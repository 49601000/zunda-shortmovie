# short-video-v2

このREADMEを、このリポジトリの現在構成におけるSOT（Source of Truth）とします。

ずんだもん系ショート動画を作るための、ブラウザ完結型の制作パネル集です。会話ログから `projects/{id}` 配下に中間JSONを積み上げ、最後に `projects/{id}/outputs/video/render-final-v01.json` を作って、隣接リポジトリの Remotion renderer へ渡します。

## SOT: 現在の入口

| ファイル | 役割 |
| --- | --- |
| `index.html` | 全体ランチャー。各module / toolへのリンクと、render / dev / voicevox 用PowerShellコマンドを生成します。 |
| `module/1_makejson.html` | 会話ログから project を作り、summary / hook / scene / sub_scene / voice_manifest / render draft のJSONを作ります。 |
| `module/2_slideprompt_builder.html` | 会話ログと lesson_slide_plan から `03-slide_spec` とスライド個別JSONを作ります。 |
| `module/3_Final-Cut-panel.html` | `06-render-draft` または `render-final` を読み込み、音声・字幕・画像・BGM・演出を最終調整します。 |
| `module/tool1-timing-calc.html` | `render-final-v01.json` などを読み込み、scene / sub_scene の秒・フレームタイミングを調整する補助ツールです。 |
| `module/tool2-hook-viewer-lens.html` | 完成済み会話劇を視聴者目線で分析するためのプロンプト生成ツールです。Final Cut連携はしません。 |
| `module/tool3-voicevox-last-tone-checker.html` | `render-final-v01.json` と生成済みwavを最後に耳チェックし、気になるsceneだけVOICEVOXで簡易再生成します。 |
| `module/tool4-hook-pic-builder.html` | TOP / MAIN / SUB と会話内容から、Shorts冒頭0〜2秒向けのHOOK画像生成プロンプトを作ります。 |

## SOT: 全体フロー

```text
会話生成
  ↓
module1: project作成 / raw_conversation保存
  ↓
module2: lesson_slide_plan → 03-slide_spec保存
  ↓
module1: summary / hook / scene / sub_scene / voice_manifest / 06-render-draft作成
  ↓
module3: Final Cut調整
  ├─ 必要に応じて tool4: HOOK画像プロンプト生成
  └─ 必要に応じて tool1/tool3: timing / voice最終確認
  ↓
projects/{id}/outputs/video/render-final-v01.json
  ↓
npm run voicevox
  ↓
projects/{id}/outputs/audio/seg_NNN.wav
  ↓
npm run scene-remotion:render
  ↓
projects/{id}/outputs/video/psych-short-{run_id}.mp4
```

## SOT: ディレクトリ構成

```text
.
├─ index.html
├─ package.json
├─ README.md
├─ module/
│  ├─ 1_makejson.html
│  ├─ 2_slideprompt_builder.html
│  ├─ 3_Final-Cut-panel.html
│  ├─ tool1-timing-calc.html
│  ├─ tool2-hook-viewer-lens.html
│  ├─ tool3-voicevox-last-tone-checker.html
│  └─ tool4-hook-pic-builder.html
├─ scripts/
│  ├─ run-scene-remotion.mjs
│  ├─ run-voicevox-batch.mjs
│  └─ voicevox-cors-proxy.mjs
├─ assets/
│  ├─ background/background-manifest.json
│  ├─ images/frames/slide/000/*.png
│  └─ mock/*.html
├─ projects/
│  └─ 0000/
│     ├─ meta.json
│     ├─ raw/
│     ├─ pipeline/
│     └─ outputs/
│        ├─ slide/
│        ├─ audio/
│        └─ video/
└─ .remotion-public/
   ├─ 20_ショート動画v2/
   └─ shared-assets/
```

### `projects/{id}` の標準構成

