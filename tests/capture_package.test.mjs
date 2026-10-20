import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promoteVerifiedCapturePackage } from "../research/ux_t1_ta4_map_chrome/capture_package.mjs";

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from("small deterministic PNG fixture"),
]);
const digest = createHash("sha256").update(png).digest("hex");
const snapshot = { commit: "pinned-source", manifestSha256: "pinned-manifest" };
const file = "screenshots/sample.png";
const metadata = {
  sourceSnapshot: snapshot,
  screenshots: [{
    file, sha256: digest, bytes: png.length, viewport: [1440, 900],
    rendered: { tileCount: 4, loadedTileCount: 4 },
  }],
  lightPreview: { type: "test-only" }, observations: [{ name: "probe" }],
};

test("capture promotion verifies the complete staged package and preserves the prior package on failure", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ta4-capture-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const currentPath = path.join(root, "capture-current");
  const stagingPath = path.join(root, "capture-staging");
  const backupPath = path.join(root, "capture-previous");
  await mkdir(currentPath);
  await writeFile(path.join(currentPath, "verified.txt"), "last verified package");

  async function writeStage(stageMetadata) {
    await mkdir(path.join(stagingPath, "screenshots"), { recursive: true });
    await writeFile(path.join(stagingPath, file), png);
    await writeFile(path.join(stagingPath, "capture-metadata.json"), JSON.stringify(stageMetadata));
  }

  await writeStage(metadata);
  await assert.rejects(promoteVerifiedCapturePackage({
    stagingPath, currentPath, backupPath, expectedSnapshot: { ...snapshot, commit: "wrong" }, requiredFiles: [file],
  }), /pinned source snapshot/);
  assert.equal(await readFile(path.join(currentPath, "verified.txt"), "utf8"), "last verified package");

  await rm(stagingPath, { recursive: true, force: true });
  await writeStage({ ...metadata, screenshots: [{ ...metadata.screenshots[0], sha256: "incorrect" }] });
  await assert.rejects(promoteVerifiedCapturePackage({
    stagingPath, currentPath, backupPath, expectedSnapshot: snapshot, requiredFiles: [file],
  }), /checksum\/size mismatch/);
  assert.equal(await readFile(path.join(currentPath, "verified.txt"), "utf8"), "last verified package");

  await rm(stagingPath, { recursive: true, force: true });
  await writeStage(metadata);
  await promoteVerifiedCapturePackage({ stagingPath, currentPath, backupPath, expectedSnapshot: snapshot, requiredFiles: [file] });
  assert.equal(await readFile(path.join(currentPath, "capture-metadata.json"), "utf8"), JSON.stringify(metadata));
  assert.equal(await readFile(path.join(currentPath, file)).then((bytes) => bytes.equals(png)), true);
  await assert.rejects(readFile(path.join(currentPath, "verified.txt")), { code: "ENOENT" });
  await assert.rejects(readFile(backupPath), { code: "ENOENT" });
});
