import {
  createTrackFilter,
  formatDuration,
  formatPace,
  GPS_READY_REQUIRED_SAMPLES,
  isReadyPosition,
  isUsablePosition,
  lapCrossings,
  processTrackPoint
} from "/run-logic.js";

const RUN_STORAGE_KEY = "running_tracker_sessions_v1";
const LEGACY_RUN_STORAGE_KEY = "google_health_running_sessions_v1";
const GEOLOCATION_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 };
const RUN_RENDER_INTERVAL_MS = 500;
const PACE_UPDATE_INTERVAL_MS = 5_000;
const VOICE_LANGUAGE = "ja-JP";

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
  readyPositions: [],
  trackFilter: null,
  lastRawTimestamp: 0,
  lastAcceptedElapsedMs: 0,
  lastLapElapsedMs: 0,
  laps: []
};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
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
      <small>累計 ${formatDuration(lap.cumulativeMs)}</small>
    </div>`).join("");
}

function renderPace() {
  const elapsed = getElapsedMs();
  const distanceKm = run.distanceM / 1000;
  runPace.textContent = distanceKm >= 0.02 ? formatPace(elapsed / distanceKm) : "—";
}

function renderRun({ updatePace = run.status !== "running" } = {}) {
  const elapsed = getElapsedMs();
  const distanceKm = run.distanceM / 1000;
  runTime.textContent = formatDuration(elapsed);
  runDistance.textContent = distanceKm.toFixed(2);
  if (updatePace) renderPace();
  runState.textContent = { idle: "準備完了", acquiring: "GPS準備中", running: "計測中", paused: "一時停止中", finished: "完了" }[run.status];
  setHidden(runStart, run.status !== "idle" && run.status !== "finished");
  runStart.textContent = run.status === "finished" ? "もう一度計測" : "計測開始";
  setHidden(runPause, run.status !== "running");
  setHidden(runResume, run.status !== "paused");
  setHidden(runStop, run.status === "idle" || run.status === "finished");
  runStop.textContent = run.status === "acquiring" && !run.startedAt ? "キャンセル" : "終了して保存";
  renderLaps();
}

function loadDemoRun() {
  if (new URLSearchParams(window.location.search).get("demo") !== "10km") return;
  const lapTimes = [336_000, 341_000, 339_000, 340_000, 337_000, 342_000, 339_000, 338_000, 341_000, 340_000];
  let cumulativeMs = 0;
  run.status = "finished";
  run.elapsedMs = lapTimes.reduce((total, lapMs) => total + lapMs, 0);
  run.distanceM = 10_000;
  run.laps = lapTimes.map((lapMs, index) => {
    cumulativeMs += lapMs;
    return { number: index + 1, distanceMeters: (index + 1) * 1_000, lapMs, cumulativeMs, paceMsPerKm: lapMs };
  });
  gpsStatus.textContent = "GPS計測完了";
  setRunNotice("10km走行後のデモ表示です。", false);
}

function clearWatch() {
  if (run.watchId != null) navigator.geolocation.clearWatch(run.watchId);
  run.watchId = null;
}

async function releaseWakeLock() {
  const wakeLock = run.wakeLock;
  run.wakeLock = null;
  if (!wakeLock) return;
  try { await wakeLock.release(); } catch { /* already released */ }
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

function cancelLapAnnouncements() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function announceLap(crossing) {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance !== "function") return;
  const announcement = new SpeechSynthesisUtterance(
    `${crossing.number}キロ走りました。ラップタイムは${formatDuration(crossing.lapMs)}です。`
  );
  announcement.lang = VOICE_LANGUAGE;
  window.speechSynthesis.speak(announcement);
}

function positionFrom(position) {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    timestamp: position.timestamp || Date.now()
  };
}

function beginTracking() {
  const isResuming = run.startedAt != null;
  const lastReadyPosition = run.readyPositions.at(-1);
  run.status = "running";
  if (!isResuming) run.startedAt = new Date().toISOString();
  run.activeStartedAt = performance.now();
  run.trackFilter = createTrackFilter(run.readyPositions);
  run.readyPositions = [];
  run.lastAcceptedElapsedMs = getElapsedMs();
  gpsStatus.textContent = `GPS準備完了（±${Math.round(lastReadyPosition.accuracy)}m）`;
  setRunNotice(isResuming
    ? "GPSを再取得しました。計測を再開します。"
    : "GPSの準備ができました。走行を開始してください。");
  renderRun();
}

function handleAcquiringPosition(position, point) {
  if (!isReadyPosition(position)) {
    run.readyPositions = [];
    gpsStatus.textContent = `GPS準備中（精度 ±${Math.round(point.accuracy)}m）`;
    setRunNotice("GPSの精度が安定するまで、空が見える場所でお待ちください。");
    renderRun();
    return;
  }

  run.readyPositions.push(point);
  run.readyPositions = run.readyPositions.slice(-GPS_READY_REQUIRED_SAMPLES);
  const readyCount = run.readyPositions.length;
  gpsStatus.textContent = `GPS準備中 ${readyCount}/${GPS_READY_REQUIRED_SAMPLES}（±${Math.round(point.accuracy)}m）`;
  if (readyCount >= GPS_READY_REQUIRED_SAMPLES) {
    beginTracking();
    return;
  }
  setRunNotice(`GPSの精度を確認中です（${readyCount}/${GPS_READY_REQUIRED_SAMPLES}）。`);
  renderRun();
}

function handlePosition(position) {
  if (run.status !== "acquiring" && run.status !== "running") return;
  const point = positionFrom(position);
  if (point.timestamp <= run.lastRawTimestamp) {
    gpsStatus.textContent = "GPSの古い測定値を除外";
    return;
  }
  run.lastRawTimestamp = point.timestamp;

  if (run.status === "acquiring") {
    handleAcquiringPosition(position, point);
    return;
  }

  gpsStatus.textContent = `GPS ±${Math.round(point.accuracy)}m`;
  if (!isUsablePosition(position)) {
    gpsStatus.textContent = `GPS精度が低い（±${Math.round(point.accuracy)}m）`;
    return;
  }

  const currentElapsedMs = getElapsedMs();
  const previousDistance = run.distanceM;
  const previousElapsedMs = run.lastAcceptedElapsedMs;
  const result = processTrackPoint(run.trackFilter || createTrackFilter(), point);
  run.trackFilter = result.filter;
  if (!result.distanceM) {
    gpsStatus.textContent = result.reason === "speed-too-high"
      ? "GPSの異常ジャンプを除外"
      : "GPSの揺れを補正中";
    renderRun();
    return;
  }

  run.lastAcceptedElapsedMs = currentElapsedMs;
  run.distanceM += result.distanceM;
  const crossings = lapCrossings({ previousDistance, currentDistance: run.distanceM, previousElapsedMs, currentElapsedMs, lastLapElapsedMs: run.lastLapElapsedMs });
  for (const crossing of crossings) {
    run.laps.push({ number: crossing.number, distanceMeters: crossing.distanceMeters, lapMs: crossing.lapMs, cumulativeMs: crossing.elapsedMs, paceMsPerKm: crossing.lapMs });
    run.lastLapElapsedMs = crossing.elapsedMs;
    setRunNotice(`${crossing.number}km 到達。ラップを記録しました。`);
    announceLap(crossing);
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
  run.readyPositions = [];
  run.trackFilter = null;
  run.lastRawTimestamp = 0;
  run.lastAcceptedElapsedMs = 0;
  run.lastLapElapsedMs = 0;
  run.laps = [];
  cancelLapAnnouncements();
  gpsStatus.textContent = "GPS 未接続";
  renderRun();
}

function startRun() {
  if (run.status === "acquiring" || run.status === "running" || run.status === "paused") return;
  resetMeasurement();
  run.status = "acquiring";
  if (!startWatch()) { abortRun(); return; }
  setRunNotice("GPSの精度を確認しています。準備完了までお待ちください。");
  requestWakeLock();
  renderRun();
}

function pauseRun() {
  if (run.status !== "running") return;
  commitElapsed();
  run.status = "paused";
  clearWatch();
  run.readyPositions = [];
  run.trackFilter = null;
  run.lastRawTimestamp = 0;
  gpsStatus.textContent = "一時停止中";
  releaseWakeLock();
  setRunNotice("一時停止中です。再開するとGPSを再取得します。");
  renderRun();
}

function resumeRun() {
  if (run.status !== "paused") return;
  run.status = "acquiring";
  run.readyPositions = [];
  run.trackFilter = null;
  run.lastRawTimestamp = 0;
  if (!startWatch()) {
    run.status = "paused";
    renderRun();
    return;
  }
  setRunNotice("GPSの精度を確認してから計測を再開します。");
  requestWakeLock();
  renderRun();
}

function readHistory() {
  try {
    const stored = localStorage.getItem(RUN_STORAGE_KEY) || localStorage.getItem(LEGACY_RUN_STORAGE_KEY) || "[]";
    const history = JSON.parse(stored);
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
  if (run.status !== "acquiring" && run.status !== "running" && run.status !== "paused") return;
  if (run.status === "acquiring" && !run.startedAt) {
    abortRun();
    return;
  }
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

runStart.addEventListener("click", startRun);
runPause.addEventListener("click", pauseRun);
runResume.addEventListener("click", resumeRun);
runStop.addEventListener("click", finishRun);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (run.status === "acquiring" || run.status === "running")) requestWakeLock();
  else releaseWakeLock();
});
setInterval(() => { if (run.status === "running") renderRun({ updatePace: false }); }, RUN_RENDER_INTERVAL_MS);
setInterval(() => { if (run.status === "running") renderPace(); }, PACE_UPDATE_INTERVAL_MS);

function init() {
  loadDemoRun();
  renderRun();
  renderHistory();
}

init();
