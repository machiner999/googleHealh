---
name: running-tracker-deploy
description: Deploy this repository's Running Tracker to its existing Google Cloud Run service after validation; use when the user asks to deploy, publish, or release changes.
---

# Running Tracker Deploy

Use this skill from the repository root for an explicit deployment request. The app is a static Node.js server with client-side GPS tracking; the current Cloud Run service name remains `google-health-dashboard` for URL compatibility.

## Deployment target

Defaults are:

- Project: `aigamerfriend`
- Region: `asia-northeast1`
- Service: `google-health-dashboard`
- URL: `https://google-health-dashboard-967602987239.asia-northeast1.run.app`

Use `PROJECT_ID`, `REGION`, `SERVICE_NAME`, or `SERVICE_URL` overrides only when the user specifies a different target. Do not create a new service merely because the service name contains the old product name.

## Workflow

1. Inspect `git status`, the current branch, and the diff. Preserve unrelated user changes.
2. Run `npm test`, `node --check server.js`, and `node --check public/app.js`. Stop if validation fails.
3. Confirm `gcloud auth list` has an active account and that the target project is accessible. If authentication is missing, ask the user to complete `gcloud auth login`; never guess an account or type credentials.
4. If the user explicitly requested commit and push, stage only the intended files, create a focused imperative commit, and push the current branch to `origin`. Do not amend or force-push unless explicitly requested.
5. Run `scripts/deploy.sh` from the repository root. It preserves existing Cloud Run environment settings and deploys from the current source with `gcloud run deploy --source .`.
6. Verify the returned service URL with an HTTPS request and confirm the response contains the `Running Tracker` title and the running-only UI.

The deploy script performs validation and deployment but does not commit, push, delete resources, rotate secrets, or alter IAM. Those actions require separate explicit user authorization.

## UI verification

For UI changes, also inspect `/?demo=10km` at a narrow mobile width. The demo is display-only and must not write to LocalStorage. GPS tracks must remain client-side; only run summaries and lap summaries may be stored locally.
