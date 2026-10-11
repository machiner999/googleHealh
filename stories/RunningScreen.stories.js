import screenHtml from '../public/index.html?raw';
import { createTenKmRun } from '../public/run-fixtures.js';
import { createRunPreview } from './run-preview.js';

const previews = new WeakMap();

function clearPreview(canvasElement) {
  previews.get(canvasElement)?.destroy();
  previews.delete(canvasElement);
}

function renderScreen(args, { canvasElement }) {
  clearPreview(canvasElement);
  const root = new DOMParser().parseFromString(screenHtml, 'text/html').querySelector('.shell');
  const preview = createRunPreview(root, args);
  previews.set(canvasElement, preview);
  return root;
}

export default {
  id: 'running-screen',
  title: 'ランニング/画面',
  render: renderScreen,
  beforeEach: ({ canvasElement }) => () => clearPreview(canvasElement),
  args: {
    status: 'running',
    hasStarted: true,
    distanceKm: 4.32,
    elapsedSeconds: 1468.8,
    lapCount: 4,
    gpsStatus: 'GPS ±5m',
    gpsTone: 'good',
    notice: '計測中です。一時停止すると、再開・終了を選べます。',
    noticeError: false
  },
  argTypes: {
    status: { name: '計測状態', control: { type: 'select', labels: { idle: '開始前', acquiring: 'GPS準備中', running: '計測中', paused: '一時停止', finished: '完了' } }, options: ['idle', 'acquiring', 'running', 'paused', 'finished'] },
    hasStarted: { name: '計測開始済み', control: 'boolean' },
    distanceKm: { name: '走行距離 (km)', control: { type: 'number', min: 0, max: 999.99, step: 0.01 } },
    elapsedSeconds: { name: '経過時間 (秒)', control: { type: 'number', min: 0, max: 359999, step: 1 } },
    lapCount: { name: 'ラップ数', control: { type: 'number', min: 0, max: 10, step: 1 } },
    gpsStatus: { name: 'GPS表示', control: 'text' },
    gpsTone: { name: 'GPS表示の色', control: { type: 'select', labels: { neutral: '通常', good: '良好', pending: '準備中', warning: '注意', error: 'エラー' } }, options: ['neutral', 'good', 'pending', 'warning', 'error'] },
    notice: { name: '案内文', control: 'text' },
    noticeError: { name: 'エラーの強調', control: 'boolean' }
  }
};

export const Running = { name: '計測中' };
export const Ready = { name: '開始前', args: { status: 'idle', hasStarted: false, distanceKm: 0, elapsedSeconds: 0, lapCount: 0, gpsStatus: 'GPS 未接続', gpsTone: 'neutral', notice: '開始を押すとGPS計測を開始します。走行中はGPSの許可が必要です。' } };
export const Acquiring = { name: 'GPS準備中', args: { status: 'acquiring', hasStarted: false, distanceKm: 0, elapsedSeconds: 0, lapCount: 0, gpsStatus: 'GPS 2/3 · ±8m', gpsTone: 'pending', notice: 'GPSの精度を確認中です（2/3）。' } };
export const Paused = { name: '一時停止', args: { status: 'paused', gpsStatus: 'GPS 停止中', gpsTone: 'neutral', notice: '一時停止中です。再開するとGPSを再取得します。' } };

const demo = createTenKmRun();
export const Finished = { name: '10km完了', args: { status: 'finished', distanceKm: demo.distanceM / 1000, elapsedSeconds: demo.elapsedMs / 1000, lapCount: 10, gpsStatus: 'GPS計測完了', gpsTone: 'neutral', notice: '10km走行後のデモ表示です。' } };
export const PaceUnavailable = { name: 'ペース未取得', args: { distanceKm: 0.01, elapsedSeconds: 3, lapCount: 0, notice: '距離が20mに達すると平均ペースが表示されます。' } };
export const LongRun = { name: '1時間超', args: { distanceKm: 12.75, elapsedSeconds: 4335, lapCount: 10 } };
export const LowGpsAccuracy = { name: 'GPS精度低下', args: { gpsStatus: 'GPS精度低下 ±45m', gpsTone: 'warning', notice: 'GPSの精度が低下しています。空が見える場所で確認してください。' } };
export const GpsError = { name: 'GPSエラー', args: { status: 'idle', hasStarted: false, distanceKm: 0, elapsedSeconds: 0, lapCount: 0, gpsStatus: 'GPSエラー', gpsTone: 'error', notice: '位置情報の利用が拒否されています。ブラウザの設定でGPSを許可してください。', noticeError: true } };