```text
projects/{id}/
  meta.json
  raw/
    raw_conversation.txt
    raw_conversation-vNN.txt
  pipeline/
    01-summary_spec-vNN.json
    02-hook_spec-vNN.json
    03-slide_spec-vNN.json
    04-scene_spec-vNN.json
    05-sub_scene_spec-vNN.json
    06-voice_manifest-vNN.json
  outputs/
    slide/
      slide_01.json
      slide_02.json
      slide_03.json
      slide01.png
      slide02.png
      slide03.png
    audio/
      seg_001.wav
      seg_002.wav
      voicevox-batch-result-{run_id}.json
    video/
      06-render-draft-vNN.json
      render-final-v01.json
      psych-short-{run_id}.mp4
```

`projects/0000/` は現在確認できるサンプルprojectです。

## 使い方

### 1. ランチャーを開く

`index.html` をブラウザで開きます。

Chrome / Edge 系ブラウザ推奨です。各moduleは File System Access API を使うため、最初にワークスペースとしてこのリポジトリ、または親の `02_hobby` を選びます。

ランチャーから開けるもの:

- 会話生成: `https://49601000.github.io/zund-short-prompter/`
- JSON作成: `module/1_makejson.html`
- スライド用プロンプト生成: `module/2_slideprompt_builder.html`
- Final Cut Panel: `module/3_Final-Cut-panel.html`
- Timing Calc: `module/tool1-timing-calc.html`
- Hook Viewer Lens: `module/tool2-hook-viewer-lens.html`
- VOICEVOX Last Tone Checker: `module/tool3-voicevox-last-tone-checker.html`
- HOOK画像プロンプト生成: `module/tool4-hook-pic-builder.html`

### 2. module1: 会話ログから動画素材JSONを作る

`module/1_makejson.html` を開きます。

できること:

- `projects/{id}` の新規作成
- `meta.json` の作成
- `raw_conversation` の保存
- `01-summary_spec`
- `02-hook_spec`
- `04-scene_spec`
- `05-sub_scene_spec`
- `06-voice_manifest`
- `06-render-draft`

注意:

- `03-slide_spec` は module2 が担当します。
- `04-scene_spec` は最新の `03-slide_spec-vNN.json` を読みます。
- `06-render-draft` は hook / slide / sub_scene / voice_manifest / audio をまとめたレンダー下書きです。
- `02-hook_spec` は現在の scene 生成では直接使いません。ただし render draft 作成時に選択hookとして合流します。

`02-hook_spec` の位置づけ:

```text
今の実運用:
raw_conversation
  ↓
summary
  ↓
scene

将来戻したい拡張ルート:
Hook Lab
  ↓
selected_hook
  ↓
Script Forge
  ↓
scene
```

### 3. module2: スライド設計JSONを作る

`module/2_slideprompt_builder.html` を開きます。

流れ:

1. `raw_conversation` を貼り付ける、またはファイルから読み込む
2. `Lesson Planner Prompt生成` で ChatGPT 用プロンプトを作る
3. ChatGPT の返答として `lesson_slide_plan` JSON を受け取る
4. `Apply Lesson Plan JSON` で読み込む
5. `Slide Prompt生成` で中央スライド画像用プロンプトを作る
6. Workspace接続して対象projectを選ぶ
7. `③ slide_spec 作成 / 保存` で保存する

保存先:

```text
projects/{id}/pipeline/03-slide_spec-vNN.json
projects/{id}/outputs/slide/{slide_id}.json
```

生成プロンプトの固定仕様:

- `preset_id`: `slide_canvas_whiteboard_v1`
- `target_use`: `center_slide_asset`
- `canvas_aspect_ratio`: `16:9`
- 用途: 縦型9:16動画の中央スライド領域に差し込む画像

### 4. module3: render draftをFinal Cutする

`module/3_Final-Cut-panel.html` を開きます。

目的は、module1で作った `06-render-draft-vNN.json` を人間が確認し、最終レンダー用の `render-final-v01.json` に仕上げることです。

