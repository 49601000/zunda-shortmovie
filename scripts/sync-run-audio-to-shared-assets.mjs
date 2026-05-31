import fs from "node:fs";
import path from "node:path";

const CWD = process.cwd();
const OUTPUT_ROOT = path.resolve(CWD, "output");

function normalizeRunId(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "000";
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`SCENE_OUTPUT_RUN_ID must be numeric (e.g. 000). received="${trimmed}"`);
  }
  return trimmed.padStart(3, "0");
}

function resolveRunId() {
  const raw = process.env.SCENE_OUTPUT_RUN_ID;
  if (!raw || !String(raw).trim()) return "000";
  return normalizeRunId(raw);
}

function resolveRendererPath() {
  const explicitPath = String(process.env.SCENE_REMOTION_APP_PATH ?? "").trim();
  const pathCandidates = [
    explicitPath,
    "../remotion-renderer",
    "remotion-renderer-v1",
  ].filter(Boolean);

  for (const candidate of pathCandidates) {
    const absPath = path.resolve(CWD, candidate);
    const packageJsonPath = path.join(absPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return absPath;
    }
  }
  return "";
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listFilesByExt(fromDir, ext) {
  if (!fs.existsSync(fromDir)) return [];
  return fs
    .readdirSync(fromDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(ext.toLowerCase()))
    .map((entry) => path.join(fromDir, entry.name));
}

function removeFilesByExt(targetDir, ext) {
  if (!fs.existsSync(targetDir)) return [];
  const removed = [];
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(ext.toLowerCase())) continue;
    const filePath = path.join(targetDir, entry.name);
    fs.unlinkSync(filePath);
    removed.push(filePath);
  }
  return removed;
}

function copyAllFilesByExt(fromDir, toDir, ext) {
  if (!fs.existsSync(fromDir)) return [];
  const copied = [];
  const entries = fs.readdirSync(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(ext.toLowerCase())) continue;
    const srcPath = path.join(fromDir, entry.name);
    const dstPath = path.join(toDir, entry.name);
    ensureDir(path.dirname(dstPath));
    fs.copyFileSync(srcPath, dstPath);
    copied.push(dstPath);
  }
  return copied;
}

function main() {
  const rendererPath = resolveRendererPath();
  if (!rendererPath) {
    throw new Error(
      "Scene remotion renderer app was not found. Set SCENE_REMOTION_APP_PATH if needed."
    );
  }

  const runId = resolveRunId();
  const runAudioDir = path.join(OUTPUT_ROOT, runId, "audio");
  const sourceWavs = listFilesByExt(runAudioDir, ".wav");
  if (!sourceWavs.length) {
    console.log(`[scene-remotion:audio:sync] no run audio found: output/${runId}/audio/*.wav`);
    return;
  }

  const sharedAudioDir = path.join(rendererPath, "..", "shared-assets", "audio");
  ensureDir(sharedAudioDir);
  const removed = removeFilesByExt(sharedAudioDir, ".wav");
  const copied = copyAllFilesByExt(runAudioDir, sharedAudioDir, ".wav");
  console.log(
    `[scene-remotion:audio:sync] run=${runId} replaced shared-assets/audio: removed=${removed.length}, copied=${copied.length}`
  );
}

main();
