import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requested));

  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) {
    return send(res, 403, { error: "Forbidden" });
  }

  try {
    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8"
    }[extension] || "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(content);
  } catch {
    send(res, 404, { error: "Not found" });
  }
}

http.createServer((req, res) => handle(req, res).catch((error) => send(res, 500, { error: error.message }))).listen(port, host, () => {
  console.log(`Running tracker: http://${host}:${port}`);
});
