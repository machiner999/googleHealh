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

Cloud RunではセッションをFirestoreに保存します。以下は初回セットアップから、ソースコードを更新した後の再デプロイまでの手順です。

### 前提

- Google Cloud プロジェクトと請求先アカウントが有効であること
- `gcloud` CLIでログイン済みであること
- Google Health API、Cloud Run、Firestore、Secret Managerを利用できること

最初に、以降のコマンドで使用する値を設定します。値は自分のGoogle Cloud環境に合わせて変更してください。

```bash
export PROJECT_ID="your-project-id"
export REGION="asia-northeast1"
export SERVICE_NAME="google-health-dashboard"
export SERVICE_ACCOUNT="google-health-dashboard@${PROJECT_ID}.iam.gserviceaccount.com"
export GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"

gcloud config set project "${PROJECT_ID}"
```

### 初回だけ行う設定

必要なAPIを有効化します。

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com
```

Cloud RunからFirestoreとSecret Managerへアクセスするサービスアカウントを作成します。

```bash
gcloud iam service-accounts create google-health-dashboard \
  --display-name="Google Health Dashboard Cloud Run"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/datastore.user"
```

FirestoreのNativeモードデータベースを、Cloud Runと同じリージョンに作成します。既に作成済みの場合はスキップしてください。

```bash
gcloud firestore databases create \
  --location="${REGION}" \
  --type=firestore-native
```

Secret ManagerにClient Secretとセッション秘密鍵を登録します。値は画面に表示されないよう、入力プロンプトから登録します。

```bash
read -rsp "Google OAuth Client Secret: " GOOGLE_CLIENT_SECRET
printf '\n'
printf '%s' "${GOOGLE_CLIENT_SECRET}" | \
  gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=-
unset GOOGLE_CLIENT_SECRET

SESSION_SECRET="$(openssl rand -base64 48)"
printf '%s' "${SESSION_SECRET}" | \
  gcloud secrets create SESSION_SECRET --data-file=-
unset SESSION_SECRET
```

作成済みのサービスアカウントに、上記2つのSecretだけを読み取る権限を付与します。

```bash
gcloud secrets add-iam-policy-binding GOOGLE_CLIENT_SECRET \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding SESSION_SECRET \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor"
```

### 初回デプロイ

まずプロジェクト番号を取得してからCloud Runへデプロイします。Cloud RunのURLは通常、サービス名・プロジェクト番号・リージョンから構成されます。

```bash
export PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --allow-unauthenticated \
  --service-account="${SERVICE_ACCOUNT}" \
  --min=0 \
  --max=1 \
  --cpu=1 \
  --memory=512Mi \
  --concurrency=80 \
  --set-env-vars="NODE_ENV=production,SESSION_STORE=firestore,SESSION_COLLECTION=googleHealthSessions,GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID},GOOGLE_REDIRECT_URI=https://${SERVICE_NAME}-${PROJECT_NUMBER}.${REGION}.run.app/oauth2callback" \
  --set-secrets="GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,SESSION_SECRET=SESSION_SECRET:latest"
```

Cloud Run URLを確認します。

```bash
gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)'
```

### 更新後の再デプロイ

`server.js`、`public/`、またはその他のアプリファイルを変更した後は、プロジェクトのルートディレクトリで次のコマンドを実行します。Secretを作り直す必要はありません。

```bash
export PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --allow-unauthenticated \
  --service-account="${SERVICE_ACCOUNT}" \
  --min=0 \
  --max=1 \
  --cpu=1 \
  --memory=512Mi \
  --concurrency=80 \
  --set-env-vars="NODE_ENV=production,SESSION_STORE=firestore,SESSION_COLLECTION=googleHealthSessions,GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID},GOOGLE_REDIRECT_URI=https://${SERVICE_NAME}-${PROJECT_NUMBER}.${REGION}.run.app/oauth2callback" \
  --set-secrets="GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,SESSION_SECRET=SESSION_SECRET:latest"
```

デプロイ完了後、次のコマンドで稼働確認ができます。

```bash
export SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)')"

curl -I "${SERVICE_URL}/"
```

HTTPステータスが `200` ならアプリが起動しています。

### OAuthクライアントの設定

Google CloudのOAuthクライアントに、ローカル用とCloud Run用の両方を登録します。

```text
承認済みのJavaScript生成元:
http://localhost:3000
https://<Cloud Runのホスト名>

承認済みのリダイレクトURI:
http://localhost:3000/oauth2callback
https://<Cloud Runのホスト名>/oauth2callback
```

Cloud RunのOAuthをテストするGoogleアカウントは、Google Auth Platformの「対象」設定にテストユーザーとして追加してください。テスト中のアプリでは、登録されていないアカウントは `403 access_denied` になります。

OAuth設定を変更した直後は、Google側の反映に数分から数時間かかる場合があります。

### Secretの更新

Client Secretをローテーションする場合は、Secretに新しいバージョンを追加してからCloud Runを再デプロイします。

```bash
printf '%s' "${NEW_GOOGLE_CLIENT_SECRET}" | \
  gcloud secrets versions add GOOGLE_CLIENT_SECRET --data-file=-

gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --allow-unauthenticated
```

Cloud Runでは、次の2つのSecretを使用します。

- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET`

Cloud Runのサービスアカウントには、Firestoreデータベースへ読み書きできる権限を付与してください。

## 注意

- OAuth の Client Secret はブラウザへ渡さず、ローカルでは `.env`、Cloud RunではSecret Managerで管理してください。
- ローカルの `SESSION_STORE=memory` では再起動するとログイン状態が消えます。Cloud Runでは `SESSION_STORE=firestore` を使用し、FirestoreへOAuthセッションを保存します。公開運用ではHTTPS、CSRF対策、適切なログ・データ保持ポリシーも追加してください。
- Google Health API の利用には Google Cloud 側の OAuth 同意画面、テストユーザー設定、必要に応じたアプリ検証が必要です。
