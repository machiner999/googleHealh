import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptedSegment,
  formatDuration,
  formatPace,
  haversineMeters,
  lapCrossings
} from "../public/run-logic.js";

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
