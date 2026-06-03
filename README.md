# short-video-v2

ずんだもん系ショート動画を作るための、ブラウザ完結型の制作パネル集です。

会話ログから `projects/{id}` 配下に中間JSONを積み上げ、最後に `render-final-v01.json` を作って Remotion 側へ渡す流れです。

## 現在の画面構成

| ファイル | 役割 |
| --- | --- |
| `index.html` | 全体ランチャー。各moduleへのリンクと、final JSONをrender/devするPowerShellコマンドを生成します。 |
| `module/1_makejson.html` | 会話ログからプロジェクトを作り、summary / hook / scene / sub_scene / render draft のJSONを作ります。 |
| `module/2_slideprompt_builder.html` | 会話ログからスライド案作成用プロンプトを作り、`03-slide_spec` とスライド個別JSONを保存します。 |
| `module/3_Final-Cut-panel.html` | `06-render-draft` を読み込み、音声・字幕・画像・BGM・演出を調整して `render-final-v01.json` に反映します。 |

## 全体フロー

```text
会話生成
  ↓
module1: プロジェクト作成 / raw_conversation 保存
  ↓
module2: lesson_slide_plan → 03-slide_spec 保存
  ↓
module1: summary / hook / scene / sub_scene / render draft 作成
  ↓
module3: Final Cut 調整
  ↓
projects/{id}/outputs/video/render-final-v01.json
  ↓
npm run scene-remotion:render
```

## 使い方

### 1. ランチャーを開く

`index.html` をブラウザで開きます。

ランチャーから以下を開けます。

- 会話生成: `https://49601000.github.io/zund-short-prompter/`
- JSON作成: `module/1_makejson.html`
- スライド用プロンプト生成: `module/2_slideprompt_builder.html`
- Final Cut Panel: `module/3_Final-Cut-panel.html`

`index.html` では、`project_id` と `run_id` を入力すると次のようなコマンドをコピーできます。

```powershell
$env:SCENE_OUTPUT_RUN_ID="000"
$env:SCENE_RENDER_SPEC_PATH="projects/0000/outputs/video/render-final-v01.json"
npm run scene-remotion:render
```

### 2. module1: 会話ログから動画素材JSONを作る

`module/1_makejson.html` を開きます。

最初に `ワークスペースを選択` で、このリポジトリのルートを選びます。ブラウザの File System Access API を使うため、Chrome / Edge 系のブラウザ推奨です。

できること:

- `projects/{id}` の新規作成
- `meta.json` の作成
- 会話ログの貼り付け、または `.txt` / `.json` から読み込み
- pipeline JSON の段階生成
- render draft JSON の作成

作成される主な構成:

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
    audio/
    video/
      06-render-draft-vNN.json
