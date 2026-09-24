#!/usr/bin/env node
"use strict";
/*
 * Builds the portable web edition into dist/GP-5 Web/:
 *   GP-5 Web.exe            Windows: double-click, no install (Node SEA with the app embedded)
 *   app/ + serve.js         any OS with Node:  node serve.js
 *   Iniciar (Mac).command   macOS double-click (needs Node or Python 3)
 *   iniciar-linux.sh        Linux (needs Node or Python 3)
 * Run: npm run build:web
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "dist", "GP-5 Web");
const BUILD = path.join(ROOT, "dist", ".sea");

// App files shipped to users (dev probes stay out).
function appFiles(dir = SRC, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...appFiles(path.join(dir, e.name), r));
    else if (!/probe/i.test(e.name)) out.push(r);
  }
  return out;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "app"), { recursive: true });
fs.mkdirSync(BUILD, { recursive: true });

const files = appFiles();
for (const f of files) {
  const dst = path.join(OUT, "app", f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(SRC, f), dst);
}
fs.copyFileSync(path.join(ROOT, "serve.js"), path.join(OUT, "serve.js"));

const sh = `#!/bin/sh
# GP-5 Editor (web): serves the app on localhost and opens Chrome/Edge.
cd "$(dirname "$0")"
PORT=5757
if command -v node >/dev/null 2>&1; then exec node serve.js; fi
if command -v python3 >/dev/null 2>&1; then
  URL="http://127.0.0.1:$PORT/"
  (sleep 1; if [ "$(uname)" = "Darwin" ]; then open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL"; else xdg-open "$URL"; fi) &
  echo "GP-5 Editor en $URL (Ctrl+C para apagar)"
  exec python3 -m http.server $PORT --bind 127.0.0.1 --directory app
fi
echo "Necesitas Node.js o Python 3 instalado."
`;
for (const name of ["Iniciar (Mac).command", "iniciar-linux.sh"]) {
  fs.writeFileSync(path.join(OUT, name), sh, { mode: 0o755 });
}
fs.writeFileSync(path.join(OUT, "LEEME.txt"), [
  "GP-5 Editor (versión web)",
  "",
  "Windows:  doble clic en \"GP-5 Web.exe\". No necesita instalar nada.",
  "macOS:    doble clic en \"Iniciar (Mac).command\" (requiere Node.js o Python 3).",
  "Linux:    ./iniciar-linux.sh (requiere Node.js o Python 3).",
  "Con Node: node serve.js",
  "",
  "Se abre en Google Chrome o Microsoft Edge (Web MIDI). Conecta el pedal por USB",
  "y cierra Valeton Suite antes de abrirlo. Cierra la ventana negra para apagarlo.",
  "",
].join("\r\n"));

// ---- Windows single-file exe (Node Single Executable Application) ----------
(async () => {
if (process.platform === "win32") {
  const assets = { "manifest.json": path.join(BUILD, "manifest.json") };
  fs.writeFileSync(assets["manifest.json"], JSON.stringify(files));
  for (const f of files) assets[f] = path.join(SRC, f);
  const cfg = path.join(BUILD, "sea-config.json");
  const blob = path.join(BUILD, "sea-prep.blob");
  fs.writeFileSync(cfg, JSON.stringify({
    main: path.join(ROOT, "serve.js"), output: blob,
    disableExperimentalSEAWarning: true, useCodeCache: false, assets,
  }, null, 2));
  execFileSync(process.execPath, ["--experimental-sea-config", cfg], { stdio: "inherit" });
  const exe = path.join(OUT, "GP-5 Web.exe");
  fs.copyFileSync(process.execPath, exe);
  // App icon + name on the exe (before injecting the app blob).
  await require("rcedit")(exe, {
    icon: path.join(ROOT, "build", "icon.ico"),
    "version-string": { ProductName: "GP-5 Web", FileDescription: "GP-5 Editor (web)", OriginalFilename: "GP-5 Web.exe", InternalName: "GP-5 Web" },
  });
  execFileSync(process.execPath, [
    require.resolve("postject/dist/cli.js"), exe, "NODE_SEA_BLOB", blob,
    "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ], { stdio: "inherit" });
}
console.log(`\nListo: ${path.relative(ROOT, OUT)} (${files.length} archivos de la app)`);
})().catch((e) => { console.error(e); process.exit(1); });