主な編集対象:

- VOICEVOX endpoint / 話者 / スタイル / 速度
- scene単位の `voice` / `voice_override`
- sub_scene単位の字幕・画面テキスト
- title帯の文言、色、高さ、文字サイズ、幅、改行
- 背景画像、scene単位背景override、BGM、音量
- スライド画像、モノリス、ダイアログ枠、左右キャラ画像
- HOOK背景、HOOKキャラ、HOOK吹き出し、HOOK文字
- タイムラインの秒・フレームduration

HOOK画像まわりの現在仕様:

- Scene1 / hook scene は、HOOK背景・HOOKキャラ・HOOK吹き出し画像・TOP / MAIN / SUB をFinal Cut Panelで選べます。
- HOOK吹き出しは、Final Cut Panel側では画像素材として扱います。
- Remotion側にはHOOK吹き出しのデフォルト座標を置きません。`hook_visual.bubble.x/y/width/height` が明示されない限り、Remotionは別パーツの吹き出しを自動描画しません。
- 画像生成で作るHOOK画像自体に吹き出しや二人の掛け合いを含める運用を優先します。

保存先:

```text
projects/{id}/outputs/video/render-final-v01.json
```

VOICEVOX endpoint の既定値:

```text
http://127.0.0.1:5510
```

`5510` はこのリポジトリの `voicevox:proxy` が立てるCORSプロキシです。VOICEVOX Engine本体の既定値は `http://127.0.0.1:50021` です。

ブラウザから `/speakers` 取得などがCORSで失敗する場合は、VOICEVOX Engineを起動したうえで別ターミナルから実行します。

```powershell
npm run voicevox:proxy
```

プロキシの転送先やポートを変える場合:

```powershell
$env:VOICEVOX_ENGINE_URL="http://127.0.0.1:50021"
$env:VOICEVOX_PROXY_PORT="5510"
npm run voicevox:proxy
```

### 5. 補助ツール

`module/tool1-timing-calc.html`:

- `render-final-v01.json` または Timing Output JSON を読み込みます。
- scene / sub_scene の `start_sec` / `duration_sec` / frameを調整するための補助ツールです。
- localStorage key: `sv2_timing_calc_state_v1`

`module/tool2-hook-viewer-lens.html`:

- 完成済みの会話劇を貼り付けます。
- ChatGPT等へ渡す分析プロンプトを生成します。
- `viewer_lens` と `hook_candidates` の2モードがあります。
- projectファイル、localStorage、Final Cut Panelとの直接連携はありません。

`module/tool3-voicevox-last-tone-checker.html`:

- `render-final-v01.json` と生成済みwavを読み込みます。
- 最終レンダー前に、sceneごとの音声を耳で確認します。
- 気になるsceneだけVOICEVOXで簡易再生成し、差し替え前の確認に使います。

`module/tool4-hook-pic-builder.html`:

- TOP / MAIN / SUB と会話内容から、ChatGPT画像生成用のHOOK画像プロンプトを作ります。
- 対象はYouTube Shorts冒頭0〜2秒で表示するHOOK画像です。
- 目的は心理学用語の説明ではなく、「あるある」「自分のことかも」「見たことある」を一瞬で伝えることです。
- TOP / MAIN / SUB は画像内に必ず入れ、文言の改変・省略・追加はしません。
- MAINを最も大きくし、TOPは上、SUBは下に置く前提です。SUBの初期値は `ってだいたいこれ` です。
- ずんだもんは右、四国めたんは左に置く想定です。低頭身・丸いシルエット・大きい表情の2Dデフォルメキャラとして指定します。
- 二人の短い会話吹き出しは入れてOKです。ただし1〜2個まで、MAINの視認性を邪魔しない補助要素にします。
- HOOK本文への集中線、スピード線、放射線、爆発マーク、矢印などの派手なエフェクトは禁止です。文字サイズ・太字・配置で読ませます。

