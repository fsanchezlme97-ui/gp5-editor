"use strict";
/*
 * webmidi_device.js — read/select client for the GP-5 / GP-50 over WebMIDI.
 *
 * The browser-side twin of patch/live_read.py + patch/select_patch.py: same
 * CRC-8/0x07, same nibble framing, same reassembly. Proven byte-for-byte against
 * the Python path on live hardware (see re/DEVICE_READ.md, the WebMIDI section).
 *
 * READ + SELECT, plus one gated raw-send primitive (_sendStream) used only by
 * webmidi_write.js. All patch-write building/validation/gating lives there; this
 * module just owns the port + the one-at-a-time chain and refuses to move write
 * bytes without an explicit confirm+validated. A bad write can wedge the pedal
 * (power-cycle to recover), so that gate is load-bearing.
 *
 * Needs window.PRST (prst.js) for device profiles + rebuild(). Chrome/Edge only.
 *
 *   const dev = await WebMidiDevice.connect();      // {key,name}; throws if none
 *   const names = await WebMidiDevice.readNames();  // [{slot,name}, ...]
 *   await WebMidiDevice.selectSlot(7);              // Program Change (non-destructive)
 *   const prst = await WebMidiDevice.readSlotPrst(7); // select + 0x41 + rebuild -> Uint8Array
 */
