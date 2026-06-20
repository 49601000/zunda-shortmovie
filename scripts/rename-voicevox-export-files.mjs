import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const CWD = process.cwd();
const PROJECTS_ROOT = path.resolve(CWD, "projects");
const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

function parseArgs(argv) {
  const options = {
    dryRun: false,
    projectId: "",
    specPath: "",
    audioDir: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();
    if (!arg) continue;
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--project-id") {
      options.projectId = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--project-id=")) {
      options.projectId = arg.slice("--project-id=".length).trim();
      continue;
    }
    if (arg === "--spec") {
      options.specPath = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--spec=")) {
      options.specPath = arg.slice("--spec=".length).trim();
      continue;
    }
    if (arg === "--audio-dir") {
      options.audioDir = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--audio-dir=")) {
      options.audioDir = arg.slice("--audio-dir=".length).trim();
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log("Usage: node scripts/rename-voicevox-export-files.mjs [--project-id 0012] [--spec path/to/render-final-v01.json] [--audio-dir path/to/audio] [--dry-run]");
  console.log("");
  console.log("VOICEVOX export wav files like 001_...wav are renamed to seg_001.wav, seg_003.wav based on enabled scenes in render-final JSON.");
}

function normalizeProjectId(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (!/^\d+$/.test(trimmed)) throw new Error(`project id must be numeric. received=\"${trimmed}\"`);
  return trimmed.padStart(4, "0");
}

function toRelativeLabel(filePath) {
  const normalized = path.resolve(filePath);
  const relative = path.relative(CWD, normalized);
  return relative && !relative.startsWith("..") ? relative.replace(/\\/g, "/") : normalized.replace(/\\/g, "/");
}

function normalizeSpecPath(raw) {
  const trimmed = String(raw ?? "").trim();
  return trimmed ? path.resolve(CWD, trimmed) : "";
}

function findLatestProjectRenderSpec() {
  if (!fs.existsSync(PROJECTS_ROOT)) return "";
  const candidates = [];
  const projectEntries = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const videoDir = path.join(PROJECTS_ROOT, projectEntry.name, "outputs", "video");
    if (!fs.existsSync(videoDir)) continue;
    const videoEntries = fs.readdirSync(videoDir, { withFileTypes: true });
    for (const videoEntry of videoEntries) {
      if (!videoEntry.isFile()) continue;
      if (!/^render-final.*\.json$/i.test(videoEntry.name)) continue;
      const filePath = path.join(videoDir, videoEntry.name);
      const stat = fs.statSync(filePath);
      candidates.push({ filePath, mtimeMs: stat.mtimeMs });
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.filePath || "";
}

function resolveSpecPath(options) {
  const explicit = normalizeSpecPath(options.specPath);
  if (explicit) return explicit;
  const projectId = normalizeProjectId(options.projectId);
  if (projectId) return path.join(PROJECTS_ROOT, projectId, "outputs", "video", "render-final-v01.json");
  const fromEnv = normalizeSpecPath(process.env.SCENE_RENDER_SPEC_PATH || process.env.RENDER_SPEC_PATH || process.env.VOICEVOX_BATCH_SPEC_PATH);
  if (fromEnv) return fromEnv;
  const envProjectId = normalizeProjectId(process.env.SCENE_PROJECT_ID || process.env.PROJECT_ID);
  if (envProjectId) return path.join(PROJECTS_ROOT, envProjectId, "outputs", "video", "render-final-v01.json");
  return findLatestProjectRenderSpec();
}

function resolveProjectIdFromSpec(specPath, batch, options) {
  const explicit = normalizeProjectId(options.projectId);
  if (explicit) return explicit;
  const fromEnv = normalizeProjectId(process.env.SCENE_PROJECT_ID || process.env.PROJECT_ID);
  if (fromEnv) return fromEnv;
  const fromBatch = normalizeProjectId(batch?.project_id || "");
  if (fromBatch) return fromBatch;
  const normalized = specPath.replace(/\\/g, "/");
  const matched = normalized.match(/(?:^|\/)projects\/([^/]+)\//);
  return normalizeProjectId(matched?.[1] || "");
}

function resolveVoiceText(scene) {
  const fromOverride = typeof scene?.voice_override === "string" ? scene.voice_override.trim() : "";
  if (fromOverride) return fromOverride;
  const fromVoiceText = typeof scene?.voice_text === "string" ? scene.voice_text.trim() : "";
  if (fromVoiceText) return fromVoiceText;
  const fromDialog = typeof scene?.dialog?.voice === "string" ? scene.dialog.voice.trim() : "";
  if (fromDialog) return fromDialog;
  const fromVoiceString = typeof scene?.voice === "string" ? scene.voice.trim() : "";
  if (fromVoiceString) return fromVoiceString;
  const fromVoiceObj = typeof scene?.voice?.text === "string" ? scene.voice.text.trim() : "";
  return fromVoiceObj;
}

function isSceneRenderEnabled(batch, scene, index) {
  if (scene?.scene_enabled === false) return false;
  const map = batch?.render_control?.scene_visibility;
  if (!map || typeof map !== "object") return true;
  const sceneId = String(scene?.source_scene_id || scene?.scene_id || `scene_${String(index + 1).padStart(3, "0")}`).trim();
  if (!sceneId) return true;
  return map[sceneId] !== false;
}

function buildTargetEntries(batch) {
  const scenes = Array.isArray(batch?.scenes) ? batch.scenes : [];
  return scenes
    .map((scene, index) => {
      if (!isSceneRenderEnabled(batch, scene, index)) return null;
      const voiceText = resolveVoiceText(scene);
      if (!voiceText) return null;
      const sceneNumber = String(index + 1).padStart(3, "0");
      return {
        sceneIndex: index,
        sceneId: String(scene?.scene_id || `scene_${sceneNumber}`),
        voiceText,
        targetFileName: `seg_${sceneNumber}.wav`
      };
    })
    .filter(Boolean);
}

function extractLeadingNumber(name) {
  const matched = String(name || "").match(/^(\d+)/);
  return matched ? Number.parseInt(matched[1], 10) : Number.POSITIVE_INFINITY;
}

function listSourceAudioFiles(audioDir) {
  const entries = fs.readdirSync(audioDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.wav$/i.test(name))
    .filter((name) => !/^seg_\d{3}\.wav$/i.test(name))
    .sort((a, b) => {
      const aNum = extractLeadingNumber(a);
      const bNum = extractLeadingNumber(b);
      if (aNum !== bNum) return aNum - bNum;
      return collator.compare(a, b);
    });
}

function resolveAudioDir(options, specPath, batch) {
  const explicit = String(options.audioDir || "").trim();
  if (explicit) return path.resolve(CWD, explicit);
  const projectId = resolveProjectIdFromSpec(specPath, batch, options);
  if (!projectId) throw new Error("failed to resolve project id from spec path. use --project-id or --audio-dir.");
  return path.join(PROJECTS_ROOT, projectId, "outputs", "audio");
}

function buildRenamePlan(sourceFiles, targetEntries, audioDir) {
  if (sourceFiles.length !== targetEntries.length) {
    throw new Error(
      `source wav count (${sourceFiles.length}) does not match enabled scene count (${targetEntries.length}).` +
      `\nsource=${toRelativeLabel(audioDir)}`
    );
  }

  const plan = sourceFiles.map((sourceFile, index) => {
    const target = targetEntries[index];
    return {
      sourceFile,
      sourcePath: path.join(audioDir, sourceFile),
      sceneId: target.sceneId,
      targetFileName: target.targetFileName,
      targetPath: path.join(audioDir, target.targetFileName),
      voiceText: target.voiceText
    };
  });

  const targetPathSet = new Set(plan.map((item) => item.targetPath.toLowerCase()));
  if (targetPathSet.size !== plan.length) {
    throw new Error("duplicate target file names detected in rename plan.");
  }

  for (const item of plan) {
    if (item.sourcePath.toLowerCase() === item.targetPath.toLowerCase()) continue;
    if (fs.existsSync(item.targetPath)) {
      throw new Error(`target file already exists: ${toRelativeLabel(item.targetPath)}`);
    }
  }

  return plan;
}

async function executeRenamePlan(plan, dryRun) {
  const staged = [];
  for (let index = 0; index < plan.length; index += 1) {
    const item = plan[index];
    const tmpPath = `${item.sourcePath}.rename_tmp_${Date.now()}_${index}`;
    staged.push({ ...item, tmpPath });
  }

  if (dryRun) return staged;

  for (const item of staged) {
    await fsp.rename(item.sourcePath, item.tmpPath);
  }
  for (const item of staged) {
    await fsp.rename(item.tmpPath, item.targetPath);
  }
  return staged;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const specPath = resolveSpecPath(options);
  if (!specPath) throw new Error("render-final JSON not found. use --project-id or --spec.");
  if (!fs.existsSync(specPath)) throw new Error(`render-final JSON not found: ${toRelativeLabel(specPath)}`);

  const batch = JSON.parse(await fsp.readFile(specPath, "utf8"));
  const targetEntries = buildTargetEntries(batch);
  if (targetEntries.length === 0) throw new Error("no enabled scenes with voice text found in render-final JSON.");

  const audioDir = resolveAudioDir(options, specPath, batch);
  if (!fs.existsSync(audioDir)) throw new Error(`audio directory not found: ${toRelativeLabel(audioDir)}`);

  const sourceFiles = listSourceAudioFiles(audioDir);
  if (sourceFiles.length === 0) {
    throw new Error(`no VOICEVOX export wav files found in ${toRelativeLabel(audioDir)}.`);
  }

  const plan = buildRenamePlan(sourceFiles, targetEntries, audioDir);
  const staged = await executeRenamePlan(plan, options.dryRun);

  console.log(`[voicevox-rename] spec: ${toRelativeLabel(specPath)}`);
  console.log(`[voicevox-rename] audio: ${toRelativeLabel(audioDir)}`);
  console.log(`[voicevox-rename] mode: ${options.dryRun ? "dry-run" : "apply"}`);
  staged.forEach((item, index) => {
    console.log(`${String(index + 1).padStart(2, "0")}. ${item.sourceFile} -> ${item.targetFileName} (${item.sceneId})`);
  });
  console.log(`[voicevox-rename] renamed=${staged.length}`);
}

main().catch((error) => {
  console.error(`[voicevox-rename] ${error && error.message ? error.message : String(error)}`);
  process.exitCode = 1;
});
