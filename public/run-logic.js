export const MAX_GPS_ACCURACY_METERS = 50;
export const MIN_SEGMENT_METERS = 3;
export const MAX_REASONABLE_SPEED_MPS = 12;

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

export function acceptedSegment(first, second) {
  if (!first || !second) return 0;
  const distance = haversineMeters(first, second);
  const elapsedSeconds = Math.max(0.1, (second.timestamp - first.timestamp) / 1000);
  if (distance < MIN_SEGMENT_METERS) return 0;
  if (distance / elapsedSeconds > MAX_REASONABLE_SPEED_MPS) return 0;
  return distance;
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
