import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const VOICEVOX_BASE_URL = process.env.VOICEVOX_URL ?? "http://127.0.0.1:50021";
const OUTPUT_ROOT = path.resolve(process.cwd(), "output");
const DEFAULT_SPEAKER_ID = 3;
const DEFAULT_SPEED_SCALE = 1.45;

function normalizeRunId(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`SCENE_OUTPUT_RUN_ID must be numeric (e.g. 000). received="${trimmed}"`);
  }
  return trimmed.padStart(3, "0");
}

function resolveNextRunId(baseOutputRoot) {
  if (!fs.existsSync(baseOutputRoot)) return "000";
  const names = fs.readdirSync(baseOutputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .filter((n) => Number.isFinite(n));
  if (!names.length) return "000";
  return String(Math.max(...names) + 1).padStart(3, "0");
}

function resolveRunId() {
  const raw = process.env.SCENE_OUTPUT_RUN_ID;
  if (!raw || !String(raw).trim()) return "000";
  if (String(raw).trim().toLowerCase() === "auto") {
    return resolveNextRunId(OUTPUT_ROOT);
  }
  return normalizeRunId(raw);
}

function readFourCC(buffer, offset) {
  if (offset + 4 > buffer.length) return "";
  return buffer.toString("ascii", offset, offset + 4);
}

function resolveWavDurationSec(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return null;
  if (readFourCC(buffer, 0) !== "RIFF" || readFourCC(buffer, 8) !== "WAVE") return null;

  let offset = 12;
  let byteRate = null;
  let dataSize = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = readFourCC(buffer, offset);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkSize > buffer.length) break;

    if (chunkId === "fmt " && chunkSize >= 16) {
      byteRate = buffer.readUInt32LE(chunkDataOffset + 8);
    } else if (chunkId === "data") {
      dataSize = chunkSize;
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    offset = chunkDataOffset + paddedSize;
  }

  if (!byteRate || dataSize == null || byteRate <= 0) return null;
  return dataSize / byteRate;
}

async function assertOk(response, stepName) {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  const snippet = body ? `\n${body.slice(0, 500)}` : "";
  throw new Error(`${stepName} failed: ${response.status} ${response.statusText}${snippet}`);
}

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveSpeakerId(scene) {
  const fromVoice = Number(scene?.voice?.voicevox_style_id);
  if (Number.isFinite(fromVoice)) return fromVoice;
  const fromFlat = Number(scene?.voicevox_style_id);
  if (Number.isFinite(fromFlat)) return fromFlat;
  return DEFAULT_SPEAKER_ID;
}

function resolveSpeedScale(scene) {
  return toFiniteNumber(scene?.speedScale, DEFAULT_SPEED_SCALE);
}

