import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {spawn} from "node:child_process";

const CWD = process.cwd();
const OUTPUT_ROOT = path.resolve(CWD, "output");
const PROJECTS_ROOT = path.resolve(CWD, "projects");
const DEFAULT_RENDERER_ROOT = path.resolve(CWD, "..", "remotion-renderer");
const DEFAULT_RENDER_SPEC_NAME = "src/data/render_spec.json";

function normalizeRunId(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "000";
  if (trimmed.toLowerCase() === "auto") return resolveNextRunId();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`SCENE_OUTPUT_RUN_ID must be numeric (e.g. 000). received="${trimmed}"`);
  }
  return trimmed.padStart(3, "0");
}

function resolveNextRunId() {
  if (!fs.existsSync(OUTPUT_ROOT)) return "000";
  const ids = fs
    .readdirSync(OUTPUT_ROOT, {withFileTypes: true})
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .filter((value) => Number.isFinite(value));
  return ids.length ? String(Math.max(...ids) + 1).padStart(3, "0") : "000";
}

function resolveRendererRoot() {
  const raw = String(process.env.SCENE_REMOTION_RENDERER_ROOT || process.env.REMOTION_RENDERER_ROOT || "").trim();
  return raw ? path.resolve(CWD, raw) : DEFAULT_RENDERER_ROOT;
}

function resolveRenderSpecPath() {
  const raw = String(process.env.SCENE_RENDER_SPEC_PATH || process.env.RENDER_SPEC_PATH || "").trim();
  if (raw) return path.resolve(CWD, raw);

  const latest = findLatestProjectRenderSpec();
  if (latest) return latest;

  return path.join(PROJECTS_ROOT, "0000", "outputs", "video", "render-final-v01.json");
}

