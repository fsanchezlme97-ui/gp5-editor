#!/usr/bin/env node
"use strict";
/*
 * Dev helper: serve the app, open it in the Chrome/Edge installed on this PC
 * (headless, Web MIDI + SysEx granted) and report. Needs the pedal on USB.
 *
 *   node tools/browser.js                       app: wait until it reads the pedal
 *   node tools/browser.js --page=probe.html     diagnostic page: print its log (npm run probe)
 *   --shot=out.png   save a screenshot        --js="code"  run code in the page first
 *   --wait=ms        extra wait before the screenshot
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const page = arg("page");
const port = 5790;
const browserPath = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find((p) => fs.existsSync(p));

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, "..", "serve.js"), "--no-open", "--dev", `--port=${port}`], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  const origin = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, defaultViewport: { width: 1320, height: 860 } });
  try {
    await browser.defaultBrowserContext().overridePermissions(origin, ["midi", "midi-sysex"]);
    const tab = await browser.newPage();
    const done = new Promise((resolve) => {
      tab.on("console", (m) => { console.log(m.text()); if (m.text().startsWith("PROBE DONE")) resolve(); });
    });
    tab.on("pageerror", (e) => console.log("page error:", e.message));
    await tab.goto(`${origin}/${page || ""}`);
    console.log("browser:", await browser.version());
    if (page) {
      await Promise.race([done, new Promise((r) => setTimeout(r, 60000))]);
    } else {
      try {
        await tab.waitForSelector("#workspace:not([hidden])", { timeout: 30000 });
        console.log("connected:", await tab.$eval("#conn-text", (e) => e.textContent), "| preset:", await tab.$eval("#patch-num", (e) => e.textContent), await tab.$eval("#patch-name", (e) => e.value));
      } catch {
        console.log("not connected:", await tab.$eval("#welcome-msg", (e) => e.textContent));
      }
      if (arg("js")) console.log("js:", JSON.stringify(await tab.evaluate(arg("js"))));
      await new Promise((r) => setTimeout(r, Number(arg("wait") || 600)));
      if (arg("shot")) await tab.screenshot({ path: arg("shot") });
    }
  } finally {
    await browser.close();
    server.kill();
  }
})();
