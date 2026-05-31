import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const script = process.argv[2];
const explicitPath = process.env.SCENE_REMOTION_APP_PATH;
const pathCandidates = [
  explicitPath,
  "../remotion-renderer",
  "remotion-renderer-v1",
].filter(Boolean);
const OUTPUT_ROOT = path.resolve(process.cwd(), "output");

function resolveRendererPath() {
  for (const candidate of pathCandidates) {
    const absPath = path.resolve(process.cwd(), candidate);
    const packageJsonPath = path.join(absPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return { absPath, packageJsonPath };
    }
  }
  return null;
}

function readPackageScripts(packageJsonPath) {
  try {
    const raw = fs.readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed.scripts ?? {} : {};
  } catch (_err) {
    return {};
  }
}

function resolveScriptAlias(requestedScript, scriptsMap) {
  if (scriptsMap[requestedScript]) {
    return { scriptToRun: requestedScript, fallbackReason: "" };
  }

  if (
    (requestedScript === "voicevox:initial" || requestedScript === "voicevox:publish") &&
    scriptsMap.voicevox
  ) {
    return {
      scriptToRun: "voicevox",
      fallbackReason:
        `"${requestedScript}" が未定義のため "voicevox" を実行します。` +
        "（renderer側に voicevox:initial/publish を追加すると個別実行できます）",
    };
  }

  return { scriptToRun: "", fallbackReason: "" };
}

function spawnNpmRun(scriptName, cwd) {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", `npm run ${scriptName}`], {
      cwd,
      stdio: "inherit",
    });
  }
  return spawn("npm", ["run", scriptName], {
    cwd,
    stdio: "inherit",
  });
}

function spawnNodeScript(scriptPath, cwd, extraEnv = {}) {
  return spawn(process.execPath, [scriptPath], {
    cwd,
    stdio: "inherit",
    env: {...process.env, ...extraEnv},
  });
}

function normalizeRunId(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`SCENE_OUTPUT_RUN_ID must be numeric (e.g. 000). received="${trimmed}"`);
  }
  return trimmed.padStart(3, "0");
}

