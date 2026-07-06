const fs = require("fs");
const http = require("http");
const pathModule = require("path");
const { URL } = require("url");

const ROOT_DIR = __dirname;
const LOG_DIR = pathModule.join(ROOT_DIR, "logs");
const LOGIN_LOG_FILE = pathModule.join(LOG_DIR, "login-access.log");
const PORT = Number(process.env.PORT || 8000);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".pmtiles": "application/octet-stream",
  ".vault": "text/plain; charset=utf-8"
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function getClientIp(request) {
  const forwardedFor = request.headers["x-forwarded-for"] || "";
  if (forwardedFor) return String(forwardedFor).split(",")[0].trim();
  return request.socket.remoteAddress || "";
}

function readRequestBody(request, limitBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > limitBytes) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\r\n\t]/g, " ").trim().slice(0, maxLength);
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function handleLoginLog(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const rawBody = await readRequestBody(request);
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const logEntry = {
      time: new Date().toISOString(),
      account: cleanText(payload.account, 80),
      displayName: cleanText(payload.displayName, 120),
      ip: getClientIp(request),
      userAgent: cleanText(request.headers["user-agent"], 500),
      browser: cleanText(payload.browser, 160),
      platform: cleanText(payload.platform, 120),
      language: cleanText(payload.language, 40),
      latitude: cleanNumber(payload.latitude),
      longitude: cleanNumber(payload.longitude),
      accuracy: cleanNumber(payload.accuracy),
      locationStatus: cleanText(payload.locationStatus, 80)
    };

    await fs.promises.mkdir(LOG_DIR, { recursive: true });
    await fs.promises.appendFile(LOGIN_LOG_FILE, JSON.stringify(logEntry) + "\n", "utf8");
    sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error("Cannot write login log:", error);
    sendJson(response, 400, { ok: false, error: "Cannot write login log" });
  }
}

function resolveStaticPath(urlPathname) {
  const decodedPath = decodeURIComponent(urlPathname);
  const normalizedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = pathModule.resolve(ROOT_DIR, "." + normalizedPath);
  if (!filePath.startsWith(ROOT_DIR)) return null;
  return filePath;
}

async function serveStatic(request, response, pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) {
      response.writeHead(301, { Location: pathname.replace(/\/+$/, "") + "/" });
      response.end();
      return;
    }

    const extension = pathModule.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, "http://" + (request.headers.host || "localhost"));
  if (requestUrl.pathname === "/api/login-log") {
    handleLoginLog(request, response);
    return;
  }
  serveStatic(request, response, requestUrl.pathname);
});

server.listen(PORT, () => {
  console.log("BDDR Tong Viewer running at http://localhost:" + PORT);
  console.log("Login logs will be written to " + LOGIN_LOG_FILE);
});
