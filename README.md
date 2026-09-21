# Running Tracker

スマートフォンのブラウザGPSを使って、走行中の距離・経過時間・ペース・1kmラップとペース推移グラフをリアルタイムに表示するランニング専用アプリです。

## 起動

```bash
npm install
npm start
```

`http://localhost:3000` を開き、位置情報の利用を許可してください。

## ランニング計測

「計測開始」を押すとGPS計測を開始します。計測中は距離、経過時間、現在のペース、1kmごとのラップとペース推移グラフを表示します。一時停止・再開にも対応しています。

GPSの取得間隔は固定ではなく、端末とブラウザが新しい位置情報を受け取ったタイミングで更新します。高精度GPSを要求し、古いキャッシュ値は使用しませんが、実際の間隔は通信環境やGPSの状態によって変わります。画面の経過時間と距離は約0.5秒ごとに再描画し、現在のペースは約5秒ごとに再計算します。ペース推移グラフとラップ一覧は、1km到達時に更新されます。

GPS軌跡や走行結果は保存・送信しません。計測結果はページを閉じるまで画面で確認できます。

GPSはHTTPSまたは端末上の `localhost` でのみ利用できます。スマートフォンから開発PC上のサーバーへアクセスする場合は、Cloud RunなどのHTTPS URLを使用してください。

10km走行後の画面を確認する場合は、`http://localhost:3000/?demo=10km` を開きます。

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
