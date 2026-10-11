import { createRunView } from '../public/run-view.js';
import { createTenKmRun } from '../public/run-fixtures.js';

// Only presentation state is simulated. This module never starts device services.
export function createRunPreview(root, args) {
  let state = {
    status: args.status,
    startedAt: args.hasStarted ? true : null,
    elapsedMs: args.elapsedSeconds * 1000,
    distanceM: args.distanceKm * 1000,
    laps: createTenKmRun().laps.slice(0, Math.min(args.lapCount, Math.floor(args.distanceKm))),
    gpsStatus: args.gpsStatus,
    gpsTone: args.gpsTone,
    notice: args.notice,
    noticeError: args.noticeError
  };
  let readyTimer = null;
  let destroyed = false;
  const view = createRunView(root, { start, pause, resume, stop });

  function render() {
    if (!destroyed) view.render(state);
  }

  function cancelReady() {
    clearTimeout(readyTimer);
    readyTimer = null;
  }

  function acquire() {
    cancelReady();
    state = { ...state, status: 'acquiring', gpsStatus: 'GPS接続中…', gpsTone: 'pending', notice: 'GPSの精度を確認しています。', noticeError: false };
    render();
    readyTimer = setTimeout(() => {
      readyTimer = null;
      state = { ...state, status: 'running', startedAt: true, gpsStatus: 'GPS ±5m', gpsTone: 'good', notice: '計測中です。一時停止すると、再開・終了を選べます。' };
      render();
    }, 1000);
  }

  function start() {
    if (state.status !== 'idle' && state.status !== 'finished') return;
    state = { ...state, startedAt: null, elapsedMs: 0, distanceM: 0, laps: [] };
    acquire();
  }

  function pause() {
    if (state.status !== 'running') return;
    state = { ...state, status: 'paused', gpsStatus: 'GPS 停止中', gpsTone: 'neutral', notice: '一時停止中です。再開するとGPSを再取得します。' };
    render();
  }

  function resume() {
    if (state.status === 'paused') acquire();
  }

  function stop() {
    if (state.status !== 'paused' && state.status !== 'acquiring') return;
    cancelReady();
    const cancelled = !state.startedAt;
    state = { ...state, status: cancelled ? 'idle' : 'finished', gpsStatus: cancelled ? 'GPS 未接続' : 'GPS計測完了', gpsTone: 'neutral', notice: cancelled ? '開始を押すとGPS計測を開始します。' : '計測を終了しました。ページを閉じるまで結果を確認できます。' };
    render();
  }

  function destroy() {
    destroyed = true;
    cancelReady();
    view.destroy();
  }

  render();
  return { destroy };
}
