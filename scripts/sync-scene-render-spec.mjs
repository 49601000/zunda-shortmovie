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
  if (String(raw).trim().toLowerCase() === "auto") {
    throw new Error(
      "SCENE_OUTPUT_RUN_ID=auto is not supported for scene spec sync. Set a fixed run id (e.g. 000)."
    );
  }
  return normalizeRunId(raw);
}

function ensureObject(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeAssetRef(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\\/g, "/");
}

function normalizeSec(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n * 1000) / 1000);
}

function parseTimeRange(raw, fallbackStart = 0, fallbackDuration = 2) {
  const txt = String(raw ?? "").trim();
  const m = txt.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) {
    const start = normalizeSec(fallbackStart, 0);
    const duration = Math.max(0.1, normalizeSec(fallbackDuration, 2));
    return { start, end: normalizeSec(start + duration, start + 2) };
  }
  const start = normalizeSec(m[1], fallbackStart);
  const endRaw = normalizeSec(m[2], start + fallbackDuration);
  const end = endRaw > start ? endRaw : normalizeSec(start + fallbackDuration, start + 2);
  return { start, end };
}

function resolvePathCandidates(runId) {
  const explicit = String(process.env.SCENE_RENDER_SPEC_PATH ?? "").trim();
  const defaults = [
    path.join(OUTPUT_ROOT, runId, "spec", "svrs_scene_render_spec.json"),
    path.join(OUTPUT_ROOT, runId, "spec", "scene_render_spec.json"),
    path.resolve(CWD, "svrs_scene_render_spec.json"),
    path.resolve(CWD, "scene_render_spec.json"),
    path.join(OUTPUT_ROOT, runId, "audio", `voicevox-batch-spec-${runId}.json`),
  ];
  if (explicit) {
    return [path.resolve(CWD, explicit), ...defaults];
  }
  return defaults;
}

function ensurePictureShape(value) {
  if (!value || typeof value !== "object") return null;
  if (!value.hook || typeof value.hook !== "object") return null;
  if (!value.scene || typeof value.scene !== "object") return null;
  if (!Array.isArray(value.scene.scenes)) return null;
  return value;
}

function resolvePictureSpecCandidates(runId) {
  return [
    path.join(OUTPUT_ROOT, runId, "spec", "picture.json"),
    path.resolve(CWD, "schema", "picture.json"),
    path.resolve(CWD, "picture.json"),
  ];
}

function readPictureSpec(runId) {
  const candidates = resolvePictureSpecCandidates(runId);
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = fs.readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw);
      const safe = ensurePictureShape(parsed);
      if (!safe) continue;
      return { picture: safe, sourcePath: candidate };
    } catch (_err) {
      // Try next candidate.
    }
  }
  return { picture: null, sourcePath: "" };
}

function readSceneRenderSpec(runId) {
  const explicit = String(process.env.SCENE_RENDER_SPEC_PATH ?? "").trim();
  const candidates = resolvePathCandidates(runId);
  if (explicit) {
    const explicitAbs = path.resolve(CWD, explicit);
    if (!fs.existsSync(explicitAbs)) {
      throw new Error(
        [
          "SCENE_RENDER_SPEC_PATH was provided but file was not found.",
          `provided: ${explicitAbs}`,
          "Save/export the latest svrs_scene_render_spec.json first, then retry.",
        ].join("\n")
      );
    }
  }
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const raw = fs.readFileSync(candidate, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.scenes)) {
      throw new Error(`Scene spec format is invalid: scenes[] not found in ${candidate}`);
    }
    return { spec: parsed, sourcePath: candidate };
  }
  throw new Error(
    [
      "scene render spec file was not found.",
      "Checked:",
      ...candidates.map((c) => `- ${c}`),
      "Set SCENE_RENDER_SPEC_PATH to a valid scene spec JSON file if needed.",
    ].join("\n")
  );
}

function sceneEnabled(renderControl, scene, index) {
  const visibility = ensureObject(renderControl?.scene_visibility);
  const sceneId = String(
    scene?.scene_id ||
    scene?.source_scene_id ||
    scene?.id ||
    `scene_${String(index + 1).padStart(3, "0")}`
  ).trim();
  const value = visibility[sceneId];
  return typeof value === "boolean" ? value : true;
}

function resolveVoiceText(scene) {
  const fromVoiceText = typeof scene?.voice_text === "string" ? scene.voice_text.trim() : "";
  if (fromVoiceText) return fromVoiceText;
  const voiceObj = ensureObject(scene?.voice);
  const dialogObj = ensureObject(scene?.dialog);
  const fromVoice = typeof voiceObj.text === "string" ? voiceObj.text.trim() : "";
  if (fromVoice) return fromVoice;
  const fromDialogVoice = typeof dialogObj.voice === "string" ? dialogObj.voice.trim() : "";
  if (fromDialogVoice) return fromDialogVoice;
  const fromScreen = typeof dialogObj.screen_text === "string" ? dialogObj.screen_text.trim() : "";
  return fromScreen;
}

function resolveScreenText(scene, fallbackText) {
  const fromSceneScreenText = typeof scene?.screen_text === "string" ? scene.screen_text.trim() : "";
  if (fromSceneScreenText) return fromSceneScreenText;
  const dialogObj = ensureObject(scene?.dialog);
  const fromScreen = typeof dialogObj.screen_text === "string" ? dialogObj.screen_text.trim() : "";
  if (fromScreen) return fromScreen;
  const fromVoiceText = typeof scene?.voice_text === "string" ? scene.voice_text.trim() : "";
  if (fromVoiceText) return fromVoiceText;
  return fallbackText;
}