function resolveNextRunId(baseOutputRoot) {
  if (!fs.existsSync(baseOutputRoot)) {
    return "000";
  }
  const names = fs.readdirSync(baseOutputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .filter((n) => Number.isFinite(n));
  if (!names.length) return "000";
  return String(Math.max(...names) + 1).padStart(3, "0");
}

function resolveRunId() {
  const raw = process.env.SCENE_OUTPUT_RUN_ID;
  if (!raw || !String(raw).trim()) {
    return "000";
  }
  if (String(raw).trim().toLowerCase() === "auto") {
    return resolveNextRunId(OUTPUT_ROOT);
  }
  return normalizeRunId(raw);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFileIfExists(fromPath, toPath) {
  if (!fs.existsSync(fromPath)) return false;
  ensureDir(path.dirname(toPath));
  fs.copyFileSync(fromPath, toPath);
  return true;
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

function copyAllImageFilesRecursive(fromDir, toDir) {
  if (!fs.existsSync(fromDir)) return [];
  const copied = [];
  const entries = fs.readdirSync(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(fromDir, entry.name);
    const dstPath = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      copied.push(...copyAllImageFilesRecursive(srcPath, dstPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(png|jpe?g|webp|avif)$/i.test(entry.name)) continue;
    ensureDir(path.dirname(dstPath));
    fs.copyFileSync(srcPath, dstPath);
    copied.push(dstPath);
  }
  return copied;
}

function listFilesByExt(fromDir, ext) {
  if (!fs.existsSync(fromDir)) return [];
  return fs
    .readdirSync(fromDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(ext.toLowerCase()))
    .map((entry) => path.join(fromDir, entry.name));
}

function pickLatestFile(filePaths) {
  if (!Array.isArray(filePaths) || !filePaths.length) return "";
  return filePaths
    .map((filePath) => {
      try {
        const st = fs.statSync(filePath);
        return { filePath, mtimeMs: st.mtimeMs };
      } catch (_err) {
        return { filePath, mtimeMs: -1 };
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0].filePath;
}

function snapshotArtifacts({ rendererPath, outputRunDir, executedScript, runId }) {
  const copied = [];
  const audioSrcDir = path.join(rendererPath, "..", "shared-assets", "audio");
  const videoSrcDir = path.join(rendererPath, "out");
  const specPath = path.join(rendererPath, "src", "data", "render_spec.json");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const specSnapshotPath = path.join(outputRunDir, "spec", `render_spec.${stamp}.json`);
  if (copyFileIfExists(specPath, specSnapshotPath)) {
    copied.push(specSnapshotPath);
  }

  if (executedScript === "voicevox") {
    const audioCopied = copyAllFilesByExt(audioSrcDir, path.join(outputRunDir, "audio"), ".wav");
    copied.push(...audioCopied);
  }

  if (executedScript === "render") {
    const videoOutDir = path.join(outputRunDir, "video");
    const sourceVideos = listFilesByExt(videoSrcDir, ".mp4");
    const latestVideo = pickLatestFile(sourceVideos);
    if (latestVideo) {
      const normalizedRunId = String(runId || "000");
      const fixedNamePath = path.join(videoOutDir, `short-${normalizedRunId}.mp4`);
      ensureDir(path.dirname(fixedNamePath));
      fs.copyFileSync(latestVideo, fixedNamePath);
      copied.push(fixedNamePath);
    }
  }

  return copied;
}

function shouldSyncSceneSpec(scriptToRun) {
  return scriptToRun === "dev" || scriptToRun === "render" || scriptToRun === "voicevox";
}

function sanitizeSceneRenderSpecPathEnv() {
  const raw = String(process.env.SCENE_RENDER_SPEC_PATH ?? "").trim();
  if (!raw) {
    return {value: "", warning: ""};
  }
  const resolved = path.resolve(process.cwd(), raw);
  if (!fs.existsSync(resolved)) {
    return {
      value: "",
      warning:
        `[run-scene-remotion] SCENE_RENDER_SPEC_PATH was set but file not found: ${resolved}\n` +
        "[run-scene-remotion] ignoring stale SCENE_RENDER_SPEC_PATH and using default candidates."
    };
  }
  return {value: resolved, warning: ""};
}

function syncRunAudioToSharedAssets({ rendererPath, runId }) {
  const runAudioDir = path.join(OUTPUT_ROOT, runId, "audio");
  const sharedAudioDir = path.join(rendererPath, "..", "shared-assets", "audio");
  const sourceWavs = listFilesByExt(runAudioDir, ".wav");
  if (!sourceWavs.length) {
    return { copied: [], removed: [] };
  }
  ensureDir(sharedAudioDir);
  const removed = removeFilesByExt(sharedAudioDir, ".wav");
  const copied = copyAllFilesByExt(runAudioDir, sharedAudioDir, ".wav");
  return { copied, removed };
}

function syncProjectImagesToSharedAssets({ rendererPath }) {
  const projectImagesDir = path.resolve(process.cwd(), "assets", "images");
  const sharedImagesDir = path.join(rendererPath, "..", "shared-assets", "images");
  return copyAllImageFilesRecursive(projectImagesDir, sharedImagesDir);
}

function runSceneSpecSync({rendererPath, runId, sceneRenderSpecPath}) {
  return new Promise((resolve, reject) => {
    const syncScriptPath = path.resolve(process.cwd(), "scripts", "sync-scene-render-spec.mjs");
    if (!fs.existsSync(syncScriptPath)) {
      resolve();
      return;
    }

    console.log("[run-scene-remotion] syncing svrs_scene_render_spec -> render_spec.json ...");
    console.log(`[run-scene-remotion] sync script: ${syncScriptPath}`);
    const child = spawnNodeScript(syncScriptPath, process.cwd(), {
      SCENE_OUTPUT_RUN_ID: runId,
      SCENE_REMOTION_APP_PATH: rendererPath,
      SCENE_RENDER_SPEC_PATH: sceneRenderSpecPath,
    });

    child.on("exit", (code) => {
      const exitCode = code ?? 1;
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(`scene spec sync failed with exit code ${exitCode}`));
    });
  });
}

if (!script) {
  console.log("Usage: node scripts/run-scene-remotion.mjs <npm-script>");
  console.log(
    "Examples: dev | render | voicevox | voicevox:initial | voicevox:publish"
  );
  console.log("Path priority:");
  pathCandidates.forEach((p) => console.log(`- ${path.resolve(process.cwd(), p)}`));
  process.exit(0);
}

const resolved = resolveRendererPath();
if (!resolved) {
  console.error("Scene remotion renderer app was not found.");
  console.error("Checked paths:");
  pathCandidates.forEach((p) => console.error(`- ${path.resolve(process.cwd(), p)}`));
  console.error(
    "Set SCENE_REMOTION_APP_PATH env var if your app is in a different location."
  );
  process.exit(1);
}

const scriptsMap = readPackageScripts(resolved.packageJsonPath);
const { scriptToRun, fallbackReason } = resolveScriptAlias(script, scriptsMap);
const runId = resolveRunId();
const outputRunDir = path.join(OUTPUT_ROOT, runId);

if (!scriptToRun) {
  console.error(`npm script "${script}" was not found in ${resolved.packageJsonPath}`);
  const names = Object.keys(scriptsMap);
  if (names.length) {
    console.error("Available scripts:");
    names.forEach((name) => console.error(`- ${name}`));
  } else {
    console.error("No scripts were detected in package.json.");
  }
  process.exit(1);
}

if (fallbackReason) {
  console.warn(`[run-scene-remotion] ${fallbackReason}`);
}

ensureDir(outputRunDir);
console.log(`[run-scene-remotion] output run dir: ${outputRunDir}`);
const launch = async () => {
  const {value: sceneRenderSpecPath, warning: sceneSpecWarn} = sanitizeSceneRenderSpecPathEnv();
  if (sceneSpecWarn) {
    console.warn(sceneSpecWarn);
  }
  try {
    if (shouldSyncSceneSpec(scriptToRun)) {
      await runSceneSpecSync({rendererPath: resolved.absPath, runId, sceneRenderSpecPath});
    }
    if (scriptToRun === "render" || scriptToRun === "dev") {
      const copiedImages = syncProjectImagesToSharedAssets({ rendererPath: resolved.absPath });
      if (copiedImages.length) {
        console.log(`[run-scene-remotion] synced project images -> shared-assets: ${copiedImages.length}`);
      } else {
        console.log("[run-scene-remotion] no project images synced (assets/images not found or empty).");
      }
    }
    if (scriptToRun === "render" || scriptToRun === "dev") {
      const syncResult = syncRunAudioToSharedAssets({ rendererPath: resolved.absPath, runId });
      if (syncResult.copied.length) {
        console.log(
          `[run-scene-remotion] replaced shared-assets audio from run ${runId}: ` +
          `removed=${syncResult.removed.length}, copied=${syncResult.copied.length}`
        );
      } else {
        console.log("[run-scene-remotion] no run audio to sync (output/<run_id>/audio/*.wav).");
      }
    }
  } catch (error) {
    console.error(
      `[run-scene-remotion] ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
    return;
  }

  const child = spawnNpmRun(scriptToRun, resolved.absPath);

  child.on("exit", (code) => {
    const exitCode = code ?? 1;
    if (exitCode !== 0) {
      process.exit(exitCode);
      return;
    }

    try {
      const copied = snapshotArtifacts({
        rendererPath: resolved.absPath,
        outputRunDir,
        executedScript: scriptToRun,
        runId,
      });
      if (copied.length) {
        console.log(`[run-scene-remotion] copied artifacts: ${copied.length}`);
      } else {
        console.log("[run-scene-remotion] no artifacts copied for this command.");
      }
    } catch (error) {
      console.error(
        `[run-scene-remotion] artifact copy failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      process.exit(1);
      return;
    }

    process.exit(0);
  });
};

launch();

