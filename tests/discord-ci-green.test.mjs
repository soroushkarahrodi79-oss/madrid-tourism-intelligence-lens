import test from 'node:test';
import assert from 'node:assert/strict';
import { currentJobsAreGreen, githubApi, matchingPrs, notify } from '../.github/scripts/discord-ci-green.mjs';

const sha = 'a'.repeat(40);
const names = [
  'test (ubuntu-latest)', 'test (windows-latest)',
  ...[1, 2, 3].map(n => `chromium-browser-shard (${n})`),
  'ux-c1-webkit', 'qx-webkit-smoke', 'cluster-ux-v1-webkit', 'geo-search-webkit',
  ...[1, 2, 3].map(n => `ux-c2-webkit-shard (${n})`),
  'radial-halo-browser', 'ux-c2-webkit',
];
const jobs = (attempt = 1) => names.map(name => ({
  name, run_attempt: attempt, status: 'completed', conclusion: 'success',
}));

function fixture({ allJobs = jobs(), changeHead = false, discordFails = false, claimDenied = false } = {}) {
  const pr = {
    number: 42, state: 'open', title: '@everyone a PR\nspoofed line', html_url: 'https://github.com/o/r/pull/42',
    base: { ref: 'main' }, head: { ref: 'feat/@everyone', sha, repo: { id: 7 } },
  };
  const run = {
    id: 99, name: 'Test', event: 'pull_request', status: 'completed', conclusion: 'success',
    run_attempt: 2, head_sha: sha, head_branch: pr.head.ref,
    head_repository: { id: 7 }, pull_requests: [],
  };
  const comments = [];
  const sent = [];
  let prReads = 0;
  const api = async (method, path, body) => {
    if (method === 'GET' && path.endsWith('/actions/runs/99')) return run;
    if (method === 'GET' && path.includes('/pulls?')) return [pr];
    if (method === 'GET' && path.includes('/actions/runs/99/jobs?')) return { jobs: allJobs };
    if (method === 'GET' && path.includes('/check-runs?')) {
      return { check_runs: names.map(name => ({ name, status: 'completed', conclusion: 'success' })) };
    }
    if (method === 'GET' && path.endsWith('/status')) return { statuses: [] };
    if (method === 'GET' && path.endsWith('/pulls/42')) {
      prReads++;
      return changeHead && prReads === 1
        ? { ...pr, head: { ...pr.head, sha: 'b'.repeat(40) } } : pr;
    }
    if (method === 'GET' && path.includes('/issues/42/comments?')) return comments;
    if (method === 'POST' && path.endsWith('/issues/42/comments')) {
      if (claimDenied) throw new Error('GitHub API POST: HTTP 403');
      const comment = { id: 1, ...body }; comments.push(comment); return comment;
    }
    if (method === 'PATCH' && path.endsWith('/issues/comments/1')) {
      comments[0].body = body.body; return comments[0];
    }
    throw new Error(`${method} ${path}`);
  };
  const sendDiscord = async (_webhook, payload) => {
    if (discordFails) throw new Error('HTTP 503');
    sent.push(payload);
  };
  const call = () => notify({ api, sendDiscord, repo: 'o/r', runId: 99,
    webhook: 'https://discord.com/api/webhooks/test', now: new Date('2026-11-24T17:00:00Z') });
  return { call, sent, comments };
}

test('complete success sends one safe Madrid-time message', async () => {
  const f = fixture();
  assert.equal(await f.call(), 'Discord notification sent');
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].content, /🟢 MADRID LENS — CI GREEN/);
  assert.match(f.sent[0].content, /14\/14 jobs verificados/);
  assert.match(f.sent[0].content, /Europe\/Madrid.*18:00/);
  assert.match(f.sent[0].content, /PR #42: @everyone a PR spoofed line\nRama:/);
  assert.deepEqual(f.sent[0].allowed_mentions, { parse: [] });
});

test('partial failure and pending job suppress notification', async () => {
  for (const status of [{ conclusion: 'failure' }, { status: 'in_progress', conclusion: null }]) {
    const altered = jobs(); altered[0] = { ...altered[0], ...status };
    const f = fixture({ allJobs: altered });
    assert.match(await f.call(), /not exactly 14\/14/);
    assert.equal(f.sent.length, 0);
  }
});

test('failed first attempt followed by successful rerun is green', async () => {
  const first = jobs(); first[0].conclusion = 'failure';
  const rerun = [{ ...first[0], run_attempt: 2, conclusion: 'success' }];
  assert.equal(currentJobsAreGreen([...first, ...rerun]), true);
  const f = fixture({ allJobs: [...first, ...rerun] });
  assert.equal(await f.call(), 'Discord notification sent');
});

test('repeated rerun sees persistent PR/SHA marker', async () => {
  const f = fixture();
  assert.equal(await f.call(), 'Discord notification sent');
  assert.equal(await f.call(), 'Notification already claimed for PR/SHA');
  assert.equal(f.sent.length, 1);
  assert.equal(f.comments.length, 1);
});

test('replaced commit suppresses notification', async () => {
  const f = fixture({ changeHead: true });
  assert.match(await f.call(), /changed during verification/);
  assert.equal(f.sent.length, 0);
});

test('synthetic merge SHA is accepted only for the matching PR', () => {
  const pr = { number: 42, state: 'open', base: { ref: 'main' },
    head: { ref: 'feature', sha, repo: { id: 7 } }, merge_commit_sha: 'b'.repeat(40) };
  const run = { head_sha: pr.merge_commit_sha, head_branch: 'feature',
    head_repository: { id: 7 }, pull_requests: [{ number: 42 }] };
  assert.deepEqual(matchingPrs(run, [pr]), [pr]);
  assert.deepEqual(matchingPrs({ ...run, pull_requests: [{ number: 43 }] }, [pr]), []);
});

test('Discord failure retains claim and suppresses a duplicate retry', async () => {
  const f = fixture({ discordFails: true });
  await assert.rejects(f.call(), /Discord delivery or marker update failed; persistent claim retained: HTTP 503/);
  assert.equal(await f.call(), 'Notification already claimed for PR/SHA');
  assert.match(f.comments[0].body, /status=attempted/);
});

test('403 while claiming fails visibly before contacting Discord', async () => {
  const f = fixture({ claimDenied: true });
  await assert.rejects(f.call(), /HTTP 403/);
  assert.equal(f.sent.length, 0);
  assert.equal(f.comments.length, 0);
});

test('GitHub API error includes safe reason and accepted permission hint', async () => {
  const fetchImpl = async () => ({
    ok: false, status: 403,
    headers: new Headers({
      'x-accepted-github-permissions': 'pull_requests=write',
      'x-github-request-id': 'ABCD:1234',
    }),
    json: async () => ({ message: 'Resource not accessible by integration' }),
  });
  await assert.rejects(
    githubApi('test-token', 'POST', '/repos/o/r/issues/42/comments', { body: '<!-- marker -->' }, fetchImpl),
    error => {
      assert.match(error.message, /Resource not accessible by integration/);
      assert.match(error.message, /accepted permissions: pull_requests=write/);
      assert.match(error.message, /request ID: ABCD:1234/);
      assert.doesNotMatch(error.message, /test-token/);
      return true;
    },
  );
});
