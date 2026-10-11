// Synthetic results only: shared by the result demo and Storybook.
export function createTenKmRun() {
  const lapTimes = [336_000, 341_000, 339_000, 340_000, 337_000, 342_000, 339_000, 338_000, 341_000, 340_000];
  let cumulativeMs = 0;
  return {
    status: 'finished',
    elapsedMs: lapTimes.reduce((total, lapMs) => total + lapMs, 0),
    distanceM: 10_000,
    laps: lapTimes.map((lapMs, index) => {
      cumulativeMs += lapMs;
      return { number: index + 1, distanceMeters: (index + 1) * 1_000, lapMs, cumulativeMs, paceMsPerKm: lapMs };
    })
  };
}
