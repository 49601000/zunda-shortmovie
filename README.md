# short-video-v2

This project reuses the existing renderer app at:

- `../16_ショート動画作成/psych-short-renderer`

## Commands

- `npm run renderer:dev`
- `npm run renderer:render`
- `npm run renderer:voicevox`
- `npm run scene-remotion:dev`
- `npm run scene-remotion:render`
- `npm run scene-remotion:voicevox:initial`
- `npm run scene-remotion:voicevox:publish`
- `npm run scene-remotion:voicevox:batch`

## If renderer app path is different

Set env var `RENDERER_APP_PATH` and run the same commands.

PowerShell example:

```powershell
$env:RENDERER_APP_PATH = "C:/Users/info/MyAntigravity/02_hobby/16_ショート動画作成/psych-short-renderer"
npm run renderer:render
```

## Scene Renderer v1 + VOICEVOX pipeline

`scene-remotion:*` commands resolve renderer path in this order:

1. `SCENE_REMOTION_APP_PATH` (env var)
2. `../remotion-renderer`
3. `./remotion-renderer-v1` (fallback)

Output control:

- Output root is fixed to `./output`
- Run directory is `./output/<run_id>`
- Default run id is `000`
- You can override by env var `SCENE_OUTPUT_RUN_ID` (e.g. `001`)

Hook統合済み `scene_render_spec` 向けの音声フロー:

1. 初回生成  
   `npm run scene-remotion:voicevox:initial`
2. VOICEVOX Control  
   `voicevox-control-panel.html` で `scene.voice_control` を編集して `svrs_scene_render_spec` 保存
3. Publish再生成  
   `npm run scene-remotion:voicevox:publish`

batch spec から直接WAV生成する場合:

- `output/<run_id>/audio/voicevox-batch-spec-<run_id>.json` を保存
- `npm run scene-remotion:voicevox:batch` を実行

仕様メモ:
- `scene_type === "hook"` は音声生成対象外
- `scene_type !== "hook"` のみ `voice.text` / `dialog.voice` を読んで生成
- 生成後は `scene.voice.audio_path` と `scene.duration` が更新される

## Auto conversion before render / voicevox

`scene-remotion:render` と `scene-remotion:voicevox*` 実行前に、
`svrs_scene_render_spec (scenes[])` から Remotion 用 `render_spec (segments[])` へ自動同期されます。

同期元の探索順（例: `SCENE_OUTPUT_RUN_ID=000`）:

1. `SCENE_RENDER_SPEC_PATH` で指定したJSON
2. `output/000/spec/svrs_scene_render_spec.json`
3. `output/000/spec/scene_render_spec.json`
4. `./svrs_scene_render_spec.json`
5. `./scene_render_spec.json`

必要なら明示指定:

```powershell
$env:SCENE_OUTPUT_RUN_ID="000"
$env:SCENE_RENDER_SPEC_PATH="output/000/spec/svrs_scene_render_spec.json"
npm run scene-remotion:render
```

## Variable run_id operation (recommended)

作品ごとに run_id を変える場合は、`SCENE_OUTPUT_RUN_ID` と
`SCENE_RENDER_SPEC_PATH` を必ず同じ run_id で揃えてください。

毎回の実行例:

```powershell
$runId="001"
$env:SCENE_OUTPUT_RUN_ID=$runId
$env:SCENE_RENDER_SPEC_PATH="output/$runId/spec/svrs_scene_render_spec.json"
npm run scene-remotion:render
```

手入力を減らす場合:

```powershell
npm run scene-remotion:render:runid -- 007
```

PowerShell関数で回す場合:

```powershell
function Render-Scene($id){
  $env:SCENE_OUTPUT_RUN_ID=$id
  $env:SCENE_RENDER_SPEC_PATH="output/$id/spec/svrs_scene_render_spec.json"
  npm run scene-remotion:render
}
# 使い方
Render-Scene 007
```
