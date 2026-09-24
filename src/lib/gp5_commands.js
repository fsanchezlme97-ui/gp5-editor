"use strict";
/*
 * gp5_commands.js — payload builders for the GP-5 live-edit commands.
 *
 * These are the [0x11, 0x4X] host->device edits used by the community GP-5
 * editors (helvecioneto/gp5-wc `ble_sysex.json`). They change the pedal's
 * working buffer in real time, exactly like turning a knob on the Android app,
 * and are NOT stored until the preset is saved.
 *
 * Block index = model-record order in the .prst:
 *   0 NR · 1 PRE · 2 DST · 3 AMP · 4 CAB · 5 EQ · 6 MOD · 7 DLY · 8 RVB · 9 N->S
 *
 * Each builder returns the raw payload; WebMidiDevice.sendCommand() adds the
 * [crc, 0x01, 0x00, len] header and the nibble/F0..F7 framing.
 */
(function (root) {
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  const f32 = (v) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, Number(v), true);
    return Array.from(b);
  };
  const checkBlock = (blk) => {
    if (!(Number.isInteger(blk) && blk >= 0 && blk <= 9)) throw new Error(`block ${blk} out of range 0..9`);
  };

  // Set parameter `algId` of block `blk` to a float value.
  function setParam(blk, algId, value) {
    checkBlock(blk);
    if (!(Number.isInteger(algId) && algId >= 0 && algId < 8)) throw new Error(`param ${algId} out of range 0..7`);
    return [0x11, 0x48, ...u32(blk), ...u32(algId), ...f32(value)];
  }

  // Turn block `blk` on (true) or off (false).
  function setBlockOn(blk, on) {
    checkBlock(blk);
    return [0x11, 0x49, ...u32(blk), ...u32(on ? 1 : 0)];
  }

  // Swap block `blk` to model `fxid` = (category << 24) | fxlow — the same
  // 4-byte little-endian record the .prst stores for that block.
  function setModel(blk, fxid) {
    checkBlock(blk);
    return [0x11, 0x47, ...u32(blk), ...u32(blk), ...u32(fxid >>> 0)];
  }

  // Select preset `slot` (0..99). Program Change does the same job.
  function selectPatch(slot) {
    if (!(slot >= 0 && slot <= 99)) throw new Error(`slot ${slot} out of range 0..99`);
    return [0x11, 0x43, ...u32(slot)];
  }

  const API = { setParam, setBlockOn, setModel, selectPatch };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.GP5Commands = API;
})(typeof self !== "undefined" ? self : this);
