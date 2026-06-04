import fs from "node:fs";
import path from "node:path";

const CWD = process.cwd();
const OUTPUT_ROOT = path.resolve(CWD, "output");
const PROJECTS_ROOT = path.resolve(CWD, "projects");

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

function normalizeProjectId(raw, fallbackRunId) {
  const trimmed = String(raw ?? "").trim();
  if (trimmed) return trimmed.padStart(4, "0");
  return String(fallbackRunId || "000").padStart(4, "0");
}

function resolveProjectId(runId) {
  const explicit = process.env.SCENE_PROJECT_ID || process.env.PROJECT_ID;
  if (explicit && String(explicit).trim()) {
    return normalizeProjectId(explicit, runId);
  }

  const specPath = String(process.env.SCENE_RENDER_SPEC_PATH || "").trim();
  const normalizedSpecPath = specPath.replace(/\\/g, "/");
  const matched = normalizedSpecPath.match(/(?:^|\/)projects\/([^/]+)\//);
  if (matched) {
    return normalizeProjectId(matched[1], runId);
  }

  return normalizeProjectId("", runId);
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
  const runId = resolveRunId();
  const projectId = resolveProjectId(runId);
  const runAudioDir = path.join(OUTPUT_ROOT, runId, "audio");
  const sourceWavs = listFilesByExt(runAudioDir, ".wav");
  if (!sourceWavs.length) {
    console.log(`[scene-remotion:audio:sync] no run audio found: output/${runId}/audio/*.wav`);
    return;
  }

  const projectAudioDir = path.join(PROJECTS_ROOT, projectId, "outputs", "audio");
  ensureDir(projectAudioDir);
  const removed = removeFilesByExt(projectAudioDir, ".wav");
  const copied = copyAllFilesByExt(runAudioDir, projectAudioDir, ".wav");
  console.log(
    `[scene-remotion:audio:sync] run=${runId} project=${projectId} replaced projects/${projectId}/outputs/audio: removed=${removed.length}, copied=${copied.length}`
  );
}

main();
