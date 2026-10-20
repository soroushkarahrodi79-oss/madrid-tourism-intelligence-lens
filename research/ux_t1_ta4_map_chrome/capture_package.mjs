import { createHash } from "node:crypto";
import { readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function validateCapturePackage(stagingPath, expectedSnapshot, requiredFiles) {
  const metadataPath = path.join(stagingPath, "capture-metadata.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  if (JSON.stringify(metadata.sourceSnapshot) !== JSON.stringify(expectedSnapshot)) {
    throw new Error("Staged capture metadata does not match the pinned source snapshot");
  }
  if (!Array.isArray(metadata.screenshots) || metadata.screenshots.length !== requiredFiles.length) {
    throw new Error("Staged package has an incomplete screenshot manifest");
  }
  const entries = new Map(metadata.screenshots.map((entry) => [entry.file, entry]));
  if (entries.size !== requiredFiles.length) throw new Error("Staged package contains duplicate screenshot names");
  for (const relativeFile of requiredFiles) {
    const entry = entries.get(relativeFile);
    if (!entry || path.isAbsolute(relativeFile) || relativeFile.split(/[\\/]/).includes("..")) {
      throw new Error(`Staged package is missing a safe screenshot path: ${relativeFile}`);
    }
    const bytes = await readFile(path.join(stagingPath, relativeFile));
    if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error(`Staged screenshot is not a PNG: ${relativeFile}`);
    }
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new Error(`Staged screenshot checksum/size mismatch: ${relativeFile}`);
    }
    if (!Array.isArray(entry.viewport) || entry.viewport.length !== 2 || entry.viewport.some((v) => !Number.isFinite(v) || v <= 0)) {
      throw new Error(`Staged screenshot has invalid viewport metadata: ${relativeFile}`);
    }
    if (!entry.rendered || entry.rendered.tileCount < 4 || entry.rendered.loadedTileCount < 4 ||
        entry.rendered.loadedTileCount > entry.rendered.tileCount) {
      throw new Error(`Staged screenshot lacks loaded tile/render metadata: ${relativeFile}`);
    }
  }
  if (!metadata.lightPreview || !Array.isArray(metadata.observations) || !metadata.observations.length) {
    throw new Error("Staged package lacks its preview or interaction observations");
  }
  return metadata;
}

export async function promoteVerifiedCapturePackage({ stagingPath, currentPath, backupPath, expectedSnapshot, requiredFiles }) {
  const metadata = await validateCapturePackage(stagingPath, expectedSnapshot, requiredFiles);
  let movedPrevious = false;
  try {
    await rename(currentPath, backupPath);
    movedPrevious = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await rename(stagingPath, currentPath);
  } catch (error) {
    if (movedPrevious) await rename(backupPath, currentPath);
    throw error;
  }
  if (movedPrevious) await rm(backupPath, { recursive: true, force: true });
  return metadata;
}
