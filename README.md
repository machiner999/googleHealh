# Google Health Dashboard

ブラウザから Google Health API に OAuth 2.0 で接続し、直近 7 日の健康情報を表示するダッシュボードです。ランニング画面では、スマートフォンのブラウザ GPS を使って、走行中の距離・経過時間・ペース・1kmラップをリアルタイムに表示します。

## 起動

1. Google Cloud で Google Health API を有効化し、OAuth クライアント（Web application）を作成します。
2. Authorized redirect URI に `http://localhost:3000/oauth2callback` を登録します。
3. `.env.example` を `.env` にコピーし、Client ID と Client Secret を設定します。
4. `npm start` を実行して `http://localhost:3000` を開きます。

このサンプルは、読み取り専用の次のスコープを使用します。

- `googlehealth.activity_and_fitness.readonly`
- `googlehealth.health_metrics_and_measurements.readonly`

表示対象は歩数、距離、消費カロリー、アクティブ時間、体重です。データが存在しない日には `—` を表示します。

## ランニング計測

画面上部の「ランニング」タブから計測を開始します。位置情報の許可後、GPSの位置情報をブラウザ内だけで処理し、GPS軌跡は保存・送信しません。終了した走行は、総距離・総時間・ラップ概要だけをブラウザのLocalStorageへ保存します。

GPSはHTTPSまたは端末上の `localhost` でのみ利用できます。スマートフォンからMac上の開発サーバーへアクセスする場合は、Cloud RunなどのHTTPS URLを使用してください。

## Cloud Run への配置

Cloud RunではセッションをFirestoreに保存します。あらかじめFirestoreデータベースを作成し、Secret Managerに次の2つのシークレットを登録してください。

- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET`

デプロイ例：

```bash
gcloud run deploy google-health-dashboard \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,SESSION_STORE=firestore,SESSION_COLLECTION=googleHealthSessions,GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com \
  --set-secrets GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,SESSION_SECRET=SESSION_SECRET:latest
```

デプロイ後に発行されたCloud Run URLを取得し、`GOOGLE_REDIRECT_URI`を更新します。

```bash
gcloud run services describe google-health-dashboard \
  --region asia-northeast1 \
  --format='value(status.url)'

gcloud run services update google-health-dashboard \
  --region asia-northeast1 \
  --update-env-vars GOOGLE_REDIRECT_URI=https://your-service-xxxxx-an.a.run.app/oauth2callback
```

同じCloud Run URLを使って、Google CloudのOAuthクライアントへ次を登録します。

```text
承認済みのJavaScript生成元: https://your-service-xxxxx-an.a.run.app
承認済みのリダイレクトURI: https://your-service-xxxxx-an.a.run.app/oauth2callback
```

Cloud Runのサービスアカウントには、Firestoreデータベースへ読み書きできる権限を付与してください。

## 注意

- OAuth の Client Secret はブラウザへ渡さず、ローカルでは `.env`、Cloud RunではSecret Managerで管理してください。
- ローカルの `SESSION_STORE=memory` では再起動するとログイン状態が消えます。Cloud Runでは `SESSION_STORE=firestore` を使用し、FirestoreへOAuthセッションを保存します。公開運用ではHTTPS、CSRF対策、適切なログ・データ保持ポリシーも追加してください。
- Google Health API の利用には Google Cloud 側の OAuth 同意画面、テストユーザー設定、必要に応じたアプリ検証が必要です。
