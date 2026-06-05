import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const VOICEVOX_BASE_URL = process.env.VOICEVOX_URL ?? "http://127.0.0.1:50021";
const PROJECTS_ROOT = path.resolve(process.cwd(), "projects");
const DEFAULT_SPEAKER_ID = 3;
const DEFAULT_SPEED_SCALE = 1.45;
const VOICE_STYLE_TO_SPEAKER_ID = {
  tsuntsun: 7,
  whisper: 22,
  hisohiso: 38,
  herohero: 75,
  namidame: 76,
  "ツンツン": 7,
  "ささやき": 22,
  "ヒソヒソ": 38,
  "ヘロヘロ": 75,
  "なみだめ": 76
};
const SPEAKER_NAME_TO_DEFAULT_ID = [
  { pattern: /あんこもん|天の声|ai/i, speakerId: 113 },
  { pattern: /四国メタン|四国めたん|めたん|metan/i, speakerId: 2 },
  { pattern: /ずんだもん|zundamon/i, speakerId: 3 }
];

function normalizeRunId(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`SCENE_OUTPUT_RUN_ID must be numeric (e.g. 000). received="${trimmed}"`);
  }
  return trimmed.padStart(3, "0");
}

function resolveRunId() {
  const raw = process.env.SCENE_OUTPUT_RUN_ID;
  if (!raw || !String(raw).trim()) return "000";
  if (String(raw).trim().toLowerCase() === "auto") return "000";
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

function resolveSpeakerIdFromVoiceStyle(scene) {
  const rawStyle = String(scene?.voice_style ?? scene?.voice_profile?.voice_style ?? "").trim();
  return VOICE_STYLE_TO_SPEAKER_ID[rawStyle] ?? null;
}

function resolveSpeakerIdFromName(scene) {
  const rawName = String(
    scene?.voicevox_speaker_name ??
    scene?.voice_profile?.voicevox_speaker_name ??
    scene?.speaker ??
    ""
  ).trim();
  if (!rawName) return null;
  const matched = SPEAKER_NAME_TO_DEFAULT_ID.find((entry) => entry.pattern.test(rawName));
  return matched ? matched.speakerId : null;
}

function resolveSpeakerId(scene) {
  const fromStyle = resolveSpeakerIdFromVoiceStyle(scene);
  if (Number.isFinite(fromStyle)) return fromStyle;
  const fromVoice = Number(scene?.voice?.voicevox_style_id);
  if (Number.isFinite(fromVoice)) return fromVoice;
  const fromFlat = Number(scene?.voicevox_style_id);
  if (Number.isFinite(fromFlat)) return fromFlat;
  const fromProfile = Number(scene?.voice_profile?.voicevox_style_id);
  if (Number.isFinite(fromProfile)) return fromProfile;
  const fromControl = Number(scene?.voice_control?.speaker_id);
  if (Number.isFinite(fromControl)) return fromControl;
  const fromSpeakerId = Number(scene?.speakerId);
  if (Number.isFinite(fromSpeakerId)) return fromSpeakerId;
  const fromName = resolveSpeakerIdFromName(scene);
  if (Number.isFinite(fromName)) return fromName;
  return DEFAULT_SPEAKER_ID;
}

function resolveSpeedScale(scene) {
  return toFiniteNumber(
    scene?.voice_speed,
    toFiniteNumber(
      scene?.speedScale,
      toFiniteNumber(scene?.voice_control?.speedScale, toFiniteNumber(scene?.voice_profile?.speedScale, DEFAULT_SPEED_SCALE))
    )
  );
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
  const value = map[sceneId];
  if (value === false) return false;
  return true;
}

function applyVoiceControl(audioQuery, scene, fallbackSpeed) {
  const control = scene?.voice_control && typeof scene.voice_control === "object" ? scene.voice_control : {};
  audioQuery.speedScale = resolveSpeedScale({...scene, speedScale: toFiniteNumber(scene?.speedScale, toFiniteNumber(control.speedScale, fallbackSpeed))});
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
  const explicit = process.env.VOICEVOX_BATCH_SPEC_PATH || process.env.SCENE_RENDER_SPEC_PATH || process.env.RENDER_SPEC_PATH;
  if (explicit && String(explicit).trim()) {
    return path.resolve(process.cwd(), String(explicit).trim());
  }
  const latestRenderSpec = findLatestProjectRenderSpec();
  if (latestRenderSpec) {
    return latestRenderSpec;
  }
  return path.join(PROJECTS_ROOT, runId.padStart(4, "0"), "outputs", "video", "render-final-v01.json");
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

function normalizeProjectId(raw, fallbackRunId) {
  const trimmed = String(raw ?? "").trim();
  if (trimmed) return trimmed.padStart(4, "0");
  return String(fallbackRunId || "000").padStart(4, "0");
}

function resolveProjectId(batch, specPath, runId) {
  const explicit = process.env.SCENE_PROJECT_ID || process.env.PROJECT_ID;
  if (explicit && String(explicit).trim()) {
    return normalizeProjectId(explicit, runId);
  }

  const fromSpec = String(batch?.project_id || "").trim();
  if (fromSpec) return normalizeProjectId(fromSpec, runId);

  const normalizedSpecPath = specPath.replace(/\\/g, "/");
  const matched = normalizedSpecPath.match(/(?:^|\/)projects\/([^/]+)\//);
  if (matched) return normalizeProjectId(matched[1], runId);

  return normalizeProjectId("", runId);
}

function resolveAudioDir(specPath, batch, runId) {
  const projectId = resolveProjectId(batch, specPath, runId);
  return path.join(PROJECTS_ROOT, projectId, "outputs", "audio");
}

function toRelativeLabel(filePath) {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function isConnectionError(error) {
  const message = String(error?.message ?? "");
  return /ECONNREFUSED|ENOTFOUND|fetch failed|127\.0\.0\.1:50021/i.test(message);
}

async function main() {
  const runId = resolveRunId();
  const specPath = resolveBatchSpecPath(runId);

  const raw = await fsp.readFile(specPath, "utf8");
  const batch = JSON.parse(raw);
  if (!batch || typeof batch !== "object" || !Array.isArray(batch.scenes)) {
    throw new Error("voicevox batch spec is invalid: scenes[] not found.");
  }

  const audioDir = resolveAudioDir(specPath, batch, runId);
  const outputDirLabel = toRelativeLabel(audioDir);
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
