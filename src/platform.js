"use strict";
/*
 * platform.js — files and safety copies for the app (window.store):
 * File System Access pickers in Chrome/Edge, plain downloads /
 * <input type=file> otherwise, and IndexedDB for the automatic
 * "before write" safety copies.
 */
(() => {
  const u8 = (a) => (a instanceof Uint8Array ? a : Uint8Array.from(a));
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const safeName = (s) => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "preset";

  function download(name, bytes, type = "application/octet-stream") {
    const url = URL.createObjectURL(new Blob([u8(bytes)], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ---- minimal ZIP writer (stored, no compression) -------------------------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = u8(f.bytes), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const size = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  // ---- IndexedDB: automatic safety copies ----------------------------------
  const DB = "gp5-desktop", STORE = "snapshots";
  function db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out && "result" in out ? out.result : out);
      t.onerror = () => reject(t.error);
    });
  }
  const listSnapshots = () => tx("readonly", (s) => s.getAll());
  const deleteSnapshot = (id) => tx("readwrite", (s) => s.delete(id));

  async function pickFiles() {
    if (window.showOpenFilePicker) {
      try {
        const hs = await window.showOpenFilePicker({
          multiple: true,
          types: [{ description: "Preset Valeton", accept: { "application/octet-stream": [".prst"] } }],
        });
        return Promise.all(hs.map(async (h) => { const f = await h.getFile(); return { file: f.name, name: f.name, bytes: Array.from(new Uint8Array(await f.arrayBuffer())) }; }));
      } catch (e) {
        if (e.name === "AbortError") return null;
        throw e;
      }
    }
    return new Promise((resolve) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".prst";
      inp.multiple = true;
      inp.onchange = async () => resolve(await filesToItems([...inp.files]));
      inp.addEventListener("cancel", () => resolve(null));
      inp.click();
    });
  }
  async function filesToItems(files) {
    return Promise.all(files.map(async (f) => ({ file: f.name, name: f.name, bytes: Array.from(new Uint8Array(await f.arrayBuffer())) })));
  }

  window.store = {
    backupLabel: "las copias del navegador (botón de carpeta)",

    async saveBackup(deviceName, presets) {
      const folder = `${safeName(deviceName)}_${stamp()}`;
      const files = presets.map((p) => ({ name: `${String(p.slot).padStart(2, "0")}-${safeName(p.name)}.prst`, bytes: p.bytes }));
      if (window.showDirectoryPicker) {
        try {
          const root = await window.showDirectoryPicker({ mode: "readwrite", id: "gp5-backups" });
          const dir = await root.getDirectoryHandle(folder, { create: true });
          for (const f of files) {
            const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable();
            await w.write(u8(f.bytes));
            await w.close();
          }
          return { dir: `${root.name}/${folder}`, count: files.length, opened: true };
        } catch (e) {
          if (e.name !== "AbortError") console.warn(e);
        }
      }
      download(`${folder}.zip`, new Uint8Array(await zip(files).arrayBuffer()), "application/zip");
      return { dir: `${folder}.zip (en Descargas)`, count: files.length, opened: true };
    },

    // Web: there is no folder to open; show the automatic safety copies instead.
    async openBackupFolder() {
      const UI = window.Controls;
      const snaps = (await listSnapshots()).sort((a, z) => z.id - a.id);
      const rows = snaps.map((s) =>
        `<li data-id="${s.id}"><span>${UI.escapeHtml(new Date(s.ts).toLocaleString())} · slot ${String(s.slot).padStart(2, "0")} · <b>${UI.escapeHtml(s.name)}</b></span>
          <button class="btn text sm" data-act="dl">Descargar</button><button class="btn text sm" data-act="rm">Borrar</button></li>`).join("");
      const done = UI.modal({
        title: "Copias automáticas",
        body: `<p>Antes de escribir un preset en el pedal se guarda aquí lo que había en ese slot.</p>
          ${snaps.length ? `<ul class="snap-list">${rows}</ul>` : "<p><b>Todavía no hay copias.</b></p>"}`,
        buttons: [{ label: "Cerrar", value: true, kind: "primary" }],
      });
      const list = document.querySelector("#modal-body .snap-list");
      if (list) {
        list.addEventListener("click", async (e) => {
          const btn = e.target.closest("button");
          if (!btn) return;
          const li = btn.closest("li"), id = Number(li.dataset.id);
          const s = snaps.find((x) => x.id === id);
          if (btn.dataset.act === "dl") download(`${stamp()}_slot${String(s.slot).padStart(2, "0")}-${safeName(s.name)}.prst`, s.bytes);
          else { await deleteSnapshot(id); li.remove(); }
        });
      }
      await done;
    },

    async exportPrst(name, bytes) {
      const file = `${safeName(name)}.prst`;
      if (window.showSaveFilePicker) {
        try {
          const h = await window.showSaveFilePicker({ suggestedName: file, types: [{ description: "Preset Valeton", accept: { "application/octet-stream": [".prst"] } }] });
          const w = await h.createWritable();
          await w.write(u8(bytes));
          await w.close();
          return h.name;
        } catch (e) {
          if (e.name === "AbortError") return null;
        }
      }
      download(file, bytes);
      return `${file} (en Descargas)`;
    },

    importPrst: pickFiles,
    filesToItems,

    async snapshot(slot, name, bytes) {
      await tx("readwrite", (s) => s.add({ ts: Date.now(), slot, name, bytes: u8(bytes) }));
      return "copia guardada en el navegador";
    },
  };
})();
