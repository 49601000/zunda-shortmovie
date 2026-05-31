import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function normalizeRunId(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    throw new Error("run_id is required.");
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`run_id must be numeric (e.g. 007). received="${trimmed}"`);
  }
  return trimmed.padStart(3, "0");
}

function spawnNpmRun(scriptName, extraEnv = {}) {
  if (process.platform === "win32") {
    return spawn("cmd.exe", ["/d", "/s", "/c", `npm run ${scriptName}`], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: {...process.env, ...extraEnv},
    });
  }
  return spawn("npm", ["run", scriptName], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {...process.env, ...extraEnv},
  });
}

function resolveSpecPath(runId) {
  const candidates = [
    path.resolve(process.cwd(), "output", runId, "spec", "svrs_scene_render_spec.json"),
    path.resolve(process.cwd(), "output", runId, "spec", "scene_render_spec.json"),
    path.resolve(process.cwd(), "output", runId, "audio", `voicevox-batch-spec-${runId}.json`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return {path: candidate, candidates};
    }
  }
  return {path: "", candidates};
}

function listKnownRunIds() {
  const outputRoot = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outputRoot)) return [];
  return fs
    .readdirSync(outputRoot, {withFileTypes: true})
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
    .map((d) => d.name)
    .sort();
}

function main() {
  const runId = normalizeRunId(process.argv[2]);
  const npmScript = (process.argv[3] ?? "scene-remotion:render").trim();
  const {path: specPath, candidates} = resolveSpecPath(runId);

  if (!specPath) {
    const knownRuns = listKnownRunIds();
    throw new Error(
      [
        "scene spec file was not found.",
        "checked:",
        ...candidates.map((p) => `- ${p}`),
        knownRuns.length ? `known run_ids: ${knownRuns.join(", ")}` : "known run_ids: (none)",
        "Save svrs_scene_render_spec.json or voicevox-batch-spec-<run_id>.json for this run_id.",
      ].join("\n")
    );
  }

  console.log(`[render-by-runid] run_id=${runId}`);
  console.log(`[render-by-runid] spec=${specPath}`);
  console.log(`[render-by-runid] script=${npmScript}`);

  const child = spawnNpmRun(npmScript, {
    SCENE_OUTPUT_RUN_ID: runId,
    SCENE_RENDER_SPEC_PATH: specPath,
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

try {
  main();
} catch (error) {
  console.error(
    `[render-by-runid] ${error instanceof Error ? error.message : String(error)}`
  );
  console.error("Usage: npm run scene-remotion:render:runid -- <run_id> [scene-remotion-script]");
  console.error("Example: npm run scene-remotion:render:runid -- 007");
  process.exit(1);
}