function resolveSceneOrder(scene, index) {
  const candidate = String(scene?.scene_id || scene?.source_scene_id || "").trim();
  const matched = candidate.match(/(\d+)/);
  if (matched) {
    const n = Number.parseInt(matched[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return index + 1;
}

function resolveFileName(scene, index) {
  return `seg_${String(resolveSceneOrder(scene, index)).padStart(3, "0")}.wav`;
}

function resolveVoiceText(scene) {
  const fromVoiceText = typeof scene?.voice_text === "string" ? scene.voice_text.trim() : "";
  if (fromVoiceText) return fromVoiceText;
  const fromVoiceObj = typeof scene?.voice?.text === "string" ? scene.voice.text.trim() : "";
  return fromVoiceObj;
}

function isSceneRenderEnabled(batch, scene, index) {
  const map = batch?.render_control?.scene_visibility;
  if (!map || typeof map !== "object") return true;
  const sceneId = String(scene?.source_scene_id || scene?.scene_id || `scene_${String(index + 1).padStart(3, "0")}`).trim();
  if (!sceneId) return true;
  const value = map[sceneId];
  if (value === false) return false;
  return true;
}

function applyVoiceControl(audioQuery, scene, fallbackSpeed) {
  const control = scene?.voice_control && typeof scene.voice_control === "object" ? scene.voice_control : {};
  audioQuery.speedScale = toFiniteNumber(scene?.speedScale, toFiniteNumber(control.speedScale, fallbackSpeed));
  audioQuery.pitchScale = toFiniteNumber(control.pitchScale, audioQuery.pitchScale);
  audioQuery.intonationScale = toFiniteNumber(control.intonationScale, audioQuery.intonationScale);
  audioQuery.volumeScale = toFiniteNumber(control.volumeScale, audioQuery.volumeScale);
  audioQuery.prePhonemeLength = toFiniteNumber(control.prePhonemeLength, audioQuery.prePhonemeLength);
  audioQuery.postPhonemeLength = toFiniteNumber(control.postPhonemeLength, audioQuery.postPhonemeLength);
  if (control.pauseLength == null || String(control.pauseLength).trim() === "") {
    // Keep engine default pause length when not provided.
  } else {
    audioQuery.pauseLength = toFiniteNumber(control.pauseLength, audioQuery.pauseLength);
  }
  audioQuery.pauseLengthScale = toFiniteNumber(control.pauseLengthScale, audioQuery.pauseLengthScale);
}

async function synthesizeVoice({ text, speakerId, scene }) {
  const queryParams = new URLSearchParams({ text, speaker: String(speakerId) });
  const queryResponse = await fetch(`${VOICEVOX_BASE_URL}/audio_query?${queryParams.toString()}`, {
    method: "POST"
  });
  await assertOk(queryResponse, "audio_query");
  const audioQuery = await queryResponse.json();
  applyVoiceControl(audioQuery, scene, resolveSpeedScale(scene));

  const synthResponse = await fetch(
    `${VOICEVOX_BASE_URL}/synthesis?${new URLSearchParams({ speaker: String(speakerId) }).toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/wav"
      },
      body: JSON.stringify(audioQuery)
    }
  );
  await assertOk(synthResponse, "synthesis");
  return Buffer.from(await synthResponse.arrayBuffer());
}

function resolveBatchSpecPath(runId) {
  const explicit = process.env.VOICEVOX_BATCH_SPEC_PATH;
  if (explicit && String(explicit).trim()) {
    return path.resolve(process.cwd(), String(explicit).trim());
  }
  return path.join(OUTPUT_ROOT, runId, "audio", `voicevox-batch-spec-${runId}.json`);
}

function isConnectionError(error) {
  const message = String(error?.message ?? "");
  return /ECONNREFUSED|ENOTFOUND|fetch failed|127\.0\.0\.1:50021/i.test(message);
}

async function main() {
  const runId = resolveRunId();
  const specPath = resolveBatchSpecPath(runId);
  const audioDir = path.dirname(specPath);
  const outputDirLabel = `output/${runId}/audio`;

  const raw = await fsp.readFile(specPath, "utf8");
  const batch = JSON.parse(raw);
  if (!batch || typeof batch !== "object" || !Array.isArray(batch.scenes)) {
    throw new Error("voicevox batch spec is invalid: scenes[] not found.");
  }

  await fsp.mkdir(audioDir, { recursive: true });

  let generated = 0;
  let skipped = 0;
  const results = [];

  for (let index = 0; index < batch.scenes.length; index += 1) {
    const scene = batch.scenes[index];
    if (!isSceneRenderEnabled(batch, scene, index)) {
      skipped += 1;
      continue;
    }
    const voiceText = resolveVoiceText(scene);
    if (!voiceText) {
      skipped += 1;
      continue;
    }

    const speakerId = resolveSpeakerId(scene);
    const fileName = resolveFileName(scene, index);
    const outputPath = path.join(audioDir, fileName);
    const audioBuffer = await synthesizeVoice({ text: voiceText, speakerId, scene });
    const durationSec = resolveWavDurationSec(audioBuffer);
    await fsp.writeFile(outputPath, audioBuffer);

    const speedScale = resolveSpeedScale(scene);
    const durationLabel = durationSec != null ? `${Number(durationSec.toFixed(3))}s` : "n/a";
    console.log(`Generated: ${fileName} speakerId=${speakerId} speedScale=${speedScale} duration=${durationLabel}`);

    results.push({
      scene_index: scene.scene_index,
      scene_id: scene.scene_id || "",
      source_scene_id: scene.source_scene_id || "",
      speaker_id: speakerId,
      speedScale,
      audio_file: fileName,
      audio_path: `${outputDirLabel}/${fileName}`,
      duration_sec: durationSec != null ? Number(durationSec.toFixed(3)) : null
    });
    generated += 1;
  }

  const resultPath = path.join(audioDir, `voicevox-batch-result-${runId}.json`);
  const resultPayload = {
    meta: {
      version: "voicevox_batch_result_v1",
      generated_at: new Date().toISOString(),
      run_id: runId,
      source_spec_path: specPath
    },
    summary: {
      generated,
      skipped
    },
    scenes: results
  };
  await fsp.writeFile(resultPath, `${JSON.stringify(resultPayload, null, 2)}\n`, "utf8");
  console.log(`Done. generated=${generated}, skipped=${skipped}, output=${outputDirLabel}`);
  console.log(`Result JSON: ${resultPath}`);
}

main().catch((error) => {
  if (isConnectionError(error)) {
    console.error("VOICEVOX連携に失敗しました。VOICEVOX Engine (http://127.0.0.1:50021) が起動しているか確認してください。");
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
