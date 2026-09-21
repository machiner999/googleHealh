import http from "node:http";
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

try {
  const envFile = fsSync.readFileSync(path.join(__dirname, ".env"), "utf8");
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
} catch {
  // .env is optional; OAuth reports a helpful error when it is not configured.
}

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/oauth2callback`;
const sessionStoreMode = process.env.SESSION_STORE || "memory";
const sessionCollection = process.env.SESSION_COLLECTION || "googleHealthSessions";
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const scopes = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly"
];

const memorySessions = new Map();
let firestore;
if (sessionStoreMode === "firestore") {
  try {
    const firestoreModule = await import("@google-cloud/firestore");
    firestore = new firestoreModule.Firestore({ projectId: process.env.FIRESTORE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT });
  } catch (error) {
    throw new Error(`Firestore セッションストアを初期化できません: ${error.message}`);
  }
}

const sessions = {
  async get(id) {
    if (sessionStoreMode !== "firestore") return memorySessions.get(id);
    const snapshot = await firestore.collection(sessionCollection).doc(id).get();
    return snapshot.exists ? snapshot.data() : undefined;
  },
  async set(id, value) {
    const record = { ...value, updatedAt: Date.now() };
    if (sessionStoreMode !== "firestore") {
      memorySessions.set(id, record);
      return;
    }
    await firestore.collection(sessionCollection).doc(id).set(record);
  },
  async delete(id) {
    if (sessionStoreMode !== "firestore") {
      memorySessions.delete(id);
      return;
    }
    await firestore.collection(sessionCollection).doc(id).delete();
  }
};

const dataTypes = [
  { id: "steps", key: "steps", label: "歩数", unit: "歩", value: (v) => v?.countSum },
  { id: "distance", key: "distance", label: "距離", unit: "km", value: (v) => v?.metersSum == null ? null : Number(v.metersSum) / 1000 },
  { id: "total-calories", key: "totalCalories", label: "消費カロリー", unit: "kcal", value: (v) => v?.kcalSum },
  {
    id: "active-minutes",
    key: "activeMinutes",
    label: "アクティブ時間",
    unit: "分",
    value: (v) => (v?.activeMinutesRollupByActivityLevel || [])
      .reduce((sum, row) => sum + Number(row.activeMinutesSum || 0), 0)
  },
  { id: "weight", key: "weight", label: "体重", unit: "kg", value: (v) => v?.weightGramsAvg == null ? null : Number(v.weightGramsAvg) / 1000 }
];

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    try {
      return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    } catch {
      return [part.slice(0, index).trim(), ""];
    }
  }));
}

function signature(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function signedValue(value) {
  return `${value}.${signature(value)}`;
}

function verifySignedValue(value) {
  if (!value) return undefined;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return undefined;
  const raw = value.slice(0, separator);
  const provided = value.slice(separator + 1);
  const expected = signature(raw);
  if (provided.length !== expected.length) return undefined;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected)) ? raw : undefined;
}

function cookieOptions(maxAge) {
  const secure = redirectUri.startsWith("https://") || process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `HttpOnly; SameSite=Lax; Path=/${secure}${maxAge === undefined ? "" : `; Max-Age=${maxAge}`}`;
}

function setCookie(res, name, value, maxAge) {
  const header = `${name}=${encodeURIComponent(value)}; ${cookieOptions(maxAge)}`;
  const current = res.getHeader("set-cookie");
  res.setHeader("set-cookie", current ? [...current, header] : [header]);
}

function clearCookie(res, name) {
  setCookie(res, name, "", 0);
}

async function sessionFor(req) {
  const rawSessionId = verifySignedValue(cookies(req).ghealth_session);
  if (!rawSessionId) return undefined;
  const session = await sessions.get(rawSessionId);
  return session ? { ...session, id: rawSessionId } : undefined;
}

function dateParts(date) {
  return { date: { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() } };
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function googleTokenRequest(params) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error_description || body.error || "Google token request failed");
  return body;
}

async function accessTokenFor(session) {
  if (session.expiresAt > Date.now() + 60_000) return session.accessToken;
  if (!session.refreshToken) throw new Error("アクセストークンの有効期限が切れました。もう一度 Google で接続してください。");
  if (!session.refreshing) {
    session.refreshing = googleTokenRequest({
      refresh_token: session.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token"
    }).then(async (token) => {
      session.accessToken = token.access_token;
      session.expiresAt = Date.now() + (token.expires_in || 3600) * 1000;
      const updatedSession = { ...session };
      delete updatedSession.refreshing;
      await sessions.set(session.id, updatedSession);
      return session.accessToken;
    }).finally(() => { delete session.refreshing; });
  }
  await session.refreshing;
  return session.accessToken;
}

async function healthRequest(session, dataType, start, end) {
  const accessToken = await accessTokenFor(session);
  const response = await fetch(`https://health.googleapis.com/v4/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      range: { start: dateParts(start), end: dateParts(end) },
      windowSizeDays: 1,
      dataSourceFamily: "users/me/dataSourceFamilies/google-sources"
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || `Google Health API returned ${response.status}`);
  return body;
}

