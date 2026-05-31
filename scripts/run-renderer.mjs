import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const script = process.argv[2];
const defaultRendererPath = "../16_ショート動画作成/psych-short-renderer";
const rendererPath = process.env.RENDERER_APP_PATH ?? defaultRendererPath;
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

const absPath = path.resolve(process.cwd(), rendererPath);
const packageJsonPath = path.join(absPath, "package.json");

if (!script) {
  console.log("Usage: node scripts/run-renderer.mjs <npm-script>");
  console.log("Examples: dev | render | voicevox");
  console.log(`Current renderer path: ${absPath}`);
  process.exit(0);
}

if (!fs.existsSync(packageJsonPath)) {
  console.error("Renderer app was not found.");
  console.error(`Expected package.json at: ${packageJsonPath}`);
  console.error(
    "Set RENDERER_APP_PATH env var if your renderer app is in a different location."
  );
  process.exit(1);
}

const child = spawnNpmRun(script, absPath);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
