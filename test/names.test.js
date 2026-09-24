"use strict";
// The name list's slot is the record position: after presets are reordered on
// the pedal, the per-record id no longer matches the slot (real GP-5 dump).
const test = require("node:test");
const assert = require("node:assert");
globalThis.window = globalThis;
const { WebMidiDevice } = require("../src/lib/webmidi_device.js");

test("names follow record order, not the record id", () => {
  const rec = (id, name) => { const r = new Uint8Array(20); new DataView(r.buffer).setUint32(0, id, true); for (let i = 0; i < name.length; i++) r[4 + i] = name.charCodeAt(i); return [...r]; };
  const blob = [0x12, 0x40, ...rec(0, "GreatPedal"), ...rec(2, "Star Night"), ...rec(1, "Neo Soul")];
  const names = WebMidiDevice._codec.splitNames(blob);
  assert.deepStrictEqual(names.map((n) => [n.slot, n.name]), [[0, "GreatPedal"], [1, "Star Night"], [2, "Neo Soul"]]);
  assert.strictEqual(names[1].id, 2);
});
