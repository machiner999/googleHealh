import {
  acceptedSegment,
  formatDuration,
  formatPace,
  isUsablePosition,
  lapCrossings
} from "/run-logic.js";

const labels = {
  steps: { label: "歩数", unit: "歩", decimals: 0 },
  distance: { label: "距離", unit: "km", decimals: 1 },
  "total-calories": { label: "消費カロリー", unit: "kcal", decimals: 0 },
  "active-minutes": { label: "アクティブ時間", unit: "分", decimals: 0 },
  weight: { label: "体重", unit: "kg", decimals: 1 }
};

const RUN_STORAGE_KEY = "google_health_running_sessions_v1";
const GEOLOCATION_OPTIONS = { enableHighAccuracy: true, maximumAge: 1_000, timeout: 10_000 };

const dateInput = document.querySelector("#date");
const summary = document.querySelector("#summary");
const chart = document.querySelector("#chart");
const notice = document.querySelector("#notice");
const connect = document.querySelector("#connect");
const logout = document.querySelector("#logout");
const runNotice = document.querySelector("#run-notice");
const runState = document.querySelector("#run-state");
const gpsStatus = document.querySelector("#gps-status");
const runTime = document.querySelector("#run-time");
const runDistance = document.querySelector("#run-distance");
const runPace = document.querySelector("#run-pace");
const runStart = document.querySelector("#run-start");
const runPause = document.querySelector("#run-pause");
const runResume = document.querySelector("#run-resume");
const runStop = document.querySelector("#run-stop");
const lapCount = document.querySelector("#lap-count");
const lapList = document.querySelector("#lap-list");
const runHistory = document.querySelector("#run-history");

const run = {
  status: "idle",
  watchId: null,
  wakeLock: null,
  startedAt: null,
  finishedAt: null,
  elapsedMs: 0,
  activeStartedAt: null,
  distanceM: 0,
  lastPosition: null,
  lastAcceptedElapsedMs: 0,
  lastLapElapsedMs: 0,
  laps: []
};

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

dateInput.value = localDateKey();