function findLatestProjectRenderSpec() {
  if (!fs.existsSync(PROJECTS_ROOT)) return "";
  const candidates = [];
  const projectEntries = fs.readdirSync(PROJECTS_ROOT, {withFileTypes: true});
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const videoDir = path.join(PROJECTS_ROOT, projectEntry.name, "outputs", "video");
    if (!fs.existsSync(videoDir)) continue;
    const videoEntries = fs.readdirSync(videoDir, {withFileTypes: true});
    for (const videoEntry of videoEntries) {
      if (!videoEntry.isFile() || !/^render-final.*\.json$/i.test(videoEntry.name)) continue;
      const filePath = path.join(videoDir, videoEntry.name);
      candidates.push({filePath, mtimeMs: fs.statSync(filePath).mtimeMs});
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.filePath || "";
}

function resolveProjectId(spec, specPath, runId) {
  const explicit = String(process.env.SCENE_PROJECT_ID || process.env.PROJECT_ID || "").trim();
  if (explicit) return explicit.padStart(4, "0");

  const fromSpec = String(spec?.project_id || "").trim();
  if (fromSpec) return fromSpec.padStart(4, "0");

  const normalized = specPath.replace(/\\/g, "/");
  const matched = normalized.match(/(?:^|\/)projects\/([^/]+)\//);
  if (matched) return matched[1].padStart(4, "0");

  return runId.padStart(4, "0");
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isSceneEnabled(spec, scene, index) {
  if (scene?.scene_enabled === false) return false;
  const sceneId = String(scene?.scene_id || scene?.id || `scene_${String(index + 1).padStart(3, "0")}`);
  const visibility = spec?.render_control?.scene_visibility;
  if (visibility && typeof visibility === "object" && visibility[sceneId] === false) return false;
  return true;
}

function resolveSceneAudioSrc(sceneIndex, projectAudioDir) {
  const fileName = `seg_${String(sceneIndex + 1).padStart(3, "0")}.wav`;
  return fs.existsSync(path.join(projectAudioDir, fileName)) ? `/audio/${fileName}` : "";
}

function resolveSceneAssets(scene) {
  const visual = scene?.visual_assets && typeof scene.visual_assets === "object" ? scene.visual_assets : {};
  const hookVisual = scene?.hook_visual && typeof scene.hook_visual === "object" ? scene.hook_visual : {};
  const composition = scene?.composition && typeof scene.composition === "object" ? scene.composition : {};
  const characters = composition.characters && typeof composition.characters === "object" ? composition.characters : {};
  return {
    ...(scene?.scene_assets && typeof scene.scene_assets === "object" ? scene.scene_assets : {}),
    background: scene?.scene_assets?.background || visual.background || composition.background?.image_path || "",
    slide: scene?.scene_assets?.slide || visual.slide || composition.slide_area?.image_path || "",
    monolith: scene?.scene_assets?.monolith || visual.monolith || composition.monolith?.image_path || "",
    dialog_box: scene?.scene_assets?.dialog_box || visual.dialog_box || composition.dialog_box?.image_path || "",
    character_left: scene?.scene_assets?.character_left || visual.character_left || characters.left?.image_path || "",
    character_right: scene?.scene_assets?.character_right || visual.character_right || characters.right?.image_path || "",
    hook_background: scene?.scene_assets?.hook_background || visual.hook_background || hookVisual.background?.image_path || "",
    hook_character: scene?.scene_assets?.hook_character || visual.hook_character || hookVisual.character?.image_path || "",
    hook_bubble: scene?.scene_assets?.hook_bubble || visual.hook_bubble || hookVisual.bubble?.image_path || ""
  };
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function lipSyncStateName(index) {
  return `mouth_${index + 1}`;
}

function buildLipSyncFrames(imagePaths) {
  const states = normalizeStringList(imagePaths).map((_path, index) => lipSyncStateName(index));
  if (!states.length) return [];
  return states.length === 1 ? ["idle", states[0]] : ["idle", ...states, states[0]];
}

function buildLipSyncAssetMap(baseImage, imagePaths) {
  const assets = {};
  const base = String(baseImage ?? "").trim();
  if (base) assets.idle = base;
  normalizeStringList(imagePaths).forEach((imagePath, index) => {
    assets[lipSyncStateName(index)] = imagePath;
  });
  return assets;
}

function resolveSceneLipSync(scene, sceneAssets, role) {
  if (scene?.lip_sync && typeof scene.lip_sync === "object") {
    return scene.lip_sync;
  }

  const hookVisual = scene?.hook_visual && typeof scene.hook_visual === "object" ? scene.hook_visual : {};
  const composition = scene?.composition && typeof scene.composition === "object" ? scene.composition : {};
  const characters = composition.characters && typeof composition.characters === "object" ? composition.characters : {};
  const normalizedRole = String(role || scene?.role || scene?.scene_type || "").trim().toLowerCase();

  if (normalizedRole === "hook") {
    const hookDiffs = normalizeStringList(hookVisual.character?.lip_sync_image_paths);
    if (!hookDiffs.length) return undefined;
    return {
      enabled: true,
      mode: "hook",
      interval_ms: 210,
      frames: buildLipSyncFrames(hookDiffs),
      mute_non_speaking_side_to_idle: false,
      speaker: scene?.speaker || "",
      speaker_side: "hook",
      assets: {
        hook: buildLipSyncAssetMap(sceneAssets.hook_character, hookDiffs)
      }
    };
  }

  const leftDiffs = normalizeStringList(characters.left?.lip_sync_image_paths);
  const rightDiffs = normalizeStringList(characters.right?.lip_sync_image_paths);
  const speakerSide =
    characters.left?.state === "speaking"
      ? "left"
      : characters.right?.state === "speaking"
        ? "right"
        : "none";
  const speakingDiffs = speakerSide === "left" ? leftDiffs : speakerSide === "right" ? rightDiffs : [];
  if (!speakingDiffs.length) return undefined;

  return {
    enabled: true,
    mode: "scene",
    interval_ms: 210,
    frames: buildLipSyncFrames(speakingDiffs),
    mute_non_speaking_side_to_idle: true,
    speaker: scene?.speaker || "",
    speaker_side: speakerSide,
    assets: {
      left: buildLipSyncAssetMap(sceneAssets.character_left, leftDiffs),
      right: buildLipSyncAssetMap(sceneAssets.character_right, rightDiffs)
    }
  };
}

function createFallbackSubScene(scene, sceneIndex) {
  const start = toNumber(scene?.start_sec ?? scene?.start, sceneIndex * 2);
  const end = toNumber(scene?.end, NaN);
  const duration = Number.isFinite(end) && end > start
    ? end - start
    : toNumber(scene?.duration_sec, 2);
  return {
    sub_scene_id: `${scene?.scene_id || scene?.id || `scene_${String(sceneIndex + 1).padStart(3, "0")}`}_01`,
    screen_text: scene?.dialog?.screen_text || scene?.screen_text || scene?.voice || "",
    start_sec: start,
    duration_sec: duration
  };
}

function flattenScenesToSegments(spec, projectAudioDir) {
  const scenes = Array.isArray(spec?.scenes) ? spec.scenes : [];
  const segments = [];

  scenes.forEach((scene, sceneIndex) => {
    if (!isSceneEnabled(spec, scene, sceneIndex)) return;
    const sceneId = String(scene?.scene_id || scene?.id || `scene_${String(sceneIndex + 1).padStart(3, "0")}`);
    const role = scene?.role || scene?.scene_type || "normal";
    const subScenes = Array.isArray(scene?.sub_scenes) && scene.sub_scenes.length
      ? scene.sub_scenes
      : [createFallbackSubScene(scene, sceneIndex)];
    const sceneAssets = resolveSceneAssets(scene);
    const lipSync = resolveSceneLipSync(scene, sceneAssets, role);
    const audioSrc = resolveSceneAudioSrc(sceneIndex, projectAudioDir);

    subScenes.forEach((sub, subIndex) => {
      const start = Math.max(0, toNumber(sub?.start_sec ?? sub?.start, sceneIndex * 2));
      const duration = Math.max(0.001, toNumber(sub?.duration_sec, 1));
      const id = String(sub?.sub_scene_id || `${sceneId}_${String(subIndex + 1).padStart(2, "0")}`);
      const segment = {
        id,
        sub_scene_id: id,
        scene_id: sceneId,
        slide_id: scene?.slide_id || "",
        role,
        speaker: scene?.speaker || "",
        emotion: scene?.emotion || "",
        screen_text: String(sub?.screen_text || scene?.dialog?.screen_text || scene?.screen_text || ""),
        text_color: scene?.text_color || scene?.dialog?.screen_text_color || "",
        bg_color: scene?.bg_color,
        stroke_color: scene?.stroke_color,
        stroke_width: scene?.stroke_width,
        screen_text_font_size: scene?.screen_text_font_size || scene?.dialog?.screen_text_font_size,
        font_family: scene?.font_family || scene?.dialog?.screen_text_font_family,
        line_break_mode: scene?.line_break_mode || scene?.dialog?.screen_text_line_break_mode,
        line_chars: scene?.line_chars || scene?.dialog?.screen_text_line_chars,
        text_position_preset: scene?.text_position_preset,
        text_offset_y: scene?.text_offset_y,
        voice: scene?.voice || scene?.dialog?.voice || "",
        voice_override: scene?.voice_override || "",
        voice_style: scene?.voice_style || "",
        voice_speed: scene?.voice_speed,
        speakerId: scene?.speakerId,
        background_override: scene?.background_override || sceneAssets.background || spec?.background || "",
        scene_assets: sceneAssets,
        effects: Array.isArray(scene?.effects) ? scene.effects : [],
        lip_sync: lipSync,
        hook_texts: scene?.hook_texts,
        hook_visual: scene?.hook_visual,
        start,
        end: Number((start + duration).toFixed(3)),
        duration_sec: Number(duration.toFixed(3))
      };
      if (subIndex === 0 && audioSrc) segment.audioSrc = audioSrc;
      segments.push(segment);
    });
  });

  return segments.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return a.end - b.end;
    return String(a.id).localeCompare(String(b.id), "ja", {numeric: true});
  });
}

function prepareRendererSpec(spec, projectAudioDir) {
  const nextSpec = JSON.parse(JSON.stringify(spec));
  if (!Array.isArray(nextSpec.segments) || nextSpec.segments.length === 0) {
    nextSpec.segments = flattenScenesToSegments(nextSpec, projectAudioDir);
  }
  if (nextSpec.video_spec && Object.prototype.hasOwnProperty.call(nextSpec.video_spec, "segments")) {
    delete nextSpec.video_spec.segments;
  }
  return nextSpec;
}

async function syncProjectAudioToSharedAssets(projectAudioDir, rendererRoot) {
  if (!fs.existsSync(projectAudioDir)) return {copied: 0, skipped: true};
  const sharedAudioDir = path.resolve(rendererRoot, "..", "shared-assets", "audio");
  await fsp.mkdir(sharedAudioDir, {recursive: true});
  const entries = await fsp.readdir(projectAudioDir, {withFileTypes: true});
  let copied = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/\.wav$/i.test(entry.name)) continue;
    await fsp.copyFile(path.join(projectAudioDir, entry.name), path.join(sharedAudioDir, entry.name));
    copied += 1;
  }
  return {copied, skipped: false};
}

