# Repository Guidelines

## Project Structure & Module Organization

- `server.js` is the Node.js HTTP server and static-file server.
- `public/` contains the browser UI: `index.html`, `app.js`, `styles.css`, and the GPS/run logic in `run-logic.js`. `/?demo=10km` provides a non-persistent 10km result preview for UI checks.
- `skills/running-tracker-deploy/` contains the repository-local deployment skill and its validated Cloud Run helper script.
- `tests/run-logic.test.js` contains unit tests for distance, GPS filtering, lap interpolation, and formatters.
- `Dockerfile` defines the Cloud Run container. `README.md` documents local setup and deployment.

## Build, Test, and Development Commands

Run these commands from the repository root:

```bash
npm install       # Install locked dependencies
npm start         # Start the server at http://localhost:3000
npm run dev       # Start with Node's watch mode
npm test          # Run the Node.js test suite
```

Cloud Run deployments use `gcloud run deploy --source .`; follow the complete, parameterized procedure in `README.md`. Do not deploy secrets or `.env` files with the source.

For a repeatable deployment workflow, use `skills/running-tracker-deploy/SKILL.md` and run its `scripts/deploy.sh` only after an explicit deployment request.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation, semicolons, and single-purpose functions. Prefer `camelCase` for variables/functions and `UPPER_SNAKE_CASE` for environment-variable names. Keep DOM selectors and user-facing text consistent with existing Japanese UI labels. Use browser-only GPS behavior in `public/`; the server only serves the static app. Treat mobile readability as a priority: keep the elapsed time, distance, pace, run state, controls, and lap text large enough to read while running, and verify narrow layouts when changing UI styles.

No formatter or linter is configured; run `npm test` and inspect the diff before submitting changes.

## Testing Guidelines

Tests use Node's built-in `node:test` runner. Add or update focused cases in `tests/` with descriptive names, especially for GPS jumps, pause/resume behavior, lap boundaries, and time interpolation. Run `npm test` for every change; manually verify GPS behavior in a browser when UI or deployment code changes. For UI changes, check the normal page and `http://localhost:3000/?demo=10km` at a narrow mobile width; the demo must not write to LocalStorage.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects that describe the change, such as `Improve GPS jump filtering` or `Document Cloud Run deployment`. Keep commits focused. Pull requests should explain behavior changes, list validation commands, include screenshots for UI changes, and call out Cloud Run configuration changes.

## Security & Configuration Tips

Never commit GPS tracks. GPS tracks remain client-side; only run summaries are stored in LocalStorage.