## render / dev / voicevox

### 音声生成

VOICEVOX Engineを起動した状態で実行します。

```powershell
$env:SCENE_OUTPUT_RUN_ID="000"
$env:SCENE_RENDER_SPEC_PATH="projects/0000/outputs/video/render-final-v01.json"
npm run voicevox
```

出力:

```text
projects/0000/outputs/audio/seg_001.wav
projects/0000/outputs/audio/voicevox-batch-result-000.json
```

### Remotion render

```powershell
$env:SCENE_OUTPUT_RUN_ID="000"
$env:SCENE_RENDER_SPEC_PATH="projects/0000/outputs/video/render-final-v01.json"
npm run scene-remotion:render
```

出力:

```text
projects/0000/outputs/video/psych-short-000.mp4
```

### Remotion dev preview

```powershell
$env:SCENE_OUTPUT_RUN_ID="000"
$env:SCENE_RENDER_SPEC_PATH="projects/0000/outputs/video/render-final-v01.json"
npm run scene-remotion:dev
```

### spec同期だけ確認する

```powershell
$env:SCENE_OUTPUT_RUN_ID="000"
$env:SCENE_RENDER_SPEC_PATH="projects/0000/outputs/video/render-final-v01.json"
npm run scene-remotion:sync-spec
```

dry-run:

```powershell
$env:SCENE_OUTPUT_RUN_ID="000"
$env:SCENE_RENDER_SPEC_PATH="projects/0000/outputs/video/render-final-v01.json"
node scripts/run-scene-remotion.mjs sync-spec --dry-run
```

## npm scripts

現在の推奨script:

```text
npm run dev
npm run voicevox
npm run scene-remotion:dev
npm run scene-remotion:render
npm run scene-remotion:voicevox:initial
npm run scene-remotion:voicevox:publish
npm run scene-remotion:sync-spec
npm run scene-remotion:voicevox:batch
npm run scene-remotion:voicevox
npm run scene-remotion:typecheck
npm run voicevox:proxy
```

`package.json` に定義されている全script:

```text
dev
voicevox
renderer:dev
renderer:render
renderer:voicevox
renderer:help
scene-remotion:dev
scene-remotion:render
scene-remotion:voicevox:initial
scene-remotion:voicevox:publish
scene-remotion:sync-spec
scene-remotion:render:runid
scene-remotion:voicevox:batch
scene-remotion:voicevox
scene-remotion:typecheck
voicevox:proxy
```

実体がこのリポジトリにあるscript:

```text
scripts/run-scene-remotion.mjs
scripts/run-voicevox-batch.mjs
scripts/voicevox-cors-proxy.mjs
```

`renderer:*` と `scene-remotion:render:runid` は `package.json` 上には残っていますが、現在のツリーには対応する `scripts/run-renderer.mjs` と `scripts/run-scene-render-by-runid.mjs` がありません。復活させるまでは、推奨scriptを正規ルートとして使います。

## 環境変数

| 変数 | 用途 | 既定値 |
| --- | --- | --- |
| `SCENE_OUTPUT_RUN_ID` | 出力動画番号。`000` のような数値、または render 側では `auto` も可。 | `000` |
| `SCENE_RENDER_SPEC_PATH` | render / voicevox の入力JSON。 | 最新の `render-final*.json`、なければ `projects/0000/outputs/video/render-final-v01.json` |
| `RENDER_SPEC_PATH` | `SCENE_RENDER_SPEC_PATH` の別名。 | 同上 |
| `SCENE_PROJECT_ID` | project IDを明示指定します。 | spec内の `project_id` またはpathから推定 |
| `PROJECT_ID` | `SCENE_PROJECT_ID` の別名。 | 同上 |
| `SCENE_REMOTION_RENDERER_ROOT` | 隣接する Remotion renderer の場所。 | `../remotion-renderer` |
| `REMOTION_RENDERER_ROOT` | `SCENE_REMOTION_RENDERER_ROOT` の別名。 | 同上 |
| `VOICEVOX_URL` | batch音声生成が叩くVOICEVOX Engine URL。 | `http://127.0.0.1:50021` |
| `VOICEVOX_BATCH_SPEC_PATH` | `npm run voicevox` 専用の入力JSON。 | `SCENE_RENDER_SPEC_PATH` |
| `VOICEVOX_ENGINE_URL` | CORSプロキシの転送先。 | `http://127.0.0.1:50021` |
| `VOICEVOX_PROXY_HOST` | CORSプロキシのlisten host。 | `127.0.0.1` |
| `VOICEVOX_PROXY_PORT` / `PORT` | CORSプロキシのlisten port。 | `5510` |