async function syncSpecToRenderer({specPath, runId, rendererRoot, dryRun}) {
  if (!fs.existsSync(specPath)) throw new Error(`render spec not found: ${specPath}`);
  if (!fs.existsSync(rendererRoot)) throw new Error(`renderer root not found: ${rendererRoot}`);

  const raw = await fsp.readFile(specPath, "utf8");
  const spec = JSON.parse(raw);
  const projectId = resolveProjectId(spec, specPath, runId);
  const projectAudioDir = path.join(PROJECTS_ROOT, projectId, "outputs", "audio");
  const rendererSpec = prepareRendererSpec(spec, projectAudioDir);
  const rendererSpecPath = path.join(rendererRoot, DEFAULT_RENDER_SPEC_NAME);

  console.log(`[scene-remotion] run=${runId} project=${projectId}`);
  console.log(`[scene-remotion] spec: ${path.relative(CWD, specPath)}`);
  console.log(`[scene-remotion] renderer: ${rendererRoot}`);
  console.log(`[scene-remotion] segments=${rendererSpec.segments.length}`);

  if (dryRun) return {rendererSpecPath, projectId, copiedAudio: 0};

  await fsp.mkdir(path.dirname(rendererSpecPath), {recursive: true});
  await fsp.writeFile(rendererSpecPath, `${JSON.stringify(rendererSpec, null, 2)}\n`, "utf8");
  const audioResult = await syncProjectAudioToSharedAssets(projectAudioDir, rendererRoot);
  console.log(`[scene-remotion] wrote: ${rendererSpecPath}`);
  console.log(`[scene-remotion] audio sync: copied=${audioResult.copied}${audioResult.skipped ? " (project audio dir not found)" : ""}`);
  return {rendererSpecPath, projectId, copiedAudio: audioResult.copied};
}

