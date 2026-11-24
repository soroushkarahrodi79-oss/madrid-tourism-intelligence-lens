import { pathToFileURL } from 'node:url';

const EXPECTED_JOBS = [
  'test (ubuntu-latest)',
  'test (windows-latest)',
  'chromium-browser-shard (1)',
  'chromium-browser-shard (2)',
  'chromium-browser-shard (3)',
  'ux-c1-webkit',
  'qx-webkit-smoke',
  'cluster-ux-v1-webkit',
  'geo-search-webkit',
  'ux-c2-webkit-shard (1)',
  'ux-c2-webkit-shard (2)',
  'ux-c2-webkit-shard (3)',
  'radial-halo-browser',
  'ux-c2-webkit',
];

export function currentJobsAreGreen(jobs) {
  const latest = new Map();
  for (const job of jobs) {
    if (!EXPECTED_JOBS.includes(job.name) || !Number.isInteger(job.run_attempt)) return false;
    const previous = latest.get(job.name);
    if (previous && previous.run_attempt === job.run_attempt) return false;
    if (!previous || previous.run_attempt < job.run_attempt) latest.set(job.name, job);
  }
  return latest.size === EXPECTED_JOBS.length && [...latest.values()].every(
    job => job.status === 'completed' && job.conclusion === 'success',
  );
}

function currentChecksAreGreen(checks) {
  const names = new Set(checks.map(check => check.name));
  return checks.length === EXPECTED_JOBS.length && names.size === EXPECTED_JOBS.length &&
    EXPECTED_JOBS.every(name => names.has(name)) &&
    checks.every(check => check.status === 'completed' && check.conclusion === 'success');
}

export function matchingPrs(run, prs) {
  const associated = run.pull_requests?.map(pr => pr.number) ?? [];
  return prs.filter(pr =>
    pr.state === 'open' && pr.base?.ref === 'main' &&
    pr.head?.repo?.id === run.head_repository?.id &&
    pr.head?.ref === run.head_branch &&
    (!associated.length || associated.includes(pr.number)) &&
    (run.head_sha === pr.head.sha || run.head_sha === pr.merge_commit_sha),
  );
}

export function marker(prNumber, sha) {
  return `discord-ci-green:v1 pr=${prNumber} sha=${sha}`;
}

function oneLine(value, limit) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function discordPayload(pr, now = new Date()) {
  const time = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short',
  }).format(now);
  return {
    content: [
      '🟢 MADRID LENS — CI GREEN',
      `PR #${pr.number}: ${oneLine(pr.title, 180)}`,
      `Rama: ${oneLine(pr.head.ref, 120)}`,
      `SHA: ${pr.head.sha.slice(0, 8)}`,
      '14/14 jobs verificados',
      pr.html_url,
      `Hora (Europe/Madrid): ${time}`,
    ].join('\n'),
    allowed_mentions: { parse: [] },
  };
}

async function pages(api, path, field) {
  const result = [];
  for (let page = 1; page <= 10; page++) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await api('GET', `${path}${separator}per_page=100&page=${page}`);
    const batch = field ? response?.[field] : response;
    if (!Array.isArray(batch)) throw new Error('Invalid paginated GitHub response');
    result.push(...batch);
    if (batch.length < 100) return result;
  }
  throw new Error('GitHub pagination limit exceeded; refusing to notify');
}

export async function notify({ api, sendDiscord, repo, runId, webhook, now = new Date() }) {
  if (!webhook) throw new Error('Discord webhook is absent');
  const root = `/repos/${repo}`;
  const run = await api('GET', `${root}/actions/runs/${runId}`);
  if (run.id !== Number(runId) || run.name !== 'Test' ||
      run.event !== 'pull_request' || run.status !== 'completed' ||
      run.conclusion !== 'success') return 'Test run is not a completed PR success';

  // workflow_run.pull_requests is sometimes empty, including on observed reruns.
  const prs = await pages(api, `${root}/pulls?state=open&base=main`);
  const matches = matchingPrs(run, prs);
  if (matches.length !== 1) return `Expected one matching open PR; found ${matches.length}`;
  const pr = matches[0];
  const jobs = await pages(api, `${root}/actions/runs/${runId}/jobs?filter=all`, 'jobs');
  if (jobs.some(job => job.run_attempt > run.run_attempt) || !currentJobsAreGreen(jobs)) {
    return 'Current Test jobs are not exactly 14/14 successful';
  }

  // Check all other checks on the PR head too. Pages is a main push workflow.
  const checks = await pages(api, `${root}/commits/${pr.head.sha}/check-runs?filter=latest`, 'check_runs');
  if (!currentChecksAreGreen(checks)) return 'PR check set changed or is not successful';
  const statuses = await api('GET', `${root}/commits/${pr.head.sha}/status`);
  if (!Array.isArray(statuses.statuses) || statuses.statuses.length) return 'PR status set needs review';

  // A new commit or rerun can land while the API calls above are in flight.
  const freshRun = await api('GET', `${root}/actions/runs/${runId}`);
  const freshPr = await api('GET', `${root}/pulls/${pr.number}`);
  if (freshRun.status !== 'completed' || freshRun.conclusion !== 'success' ||
      freshRun.run_attempt !== run.run_attempt ||
      matchingPrs(freshRun, [freshPr]).length !== 1 ||
      freshPr.head.sha !== pr.head.sha) return 'PR head or Test run changed during verification';

  const key = marker(pr.number, pr.head.sha);
  const comments = await pages(api, `${root}/issues/${pr.number}/comments`);
  if (comments.some(comment => comment.body?.includes(key))) return 'Notification already claimed for PR/SHA';

  // Claim before the webhook call: an uncertain Discord result cannot duplicate a message.
  const claim = await api('POST', `${root}/issues/${pr.number}/comments`, {
    body: `<!-- ${key} status=attempted run=${runId} -->`,
  });
  try {
    await sendDiscord(webhook, discordPayload(freshPr, now));
    await api('PATCH', `${root}/issues/comments/${claim.id}`, {
      body: `<!-- ${key} status=sent run=${runId} -->`,
    });
    return 'Discord notification sent';
  } catch (error) {
    // Keep the claim even on failure. Manual deletion and a Test rerun allow a retry.
    throw new Error(`Discord delivery or marker update failed; persistent claim retained: ${error.message}`);
  }
}

export async function githubApi(token, method, path, body, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    const message = oneLine(details.message, 200);
    const accepted = oneLine(response.headers.get('x-accepted-github-permissions'), 200);
    const requestId = oneLine(response.headers.get('x-github-request-id'), 100);
    throw new Error(`GitHub API ${method} ${path}: HTTP ${response.status}` +
      (message ? `; ${message}` : '') +
      (accepted ? `; accepted permissions: ${accepted}` : '') +
      (requestId ? `; request ID: ${requestId}` : ''));
  }
  return response.json();
}

async function discordPost(webhook, payload) {
  const url = new URL(webhook);
  if (url.protocol !== 'https:') throw new Error('Discord webhook must use HTTPS');
  url.searchParams.set('wait', 'true');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, TEST_RUN_ID, DISCORD_CI_WEBHOOK_URL } = process.env;
  notify({
    api: (method, path, body) => githubApi(GITHUB_TOKEN, method, path, body),
    sendDiscord: discordPost,
    repo: GITHUB_REPOSITORY,
    runId: TEST_RUN_ID,
    webhook: DISCORD_CI_WEBHOOK_URL,
  }).then(result => console.log(result)).catch(error => {
    console.error(`Discord notifier failed: ${error.message}`);
    process.exitCode = 1;
  });
}