function normalizeHexColor(value, fallback = "#ffffff") {
  const raw = String(value ?? "").trim();
  if (/^#([0-9a-fA-F]{6})$/.test(raw)) return raw.toLowerCase();
  if (/^#([0-9a-fA-F]{3})$/.test(raw)) {
    return (
      "#" +
      raw
        .slice(1)
        .split("")
        .map((ch) => ch + ch)
        .join("")
        .toLowerCase()
    );
  }
  return fallback;
}

function resolveScreenTextStyle(scene) {
  const dialogObj = ensureObject(scene?.dialog);
  const screenTextFontSize = Math.max(
    12,
    Math.min(
      200,
      toFiniteInt(dialogObj.screen_text_font_size ?? scene?.screen_text_font_size, 72)
    )
  );
  const fontFamily = String(
    dialogObj.screen_text_font_family ?? scene?.font_family ?? "Noto Sans JP Bold"
  ).trim() || "Noto Sans JP Bold";
  const textColor = normalizeHexColor(
    dialogObj.screen_text_color ?? scene?.text_color,
    "#ffffff"
  );
  const modeRaw = String(
    dialogObj.screen_text_line_break_mode ?? scene?.line_break_mode ?? "auto"
  ).trim().toLowerCase();
  const lineBreakMode = modeRaw === "line_chars" ? "line_chars" : "auto";
  const lineChars = Math.max(
    1,
    Math.min(
      120,
      toFiniteInt(dialogObj.screen_text_line_chars ?? scene?.line_chars, 18)
    )
  );
  return {
    screen_text_font_size: screenTextFontSize,
    font_family: fontFamily,
    text_color: textColor,
    line_break_mode: lineBreakMode,
    line_chars: lineChars,
  };
}

const TEXT_POSITION_PRESETS = new Set([
  "logboard_center",
]);

function resolveTextPosition(scene) {
  const dialogObj = ensureObject(scene?.dialog);
  const presetRaw = String(
    dialogObj.screen_text_position_preset ??
    scene?.text_position_preset ??
    scene?.screen_text_position_preset ??
    ""
  )
    .trim()
    .toLowerCase();
  const textPositionPreset = TEXT_POSITION_PRESETS.has(presetRaw)
    ? presetRaw
    : "logboard_center";

  // Legacy compatibility: migrate per-scene direct textY/text_y to new offset field.
  const textOffsetY = toFiniteInt(
    dialogObj.screen_text_offset_y ??
    scene?.text_offset_y ??
    scene?.screen_text_offset_y ??
    scene?.textY ??
    scene?.text_y,
    0
  );

  return {
    text_position_preset: textPositionPreset,
    text_offset_y: textOffsetY,
  };
}

function resolveHookTexts(scene, picture) {
  const hookVisual = ensureObject(scene?.hook_visual);
  const hookTexts = ensureObject(hookVisual.texts);
  const topNode = ensureObject(hookTexts.top);
  const mainNode = ensureObject(hookTexts.main);
  const subNode = ensureObject(hookTexts.sub);
  const bubbleNode = ensureObject(hookVisual.bubble);
  const pictureHook = ensureObject(picture?.hook);
  const pictureHookTexts = ensureObject(pictureHook.texts);

  const topFallback = ensureObject(pictureHookTexts.top);
  const mainFallback = ensureObject(pictureHookTexts.main);
  const subFallback = ensureObject(pictureHookTexts.sub);
  const bubbleFallback = ensureObject(pictureHook.bubble);

  return {
    top: String(topNode.text ?? topFallback.text ?? "").trim(),
    main: String(mainNode.text ?? mainFallback.text ?? "").trim(),
    sub: String(subNode.text ?? subFallback.text ?? "").trim(),
    bubble: String(bubbleNode.text ?? bubbleFallback.text ?? "").trim(),
  };
}

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function toFiniteInt(value, fallback) {
  return Math.round(toFiniteNumber(value, fallback));
}

function toFiniteNumberClamped(value, fallback, min, max) {
  const n = toFiniteNumber(value, fallback);
  return Math.max(min, Math.min(max, n));
}

function normalizeEffectList(value) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(value) ? value : [];
  for (const item of list) {
    const effect = String(item ?? "").trim();
    if (!effect || seen.has(effect)) continue;
    seen.add(effect);
    out.push(effect);
  }
  return out;
}

const HOOK_TEXT_DEFAULTS = {
  top: {
    text: "もしかして自分だけ？",
    fontSize: 90,
    fontWeight: 800,
    color: "#303030",
    outlineColor: "#ffffff",
    fillVisible: false,
    outlineScale: 1.06,
    x: 58,
    y: 230,
    rotation: -3,
    shadow: false,
  },
  main: {
    text: "損切",
    fontSize: 260,
    fontWeight: 900,
    color: "#e60012",
    outlineColor: "#ffffff",
    fillVisible: true,
    outlineScale: 1.06,
    x: 120,
    y: 480,
    rotation: -2,
    shadow: true,
  },
  sub: {
    text: "できない理由",
    fontSize: 140,
    fontWeight: 800,
    color: "#303030",
    outlineColor: "#ffffff",
    fillVisible: false,
    outlineScale: 1.06,
    x: 220,
    y: 827,
    rotation: -2,
    shadow: true,
  },
};

