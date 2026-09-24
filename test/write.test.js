"use strict";
// The GP-5 patch write must be byte-identical to what Valeton Suite sends
// (captured with tools/suite_sniffer.py while Suite imported a .prst).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

globalThis.window = globalThis;
window.PRST = require("../src/lib/prst.js");
const W = require("../src/lib/webmidi_write.js");

const cap = require("./fixtures/gp5_suite_import.json");
const prst = new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "97-FF CC.prst")));
const hex = (w) => Buffer.from(w).toString("hex");

test("GP-5 write stream matches the Suite capture byte for byte", () => {
  const packets = W.buildPatchWriteStream(prst, cap.slot);
  assert.strictEqual(packets.length, cap.write.length);
  packets.forEach((w, i) => assert.strictEqual(hex(w), cap.write[i], `packet ${i}`));
  assert.deepStrictEqual(W.validateStream(packets), [true, "ok"]);
});

test("GP-5 writes with command 0x1A, GP-50 with 0x1D; both 0-based slots", () => {
  const dec = (w) => { const m = w.slice(1, -1); const o = []; for (let i = 0; i < m.length; i += 2) o.push((m[i] << 4) | m[i + 1]); return o; };
  const gp5 = dec(W.buildPatchWriteStream(prst, 0)[0]);
  assert.strictEqual(gp5[1], 0x1a);
  assert.deepStrictEqual(gp5.slice(4, 7), [0x11, 0x4f, 0]);
  const gp50 = window.PRST.convert(prst, "gp50");
  const d50 = dec(W.buildPatchWriteStream(gp50, 90)[0]);
  assert.strictEqual(d50[1], 0x1d);
  assert.strictEqual(d50[6], 90);
  assert.ok(W.WRITE_VERIFIED.gp5);
});