function runCommand(command, args, options) {
  const finalCommand = process.platform === "win32" && (command === "npm" || command === "npx")
    ? `${command}.cmd`
    : command;
  const commandArgs = [...args];
  if (process.platform === "win32") {
    const commandLine = [finalCommand, ...commandArgs].map(windowsShellQuote).join(" ");
    return new Promise((resolve, reject) => {
      const child = spawn("cmd.exe", ["/d", "/s", "/c", commandLine], {stdio: "inherit", shell: false, ...options});
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
      });
    });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(finalCommand, commandArgs, {stdio: "inherit", shell: false, ...options});
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

function windowsShellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
  return `"${text.replace(/(["^&|<>])/g, "^$1")}"`;
}

async function moveRenderedMovie(rendererRoot, runId, dryRun) {
  const source = path.join(rendererRoot, "out", "psych-short.mp4");
  const targetDir = path.join(OUTPUT_ROOT, runId, "video");
  const target = path.join(targetDir, `psych-short-${runId}.mp4`);
  if (dryRun) return;
  if (!fs.existsSync(source)) {
    console.warn(`[scene-remotion] rendered movie not found: ${source}`);
    return;
  }
  await fsp.mkdir(targetDir, {recursive: true});
  await fsp.copyFile(source, target);
  console.log(`[scene-remotion] copied movie: ${path.relative(CWD, target)}`);
}

async function main() {
  const mode = process.argv[2] || "help";
  const flags = new Set(process.argv.slice(3));
  const dryRun = flags.has("--dry-run");
  const runId = normalizeRunId(process.env.SCENE_OUTPUT_RUN_ID);
  const specPath = resolveRenderSpecPath();
  const rendererRoot = resolveRendererRoot();

  if (mode === "help" || mode === "--help" || mode === "-h") {
    console.log("Usage: node scripts/run-scene-remotion.mjs <dev|render|voicevox|voicevox:initial|voicevox:publish|typecheck|sync-spec> [--dry-run]");
    return;
  }

  await syncSpecToRenderer({specPath, runId, rendererRoot, dryRun});

  if (mode === "sync-spec") return;
  if (dryRun) {
    console.log(`[scene-remotion] dry-run: skipped renderer command for mode=${mode}`);
    return;
  }

  if (mode === "dev") {
    await runCommand("npm", ["run", "dev"], {cwd: rendererRoot});
    return;
  }
  if (mode === "render") {
    await runCommand("npm", ["run", "render"], {cwd: rendererRoot});
    await moveRenderedMovie(rendererRoot, runId, dryRun);
    return;
  }
  if (mode === "voicevox" || mode === "voicevox:initial" || mode === "voicevox:publish") {
    await runCommand("npm", ["run", "voicevox"], {cwd: rendererRoot});
    return;
  }
  if (mode === "typecheck") {
    await runCommand("npx", ["tsc", "--noEmit"], {cwd: rendererRoot});
    return;
  }

  throw new Error(`Unknown scene-remotion mode: ${mode}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
