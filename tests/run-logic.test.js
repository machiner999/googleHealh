import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptedSegment,
  createTrackFilter,
  formatDuration,
  formatPace,
  haversineMeters,
  isReadyPosition,
  isUsablePosition,
  lapCrossings,
  processTrackPoint
} from "../public/run-logic.js";

function pointAtMeters(distanceM, timestamp, accuracy = 5) {
  return {
    latitude: distanceM / 111_320,
    longitude: 139,
    accuracy,
    timestamp
  };
}

function browserPosition({ accuracy = 5, latitude = 35, longitude = 139 } = {}) {
  return { coords: { accuracy, latitude, longitude } };
}

test("haversine distance is approximately correct", () => {
  const distance = haversineMeters({ latitude: 35.6812, longitude: 139.7671 }, { latitude: 35.6905, longitude: 139.7005 });
  assert.ok(distance > 6_000 && distance < 7_000);
});

test("small GPS jitter and implausible jumps are ignored", () => {
  const first = { latitude: 35, longitude: 139, timestamp: 0 };
  const tiny = { latitude: 35.000001, longitude: 139.000001, timestamp: 1000 };
  const jump = { latitude: 35.01, longitude: 139.01, timestamp: 1000 };
  assert.equal(acceptedSegment(first, tiny), 0);
  assert.equal(acceptedSegment(first, jump), 0);
});

test("GPS readiness requires tighter accuracy than active tracking", () => {
  assert.equal(isReadyPosition(browserPosition({ accuracy: 15 })), true);
  assert.equal(isReadyPosition(browserPosition({ accuracy: 25 })), false);
  assert.equal(isUsablePosition(browserPosition({ accuracy: 25 })), true);
  assert.equal(isUsablePosition(browserPosition({ accuracy: 35 })), false);
});

test("sub-three-meter updates accumulate instead of being discarded", () => {
  let filter = createTrackFilter([
    pointAtMeters(-2.5, 0),
    pointAtMeters(0, 1_000),
    pointAtMeters(2.5, 2_000)
  ]);
  let distanceM = 0;

  for (const [distance, timestamp] of [[5, 3_000], [7.5, 4_000], [10, 5_000], [12.5, 6_000]]) {
    const result = processTrackPoint(filter, pointAtMeters(distance, timestamp));
    filter = result.filter;
    distanceM += result.distanceM;
  }

  assert.ok(distanceM > 9.5 && distanceM < 10.5);
});

test("median filtering prevents stationary jitter from adding distance", () => {
  let filter = createTrackFilter([
    pointAtMeters(-1, 0),
    pointAtMeters(0, 1_000),
    pointAtMeters(1, 2_000)
  ]);
  let distanceM = 0;

  for (const [index, distance] of [-1.5, 1.5, -1, 1, 0].entries()) {
    const result = processTrackPoint(filter, pointAtMeters(distance, (index + 3) * 1_000));
    filter = result.filter;
    distanceM += result.distanceM;
  }

  assert.equal(distanceM, 0);
});

test("an implausible jump does not replace the last accepted anchor", () => {
  let filter = createTrackFilter([
    pointAtMeters(0, 0),
    pointAtMeters(1, 1_000),
    pointAtMeters(2, 2_000)
  ]);
  let distanceM = 0;

  for (const [distance, timestamp] of [[3, 3_000], [1_000, 4_000], [4, 5_000], [5, 6_000], [6, 7_000]]) {
    const result = processTrackPoint(filter, pointAtMeters(distance, timestamp));
    filter = result.filter;
    distanceM += result.distanceM;
  }

  assert.ok(distanceM > 2.5 && distanceM < 10);
  assert.ok(filter.anchor.latitude < pointAtMeters(10, 0).latitude);
});

test("lap crossing time is interpolated inside a GPS segment", () => {
  const crossings = lapCrossings({
    previousDistance: 950,
    currentDistance: 1050,
    previousElapsedMs: 100_000,
    currentElapsedMs: 110_000,
    lastLapElapsedMs: 0
  });
  assert.equal(crossings.length, 1);
  assert.equal(crossings[0].elapsedMs, 105_000);
  assert.equal(crossings[0].lapMs, 105_000);
});

test("formatters render elapsed time and pace", () => {
  assert.equal(formatDuration(3723_000), "1:02:03");
  assert.equal(formatPace(5 * 60 * 1000 + 32_000), "5:32");
});