async function loadDashboard(session, dateString) {
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(dateString || "") ? new Date(`${dateString}T00:00:00`) : new Date();
  selected.setHours(0, 0, 0, 0);
  const start = addDays(selected, -6);
  const end = addDays(selected, 1);

  const results = await Promise.all(dataTypes.map(async (type) => {
    try {
      return [type.id, await healthRequest(session, type.id, start, end)];
    } catch (error) {
      return [type.id, { error: error.message }];
    }
  }));

  const byType = Object.fromEntries(results);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const key = dateKey(date);
    const row = { date: key };
    for (const type of dataTypes) {
      const point = (byType[type.id]?.rollupDataPoints || []).find((item) => {
        const d = item.civilStartTime?.date;
        return d && `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` === key;
      });
      row[type.id] = point ? type.value(point[type.key]) : null;
    }
    return row;
  });

  return {
    selectedDate: dateString || dateKey(selected),
    days,
    errors: Object.fromEntries(Object.entries(byType).filter(([, result]) => result.error).map(([key, result]) => [key, result.error]))
  };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/auth/google") {
    if (!clientId || !clientSecret) return send(res, 500, { error: "環境変数 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を設定してください。" });
    const state = crypto.randomBytes(24).toString("hex");
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: scopes.join(" "),
      state
    });
    setCookie(res, "ghealth_oauth_state", signedValue(state), 600);
    return redirect(res, authUrl.toString());
  }

  if (url.pathname === "/oauth2callback") {
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const storedState = verifySignedValue(cookies(req).ghealth_oauth_state);
    if (!state || !storedState || state !== storedState) return send(res, 400, { error: "OAuth state が無効です。最初からやり直してください。" });
    if (!code) return send(res, 400, { error: url.searchParams.get("error_description") || "Google 認証がキャンセルされました。" });
    try {
      const token = await googleTokenRequest({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" });
      if (!token.access_token) throw new Error("Googleからアクセストークンが返されませんでした。もう一度 Google で接続してください。");
      if (!token.refresh_token) throw new Error("Googleからリフレッシュトークンが返されませんでした。Googleの認証画面でアクセスを許可し、もう一度お試しください。");
      const sessionId = crypto.randomBytes(32).toString("hex");
      await sessions.set(sessionId, { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + (token.expires_in || 3600) * 1000, createdAt: Date.now() });
      setCookie(res, "ghealth_session", signedValue(sessionId));
      clearCookie(res, "ghealth_oauth_state");
      return redirect(res, "/?connected=1");
    } catch (error) {
      return send(res, 502, { error: error.message });
    }
  }

  if (url.pathname === "/auth/logout") {
    const sessionId = verifySignedValue(cookies(req).ghealth_session);
    if (sessionId) await sessions.delete(sessionId);
    clearCookie(res, "ghealth_session");
    return redirect(res, "/");
  }

  if (url.pathname === "/api/health") {
    const session = await sessionFor(req);
    if (!session) return send(res, 401, { error: "Google Health API に接続してください。" });
    try {
      return send(res, 200, await loadDashboard(session, url.searchParams.get("date")));
    } catch (error) {
      return send(res, 502, { error: error.message });
    }
  }

  if (url.pathname === "/api/status") return send(res, 200, { connected: Boolean(await sessionFor(req)) });

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) return send(res, 403, { error: "Forbidden" });
  try {
    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    const contentType = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" }[extension] || "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(content);
  } catch {
    send(res, 404, { error: "Not found" });
  }
}

http.createServer((req, res) => handle(req, res).catch((error) => send(res, 500, { error: error.message }))).listen(port, host, () => {
  console.log(`Google Health dashboard: http://${host}:${port}`);
});