```

注意:

- `03-slide_spec` は module2 が担当します。
- `02-hook_spec` は現在の `04-scene_spec` 生成には使っていません。ただし `06-render-draft` 作成時に選択hookとして読み込まれます。将来 `Hook Lab -> selected_hook -> Script Forge -> scene` に戻すための拡張ポイントとして残しています。
- module1 の `4. scene_spec 作成` は最新の `03-slide_spec-vNN.json` を読みます。
- `6. 06-render-draft-v01.json 作成` は、hook / slide / sub_scene / voice_manifest / audio をまとめたレンダー下書きです。

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

`02-hook_spec` は、ショート動画で特に重要な「最初の2秒」を独立して試作・選定するための予約席です。現時点では `hook_a` / `hook_b` / `hook_c` / `selected_hook` のような独立アセットを持てるようにしておき、scene生成からは独立させています。通常はプロジェクト作成時に初期ファイルが作られるため、render draft 作成時だけ選択hookとして合流します。

### 3. module2: スライド用プロンプトとslide_specを作る

`module/2_slideprompt_builder.html` を開きます。

流れ:

1. `raw_conversation` を貼り付ける、またはファイルから読み込む
2. `Lesson Planner Prompt生成` で ChatGPT 用プロンプトを作る
3. ChatGPT の返答として `lesson_slide_plan` JSON を受け取る
4. `Apply Lesson Plan JSON` で読み込む
5. `Slide Prompt生成` で中央スライド画像用プロンプトを作る
6. `Workspace接続` して対象projectを選ぶ
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

localStorage にも中間状態を保存します。

- `svrs_raw_conversation`
- `svrs_lesson_slide_plan`
- `svrs_slide_prompt_spec`
- `svrs_slide_spec`

### 4. module3: render draftをFinal Cutする

`module/3_Final-Cut-panel.html` を開きます。

目的は、module1で作った `06-render-draft-vNN.json` を人間が確認し、最終レンダー用の `render-final-v01.json` に仕上げることです。

流れ:

1. `ワークスペース選択` でリポジトリルートを選ぶ
2. projectを選ぶ
3. `render draft読込` で `projects/{id}/outputs/video/06-render-draft-vNN.json` を読み込む
4. scene / sub_scene 単位で音声、字幕、表示文、スライド画像、キャラ、hook文言などを調整する
5. 必要なら VOICEVOX endpoint、話者、スタイル、BGM、背景、shared-assets を設定する
6. `render-final-v01.jsonに書き出し・反映` で保存する

保存先:

```text
projects/{id}/outputs/video/render-final-v01.json
```

主な編集対象:

- VOICEVOX endpoint: 既定値 `http://127.0.0.1:5510`
- VOICEVOX話者 / スタイル / 速度
- scene単位の voice / voice_override
- sub_scene単位の字幕・画面テキスト
- タイトル帯の文言、色、高さ、文字サイズ、幅、改行
- 背景画像、BGM、音量
- スライド画像、モノリス、ダイアログ枠、左右キャラ画像
- タイムライン duration

shared-assets 連携:

- 推奨ルート: `MyAntigravity/02_hobby/shared-assets`
- 背景: `images/backgrounds`
- BGM: `audio/bgm`
- スライド: `assets/images/frames/slide/{run_id}` または `images/frames/slide/{run_id}`
- モノリス: `images/monolith`
- ダイアログ枠: `images/logboard`
- 左キャラ: `images/characters/metan`
- 右キャラ: `images/characters/zundamon`, `images/frames`

localStorage にも中間状態を保存します。

- `svrs_video_spec`
- `svrs_voice_settings`
- `svrs_voice_character_defaults_v3`
- `svrs_voicevox_system_settings_v1`
- `svrs_voicevox_speakers_cache_v1`
- `svrs_output_run_id`

## render

Final Cut Panel で作ったJSONを指定して render します。

```powershell
$env:SCENE_OUTPUT_RUN_ID="000"
$env:SCENE_RENDER_SPEC_PATH="projects/0000/outputs/video/render-final-v01.json"
npm run scene-remotion:render
```

開発プレビューの場合:

```powershell
$env:SCENE_OUTPUT_RUN_ID="000"
$env:SCENE_RENDER_SPEC_PATH="projects/0000/outputs/video/render-final-v01.json"
npm run scene-remotion:dev
```

`index.html` のコマンド生成欄から、project_id / run_id に合わせたコマンドをコピーできます。

## npm scripts

`package.json` に定義されている主なコマンドです。

```text
npm run dev
npm run scene-remotion:dev
npm run scene-remotion:render
npm run scene-remotion:voicevox:initial
npm run scene-remotion:voicevox:publish
npm run scene-remotion:voicevox:batch
npm run scene-remotion:audio:sync
npm run scene-remotion:typecheck
npm run voicevox:proxy
```

現状のリポジトリ直下には `scripts/` ディレクトリがないため、これらのコマンドはレンダラー連携スクリプトが配置されている環境で実行してください。

## 現在確認できるサンプルproject

```text
projects/0000/
```

確認できる成果物:

- `meta.json`
- `pipeline/01-summary_spec-v01.json` など
- `pipeline/03-slide_spec-vNN.json`
- `outputs/slide/slide_01.json` など
- `outputs/video/render-final-v01.json`

## ざっくり役割分担

```text
module1 = 会話ログを動画用JSONへ分解する係
module2 = スライド画像を作るための設計図を作る係
module3 = 最後に人間が見て整える編集卓
index   = 入口とrenderコマンドのコピー係
```
