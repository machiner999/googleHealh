import {
  createTrackFilter,
  formatDuration,
  GPS_READY_REQUIRED_SAMPLES,
  isReadyPosition,
  isUsablePosition,
  lapCrossings,
  processTrackPoint
} from "./run-logic.js";
import { createRunView } from "./run-view.js";
import { createTenKmRun } from "./run-fixtures.js";

const GEOLOCATION_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 };
const RUN_RENDER_INTERVAL_MS = 500;
const PACE_UPDATE_INTERVAL_MS = 5_000;
const VOICE_LANGUAGE = "ja-JP";

const run = {
  status: "idle",
  watchId: null,
  wakeLock: null,
  startedAt: null,
  elapsedMs: 0,
  activeStartedAt: null,
  distanceM: 0,
  readyPositions: [],
  trackFilter: null,
  lastRawTimestamp: 0,
  lastAcceptedElapsedMs: 0,
  lastLapElapsedMs: 0,
  laps: [],
  gpsStatus: "GPS 未接続",
  gpsTone: "neutral",
  notice: "開始を押すとGPS計測を開始します。走行中はGPSの許可が必要です。",
  noticeError: false
};

const view = createRunView(document.querySelector('.shell'), {
  start: startRun,
  pause: pauseRun,
  resume: resumeRun,
  stop: finishRun
});

function getElapsedMs() {
  return run.elapsedMs + (run.activeStartedAt == null ? 0 : performance.now() - run.activeStartedAt);
}

function commitElapsed() {
  run.elapsedMs = getElapsedMs();
  run.activeStartedAt = null;
}

function setRunNotice(message, error = false) {
  run.notice = message;
  run.noticeError = error;
  view.renderNotice(message, error);
}

function setGpsStatus(message, tone = 'neutral') {
  run.gpsStatus = message;
  run.gpsTone = tone;
  view.renderGps(message, tone);
}

function renderPace() {
  view.renderPace({ elapsedMs: getElapsedMs(), distanceM: run.distanceM });
}

function renderRun({ updatePace = run.status !== "running" } = {}) {
  view.render({ ...run, elapsedMs: getElapsedMs() }, { updatePace });
}

function loadDemoRun() {
  if (new URLSearchParams(window.location.search).get("demo") !== "10km") return;
  Object.assign(run, createTenKmRun());
  setGpsStatus("GPS計測完了");
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
  setGpsStatus(`GPS ±${Math.round(lastReadyPosition.accuracy)}m`, "good");
  setRunNotice(isResuming
    ? "GPSを再取得しました。計測を再開します。"
    : "GPSの準備ができました。走行を開始してください。");
  renderRun();
}

function handleAcquiringPosition(position, point) {
  if (!isReadyPosition(position)) {
    run.readyPositions = [];
    setGpsStatus(`GPS ±${Math.round(point.accuracy)}m`, "warning");
    setRunNotice("GPSの精度が安定するまで、空が見える場所でお待ちください。");
    renderRun();
    return;
  }

  run.readyPositions.push(point);
  run.readyPositions = run.readyPositions.slice(-GPS_READY_REQUIRED_SAMPLES);
  const readyCount = run.readyPositions.length;
  setGpsStatus(`GPS ${readyCount}/${GPS_READY_REQUIRED_SAMPLES} · ±${Math.round(point.accuracy)}m`, "pending");
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
    setGpsStatus("GPSの古い測定値を除外");
    return;
  }
  run.lastRawTimestamp = point.timestamp;

  if (run.status === "acquiring") {
    handleAcquiringPosition(position, point);
    return;
  }

  setGpsStatus(`GPS ±${Math.round(point.accuracy)}m`, "good");
  if (!isUsablePosition(position)) {
    setGpsStatus(`GPS精度低下 ±${Math.round(point.accuracy)}m`, "warning");
    return;
  }

  const currentElapsedMs = getElapsedMs();
  const previousDistance = run.distanceM;
  const previousElapsedMs = run.lastAcceptedElapsedMs;
  const result = processTrackPoint(run.trackFilter || createTrackFilter(), point);
  run.trackFilter = result.filter;
  if (!result.distanceM) {
    setGpsStatus(result.reason === "speed-too-high"
      ? "GPSの異常ジャンプを除外"
      : "GPSの揺れを補正中");
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
  setGpsStatus("GPSエラー", "error");
  setRunNotice(messages[error.code] || "GPSを取得できませんでした。", true);
  if (error.code === 1) {
    abortRun();
    setGpsStatus("GPSエラー", "error");
  }
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
  setGpsStatus("GPS接続中…", "pending");
  return true;
}

function resetMeasurement() {
  clearWatch();
  run.status = "idle";
  run.wakeLock = null;
  run.startedAt = null;
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
  setGpsStatus("GPS 未接続");
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
  setGpsStatus("GPS 停止中");
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

function finishRun() {
  if (run.status !== "acquiring" && run.status !== "running" && run.status !== "paused") return;
  if (run.status === "acquiring" && !run.startedAt) {
    abortRun();
    return;
  }
  if (run.status === "running") commitElapsed();
  run.status = "finished";
  clearWatch();
  releaseWakeLock();
  setGpsStatus("GPS計測完了");
  setRunNotice("計測を終了しました。ページを閉じるまで結果を確認できます。");
  renderRun();
}

function abortRun() {
  clearWatch();
  releaseWakeLock();
  resetMeasurement();
  if (!run.noticeError) setRunNotice("開始を押すとGPS計測を開始します。");
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (run.status === "acquiring" || run.status === "running")) requestWakeLock();
  else releaseWakeLock();
});
setInterval(() => { if (run.status === "running") renderRun({ updatePace: false }); }, RUN_RENDER_INTERVAL_MS);
setInterval(() => { if (run.status === "running") renderPace(); }, PACE_UPDATE_INTERVAL_MS);

function init() {
  loadDemoRun();
  renderRun();
}

init();
