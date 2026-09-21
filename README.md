# Running Tracker

スマートフォンのブラウザGPSを使って、走行中の距離・経過時間・ペース・1kmラップをリアルタイムに表示するランニング専用アプリです。

## 起動

```bash
npm install
npm start
```

`http://localhost:3000` を開き、位置情報の利用を許可してください。

## ランニング計測

「計測開始」を押すとGPS計測を開始します。計測中は距離、経過時間、現在のペース、1kmごとのラップを表示します。一時停止・再開にも対応しています。

走行結果は総距離・総時間・ラップ概要だけをブラウザのLocalStorageへ保存します。GPS軌跡は保存・送信しません。

GPSはHTTPSまたは端末上の `localhost` でのみ利用できます。スマートフォンから開発PC上のサーバーへアクセスする場合は、Cloud RunなどのHTTPS URLを使用してください。

## Cloud Run への配置

Google Cloudプロジェクトと `gcloud` CLIを用意し、以下の値を環境に合わせて変更します。

```bash
export PROJECT_ID="your-project-id"
export REGION="asia-northeast1"
export SERVICE_NAME="running-tracker"

gcloud config set project "${PROJECT_ID}"
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --allow-unauthenticated \
  --min=0 \
  --max=1 \
  --cpu=1 \
  --memory=256Mi
```

デプロイ後に表示されるHTTPS URLをスマートフォンで開いてください。

## 開発

```bash
npm run dev
npm test
```
