#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
project_id="${PROJECT_ID:-aigamerfriend}"
region="${REGION:-asia-northeast1}"
service_name="${SERVICE_NAME:-google-health-dashboard}"
service_url="${SERVICE_URL:-https://google-health-dashboard-967602987239.asia-northeast1.run.app}"

cd "${repo_root}"

command -v gcloud >/dev/null 2>&1 || { echo "gcloud is required" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }

active_account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)')"
if [[ -z "${active_account}" ]]; then
  echo "No active gcloud account. Run: gcloud auth login" >&2
  exit 1
fi

gcloud projects describe "${project_id}" >/dev/null
npm test
node --check server.js
node --check public/app.js

gcloud run deploy "${service_name}" \
  --source . \
  --project="${project_id}" \
  --region="${region}" \
  --allow-unauthenticated \
  --min=0 \
  --max=1 \
  --cpu=1 \
  --memory=256Mi

page="$(curl --fail --silent --show-error "${service_url}/")"
if ! grep -q '<title>Running Tracker</title>' <<< "${page}"; then
  echo "Deployment response did not contain the Running Tracker title" >&2
  exit 1
fi

echo "Verified: ${service_url}"
