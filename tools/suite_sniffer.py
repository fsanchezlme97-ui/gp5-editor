#!/usr/bin/env python3
"""Record the MIDI traffic between Valeton Suite and the pedal (read-only spy).

Attaches Frida to a running "Valeton Suite.exe" and logs every SysEx / short
message it sends and receives at the Windows MIDI driver (wdmaud.drv modMessage/midMessage),
plus calls into 5868USB.dll's NAM conversion exports. Nothing is modified on disk and nothing extra is sent to
the pedal: this only observes what Suite does.

    python tools/suite_sniffer.py capturas/ir.jsonl            # attach to running Suite
    python tools/suite_sniffer.py capturas/ir.jsonl --spawn    # start Suite hooked

Stop with Ctrl+C (or it stops when Suite exits).
"""
import json
import sys
import time

import frida

SUITE_DIR = r"C:\Program Files\Valeton Suite\Valeton Suite"
SUITE_EXE = SUITE_DIR + r"\Valeton Suite.exe"

AGENT = r"""
// Hooks the Windows MIDI driver entry points (wdmaud.drv modMessage/midMessage):
// every byte Suite exchanges with the pedal passes through them, whatever
// path the app uses above (winmm, Dart FFI, 5868USB.dll).
const done = new Set();
function hex(p, n) { return Array.from(new Uint8Array(p.readByteArray(n)), (x) => x.toString(16).padStart(2, "0")).join(""); }
const PS = Process.pointerSize;
function hookDrv(m) {
  const mod = m.findExportByName("modMessage"), mid = m.findExportByName("midMessage");
  if (mod) Interceptor.attach(mod, { onEnter(a) {
    const msg = a[1].toUInt32();
    if (msg === 8) { const h = a[3]; send({ t: "out", drv: m.name, hex: hex(h.readPointer(), h.add(PS).readU32()) }); }
    else if (msg === 7) { const v = a[3].toUInt32(); if ((v & 0xff) < 0xf8) send({ t: "out_short", drv: m.name, msg: v }); }
    else if (msg === 3) send({ t: "info", msg: `${m.name} MODM_OPEN dev ${a[0].toUInt32()}` });
  } });
  if (mid) Interceptor.attach(mid, { onEnter(a) {
    const msg = a[1].toUInt32();
    if (msg === 55) send({ t: "info", msg: `${m.name} MIDM_OPEN dev ${a[0].toUInt32()}` });
    else if (msg === 59) { // MIDM_ADDBUFFER: a re-queued buffer still holds the last reply
      const h = a[3], rec = h.add(PS + 4).readU32();
      if (rec) send({ t: "in", drv: m.name, hex: hex(h.readPointer(), rec) });
    }
  } });
  send({ t: "info", msg: `${m.name} hooked` });
}
function tryStr(p) {
  try { if (p.isNull()) return null; const s = p.readUtf8String(260); return s && /^[ -~]{3,}$/.test(s) ? s : null; } catch (e) { return null; }
}
function hookValeton(m) {
  for (const e of m.enumerateExports()) {
    if (e.type !== "function" || !/nam|Nam|clo|Clo|Compress|Boot|Update/.test(e.name)) continue;
    Interceptor.attach(e.address, {
      onEnter(a) { this.n = e.name; const args = []; for (let i = 0; i < 6; i++) args.push({ p: a[i].toString(), s: tryStr(a[i]) }); send({ t: "call", fn: e.name, args }); },
      onLeave(r) { send({ t: "ret", fn: this.n, ret: r.toString(), s: tryStr(r) }); },
    });
  }
  const smm = m.findExportByName("sendMidiMessage");
  if (smm) Interceptor.attach(smm, { onEnter(a) { send({ t: "smm", sel: a[1].toUInt32(), a3: a[3].toString(), a4: a[4].toString() }); } });
  send({ t: "info", msg: "5868USB hooked" });
}
// Replies reach the app through DriverCallback(MIM_LONGDATA, MIDIHDR*).
let dcb = false;
function hookCallbacks() {
  for (const lib of ["winmmbase.dll", "winmm.dll"]) {
    let m = null;
    try { m = Process.getModuleByName(lib); } catch (e) { continue; }
    const f = m.findExportByName("DriverCallback");
    if (!f) continue;
    Interceptor.attach(f, { onEnter(a) {
      const msg = a[3].toUInt32();
      if (msg === 0x3c4) { const h = a[5]; const rec = h.add(PS + 4).readU32(); if (rec) send({ t: "in", drv: lib, hex: hex(h.readPointer(), rec) }); }
      else if (msg === 0x3c3) { const v = a[5].toUInt32(); if ((v & 0xff) < 0xf8) send({ t: "in_short", msg: v }); }
    } });
    dcb = true;
    send({ t: "info", msg: `${lib} DriverCallback hooked` });
    return;
  }
}
function poll() {
  if (!dcb) hookCallbacks();
  for (const m of Process.enumerateModules()) {
    const n = m.name.toLowerCase();
    if (done.has(n)) continue;
    if (n === "wdmaud.drv" || n === "wdmaud2.drv") { done.add(n); hookDrv(m); }
    if (n === "5868usb.dll") { done.add(n); hookValeton(m); }
  }
}
poll();
setInterval(poll, 200);
"""


