export const GPS_READY_ACCURACY_METERS = 20;
export const GPS_READY_REQUIRED_SAMPLES = 3;
export const MAX_GPS_ACCURACY_METERS = 30;
export const MIN_SEGMENT_METERS = 3;
export const MAX_REASONABLE_SPEED_MPS = 12;
export const POSITION_FILTER_WINDOW_SIZE = 3;

export function haversineMeters(first, second) {
  const earthRadiusMeters = 6_371_000;
  const lat1 = first.latitude * Math.PI / 180;
  const lat2 = second.latitude * Math.PI / 180;
  const deltaLat = (second.latitude - first.latitude) * Math.PI / 180;
  const deltaLon = (second.longitude - first.longitude) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isUsablePosition(position) {
  const coords = position?.coords;
  return Boolean(coords)
    && Number.isFinite(coords.latitude)
    && Number.isFinite(coords.longitude)
    && Number.isFinite(coords.accuracy)
    && coords.accuracy <= MAX_GPS_ACCURACY_METERS;
}

export function isReadyPosition(position) {
  return isUsablePosition(position)
    && position.coords.accuracy <= GPS_READY_ACCURACY_METERS;
}

function median(values) {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)];
}

export function medianPosition(points) {
  if (!points.length) return null;
  return {
    latitude: median(points.map((point) => point.latitude)),
    longitude: median(points.map((point) => point.longitude)),
    accuracy: median(points.map((point) => point.accuracy)),
    timestamp: points.at(-1).timestamp
  };
}

export function evaluateSegment(first, second) {
  if (!first || !second) return { distanceM: 0, reason: "missing-position" };
  const elapsedMilliseconds = second.timestamp - first.timestamp;
  if (elapsedMilliseconds <= 0) return { distanceM: 0, reason: "stale-position" };
  const distance = haversineMeters(first, second);
  const elapsedSeconds = elapsedMilliseconds / 1000;
  if (distance < MIN_SEGMENT_METERS) return { distanceM: 0, reason: "movement-too-small" };
  if (distance / elapsedSeconds > MAX_REASONABLE_SPEED_MPS) return { distanceM: 0, reason: "speed-too-high" };
  return { distanceM: distance, reason: "accepted" };
}

export function acceptedSegment(first, second) {
  return evaluateSegment(first, second).distanceM;
}

export function createTrackFilter(seedPoints = []) {
  const recentPoints = seedPoints.slice(-POSITION_FILTER_WINDOW_SIZE);
  return {
    recentPoints,
    anchor: recentPoints.length === POSITION_FILTER_WINDOW_SIZE
      ? medianPosition(recentPoints)
      : null
  };
}

export function processTrackPoint(filter, point) {
  const recentPoints = [...filter.recentPoints, point].slice(-POSITION_FILTER_WINDOW_SIZE);
  if (recentPoints.length < POSITION_FILTER_WINDOW_SIZE) {
    return {
      filter: { recentPoints, anchor: filter.anchor },
      distanceM: 0,
      reason: "warming-up"
    };
  }

  const filteredPoint = medianPosition(recentPoints);
  if (!filter.anchor) {
    return {
      filter: { recentPoints, anchor: filteredPoint },
      distanceM: 0,
      reason: "seeded"
    };
  }

  const segment = evaluateSegment(filter.anchor, filteredPoint);
  return {
    filter: {
      recentPoints,
      anchor: segment.reason === "accepted" ? filteredPoint : filter.anchor
    },
    distanceM: segment.distanceM,
    reason: segment.reason
  };
}

export function lapCrossings({
  previousDistance,
  currentDistance,
  previousElapsedMs,
  currentElapsedMs,
  lastLapElapsedMs,
  lapLengthMeters = 1000
}) {
  if (currentDistance <= previousDistance || currentDistance < lapLengthMeters) return [];
  const segmentDistance = currentDistance - previousDistance;
  const segmentElapsed = currentElapsedMs - previousElapsedMs;
  const crossings = [];
  let lapNumber = Math.floor(previousDistance / lapLengthMeters) + 1;
  let target = lapNumber * lapLengthMeters;

  while (target <= currentDistance) {
    const fraction = Math.max(0, Math.min(1, (target - previousDistance) / segmentDistance));
    const crossingElapsedMs = previousElapsedMs + segmentElapsed * fraction;
    crossings.push({
      number: lapNumber,
      distanceMeters: lapLengthMeters,
      elapsedMs: crossingElapsedMs,
      lapMs: crossingElapsedMs - (crossings.at(-1)?.elapsedMs ?? lastLapElapsedMs),
      paceSecondsPerKm: (crossingElapsedMs - (crossings.at(-1)?.elapsedMs ?? lastLapElapsedMs)) / 1000
    });
    lapNumber += 1;
    target = lapNumber * lapLengthMeters;
  }
  return crossings;
}

export function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatPace(millisecondsPerKm) {
  if (!Number.isFinite(millisecondsPerKm) || millisecondsPerKm <= 0) return "—";
  const totalSeconds = Math.round(millisecondsPerKm / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
