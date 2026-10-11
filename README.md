# Running Tracker

スマートフォンのブラウザGPSを使って、走行中の距離・経過時間・ペース・1kmラップとペース推移グラフをリアルタイムに表示するランニング専用アプリです。

## 起動

```bash
npm install
npm start
```

`http://localhost:3000` を開き、位置情報の利用を許可してください。

## ランニング計測

「計測開始」を押すとGPS計測を開始します。計測中は平均ペースを大きく表示し、距離・経過時間・計測状態と一時停止ボタンを最初の画面で確認できます。終了する場合は、一時停止してから「計測を終了」を押します。1kmごとのラップとペース推移グラフは下へスクロールして確認できます。

GPSの取得間隔は固定ではなく、端末とブラウザが新しい位置情報を受け取ったタイミングで更新します。高精度GPSを要求し、古いキャッシュ値は使用しませんが、実際の間隔は通信環境やGPSの状態によって変わります。画面の経過時間と距離は約0.5秒ごとに再描画し、平均ペース（計測時間 ÷ 走行距離）は約5秒ごとに再計算します。距離が20m未満の場合は「—」を表示します。ペース推移グラフとラップ一覧は、1km到達時に更新されます。

GPS軌跡や走行結果は保存・送信しません。計測結果はページを閉じるまで画面で確認できます。

GPSはHTTPSまたは端末上の `localhost` でのみ利用できます。スマートフォンから開発PC上のサーバーへアクセスする場合は、Cloud RunなどのHTTPS URLを使用してください。

10km走行後の画面を確認する場合は、`http://localhost:3000/?demo=10km` を開きます。

## Storybookでデザインを確認

開発環境はNode.js 20.19以降の20系、または22.12以降を使用してください。

```bash
npm install
npm run storybook
```

`http://localhost:6006/?path=/story/running-screen--running` で「計測中」のプレビューが開きます。本番アプリのサーバーを起動する必要はありません。HTML・CSS・数値やラップの表示処理を本番画面と共有するため、変更はプレビューにも反映されます。

左の画面一覧で、開始前・GPS準備中・計測中・一時停止・10km完了・ペース未取得・1時間超・GPS精度低下・GPSエラーを切り替えられます。Controlsで距離、経過時間、GPS表示、案内文を変更できます。平均ペースは距離と時間から計算されます。画面サイズは初期表示の412×780から、360×640やデスクトップへ切り替えられます。対応端末はGoogle Pixel 10aです。プレビューの寸法はCSSピクセルによるレイアウト確認用で、実機のGPSや画面点灯維持の検証は端末で行ってください。

プレビューのボタンで一時停止・再開・終了を試せます。開始と再開では1秒間GPS準備中の表示になり、その後計測中に移ります。数値は固定のダミーデータで、GPS、音声通知、画面点灯維持、保存は実行しません。

静的プレビューを生成する場合:

```bash
npm run build-storybook
```

生成先は`storybook-static/`です。Storybookは開発用で、本番コンテナには含めません。

## Cloud Run への配置

このリポジトリには、検証からCloud Run公開URLの確認までを行うデプロイskillがあります。

初回だけ、Google Cloud CLIへログインします。

```bash
gcloud auth login
```

現在のデプロイ先は次の通りです。

- プロジェクト: `aigamerfriend`
- リージョン: `asia-northeast1`
- サービス: `google-health-dashboard`

テスト、構文チェック、デプロイ、公開URL確認をまとめて実行します。

```bash
./skills/running-tracker-deploy/scripts/deploy.sh
```

デプロイ先を変更する場合は、実行時に環境変数で上書きできます。

```bash
PROJECT_ID="your-project-id" \
REGION="asia-northeast1" \
SERVICE_NAME="your-service-name" \
SERVICE_URL="https://your-service-url" \
./skills/running-tracker-deploy/scripts/deploy.sh
```

デプロイ後に表示されるHTTPS URLをスマートフォンで開いてください。commitとpushは、変更内容を確認したうえで別途実行します。

## 開発

```bash
npm run dev
npm test
```
