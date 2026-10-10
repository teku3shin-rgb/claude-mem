# 深層線 DEEP LINE 2039

メトロシリーズ（Metro 2033 / Last Light / Exodus）にインスパイアされた、ブラウザで遊べる一人称3Dサバイバルシューター。
核戦争後の東京の地下鉄を舞台に、全6章・エンディング3種の物語を収録している。

シナリオ、マップ、モデル、テクスチャ、サウンドをすべてコードで生成している。3D モデルと PBR テクスチャは Blender をスクリプトで動かして作り、
`js/assets*.js` に埋め込んである（[tools/README.md](tools/README.md)）。

- **人物**: [MakeHuman](http://www.makehumancommunity.org/) の CC0 の人体データ（体型・リグ・ウェイト）から 19 人を作り、服・髪・ひげ・装備を足して
  一人ずつテクスチャを焼いた、スキニング済みのフル 3D モデル。
- **変異体**: ムクロ・ヌシ・ハハ・ハグレは独自のデザイン（[SCENARIO.md](SCENARIO.md) の「変異体」）。彫り込んだハイポリから法線マップを焼いている。

音はすべて WebAudio で合成していて、音声ファイルは無い。銃声は録音の代わりに、衝撃波・銃口の爆風・ガスの尾・低音・超音速弾の
衝撃音・作動音という物理的な成り立ちから起動時に計算し（`js/sfx.js`）、トンネル・駅・ホール・地上それぞれの残響（帯域ごとの減衰、
初期反射、平行な壁のフラッターエコー、建物からのはね返り）で畳み込む。遠くの銃声は距離に応じて遅れて届き、高音が削れる。

外部ライブラリは three.js（r128）と GLTFLoader・SkeletonUtils・FXAA シェーダー、meshoptimizer のデコーダーだけ（どれも `vendor/` に同梱、
three.js は MIT License、FXAA は NVIDIA の BSD License）。

## グラフィック

設定の「画質」で選ぶ（URL の `?gfx=low|medium|high|ultra` でも一時的に変えられる）。中以上は `js/post.js` の HDR パイプラインで描く。

| 画質 | 内容 |
| --- | --- |
| 低 | 従来どおりの直接描画（MSAA）。古い PC やノート PC 向け |
| 中 | HDR、ブルーム（縮小・拡大の連鎖）、懐中電灯の光の筋とランプの霞（体積光）、ACES トーンマップと色調、FXAA |
| 高（既定） | 中 ＋ SSAO（隅や接地面の陰り）、影マップ 2048、色収差 |
| 最高 | 高 ＋ SSAO を全解像度で、体積光の段数を増やし、描画解像度を最大 2 倍に |

- **体積光**: 懐中電灯の円錐を影マップで遮りながら視線に沿って積分するので、物の影が光の筋になって霞に落ちる。ランプのまわりの霞は
  逆二乗の散乱を解析的に積分し、壁の向こうのランプは霞を弱める。
- **壁際の細部**（`js/dress.js`）: 格子の地形から巾木・天井の見切り・垂れ下がったケーブルの束と支持金具・配管・瓦礫・紙くず・水たまりを
  自動で並べる。壁や床のシェーダーには、近くで効く細かい凹凸、繰り返しを崩す色むら、濡れた床（光を照り返す）、壁を伝う水染みを足している。

## デスクトップ版（PC アプリとして動かす）

`desktop/` は [Electron](https://www.electronjs.org/) でゲームを包んだもの。ブラウザの枠なしの全画面で、GPU を確実に使って動く。

```bash
cd games/deep-line-2039/desktop
npm install
npm start                 # 全画面で起動（F11 で切り替え、--windowed でウィンドウ）
npm start -- --gfx=ultra  # 画質を指定して起動
npm run pack:win          # Windows 用のフォルダを dist/ に作る（pack:mac / pack:linux も）
```

`pack:*` は `index.html` と `js/`・`vendor/` を `desktop/game/` に写してから、Electron と一緒にまとめる。

物語と登場人物は [SCENARIO.md](SCENARIO.md) を参照。

## 遊び方

`index.html` をブラウザ（Chrome / Edge / Firefox の最新版）で開くだけで遊べる。ビルドは不要。

ローカルサーバーで開く場合:

```bash
cd games/deep-line-2039
npx serve .   # または python3 -m http.server
```

キーボードとマウスが必要。ヘッドフォン推奨。

## 操作

| キー | 動作 |
| --- | --- |
| W A S D | 移動（Shift 走る / C しゃがむ / Space ジャンプ） |
| マウス | 視点（矢印キーでも回せる） |
| 左クリック / 右クリック | 撃つ / 狙う |
| R | リロード |
| 1 2 3・ホイール | 武器の切り替え |
| B | 短機関銃に軍用弾（通貨）を込める／通常弾に戻す |
| V | ナイフ。気づかれていない人間の背後からなら一撃 |
| Q | パイプ爆弾 |
| F | ライト |
| T（長押し） | 手回し充電器でライトの電池を充電 |
| G | ガスマスクの着脱 |
| H | 医療キット |
| E | 話す・調べる・使う |
| Tab | 手帳（目標と拾ったメモ） |
| Esc | 一時停止 |

## メトロらしさの要素

- **ガスマスクとフィルター**：腕時計にフィルターの残り時間が出る。被弾するとマスクにひびが入り、割れると使えなくなる。
- **ライトと手回し充電器**：電池が減るとライトがちらつく。充電中は銃を撃てない。
- **軍用弾は通貨**：商人との取引に使う一方、強力な弾として撃つこともできる。
- **光と闇のステルス**：腕時計の青いランプは「見られている」合図。電球は撃てば消える。
- **隠しカルマ**：小さな善行の積み重ねで結末が変わる。
- **残響**：トンネルで起きる超常現象。

## 構成

```
index.html       画面（HUD・メニュー・字幕）とスタイル
js/util.js       数学ユーティリティ、手続き型テクスチャ、保存
js/audio.js      WebAudio による効果音・環境音・ギター（カープラス・ストロング）
js/sfx.js        銃声・装填・着弾・爆発の合成と、空間ごとの残響（インパルス応答）
js/world.js      グリッドベースのワールド生成、衝突判定、レイキャスト、経路探索、照明プール
js/dress.js      壁際の細部の自動配置と、壁や床の表面の細部（シェーダー）
js/models.js     人物・変異体・武器・小道具（Blender 製アセットが無いときはプリミティブで組む）
js/gfx.js        Blender 製アセットの読み込みと、ゲーム用のマテリアル・リグ（スキニング）への組み立て
js/post.js       HDR の後処理（SSAO、体積光、ブルーム、トーンマップと色調、FXAA）と画質プリセット
js/assets.js     Blender で生成した武器・小道具のモデルと壁や床のテクスチャ（自動生成、tools/pack_assets.py）
js/assets-chars.js    人物 19 人のモデルとテクスチャ（自動生成）
js/assets-mutants.js  変異体 4 種のモデルとテクスチャ（自動生成）
js/entities.js   変異体AI、人間AI（味方・敵・ステルス・降伏）、拾得物、爆弾、エフェクト
js/player.js     移動、武器、ガスマスク、ライト、一人称モデル
js/ui.js         HUD、字幕、選択肢、商店、手帳、章カード
js/levels.js     全6章の地形・登場人物・台詞・イベント、エンディング
js/game.js       メインループ、入力、章の読み込み、チェックポイント、メニュー
vendor/three.min.js  three.js r128（MIT License）
vendor/GLTFLoader.js three.js r128 の GLTFLoader（MIT License）
vendor/SkeletonUtils.js  three.js r128 の SkeletonUtils（MIT License）
vendor/FXAAShader.js  three.js r128 の FXAA シェーダー（NVIDIA FXAA 3.11、BSD License）
vendor/meshopt_decoder*.js  meshoptimizer のデコーダー（MIT License）
desktop/         デスクトップ版（Electron）
tools/           Blender（bpy）でモデルとテクスチャを生成するスクリプト
```

## デバッグ

URL に `?debug` を付けると全章が選択可能になる。`?debug&ch=3` で第四章から直接始まる。
デバッグ中はコンソールで `DL.game.post.debug = 'ao'`（または `'vol'` `'bloom'`）とすると後処理の途中経過を表示する。
