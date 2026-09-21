# Repository Guidelines

## Project Structure & Module Organization

- `server.js` is the Node.js HTTP server, OAuth flow, Google Health API client, session handling, and static-file server.
- `public/` contains the browser UI: `index.html`, `app.js`, `styles.css`, and the GPS/run logic in `run-logic.js`.
- `tests/run-logic.test.js` contains unit tests for distance, GPS filtering, lap interpolation, and formatters.
- `Dockerfile` defines the Cloud Run container. `README.md` documents local setup and deployment.
- `.env.example` documents local configuration; `.env` is ignored and must never be committed.

## Build, Test, and Development Commands

Run these commands from the repository root:

```bash
npm install       # Install locked dependencies
npm start         # Start the server at http://localhost:3000
npm run dev       # Start with Node's watch mode
npm test          # Run the Node.js test suite
```

Cloud Run deployments use `gcloud run deploy --source .`; follow the complete, parameterized procedure in `README.md`. Do not deploy secrets or `.env` files with the source.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation, semicolons, and single-purpose functions. Prefer `camelCase` for variables/functions and `UPPER_SNAKE_CASE` for environment-variable names. Keep DOM selectors and user-facing text consistent with existing Japanese UI labels. Use browser-only GPS behavior in `public/` and server-only credentials/API calls in `server.js`.

No formatter or linter is configured; run `npm test` and inspect the diff before submitting changes.

## Testing Guidelines

Tests use Node's built-in `node:test` runner. Add or update focused cases in `tests/` with descriptive names, especially for GPS jumps, pause/resume behavior, lap boundaries, and time interpolation. Run `npm test` for every change; manually verify OAuth and GPS behavior in a browser when UI or deployment code changes.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects that describe the change, such as `Handle missing OAuth refresh tokens` or `Document Cloud Run deployment and redeploy`. Keep commits focused. Pull requests should explain behavior changes, list validation commands, include screenshots for UI changes, and call out OAuth, Firestore, or Cloud Run configuration changes.

## Security & Configuration Tips

Never commit `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, OAuth tokens, or GPS tracks. Local secrets belong in `.env`; Cloud Run secrets belong in Secret Manager. Request only the existing read-only Google Health scopes. GPS tracks remain client-side; only run summaries are stored in LocalStorage.