function resolveHookVisualSpec(scene, picture) {
  const hookVisual = ensureObject(scene?.hook_visual);
  const pictureHook = ensureObject(picture?.hook);
  const hookTexts = ensureObject(hookVisual.texts);
  const pictureTexts = ensureObject(pictureHook.texts);

  const topNode = ensureObject(hookTexts.top);
  const mainNode = ensureObject(hookTexts.main);
  const subNode = ensureObject(hookTexts.sub);
  const topFallback = ensureObject(pictureTexts.top);
  const mainFallback = ensureObject(pictureTexts.main);
  const subFallback = ensureObject(pictureTexts.sub);

  const charNode = ensureObject(hookVisual.character);
  const charFallback = ensureObject(pictureHook.character);
  const bubbleNode = ensureObject(hookVisual.bubble);
  const bubbleFallback = ensureObject(pictureHook.bubble);

  const normalizeTextNode = (node, fallbackNode, defaults) => ({
    text: String(node.text ?? fallbackNode.text ?? defaults.text ?? "").trim(),
    fontSize: toFiniteInt(node.fontSize ?? fallbackNode.fontSize, defaults.fontSize),
    fontWeight: toFiniteInt(node.fontWeight ?? fallbackNode.fontWeight, defaults.fontWeight),
    color: String(node.color ?? fallbackNode.color ?? defaults.color),
    outlineColor: String(node.outlineColor ?? fallbackNode.outlineColor ?? defaults.outlineColor),
    fillVisible: Boolean(
      node.fillVisible ??
      fallbackNode.fillVisible ??
      node.emphasis ??
      fallbackNode.emphasis ??
      defaults.fillVisible
    ),
    outlineScale: toFiniteNumberClamped(
      node.outlineScale ?? fallbackNode.outlineScale,
      defaults.outlineScale,
      1,
      1.3
    ),
    x: toFiniteInt(node.x ?? fallbackNode.x, defaults.x),
    y: toFiniteInt(node.y ?? fallbackNode.y, defaults.y),
    rotation: toFiniteNumber(node.rotation ?? fallbackNode.rotation, defaults.rotation),
    shadow: Boolean(node.shadow ?? fallbackNode.shadow ?? defaults.shadow),
  });

  return {
    texts: {
      top: normalizeTextNode(topNode, topFallback, HOOK_TEXT_DEFAULTS.top),
      main: normalizeTextNode(mainNode, mainFallback, HOOK_TEXT_DEFAULTS.main),
      sub: normalizeTextNode(subNode, subFallback, HOOK_TEXT_DEFAULTS.sub),
    },
    character: {
      enabled: Boolean(charNode.enabled ?? charFallback.enabled ?? true),
      x: toFiniteInt(charNode.x ?? charFallback.x, 540),
      y: toFiniteInt(charNode.y ?? charFallback.y, 1030),
      width: toFiniteInt(charNode.width ?? charFallback.width, 520),
      height: toFiniteInt(charNode.height ?? charFallback.height, 820),
      scale: toFiniteNumber(charNode.scale ?? charFallback.scale, 1),
      objectFit: String(charNode.objectFit ?? charFallback.objectFit ?? "contain"),
      objectPosition: String(charNode.objectPosition ?? charFallback.objectPosition ?? "center top"),
    },
    bubble: {
      enabled: Boolean(bubbleNode.enabled ?? bubbleFallback.enabled ?? true),
      text: String(bubbleNode.text ?? bubbleFallback.text ?? "").trim(),
      x: toFiniteInt(bubbleNode.x ?? bubbleFallback.x, 80),
      y: toFiniteInt(bubbleNode.y ?? bubbleFallback.y, 1230),
      width: toFiniteInt(bubbleNode.width ?? bubbleFallback.width, 520),
      height: toFiniteInt(bubbleNode.height ?? bubbleFallback.height, 400),
      fontSize: toFiniteInt(bubbleNode.fontSize ?? bubbleFallback.fontSize, 64),
      color: String(bubbleNode.color ?? bubbleFallback.color ?? "#222222"),
      emphasisColor: String(bubbleNode.emphasisColor ?? bubbleFallback.emphasisColor ?? "#e60012"),
      backgroundColor: String(bubbleNode.backgroundColor ?? bubbleFallback.backgroundColor ?? "#ffffff"),
      borderColor: String(bubbleNode.borderColor ?? bubbleFallback.borderColor ?? "#222222"),
      borderWidth: toFiniteNumberClamped(
        bubbleNode.borderWidth ?? bubbleFallback.borderWidth,
        6,
        0,
        32
      ),
      rotation: toFiniteNumber(bubbleNode.rotation ?? bubbleFallback.rotation, 0),
    },
  };
}

function resolvePictureAssetFromRegistry(picture, group, key) {
  const registry = ensureObject(picture?.scene?.asset_registry);
  const bucket = ensureObject(registry[group]);
  const normalizedKey = normalizeAssetRef(String(key ?? ""));
  if (!normalizedKey) return "";
  const raw = bucket[normalizedKey];
  if (typeof raw === "string" && raw.trim()) return normalizeAssetRef(raw);
  return normalizedKey;
}

function hasImageExt(value) {
  return /\.(png|jpe?g|webp|avif)$/i.test(String(value ?? "").trim());
}

function resolveHookBackgroundAssetPath(picture) {
  const hook = ensureObject(picture?.hook);
  const backgroundNode = ensureObject(hook.background);
  const rawId = normalizeAssetRef(backgroundNode.asset_id);
  if (!rawId) return "";
  const fromRegistry = resolvePictureAssetFromRegistry(picture, "backgrounds", rawId);
  if (hasImageExt(fromRegistry)) return fromRegistry;
  if (hasImageExt(rawId)) return rawId;
  return `backgrounds/${rawId}.png`;
}

