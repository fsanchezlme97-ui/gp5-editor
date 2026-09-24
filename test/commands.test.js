"use strict";
// The live-edit wire bytes must match what the community GP-5 editor
// (helvecioneto/gp5-wc) sends: template -> crc8 -> "addzero" nibbles -> F0..F7.
const test = require("node:test");
const assert = require("node:assert");
const C = require("../src/lib/gp5_commands.js");
const { WebMidiDevice } = require("../src/lib/webmidi_device.js");
const PRST = require("../src/lib/prst.js");

// Reference implementation, transcribed from gp5-wc index.html.
function gp5wc(commandHex) {
  const bytes = commandHex.match(/../g).map((h) => parseInt(h, 16));
  const crc = PRST.crc8(bytes);
  const s = crc.toString(16).padStart(2, "0") + commandHex;
  const wire = [0xf0];
  for (const ch of s) wire.push(parseInt(ch, 16));
  wire.push(0xf7);
  return wire;
}
const floatHex = (v) => {
  const b = Buffer.alloc(4); b.writeFloatLE(v); return b.toString("hex");
};

test("change_parameter matches gp5-wc", () => {
  for (const [blk, p, v] of [[3, 0, 70], [0, 0, 20], [8, 4, 33.5], [9, 1, 0]]) {
    const tmpl = `01000e1148${blk.toString(16).padStart(2, "0")}000000${p.toString(16).padStart(2, "0")}000000${floatHex(v)}`;
    assert.deepStrictEqual(WebMidiDevice.commandWire(C.setParam(blk, p, v)), gp5wc(tmpl));
  }
});

test("toggle_block matches gp5-wc", () => {
  for (const blk of [0, 2, 8]) for (const st of [0, 1]) {
    const tmpl = `01000a11490${blk}0000000${st}000000`;
    assert.deepStrictEqual(WebMidiDevice.commandWire(C.setBlockOn(blk, !!st)), gp5wc(tmpl));
  }
});

test("change_effect matches gp5-wc (effect ids are the .prst model record)", () => {
  // gp5-wc ids: AMP "01000007" = fxlow 1, category 7; RVB "0b00000c".
  for (const [blk, id, fxid] of [[3, "01000007", 0x07000001], [8, "0b00000c", 0x0c00000b], [1, "1a000000", 0x0000001a]]) {
    const tmpl = `01000e11470${blk}0000000${blk}000000${id}`;
    assert.deepStrictEqual(WebMidiDevice.commandWire(C.setModel(blk, fxid)), gp5wc(tmpl));
  }
});

test("change_patch matches gp5-wc", () => {
  assert.deepStrictEqual(WebMidiDevice.commandWire(C.selectPatch(5)), gp5wc("010006114305000000"));
  assert.deepStrictEqual(WebMidiDevice.commandWire(C.selectPatch(99)), gp5wc("010006114363000000"));
});

test("builders reject out-of-range input", () => {
  assert.throws(() => C.setParam(10, 0, 1));
  assert.throws(() => C.setParam(0, 8, 1));
  assert.throws(() => C.selectPatch(100));
});