(function (root) {
  const PRST = root.PRST;
  const CATSEL = 0x12;
  const SEL_NAMES = 0x40;
  const SEL_BODY = 0x41;
  // Cadence, mirrored from live_read.py: the pedal has a shallow input queue and
  // wedges if requests outrun it. One at a time, settle after each.
  const POST_PC_MS = 300; // settle after a Program Change before reading
  const IDLE_MS = 400; // reply stream considered done after this much quiet
  const READ_TIMEOUT_MS = 2500;
  const SETTLE_MS = 200; // quiet gap after each request completes

  // --- SysEx codec (port of live_read.py) -----------------------------------
  function crc8(bytes) {
    let c = 0;
    for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c & 0x80) ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; }
    return c;
  }
  function buildRequest(selector) {
    const buf = [0, 0x01, 0x00, 0x02, CATSEL, selector];
    buf[0] = crc8(buf);
    return buf;
  }
  const toWire = (buf) => buf.flatMap((b) => [b >> 4, b & 0xf]);
  const nibDecode = (arr) => {
    const out = [];
    for (let i = 0; i + 1 < arr.length; i += 2) out.push((arr[i] << 4) | arr[i + 1]);
    return out;
  };
  function reassemble(replies) {
    const byCmd = new Map();
    for (const b of replies) {
      if (b.length < 4) continue;
      if (!byCmd.has(b[1])) byCmd.set(b[1], []);
      byCmd.get(b[1]).push([b[2], b.slice(4)]);
    }
    const out = new Map();
    for (const [cmd, chunks] of byCmd) {
      chunks.sort((a, z) => a[0] - z[0]);
      out.set(cmd, chunks.flatMap((c) => c[1]));
    }
    return out;
  }
  // Records come in slot order. Each also carries an id, which matches the
  // slot only until presets are reordered on the pedal (then ids move with
  // their preset), so the slot is the record's position, not its id.
  function splitNames(blob, hdr = 2, rec = 20) {
    const names = [];
    const dv = new DataView(new Uint8Array(blob).buffer);
    for (let i = hdr, pos = 0; i + rec <= blob.length; i += rec, pos++) {
      const id = dv.getUint32(i, true);
      let nm = "";
      for (let j = i + 4; j < i + rec; j++) { if (blob[j] === 0) break; nm += String.fromCharCode(blob[j]); }
      names.push({ slot: pos, id, name: nm.trim() });
    }
    return names;
  }

  // GP-50 first so the "GP-5" substring can't shadow it.
  const findPort = (map) => {
    const ports = [...map.values()];
    return ports.find((p) => (p.name || "").includes("GP-50"))
      || ports.find((p) => (p.name || "").includes("GP-5")) || null;
  };
  const profileForPort = (name) =>
    (name || "").includes("GP-50") ? PRST.GP50 : PRST.GP5;

  // --- connection state ------------------------------------------------------
  let access = null, input = null, output = null, profile = null;
  let namesCache = null;
  // Receives every MIDI message that arrives while no request is in flight
  // (e.g. the player turning a knob or switching presets on the pedal itself).
  let idleHandler = null;
  let stateHandler = null;
  let chain = Promise.resolve(); // serializes all device requests (one at a time)

  function assertReady() {
    if (!input || !output) throw new Error("not connected — call WebMidiDevice.connect() first");
    if (!root.PRST) throw new Error("prst.js (window.PRST) is not loaded");
  }

  // Run `fn` after every previously-queued request has finished + settled.
  function serialize(fn, settleMs = SETTLE_MS) {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => new Promise((r) => setTimeout(r, settleMs)),
      () => new Promise((r) => setTimeout(r, settleMs))
    );
    return run;
  }

  // One request/reply exchange: send `wire`, collect nibble-decoded SysEx frames
  // until the stream goes idle, reassemble, return the longest blob.
  function exchange(wire) {
    return new Promise((resolve, reject) => {
      const replies = [];
      const handler = (e) => {
        const d = Array.from(e.data);
        if (d[0] === 0xf0 && d[d.length - 1] === 0xf7) replies.push(nibDecode(d.slice(1, -1)));
      };
      input.onmidimessage = handler;
      try { output.send(wire); }
      catch (err) { input.onmidimessage = idleHandler; return reject(err); }
      const t0 = performance.now(); let last = t0, seen = 0;
      const tick = () => {
        if (replies.length > seen) { seen = replies.length; last = performance.now(); }
        const now = performance.now();
        if (now - t0 > READ_TIMEOUT_MS || (seen > 0 && now - last > IDLE_MS)) {
          input.onmidimessage = idleHandler;
          const banks = reassemble(replies);
          const blob = [...banks.values()].sort((a, z) => z.length - a.length)[0] || [];
          return resolve({ blob, frames: replies.length });
        }
        setTimeout(tick, 25);
      };
      tick();
    });
  }

  async function connect() {
    if (!navigator.requestMIDIAccess) throw new Error("this browser has no WebMIDI (use Chrome or Edge)");
    access = await navigator.requestMIDIAccess({ sysex: true });
    input = findPort(access.inputs);
    output = findPort(access.outputs);
    if (!input || !output) throw new Error("no GP-5 / GP-50 MIDI port found — connect it and close Valeton Suite");
    profile = profileForPort(input.name);
    namesCache = null;
    input.onmidimessage = idleHandler;
    access.onstatechange = (e) => {
      const p = e.port;
      if (p && (p.id === input?.id || p.id === output?.id) && p.state === "disconnected") {
        input = output = null;
        if (stateHandler) stateHandler("disconnected");
      }
    };
    return { key: profile.key, name: profile.name, port: input.name };
  }

  const isConnected = () => !!(input && output);
  const device = () => (profile ? { key: profile.key, name: profile.name } : null);

  function readNames() {
    assertReady();
    return serialize(async () => {
      const { blob } = await exchange([0xf0, ...toWire(buildRequest(SEL_NAMES)), 0xf7]);
      namesCache = splitNames(blob);
      return namesCache;
    });
  }

  // Read an arbitrary catalog selector (e.g. 0x24 SnapTone names, 0x20 User IR
  // names) and return the longest reassembled blob. Same transport as readNames.
  function readBankBlob(selector) {
    assertReady();
    return serialize(async () => (await exchange([0xf0, ...toWire(buildRequest(selector)), 0xf7])).blob);
  }

  function selectSlot(slot) {
    assertReady();
    if (!(slot >= 0 && slot <= 99)) throw new Error(`slot ${slot} out of range 0..99`);
    // The GP-5 ignores MIDI Program Change; it switches with its own SysEx
    // select [0x11, 0x43, slot]. The GP-50 answers Program Change.
    if (profile && profile.key === "gp5") {
      return sendCommand([0x11, 0x43, slot & 0xff, 0, 0, 0], { ackMs: 300, settleMs: POST_PC_MS });
    }
    return serialize(async () => {
      output.send([0xc0, slot & 0x7f]); // Program Change — non-destructive
      await new Promise((r) => setTimeout(r, POST_PC_MS));
    });
  }

  // Read the CURRENTLY active patch body (0x41) and rebuild a .prst. `name` labels
  // the patch (the device body carries no name). One retry on a short/raced read.
  function readActivePrst(name = "") {
    assertReady();
    return serialize(async () => {
      const wire = [0xf0, ...toWire(buildRequest(SEL_BODY)), 0xf7];
      const strip = (blob) => (blob[0] === CATSEL && blob[1] === SEL_BODY ? blob.slice(2) : blob);
      const wantLen = PRST.bodyLen(profile);
      let body = strip((await exchange(wire)).blob);
      for (let attempt = 0; attempt < 2 && body.length !== wantLen; attempt++) {
        await new Promise((r) => setTimeout(r, 400));
        body = strip((await exchange(wire)).blob);
      }
      if (body.length !== wantLen) {
        throw new Error(`body read landed ${body.length} bytes (expected ${wantLen})`);
      }
      return PRST.rebuild(name, body, profile);
    });
  }

  // Select slot `slot`, then read its body back as a .prst. Uses the cached name
  // from readNames() (fetched once if not already cached).
  async function readSlotPrst(slot) {
    assertReady();
    if (!namesCache) await readNames();
    const hit = (namesCache || []).find((n) => n.slot === slot);
    await selectSlot(slot);
    return readActivePrst(hit ? hit.name : `slot${slot}`);
  }

  // Gated raw sender for a pre-built, pre-validated write stream. Owns the port
  // and the one-at-a-time chain, so writes can't race reads. All write gating
  // (build/validate/WRITE_VERIFIED/confirm) lives in webmidi_write.js; this just
  // refuses to move bytes without an explicit confirm+validated from that layer.
  // Paces like Suite: one block, wait for the device ACK (shallow queue), repeat.
  function _sendStream(packets, opts) {
    assertReady();
    const { confirm = false, validated = false, ackWaitMs = 150 } = opts || {};
    if (!(confirm && validated)) throw new Error("refusing to send: _sendStream requires confirm && validated");
    return serialize(async () => {
      let acks = 0, pending = 0;
      const replies = [];
      input.onmidimessage = (e) => {
        if (e.data[0] !== 0xf0) return;
        pending++;
        const d = Array.from(e.data);
        replies.push(nibDecode(d.slice(1, -1)));
      };
      try {
        for (const w of packets) {
          const before = pending;
          output.send(w);
          const t0 = performance.now();
          while (performance.now() - t0 < ackWaitMs && pending === before) {
            await new Promise((r) => setTimeout(r, 5));
          }
          if (pending > before) acks++;
        }
      } finally { input.onmidimessage = idleHandler; }
      return { sent: packets.length, acks, replies };
    });
  }

  // --- live edit commands (GP-5 [0x11, 0x4X] family) ------------------------
  // Same transport as the reads: BUF = [crc, 0x01, 0x00, len, ...payload],
  // nibble-expanded inside F0..F7. Payload bytes are the ones the community GP-5
  // editors send (helvecioneto/gp5-wc ble_sysex.json); see gp5_commands.js.
  // They edit the pedal's working buffer only: nothing is stored until a save.
  const EDIT_SETTLE_MS = 25;
  const EDIT_ACK_MS = 150;
  function commandWire(payload) {
    const buf = [0, 0x01, 0x00, payload.length & 0xff, ...payload];
    buf[0] = crc8(buf.slice(1));
    return [0xf0, ...toWire(buf), 0xf7];
  }
  function sendCommand(payload, { ackMs = EDIT_ACK_MS, settleMs = EDIT_SETTLE_MS } = {}) {
    assertReady();
    const wire = commandWire(payload);
    return serialize(() => new Promise((resolve, reject) => {
      let acked = false;
      input.onmidimessage = (e) => { if (e.data[0] === 0xf0) acked = true; };
      try { output.send(wire); }
      catch (err) { input.onmidimessage = idleHandler; return reject(err); }
      const t0 = performance.now();
      const tick = () => {
        if (acked || performance.now() - t0 > ackMs) {
          input.onmidimessage = idleHandler;
          return resolve({ acked });
        }
        setTimeout(tick, 5);
      };
      tick();
    }), settleMs);
  }
  // Plain channel message (Program Change / CC), queued like everything else.
  function sendShort(bytes, settleMs = EDIT_SETTLE_MS) {
    assertReady();
    return serialize(async () => { output.send(bytes); }, settleMs);
  }
  function onIdleMessage(cb) {
    idleHandler = cb ? (e) => { try { cb(Array.from(e.data)); } catch (err) { console.error(err); } } : null;
    if (input) input.onmidimessage = idleHandler;
  }
  const onStateChange = (cb) => { stateHandler = cb; };

  root.WebMidiDevice = {
    connect, disconnect: () => { input = output = access = profile = namesCache = null; },
    isConnected, device, readNames, readBankBlob, selectSlot, readActivePrst, readSlotPrst, _sendStream,
    sendCommand, sendShort, onIdleMessage, onStateChange, commandWire,
    // exposed for tests / the probe
    _codec: { crc8, buildRequest, toWire, nibDecode, reassemble, splitNames, findPort },
  };
})(typeof self !== "undefined" ? self : this);
