#!/usr/bin/env node
"use strict";
/*
 * serve.js — run GP-5 Editor in the browser with one command.
 *
 * Serves the app on http://127.0.0.1:<port> (localhost counts as a secure
 * context, which Web MIDI needs) and opens it in Chrome or Edge as an app
 * window. No dependencies. Works three ways:
 *   node serve.js                 -> serves ./src (dev) or ./app (portable folder)
 *   "GP-5 Web.exe" (Node SEA)     -> serves the files embedded in the exe
 * Options: --port=5757  --no-open  --browser (normal tab instead of app window)
 *          --dev (also serve the read-only diagnostic pages, probe*.html)
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const args = process.argv.slice(2);
const opt = (name) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split("=")[1] : null; };
const flag = (name) => args.includes(`--${name}`);

// ---- where the app files come from ------------------------------------------
let sea = null;
try { sea = require("node:sea"); if (!sea.isSea()) sea = null; } catch { sea = null; }
let manifest = null;
if (sea) manifest = JSON.parse(sea.getAsset("manifest.json", "utf8"));
const baseDir = sea ? null : [path.join(__dirname, "app"), path.join(__dirname, "src")].find((d) => fs.existsSync(path.join(d, "index.html")));
if (!sea && !baseDir) { console.error("No encuentro los archivos de la app (carpeta app/ o src/)."); process.exit(1); }

function readFile(rel) {
  if (sea) return manifest.includes(rel) ? Buffer.from(sea.getAsset(rel)) : null;
  const full = path.join(baseDir, rel);
  if (!full.startsWith(baseDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return null;
  return fs.readFileSync(full);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

// POST /__proxy {url, method, headers, body}: lets the web build reach AI APIs
// that don't allow browser (CORS) calls, e.g. a local Ollama. Only this app's
// own page can use it: the custom header forces a CORS preflight that this
// server never approves for other sites, and the Origin must be ours.
function proxy(req, res) {
  const origin = req.headers.origin || "";
  const self = `http://${req.headers.host}`;
  if (req.headers["x-gp5-proxy"] !== "1" || (origin && origin !== self)) { res.writeHead(403); return res.end(); }
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 5e6) req.destroy(); });
  req.on("end", async () => {
    const reply = (obj) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    try {
      const { url, method = "GET", headers = {}, body } = JSON.parse(raw);
      if (!/^https?:\/\//i.test(url)) return reply({ error: "URL no permitida" });
      const r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(300000) });
      reply({ status: r.status, text: await r.text() });
    } catch (e) {
      reply({ error: `No se pudo conectar: ${e.cause ? e.cause.code || e.cause.message : e.message}` });
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/__proxy") {
    if (req.method === "POST") return proxy(req, res);
    res.writeHead(405); return res.end();
  }
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "");
  if (!rel) rel = "index.html";
  rel = path.posix.normalize(rel);
  if (rel.startsWith("..") || (rel.includes("probe") && !flag("dev"))) { res.writeHead(404); return res.end(); }
  const body = readFile(rel);
  if (!body) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(rel)] || "application/octet-stream", "Cache-Control": "no-cache" });
  res.end(body);
});

// ---- browser ----------------------------------------------------------------
function findBrowser() {
  const env = process.env;
  const candidates = {
    win32: [
      path.join(env.PROGRAMFILES || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
      path.join(env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(env.PROGRAMFILES || "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
    ],
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
    linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"],
  }[process.platform] || [];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function openBrowser(url) {
  const browser = findBrowser();
  if (browser) {
    const a = flag("browser") ? [url] : [`--app=${url}`, "--window-size=1320,860"];
    spawn(browser, a, { detached: true, stdio: "ignore" }).unref();
    return path.basename(browser);
  }
  // No Chrome/Edge found: default browser (Web MIDI needs Chrome or Edge).
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref();
  return null;
}

// ---- start ------------------------------------------------------------------
function listen(port, tries = 20) {
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE" && tries > 0) listen(port + 1, tries - 1);
    else { console.error(e.message); process.exit(1); }
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log("");
    console.log("  GP-5 Editor funcionando en " + url);
    if (!flag("no-open")) {
      const b = openBrowser(url);
      console.log(b ? `  Abierto en ${b}.` : "  Abierto en tu navegador predeterminado (usa Chrome o Edge para Web MIDI).");
    }
    console.log("  Cierra esta ventana para apagarlo.");
    console.log("");
  });
}
listen(Number(opt("port")) || 5757);