function resolveHookCharacterAssetPath(picture) {
  const hook = ensureObject(picture?.hook);
  const characterNode = ensureObject(hook.character);
  const rawId = normalizeAssetRef(characterNode.asset_id);
  if (!rawId) return "";
  if (hasImageExt(rawId)) return rawId;
  return `characters/zundamon/${rawId}.png`;
}

function resolveHookBubbleAssetPath(picture) {
  const hook = ensureObject(picture?.hook);
  const bubbleNode = ensureObject(hook.bubble);
  const rawId = normalizeAssetRef(bubbleNode.asset_id);
  if (!rawId) return "";
  if (hasImageExt(rawId)) return rawId;
  if (/^hook-speech-balloon$/i.test(rawId)) {
    return "parts/Hook-speech-balloon.png";
  }
  return `parts/${rawId}.png`;
}

function resolveHookBackgroundAssetRef(value, picture) {
  const normalized = normalizeAssetRef(value);
  if (!normalized) return "";
  const fromRegistry = resolvePictureAssetFromRegistry(picture, "backgrounds", normalized);
  if (hasImageExt(fromRegistry)) return fromRegistry;
  if (hasImageExt(normalized)) return normalized;
  return `backgrounds/${normalized}.png`;
}

function resolveHookCharacterAssetRef(value, picture) {
  const normalized = normalizeAssetRef(value);
  if (!normalized) return "";
  if (hasImageExt(normalized)) {
    const compat = normalized.match(
      /^(images\/)?characters\/zundamon\/zundamon-(thinking|normal|happy|sad|laugh|provoke|annoyed|mid-panic|high-panic|low-panic|mid-cheat|high-cheat|low-cheat)\.png$/i
    );
    if (compat) {
      const prefix = compat[1] || "";
      const shortKey = normalizeAssetRef(compat[2] || "");
      if (shortKey) {
        return `${prefix}characters/zundamon/${shortKey}.png`;
      }
    }
    return normalized;
  }

  const registry = ensureObject(picture?.scene?.asset_registry?.characters);
  const bucket = ensureObject(registry[normalized]);
  const idle = normalizeAssetRef(bucket.idle || "");
  if (idle && hasImageExt(idle)) return idle;

  const first = Object.values(bucket).find((v) => typeof v === "string" && hasImageExt(v));
  if (typeof first === "string" && first.trim()) {
    return normalizeAssetRef(first);
  }

  // picture.json の hook.character.asset_id は "zundamon-thinking" のような論理IDの場合がある。
  // まずは short key（thinking など）を優先して推定し、それでも難しければ既定ファイルへフォールバック。
  if (/^zundamon-/i.test(normalized)) {
    const shortKey = normalizeAssetRef(normalized.replace(/^zundamon-/i, ""));
    if (shortKey) {
      return `characters/zundamon/${shortKey}.png`;
    }
    return "characters/zundamon/zundamon-normal-0000.png";
  }
  if (/^metan-/i.test(normalized)) {
    const shortKey = normalizeAssetRef(normalized.replace(/^metan-/i, ""));
    if (shortKey) {
      return `characters/metan/${shortKey}.png`;
    }
    return "characters/metan/metan-0.png";
  }

  return `characters/zundamon/${normalized}.png`;
}

function resolveHookBubbleAssetRef(value, picture) {
  const normalized = normalizeAssetRef(value);
  if (!normalized) return "";
  if (hasImageExt(normalized)) return normalized;

  const fromUi = resolvePictureAssetFromRegistry(picture, "ui", normalized);
  if (hasImageExt(fromUi)) return fromUi;

  if (/^hook-speech-balloon$/i.test(normalized)) {
    return "parts/Hook-speech-balloon.png";
  }
  return `parts/${normalized}.png`;
}

function resolvePictureCharacterAsset(picture, sceneRow, side) {
  const registry = ensureObject(picture?.scene?.asset_registry?.characters);
  const stateMapping = ensureObject(picture?.scene?.character_operation?.state_mapping);
  const charsNode = ensureObject(sceneRow?.composition?.characters);
  const charNode = ensureObject(charsNode[side]);
  const assetId = normalizeAssetRef(charNode.asset_id);
  const assetBucket = ensureObject(registry[assetId]);
  if (!assetId || !Object.keys(assetBucket).length) return "";
  const rawState = normalizeAssetRef(charNode.asset_state || charNode.state || "idle");
  const mappedState = normalizeAssetRef(stateMapping[rawState] || rawState || "idle");
  const fromState = normalizeAssetRef(assetBucket[mappedState]);
  if (fromState) return fromState;
  return normalizeAssetRef(assetBucket.idle || "");
}