## Remotion連携のSOT

`scripts/run-scene-remotion.mjs` が、Final Cut後のJSONを Remotion renderer 用に同期します。

やっていること:

- `SCENE_RENDER_SPEC_PATH` のJSONを読む
- renderer側の `src/data/render_spec.json` へ変換して書く
- `projects/{id}/outputs/audio/*.wav` を shared-assets 側へ同期する
- `shared-assets` と project内の必要素材を `.remotion-public/` にステージングする
- renderer側で `npm run dev` / `npm run render` / `npm run voicevox` / `npx tsc --noEmit` を実行する
- render後、renderer側の `out/psych-short.mp4` を `projects/{id}/outputs/video/psych-short-{run_id}.mp4` にコピーする

`.remotion-public/` はステージング領域です。手作業で編集する本体ではなく、render前の同期結果として扱います。

HOOK吹き出しの扱い:

- Final Cut Panelは `scene_assets.hook_bubble` / `hook_visual.bubble.image_path` として吹き出し画像をJSONに入れられます。
- 現在のRemotion側は、HOOK吹き出しのデフォルト `x/y/width/height` を持ちません。
- `hook_visual.bubble.x/y/width/height` が全て明示されている場合だけ、Remotionが別パーツとして吹き出しを描画します。
- 通常運用では、Tool4で作ったHOOK画像プロンプトから、吹き出し込みの1枚絵を作ってFinal Cut Panelで画像として選びます。

## assets / shared-assets のSOT

このリポジトリ内:

```text
assets/background/background-manifest.json
assets/images/frames/slide/000/*.png
assets/mock/*.html
```

Final Cut Panel の shared-assets 推奨ルート:

```text
MyAntigravity/02_hobby/shared-assets
```

主なサブフォルダ:

```text
images/backgrounds
audio/bgm
images/monolith
images/logboard
images/characters/metan
images/characters/zundamon
images/frames
```

Remotion用のpublic参照では、素材はおおむね次のprefixへ寄せます。

```text
shared-assets/...
20_ショート動画v2/projects/...
```

## localStorage

主な保存key:

```text
svrs_raw_conversation
svrs_lesson_slide_plan
svrs_slide_prompt_spec
svrs_slide_spec
svrs_video_spec
svrs_voice_settings
svrs_voice_character_defaults_v3
svrs_voicevox_system_settings_v1
svrs_voicevox_speakers_cache_v1
svrs_output_run_id
sv2_index_project_id
sv2_index_run_id
sv2_timing_calc_state_v1
```

localStorageは中間状態です。SOTとして残す成果物は `projects/{id}/` 配下のJSON / WAV / MP4です。

## ざっくり役割分担

```text
index   = 入口とコマンドコピー係
module1 = 会話ログを動画用JSONへ分解する係
module2 = スライド画像の設計図を作る係
module3 = 最後に人間が見て整える編集卓
tool1   = タイミング計算の補助係
tool2   = HOOKの視聴者目線チェック係
tool3   = VOICEVOX音声の最終耳チェック係
tool4   = HOOK画像生成プロンプトを作る係
scripts = VOICEVOX / Remotion への橋渡し係
```