function format(value, decimals = 0) {
  return value == null ? "—" : Number(value).toLocaleString("ja-JP", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function displayDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function renderHealth(data) {
  const selected = data.days[data.days.length - 1] || {};
  summary.innerHTML = Object.entries(labels).map(([key, meta]) => `
    <article class="card">
      <div class="card-label">${meta.label}</div>
      <div><span class="card-value">${format(selected[key], meta.decimals)}</span><span class="card-unit">${meta.unit}</span></div>
      <div class="card-date">${displayDate(selected.date)} の集計</div>
    </article>`).join("");

  const values = data.days.map((day) => Number(day.steps || 0));
  const max = Math.max(...values, 1);
  chart.classList.remove("empty");
  chart.innerHTML = data.days.map((day) => `
    <div class="bar-column" title="${displayDate(day.date)}: ${format(day.steps)} 歩">
      <div class="bar-value">${day.steps == null ? "—" : format(day.steps)}</div>
      <div class="bar-track"><div class="bar" style="height:${Math.max(3, (Number(day.steps || 0) / max) * 100)}%"></div></div>
      <div class="bar-date">${displayDate(day.date)}</div>
    </div>`).join("");
}

async function loadHealth() {
  notice.classList.remove("error");
  notice.textContent = "データを読み込んでいます…";
  try {
    const response = await fetch(`/api/health?date=${encodeURIComponent(dateInput.value)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "データを取得できませんでした。");
    renderHealth(body);
    const failed = Object.keys(body.errors || {});
    notice.textContent = failed.length ? `一部のデータ型を取得できませんでした（${failed.join(", ")}）。` : "Google Health API から最新データを表示しています。";
    if (failed.length) notice.classList.add("error");
  } catch (error) {
    notice.textContent = error.message;
    notice.classList.add("error");
    summary.innerHTML = "";
    chart.className = "chart empty";
    chart.textContent = "データを表示できません。";
  }
}

function getElapsedMs() {
  return run.elapsedMs + (run.activeStartedAt == null ? 0 : performance.now() - run.activeStartedAt);
}

function commitElapsed() {
  run.elapsedMs = getElapsedMs();
  run.activeStartedAt = null;
}

function setHidden(element, hidden) {
  element.classList.toggle("hidden", hidden);
}

function setRunNotice(message, error = false) {
  runNotice.textContent = message;
  runNotice.classList.toggle("error", error);
}

function renderLaps() {
  lapCount.textContent = `${run.laps.length} km`;
  if (!run.laps.length) {
    lapList.className = "lap-list empty-list";
    lapList.textContent = "1km走るとラップが表示されます。";
    return;
  }
  lapList.className = "lap-list";
  lapList.innerHTML = [...run.laps].reverse().map((lap) => `
    <div class="lap-row">
      <strong>${lap.number} km</strong>
      <span>${formatDuration(lap.lapMs)}</span>
      <span>${formatPace(lap.paceMsPerKm)} /km</span>
      <small>累計 ${formatDuration(lap.cumulativeMs)}</small>
    </div>`).join("");
}

function renderRun() {
  const elapsed = getElapsedMs();
  const distanceKm = run.distanceM / 1000;
  runTime.textContent = formatDuration(elapsed);
  runDistance.textContent = distanceKm.toFixed(2);
  runPace.textContent = distanceKm >= 0.02 ? formatPace(elapsed / distanceKm) : "—";
  runState.textContent = { idle: "準備完了", running: "計測中", paused: "一時停止中", finished: "完了" }[run.status];
  setHidden(runStart, run.status === "running" || run.status === "paused");
  runStart.textContent = run.status === "finished" ? "もう一度計測" : "計測開始";
  setHidden(runPause, run.status !== "running");
  setHidden(runResume, run.status !== "paused");
  setHidden(runStop, run.status === "idle" || run.status === "finished");
  renderLaps();
}

function clearWatch() {
  if (run.watchId != null) navigator.geolocation.clearWatch(run.watchId);
  run.watchId = null;
}

async function releaseWakeLock() {
  if (!run.wakeLock) return;
  try { await run.wakeLock.release(); } catch { /* already released */ }
  run.wakeLock = null;
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || run.wakeLock || document.visibilityState !== "visible") return;
  try {
    run.wakeLock = await navigator.wakeLock.request("screen");
    run.wakeLock.addEventListener("release", () => { run.wakeLock = null; }, { once: true });
  } catch {
    // Screen Wake Lock is optional and unsupported on some mobile browsers.
  }
}

function positionFrom(position) {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    timestamp: position.timestamp || Date.now()
  };
}

function handlePosition(position) {
  if (run.status !== "running") return;
  const point = positionFrom(position);
  gpsStatus.textContent = `GPS ±${Math.round(point.accuracy)}m`;
  if (!isUsablePosition(position)) {
    gpsStatus.textContent = `GPS精度が低い（±${Math.round(point.accuracy)}m）`;
    run.lastPosition = null;
    return;
  }

  const currentElapsedMs = getElapsedMs();
  if (!run.lastPosition) {
    run.lastPosition = point;
    run.lastAcceptedElapsedMs = currentElapsedMs;
    setRunNotice("GPSを取得中です。走行を開始してください。");
    renderRun();
    return;
  }

  const previousDistance = run.distanceM;
  const previousElapsedMs = run.lastAcceptedElapsedMs;
  const segment = acceptedSegment(run.lastPosition, point);
  run.lastPosition = point;
  run.lastAcceptedElapsedMs = currentElapsedMs;
  if (!segment) {
    gpsStatus.textContent = "GPSの揺れ・ジャンプを除外";
    renderRun();
    return;
  }

  run.distanceM += segment;
  const crossings = lapCrossings({ previousDistance, currentDistance: run.distanceM, previousElapsedMs, currentElapsedMs, lastLapElapsedMs: run.lastLapElapsedMs });
  for (const crossing of crossings) {
    run.laps.push({ number: crossing.number, distanceMeters: crossing.distanceMeters, lapMs: crossing.lapMs, cumulativeMs: crossing.elapsedMs, paceMsPerKm: crossing.lapMs });
    run.lastLapElapsedMs = crossing.elapsedMs;
    setRunNotice(`${crossing.number}km 到達。ラップを記録しました。`);
  }
  renderRun();
}

function handleGeolocationError(error) {
  const messages = { 1: "位置情報の利用が拒否されています。ブラウザの設定でGPSを許可してください。", 2: "現在地を取得できません。屋外で少し待ってから再試行してください。", 3: "GPSの取得がタイムアウトしました。空が見える場所で再試行してください。" };
  gpsStatus.textContent = "GPSエラー";
  setRunNotice(messages[error.code] || "GPSを取得できませんでした。", true);
  if (error.code === 1) abortRun();
}

function startWatch() {
  if (!navigator.geolocation) {
    setRunNotice("このブラウザは位置情報に対応していません。", true);
    return false;
  }
  try {
    run.watchId = navigator.geolocation.watchPosition(handlePosition, handleGeolocationError, GEOLOCATION_OPTIONS);
  } catch (error) {
    setRunNotice("GPSを開始できません。HTTPSまたは端末のlocalhostで開いているか確認してください。", true);
    return false;
  }
  gpsStatus.textContent = "GPS接続中…";
  return true;
}

function resetMeasurement() {
  clearWatch();
  run.status = "idle";
  run.wakeLock = null;
  run.startedAt = null;
  run.finishedAt = null;
  run.elapsedMs = 0;
  run.activeStartedAt = null;
  run.distanceM = 0;
  run.lastPosition = null;
  run.lastAcceptedElapsedMs = 0;
  run.lastLapElapsedMs = 0;
  run.laps = [];
  gpsStatus.textContent = "GPS 未接続";
  renderRun();
}

function startRun() {
  if (run.status === "running" || run.status === "paused") return;
  resetMeasurement();
  run.status = "running";
  run.startedAt = new Date().toISOString();
  run.activeStartedAt = performance.now();
  if (!startWatch()) { abortRun(); return; }
  setRunNotice("GPSの取得を開始しました。走行を開始してください。");
  requestWakeLock();
  renderRun();
}

function pauseRun() {
  if (run.status !== "running") return;
  commitElapsed();
  run.status = "paused";
  clearWatch();
  run.lastPosition = null;
  gpsStatus.textContent = "一時停止中";
  releaseWakeLock();
  setRunNotice("一時停止中です。再開するとGPSを再取得します。");
  renderRun();
}

function resumeRun() {
  if (run.status !== "paused") return;
  run.status = "running";
  run.activeStartedAt = performance.now();
  run.lastPosition = null;
  if (!startWatch()) { pauseRun(); return; }
  setRunNotice("GPSを再取得中です。");
  requestWakeLock();
  renderRun();
}

function readHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(RUN_STORAGE_KEY) || "[]");
    return Array.isArray(history) ? history : [];
  } catch { return []; }
}

function writeHistory(history) {
  try { localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(history.slice(0, 50))); } catch { /* storage may be unavailable */ }
}

function renderHistory() {
  const history = readHistory();
  if (!history.length) {
    runHistory.className = "run-history empty-list";
    runHistory.textContent = "保存された走行履歴はありません。";
    return;
  }
  runHistory.className = "run-history";
  runHistory.innerHTML = history.map((item) => `
    <div class="history-row">
      <div><strong>${escapeHtml(new Date(item.startedAt).toLocaleDateString("ja-JP"))}</strong><small>${item.laps.length} kmラップ</small></div>
      <div><strong>${(Number(item.distanceM) / 1000).toFixed(2)} km</strong><small>${formatDuration(Number(item.elapsedMs))}</small></div>
    </div>`).join("");
}

function saveRun() {
  const item = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, startedAt: run.startedAt, finishedAt: run.finishedAt, distanceM: run.distanceM, elapsedMs: run.elapsedMs, laps: run.laps.map((lap) => ({ ...lap })) };
  writeHistory([item, ...readHistory()]);
  renderHistory();
}

function finishRun() {
  if (run.status !== "running" && run.status !== "paused") return;
  if (run.status === "running") commitElapsed();
  run.finishedAt = new Date().toISOString();
  run.status = "finished";
  clearWatch();
  releaseWakeLock();
  saveRun();
  setRunNotice("走行結果をこのブラウザに保存しました。");
  renderRun();
}

function abortRun() {
  clearWatch();
  releaseWakeLock();
  resetMeasurement();
}

document.querySelectorAll(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".mode-tab").forEach((item) => item.classList.toggle("active", item === tab));
    document.querySelectorAll("#overview-view, #run-view").forEach((view) => view.classList.toggle("hidden", view.id !== tab.dataset.view));
    if (tab.dataset.view === "run-view") renderHistory();
  });
});

runStart.addEventListener("click", startRun);
runPause.addEventListener("click", pauseRun);
runResume.addEventListener("click", resumeRun);
runStop.addEventListener("click", finishRun);
dateInput.addEventListener("change", () => { if (!connect.classList.contains("hidden")) return; loadHealth(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && run.status === "running") requestWakeLock(); });
setInterval(() => { if (run.status === "running") renderRun(); }, 500);

async function init() {
  renderRun();
  renderHistory();
  const status = await fetch("/api/status").then((response) => response.json());
  if (status.connected) {
    connect.classList.add("hidden");
    logout.classList.remove("hidden");
    await loadHealth();
  }
}

init();