def decode(hexstr):
    """Nibble-decode a Valeton SysEx frame -> [crc, cmd, index, len, *payload]."""
    b = bytes.fromhex(hexstr)
    if len(b) < 4 or b[0] != 0xF0 or b[-1] != 0xF7:
        return None
    mid = b[1:-1]
    return [(mid[i] << 4) | mid[i + 1] for i in range(0, len(mid) - 1, 2)]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out_path = args[0] if args else "capture.jsonl"
    spawn = "--spawn" in sys.argv
    timeout = next((float(a.split("=")[1]) for a in sys.argv if a.startswith("--seconds=")), None)
    pid = None
    if spawn:
        pid = frida.spawn([SUITE_EXE], cwd=SUITE_DIR, stdio="pipe")
        session = frida.attach(pid)
    else:
        session = frida.attach("Valeton Suite.exe")
    t0 = time.time()
    n = {"out": 0, "in": 0}
    with open(out_path, "a", encoding="utf-8") as f:
        def on_message(msg, _data):
            if msg["type"] != "send":
                print("agent:", msg.get("description") or msg)
                return
            p = msg["payload"]
            p["ts"] = round(time.time() - t0, 4)
            if "hex" in p:
                p["buf"] = decode(p["hex"])
            f.write(json.dumps(p) + "\n")
            f.flush()
            k = "out" if p["t"] in ("out", "out_short") else "in" if p["t"] in ("in", "in_short") else None
            if k:
                n[k] += 1
                buf = p.get("buf")
                tag = f"cmd=0x{buf[1]:02x} idx={buf[2]} len={buf[3]}" if buf and len(buf) >= 4 else p.get("hex", p.get("msg"))
                print(f"\r{p['ts']:8.2f}s  {p['t']:9} {tag}   (out {n['out']} / in {n['in']})     ", end="", flush=True)
            else:
                print(f"\n[{p['t']}] {json.dumps({k: v for k, v in p.items() if k not in ('t', 'ts')})[:300]}")

        script = session.create_script(AGENT)
        script.on("message", on_message)
        script.load()
        if pid is not None:
            frida.resume(pid)
        print(f"Grabando en {out_path}. Haz la acción en Valeton Suite y luego pulsa Ctrl+C.")
        detached = []
        session.on("detached", lambda *a: detached.append(a))
        try:
            while not detached and (timeout is None or time.time() - t0 < timeout):
                time.sleep(0.2)
        except KeyboardInterrupt:
            pass
    print(f"\nListo: {n['out']} mensajes enviados, {n['in']} recibidos -> {out_path}")


if __name__ == "__main__":
    main()
