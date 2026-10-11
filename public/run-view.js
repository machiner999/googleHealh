import { formatDuration, formatPace } from './run-logic.js';

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function setHidden(element, hidden) {
  element.hidden = hidden;
  element.classList.toggle('hidden', hidden);
}

// All selectors stay within the supplied screen; no device APIs are used here.
export function createRunView(root, actions = {}) {
  const select = (id) => root.querySelector(`#${id}`);
  const runNotice = select('run-notice');
  const runState = select('run-state');
  const gpsStatus = select('gps-status');
  const runTime = select('run-time');
  const runDistance = select('run-distance');
  const runPace = select('run-pace');
  const runStart = select('run-start');
  const runPause = select('run-pause');
  const runResume = select('run-resume');
  const runStop = select('run-stop');
  const lapCount = select('lap-count');
  const lapChart = select('lap-chart');
  const lapChartSummary = select('lap-chart-summary');
  const lapList = select('lap-list');
  let renderedLaps = null;
  const listeners = [];

  for (const [button, action] of [[runStart, actions.start], [runPause, actions.pause], [runResume, actions.resume], [runStop, actions.stop]]) {
    if (!action) continue;
    button.addEventListener('click', action);
    listeners.push(() => button.removeEventListener('click', action));
  }

  function renderLapChart(laps) {
    if (!laps.length) {
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
    const chartBottom = 288;
    const chartLeft = 62;
    const chartRight = chartWidth - 8;
    const lapTimes = laps.map((lap) => lap.lapMs);
    const bestLapMs = Math.min(...lapTimes);
    const slowestLapMs = Math.max(...lapTimes);
    const centerLapMs = (bestLapMs + slowestLapMs) / 2;
    const chartRangeMs = Math.max(slowestLapMs - bestLapMs, 30_000);
    const chartMinMs = centerLapMs - chartRangeMs / 2;
    const chartMidMs = chartMinMs + chartRangeMs / 2;
    const chartMaxMs = chartMinMs + chartRangeMs;
    const xStep = laps.length === 1 ? 0 : (chartRight - chartLeft) / (laps.length - 1);
    const points = laps.map((lap, index) => ({
      lap,
      x: laps.length === 1 ? chartWidth / 2 : chartLeft + index * xStep,
      y: chartTop + ((chartMaxMs - lap.lapMs) / chartRangeMs) * (chartBottom - chartTop)
    }));
    const pointList = points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const areaPath = `M ${points[0].x.toFixed(1)} ${chartBottom} L ${pointList.replaceAll(" ", " L ")} L ${points.at(-1).x.toFixed(1)} ${chartBottom} Z`;
    const labelStep = Math.max(1, Math.ceil(laps.length / 8));

    lapChart.className = "lap-chart";
    lapChart.setAttribute("aria-label", `ラップペースのグラフ。${laps.map((lap) => `${lap.number} km ${formatDuration(lap.lapMs)}`).join("、")}`);
    lapChartSummary.textContent = `最速 ${formatDuration(bestLapMs)}`;
    lapChart.innerHTML = `
      <div class="lap-chart-plot">
        <svg viewBox="0 0 ${chartWidth} 366" width="${chartWidth}" height="366" aria-hidden="true" focusable="false">
          <g class="lap-chart-grid">
            <line class="lap-chart-axis" x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${chartBottom}"></line>
            <line x1="${chartLeft}" y1="${chartTop}" x2="${chartRight}" y2="${chartTop}"></line>
            <line x1="${chartLeft}" y1="${(chartTop + chartBottom) / 2}" x2="${chartRight}" y2="${(chartTop + chartBottom) / 2}"></line>
            <line x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}"></line>
          </g>
          <text class="lap-chart-axis-unit lap-chart-y-axis-unit" x="4" y="13">ペース (分/km)</text>
          <text class="lap-chart-axis-label" x="${chartLeft - 8}" y="${chartTop + 5}">${formatDuration(chartMaxMs)}</text>
          <text class="lap-chart-axis-label" x="${chartLeft - 8}" y="${(chartTop + chartBottom) / 2 + 5}">${formatDuration(chartMidMs)}</text>
          <text class="lap-chart-axis-label" x="${chartLeft - 8}" y="${chartBottom + 5}">${formatDuration(chartMinMs)}</text>
          <path class="lap-chart-area" d="${areaPath}"></path>
          <polyline class="lap-chart-line" points="${pointList}"></polyline>
          ${points.map(({ lap, x, y }) => `<circle class="lap-chart-point${lap.lapMs === bestLapMs ? " is-best" : ""}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"></circle>`).join("")}
          ${points.map(({ lap, x }, index) => (index === 0 || index === points.length - 1 || index % labelStep === 0)
      ? `<text class="lap-chart-label" x="${x.toFixed(1)}" y="${chartBottom + 35}">${lap.number}</text>`
      : "").join("")}
          <text class="lap-chart-axis-unit lap-chart-x-axis-unit" x="${chartWidth / 2}" y="${chartBottom + 63}">距離 (km)</text>
        </svg>
      </div>`;
  }

  function renderLaps(laps) {
    lapCount.textContent = `${laps.length} km`;
    const signature = laps.map((lap) => `${lap.number}:${lap.lapMs}:${lap.cumulativeMs}`).join("|");
    if (renderedLaps === signature) return;
    renderedLaps = signature;
    renderLapChart(laps);
    if (!laps.length) {
      lapList.className = "lap-list empty-list";
      lapList.textContent = "1km走るとラップが表示されます。";
      return;
    }
    lapList.className = "lap-list";
    lapList.innerHTML = [...laps].reverse().map((lap) => `
      <div class="lap-row">
        <strong>${lap.number} km</strong>
        <span>${formatDuration(lap.lapMs)}</span>
        <small>累計 ${formatDuration(lap.cumulativeMs)}</small>
      </div>`).join("");
  }


  function renderPace({ elapsedMs, distanceM }) {
    const distanceKm = distanceM / 1000;
    const pace = distanceKm >= 0.02 ? formatPace(elapsedMs / distanceKm) : '—';
    setText(runPace, pace);
    runPace.parentElement.classList.toggle('is-long', pace.length > 5);
  }

  function renderNotice(message, error = false) {
    runNotice.setAttribute('role', error ? 'alert' : 'status');
    runNotice.classList.toggle('error', error);
    setText(runNotice, message);
    setHidden(runNotice, !message);
  }

  function renderGps(message, tone = 'neutral') {
    setText(gpsStatus, message);
    gpsStatus.dataset.tone = tone;
  }

  function render(run, { updatePace = true } = {}) {
    const time = formatDuration(run.elapsedMs);
    const distance = (run.distanceM / 1000).toFixed(2);
    setText(runTime, time);
    setText(runDistance, distance);
    runTime.parentElement.classList.toggle('is-long', time.length > 6);
    runDistance.closest('.run-metric').classList.toggle('is-long', distance.length > 5);
    if (updatePace) renderPace(run);
    root.dataset.state = run.status;
    runState.dataset.state = run.status;
    setText(runState, { idle: '準備完了', acquiring: 'GPS準備中', running: '計測中', paused: '一時停止中', finished: '計測完了' }[run.status]);
    setHidden(runStart, run.status !== 'idle' && run.status !== 'finished');
    setText(runStart.querySelector('.button-label'), run.status === 'finished' ? 'もう一度計測' : '計測開始');
    setHidden(runPause, run.status !== 'running');
    setHidden(runResume, run.status !== 'paused');
    setHidden(runStop, run.status !== 'paused' && run.status !== 'acquiring');
    setText(runStop, run.status === 'acquiring' && !run.startedAt ? 'キャンセル' : '計測を終了');
    renderGps(run.gpsStatus, run.gpsTone);
    renderNotice(run.notice, run.noticeError);
    renderLaps(run.laps);
  }

  function destroy() {
    listeners.forEach((remove) => remove());
    listeners.length = 0;
  }

  return { render, renderPace, renderNotice, renderGps, destroy };
}
