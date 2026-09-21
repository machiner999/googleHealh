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
const lapChart = document.querySelector("#lap-chart");
const lapChartSummary = document.querySelector("#lap-chart-summary");
const lapList = document.querySelector("#lap-list");
let renderedLapCount = -1;

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
  laps: []
};

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

function renderLapChart() {
  if (!run.laps.length) {
    lapChart.className = "lap-chart lap-chart-empty";
    lapChart.setAttribute("aria-label", "ラップペースのグラフ。ラップはまだありません。");
    lapChartSummary.textContent = "—";
    lapChart.innerHTML = `
      <span class="lap-chart-placeholder" aria-hidden="true"></span>
      <p>1 km走るとペースの推移が表示されます。</p>`;
    return;
  }

  const chartWidth = 640;
  const chartTop = 24;
  const chartBottom = 172;
  const chartLeft = 34;
  const chartRight = chartWidth - 34;
  const lapTimes = run.laps.map((lap) => lap.lapMs);
  const bestLapMs = Math.min(...lapTimes);
  const slowestLapMs = Math.max(...lapTimes);
  const centerLapMs = (bestLapMs + slowestLapMs) / 2;
  const chartRangeMs = Math.max(slowestLapMs - bestLapMs, 30_000);
  const chartMinMs = centerLapMs - chartRangeMs / 2;
  const xStep = run.laps.length === 1 ? 0 : (chartRight - chartLeft) / (run.laps.length - 1);
  const points = run.laps.map((lap, index) => ({
    lap,
    x: run.laps.length === 1 ? chartWidth / 2 : chartLeft + index * xStep,
    y: chartTop + ((lap.lapMs - chartMinMs) / chartRangeMs) * (chartBottom - chartTop)
  }));
  const pointList = points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `M ${points[0].x.toFixed(1)} ${chartBottom} L ${pointList.replaceAll(" ", " L ")} L ${points.at(-1).x.toFixed(1)} ${chartBottom} Z`;
  const labelStep = Math.max(1, Math.ceil(run.laps.length / 8));

  lapChart.className = "lap-chart";
  lapChart.setAttribute("aria-label", `ラップペースのグラフ。${run.laps.map((lap) => `${lap.number} km ${formatDuration(lap.lapMs)}`).join("、")}`);
  lapChartSummary.textContent = `BEST ${formatDuration(bestLapMs)}`;
  lapChart.innerHTML = `
    <div class="lap-chart-plot">
      <svg viewBox="0 0 ${chartWidth} 220" width="${chartWidth}" height="220" aria-hidden="true" focusable="false">
        <g class="lap-chart-grid">
          <line x1="${chartLeft}" y1="${chartTop}" x2="${chartRight}" y2="${chartTop}"></line>
          <line x1="${chartLeft}" y1="${(chartTop + chartBottom) / 2}" x2="${chartRight}" y2="${(chartTop + chartBottom) / 2}"></line>
          <line x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}"></line>
        </g>
        <path class="lap-chart-area" d="${areaPath}"></path>
        <polyline class="lap-chart-line" points="${pointList}"></polyline>
        ${points.map(({ lap, x, y }) => `<circle class="lap-chart-point${lap.lapMs === bestLapMs ? " is-best" : ""}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"></circle>`).join("")}
        ${points.map(({ lap, x }, index) => (index === 0 || index === points.length - 1 || index % labelStep === 0)
    ? `<text class="lap-chart-label" x="${x.toFixed(1)}" y="207">${lap.number}</text>`
    : "").join("")}
      </svg>
    </div>`;
}

function renderLaps() {
  lapCount.textContent = `${run.laps.length} km`;
  if (renderedLapCount === run.laps.length) return;
  renderedLapCount = run.laps.length;
  renderLapChart();
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
  runState.dataset.state = run.status;
  runState.textContent = { idle: "準備完了", acquiring: "GPS準備中", running: "計測中", paused: "一時停止中", finished: "完了" }[run.status];
  setHidden(runStart, run.status !== "idle" && run.status !== "finished");
  runStart.textContent = run.status === "finished" ? "もう一度計測" : "計測開始";
  setHidden(runPause, run.status !== "running");
  setHidden(runResume, run.status !== "paused");
  setHidden(runStop, run.status === "idle" || run.status === "finished");
  runStop.textContent = run.status === "acquiring" && !run.startedAt ? "キャンセル" : "計測を終了";
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
  setRunNotice("計測を終了しました。ページを閉じるまで結果を確認できます。");
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
}

init();