function resolvePictureSceneFallback(picture, scene, sceneIndex) {
  if (!picture) return { row: null, visualAssets: {} };
  const rows = Array.isArray(picture?.scene?.scenes) ? picture.scene.scenes : [];
  const sceneId = normalizeAssetRef(scene?.scene_id || scene?.source_scene_id || scene?.id || "");
  let row = null;
  if (sceneId) {
    row = rows.find((r) => normalizeAssetRef(r?.id) === sceneId) || null;
  }
  if (!row && sceneIndex >= 0 && sceneIndex < rows.length) {
    row = rows[sceneIndex];
  }
  if (!row) return { row: null, visualAssets: {} };

  const comp = ensureObject(row.composition);
  const bg = ensureObject(comp.background);
  const slide = ensureObject(comp.slide_area);
  const monolith = ensureObject(comp.monolith);
  const role = normalizeAssetRef(row.role || scene?.scene_type || scene?.role || "");
  const hookBackground = resolveHookBackgroundAssetPath(picture);
  const hookCharacter = resolveHookCharacterAssetPath(picture);
  const hookBubble = resolveHookBubbleAssetPath(picture);

  const visualAssets = {
    background: resolvePictureAssetFromRegistry(picture, "backgrounds", bg.asset_id),
    slide: resolvePictureAssetFromRegistry(picture, "slides", slide.content_ref || slide.asset_id),
    monolith: resolvePictureAssetFromRegistry(picture, "monolith", monolith.mode || monolith.asset_id),
    dialog_box: resolvePictureAssetFromRegistry(picture, "ui", "dialog_box"),
    character_left: resolvePictureCharacterAsset(picture, row, "left"),
    character_right: resolvePictureCharacterAsset(picture, row, "right"),
    hook_background: hookBackground,
    hook_character: hookCharacter,
    hook_bubble: hookBubble,
  };
  if (role === "hook" && hookBackground) {
    visualAssets.background = hookBackground;
  }
  return { row, visualAssets };
}

function resolveSegmentOrder(scene, index) {
  const candidate = String(scene?.scene_id || scene?.source_scene_id || scene?.id || "").trim();
  const matched = candidate.match(/(\d+)/);
  if (matched) {
    const n = Number.parseInt(matched[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return index + 1;
}

function resolveSpeakerId(scene) {
  const voiceControl = ensureObject(scene?.voice_control);
  const voiceProfile = ensureObject(scene?.voice_profile);
  const speakerCandidate = Number(voiceControl.speaker_id ?? voiceProfile.voicevox_style_id);
  if (Number.isFinite(speakerCandidate)) return speakerCandidate;
  return 3;
}

function resolveSpeedScale(scene) {
  const voiceControl = ensureObject(scene?.voice_control);
  const voiceProfile = ensureObject(scene?.voice_profile);
  const speed = Number(voiceControl.speedScale ?? voiceProfile.speedScale);
  if (!Number.isFinite(speed)) return 1.25;
  return Math.max(0.5, Math.min(2.0, Math.round(speed * 100) / 100));
}

function resolveBackground(topLevelBackground) {
  if (typeof topLevelBackground !== "string") return "classroom-evening.png";
  const trimmed = topLevelBackground.trim().replace(/\\/g, "/");
  if (!trimmed) return "classroom-evening.png";
  const cleaned = trimmed.replace(/^\/+/, "").replace(/^public\//i, "");
  const noAssetsPrefix = cleaned.replace(/^assets\/background\//i, "");
  return noAssetsPrefix || "classroom-evening.png";
}

function resolveSegmentBackgroundOverride(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/^\/+/, "").replace(/^public\//i, "");
  const noAssetsPrefix = cleaned.replace(/^assets\/background\//i, "");
  return noAssetsPrefix;
}

function resolvePictureBackgroundOverride(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/^\/+/, "").replace(/^public\//i, "");
  const m1 = cleaned.match(/^images\/backgrounds\/(.+\.(?:png|jpe?g|webp|avif))$/i);
  if (m1?.[1]) return m1[1];
  const m2 = cleaned.match(/^backgrounds\/(.+\.(?:png|jpe?g|webp|avif))$/i);
  if (m2?.[1]) return m2[1];
  const m3 = cleaned.match(/^assets\/background\/(.+\.(?:png|jpe?g|webp|avif))$/i);
  if (m3?.[1]) return m3[1];
  if (/\.(png|jpe?g|webp|avif)$/i.test(cleaned) && !cleaned.includes("/")) {
    return cleaned;
  }
  return cleaned;
}

function resolveSegmentVisualAssets(scene, fallbackAssets = {}, picture = null) {
  const visual = ensureObject(scene?.visual_assets);
  const composition = ensureObject(scene?.composition);
  const backgroundNode = ensureObject(composition.background);
  const slideNode = ensureObject(composition.slide_area);
  const monolithNode = ensureObject(composition.monolith);
  const dialogBoxNode = ensureObject(composition.dialog_box);
  const charactersNode = ensureObject(composition.characters);
  const leftCharNode = ensureObject(charactersNode.left);
  const rightCharNode = ensureObject(charactersNode.right);
  const hookVisual = ensureObject(scene?.hook_visual);
  const hookBackgroundNode = ensureObject(hookVisual.background);
  const hookCharacterNode = ensureObject(hookVisual.character);
  const hookBubbleNode = ensureObject(hookVisual.bubble);
  const fb = ensureObject(fallbackAssets);
  const hookBackgroundRaw = String(
    visual.hook_background ?? hookBackgroundNode.image_path ?? fb.hook_background ?? ""
  ).trim();
  const hookCharacterRaw = String(
    visual.hook_character ?? hookCharacterNode.image_path ?? fb.hook_character ?? ""
  ).trim();
  const hookBubbleRaw = String(
    visual.hook_bubble ?? hookBubbleNode.image_path ?? fb.hook_bubble ?? ""
  ).trim();
  const hookBackground = resolveHookBackgroundAssetRef(hookBackgroundRaw, picture);
  const hookCharacter = resolveHookCharacterAssetRef(hookCharacterRaw, picture);
  const hookBubble = resolveHookBubbleAssetRef(hookBubbleRaw, picture);
  const role = normalizeAssetRef(scene?.scene_type || scene?.role || "");
  const backgroundBase = String(visual.background ?? backgroundNode.image_path ?? fb.background ?? "").trim();
  const background = role === "hook" && hookBackground ? hookBackground : backgroundBase;
  return {
    background,
    slide: String(visual.slide ?? slideNode.image_path ?? fb.slide ?? "").trim(),
    monolith: String(visual.monolith ?? monolithNode.image_path ?? fb.monolith ?? "").trim(),
    dialog_box: String(visual.dialog_box ?? dialogBoxNode.image_path ?? fb.dialog_box ?? "").trim(),
    character_left: String(visual.character_left ?? leftCharNode.image_path ?? fb.character_left ?? "").trim(),
    character_right: String(visual.character_right ?? rightCharNode.image_path ?? fb.character_right ?? "").trim(),
    hook_background: hookBackground,
    hook_character: hookCharacter,
    hook_bubble: hookBubble,
  };
}

const DEFAULT_LIP_SYNC_FRAMES = [
  "mouth_closed",
  "mouth_half",
  "mouth_open",
  "mouth_half",
  "mouth_closed",
];

function normalizeAssetStateList(value, fallback = DEFAULT_LIP_SYNC_FRAMES) {
  const source = Array.isArray(value) ? value : fallback;
  const out = [];
  for (const item of source) {
    const state = normalizeAssetRef(item);
    if (!state) continue;
    out.push(state);
  }
  return out.length ? out : [...fallback];
}

function resolvePictureLipSyncSettings(picture) {
  const lip = ensureObject(picture?.scene?.character_operation?.lip_sync);
  return {
    enabled_default: Boolean(lip.enabled_default ?? true),
    interval_ms: Math.max(60, Math.round(toFiniteNumber(lip.interval_ms, 210))),
    frames: normalizeAssetStateList(lip.frames, DEFAULT_LIP_SYNC_FRAMES),
    supported_speakers: Array.isArray(lip.supported_speakers)
      ? lip.supported_speakers.map((v) => String(v ?? "").trim()).filter(Boolean)
      : ["metan_engine", "zundamon_engine"],
    disabled_on_ai_scene: Boolean(lip.disabled_on_ai_scene ?? true),
    mute_non_speaking_side_to_idle: Boolean(lip.mute_non_speaking_side_to_idle ?? true),
  };
}

function resolveCharacterAssetIdFromNode(picture, charNode, fallbackEngine = "") {
  const mapping = ensureObject(picture?.scene?.character_operation?.engine_to_character_asset);
  const node = ensureObject(charNode);
  const explicit = normalizeAssetRef(node.asset_id);
  if (explicit) return explicit;
  const engine = normalizeAssetRef(node.engine || fallbackEngine);
  const fromEngine = normalizeAssetRef(mapping[engine]);
  if (fromEngine) return fromEngine;
  if (/^metan/i.test(engine)) return "metan";
  if (/^zundamon/i.test(engine)) return "zundamon";
  return "";
}

function resolveCharacterAssetSetById(picture, assetId) {
  const id = normalizeAssetRef(assetId);
  if (!id) return {};
  const bucket = ensureObject(picture?.scene?.asset_registry?.characters?.[id]);
  if (!Object.keys(bucket).length) return {};
  const out = {};
  for (const [k, v] of Object.entries(bucket)) {
    const key = normalizeAssetRef(k);
    const path = normalizeAssetRef(v);
    if (!key || !path) continue;
    out[key] = path;
  }
  return out;
}

function resolveCharacterSideNode(scene, pictureFallbackRow, side) {
  const sceneChars = ensureObject(scene?.composition?.characters);
  const fallbackChars = ensureObject(pictureFallbackRow?.composition?.characters);
  return ensureObject(sceneChars[side] ?? fallbackChars[side]);
}

function detectSpeakerSide(scene, pictureFallbackRow) {
  const leftNode = resolveCharacterSideNode(scene, pictureFallbackRow, "left");
  const rightNode = resolveCharacterSideNode(scene, pictureFallbackRow, "right");
  const leftState = normalizeAssetRef(leftNode.state);
  const rightState = normalizeAssetRef(rightNode.state);
  if (leftState === "speaking" && rightState !== "speaking") return "left";
  if (rightState === "speaking" && leftState !== "speaking") return "right";

  const speaker = normalizeAssetRef(scene?.speaker || scene?.character_id);
  const leftEngine = normalizeAssetRef(leftNode.engine);
  const rightEngine = normalizeAssetRef(rightNode.engine);
  if (speaker && leftEngine && speaker === leftEngine) return "left";
  if (speaker && rightEngine && speaker === rightEngine) return "right";
  if (speaker === "metan_engine") return "left";
  if (speaker === "zundamon_engine") return "right";
  return "none";
}

function resolveHookCharacterAssetId(scene, picture, fallbackAssetId = "") {
  const hookVisual = ensureObject(scene?.hook_visual);
  const hookCharNode = ensureObject(hookVisual.character);
  const pictureHookChar = ensureObject(picture?.hook?.character);
  const raw = normalizeAssetRef(hookCharNode.asset_id || pictureHookChar.asset_id);
  if (/^zundamon-/i.test(raw)) return "zundamon";
  if (/^metan-/i.test(raw)) return "metan";
  if (/\/zundamon\//i.test(raw)) return "zundamon";
  if (/\/metan\//i.test(raw)) return "metan";
  if (raw && ensureObject(picture?.scene?.asset_registry?.characters)?.[raw]) return raw;
  return normalizeAssetRef(fallbackAssetId);
}

function resolveSegmentLipSyncSpec({
  scene,
  picture,
  pictureFallbackRow,
  visualAssets,
  isHookRole,
  sceneEffects,
}) {
  const lip = resolvePictureLipSyncSettings(picture);
  if (!lip.enabled_default) return null;
  const role = normalizeAssetRef(scene?.scene_type || scene?.role || "");
  const isAi = role === "roast" || sceneEffects.includes("grayscale_characters");
  if (isAi && lip.disabled_on_ai_scene) {
    return {
      enabled: false,
      reason: "disabled_on_ai_scene",
      interval_ms: lip.interval_ms,
      frames: lip.frames,
    };
  }

  const leftNode = resolveCharacterSideNode(scene, pictureFallbackRow, "left");
  const rightNode = resolveCharacterSideNode(scene, pictureFallbackRow, "right");
  const speaker = String(scene?.speaker || "").trim();
  const supported = lip.supported_speakers.includes(speaker);
  const speakerSide = detectSpeakerSide(scene, pictureFallbackRow);
  const leftAssetId = resolveCharacterAssetIdFromNode(picture, leftNode, "metan_engine");
  const rightAssetId = resolveCharacterAssetIdFromNode(picture, rightNode, "zundamon_engine");
  const hookAssetId = resolveHookCharacterAssetId(
    scene,
    picture,
    speakerSide === "left" ? leftAssetId : rightAssetId
  );

  const leftAssets = {
    idle: String(visualAssets.character_left || "").trim(),
    mouth_closed: String(visualAssets.character_left || "").trim(),
    mouth_half: String(visualAssets.character_left || "").trim(),
    mouth_open: String(visualAssets.character_left || "").trim(),
    frozen: String(visualAssets.character_left || "").trim(),
    ...resolveCharacterAssetSetById(picture, leftAssetId),
  };
  const rightAssets = {
    idle: String(visualAssets.character_right || "").trim(),
    mouth_closed: String(visualAssets.character_right || "").trim(),
    mouth_half: String(visualAssets.character_right || "").trim(),
    mouth_open: String(visualAssets.character_right || "").trim(),
    frozen: String(visualAssets.character_right || "").trim(),
    ...resolveCharacterAssetSetById(picture, rightAssetId),
  };
  const hookAssets = {
    idle: String(visualAssets.hook_character || "").trim(),
    mouth_closed: String(visualAssets.hook_character || "").trim(),
    mouth_half: String(visualAssets.hook_character || "").trim(),
    mouth_open: String(visualAssets.hook_character || "").trim(),
    frozen: String(visualAssets.hook_character || "").trim(),
    ...resolveCharacterAssetSetById(picture, hookAssetId),
  };

  const base = {
    enabled: Boolean(supported && speakerSide !== "none"),
    interval_ms: lip.interval_ms,
    frames: lip.frames,
    mute_non_speaking_side_to_idle: lip.mute_non_speaking_side_to_idle,
    speaker,
    speaker_side: speakerSide,
    assets: {
      left: leftAssets,
      right: rightAssets,
      hook: hookAssets,
    },
  };
  if (!base.enabled) {
    return {
      ...base,
      reason: supported ? "speaker_side_unresolved" : "unsupported_speaker",
    };
  }
  if (isHookRole) {
    return {
      ...base,
      mode: "hook",
      speaker_side: "hook",
    };
  }
  return {
    ...base,
    mode: "scene",
  };
}

function resolveBgm(spec) {
  const topAudio = ensureObject(spec?.audio);
  const topBgm = spec?.bgm;

  let src = "";
  let volume = 0.03;
  let loop = true;

  if (typeof topBgm === "string") {
    src = topBgm;
  } else if (topBgm && typeof topBgm === "object") {
    src = typeof topBgm.src === "string" ? topBgm.src : "";
    if (Number.isFinite(Number(topBgm.volume))) {
      volume = Number(topBgm.volume);
    }
    if (typeof topBgm.loop === "boolean") {
      loop = topBgm.loop;
    }
  }

  if (!src && typeof topAudio.bgm === "string") {
    src = topAudio.bgm;
  }
  if (Number.isFinite(Number(topAudio.bgm_volume))) {
    volume = Number(topAudio.bgm_volume);
  }
  if (typeof topAudio.bgm_loop === "boolean") {
    loop = topAudio.bgm_loop;
  }

  if (typeof src === "string" && src.trim()) {
    const normalized = src.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/^public\//i, "");
    src = `/${normalized}`;
  } else {
    src = "/audio/bgm/BGM-piano.mp3";
  }

  return {
    src,
    volume: Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.03)),
    loop,
  };
}

function convertSceneSpecToRenderSpec(sceneSpec) {
  const scenes = Array.isArray(sceneSpec.scenes) ? sceneSpec.scenes : [];
  const renderControl = ensureObject(sceneSpec.render_control);
  const enabledScenes = scenes.filter((scene, index) => sceneEnabled(renderControl, scene, index));
  const runId = resolveRunId();
  const { picture, sourcePath: pictureSourcePath } = readPictureSpec(runId);

  const segments = enabledScenes
    .map((scene, index) => {
      const fallbackStart = normalizeSec(scene?.start_sec, index * 2.5);
      const fallbackDuration = Math.max(0.1, normalizeSec(scene?.duration ?? scene?.duration_sec, 2.5));
      const parsed = parseTimeRange(scene?.time, fallbackStart, fallbackDuration);
      const duration = Math.max(0.1, normalizeSec(parsed.end - parsed.start, fallbackDuration));
      const start = parsed.start;
      const end = normalizeSec(start + duration, parsed.end);
      const pictureFallback = resolvePictureSceneFallback(picture, scene, index);
      const pictureDialog = ensureObject(pictureFallback.row?.dialog);
      const hookTexts = resolveHookTexts(scene, picture);
      const hookVisual = resolveHookVisualSpec(scene, picture);
      const voiceText = resolveVoiceText(scene) || String(pictureDialog.voice ?? "").trim();
      const screenText = resolveScreenText(scene, String(pictureDialog.screen_text ?? "").trim() || voiceText);
      const screenTextStyle = resolveScreenTextStyle(scene);
      const textPosition = resolveTextPosition(scene);
      const styleName = String(scene?.voice_profile?.voicevox_style_name ?? "").trim();
      const emotion = styleName || "normal";
      const segmentOrder = resolveSegmentOrder(scene, index);
      const segmentId = `seg_${String(segmentOrder).padStart(3, "0")}`;
      const explicitBackgroundOverride = resolveSegmentBackgroundOverride(scene?.background_override);
      const visualAssets = resolveSegmentVisualAssets(scene, pictureFallback.visualAssets, picture);
      const pictureBackgroundOverride = resolvePictureBackgroundOverride(visualAssets.background);
      const role = String(scene?.scene_type || scene?.role || pictureFallback.row?.role || "normal");
      const isHookRole = String(role).toLowerCase() === "hook";
      const sceneEffects = normalizeEffectList(scene?.effects);
      const lipSync = resolveSegmentLipSyncSpec({
        scene,
        picture,
        pictureFallbackRow: pictureFallback.row,
        visualAssets,
        isHookRole,
        sceneEffects,
      });

      if (isHookRole) {
        // HOOKはscene構成とレイヤーが異なるため、通常SCENE部品は描画対象から外す。
        visualAssets.slide = "";
        visualAssets.monolith = "";
        visualAssets.dialog_box = "";
        visualAssets.character_left = "";
        visualAssets.character_right = "";
      }
      let backgroundOverride = explicitBackgroundOverride || pictureBackgroundOverride;
      if (isHookRole && visualAssets.hook_background) {
        const hookBackgroundOverride = resolvePictureBackgroundOverride(visualAssets.hook_background);
        if (hookBackgroundOverride) {
          backgroundOverride = hookBackgroundOverride;
        }
      }

      const segment = {
        id: segmentId,
        time: `${start}-${end}`,
        role,
        screen_text: screenText,
        voice: voiceText,
        start,
        end,
        audioSrc: `/audio/${segmentId}.wav`,
        speakerId: resolveSpeakerId(scene),
        emotion,
        voice_speed: resolveSpeedScale(scene),
        voice_style: styleName || "normal",
        voice_override: voiceText,
        text_color: screenTextStyle.text_color,
        bg_color: "transparent",
        stroke_color: "transparent",
        stroke_width: 0,
        screen_text_font_size: screenTextStyle.screen_text_font_size,
        font_family: screenTextStyle.font_family,
        line_break_mode: screenTextStyle.line_break_mode,
        line_chars: screenTextStyle.line_chars,
        text_position_preset: textPosition.text_position_preset,
        text_offset_y: textPosition.text_offset_y,
      };
      if (backgroundOverride) {
        segment.background_override = backgroundOverride;
      }
      if (sceneEffects.length) {
        segment.effects = sceneEffects;
      }
      segment.scene_assets = visualAssets;
      if (lipSync) {
        segment.lip_sync = lipSync;
      }
      if (isHookRole) {
        segment.hook_texts = hookTexts;
        segment.hook_visual = hookVisual;
      }
      return segment;
    })
    .sort((a, b) => a.start - b.start);

  const fps = 30;
  const width = 1080;
  const height = 1920;
  const lastEnd = segments.length ? segments[segments.length - 1].end : 2;
  const durationSec = Math.max(0.1, normalizeSec(lastEnd, 2));
  const durationInFrames = Math.max(1, Math.round(durationSec * fps));
  const bgm = resolveBgm(sceneSpec);
  const background = resolveBackground(sceneSpec.background ?? sceneSpec.settings?.background);
  const title = segments[0]?.screen_text || "Untitled";

  return {
    version: "render_spec_v2",
    fps,
    width,
    height,
    durationInFrames,
    durationSec,
    segments,
    background,
    bgm,
    title,
    title_overlay: {
      enabled: true,
      bg_color: "#000000",
      text_color: "#ffffff",
      height_px: 88,
      font_size_px: 42,
      width_px: 994,
      line_break_mode: "auto",
      line_chars: 18,
      text_align: "center",
    },
    picture_source: pictureSourcePath || undefined,
  };
}

function resolveOutputPath() {
  const explicit = String(process.env.REMOTION_RENDER_SPEC_PATH ?? "").trim();
  if (explicit) {
    return path.resolve(CWD, explicit);
  }
  const explicitRendererPath = String(process.env.SCENE_REMOTION_APP_PATH ?? "").trim();
  const rendererRoot = explicitRendererPath
    ? path.resolve(CWD, explicitRendererPath)
    : path.resolve(CWD, "../remotion-renderer");
  return path.join(rendererRoot, "src", "data", "render_spec.json");
}

function main() {
  const runId = resolveRunId();
  const { spec, sourcePath } = readSceneRenderSpec(runId);
  const converted = convertSceneSpecToRenderSpec(spec);
  const outputPath = resolveOutputPath();

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(converted, null, 2)}\n`, "utf8");

  console.log(`[sync-scene-render-spec] source: ${sourcePath}`);
  console.log(`[sync-scene-render-spec] output: ${outputPath}`);
  console.log(
    `[sync-scene-render-spec] segments=${converted.segments.length} durationSec=${converted.durationSec}`
  );
}

main();
