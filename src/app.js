"use strict";
/*
 * app.js — GP-5 Editor (web, Chrome/Edge + Web MIDI).
 *
 * Reads use the proven 0x40/0x41 protocol (webmidi_device.js). Edits are sent
 * live with the GP-5 [0x11,0x4X] commands (gp5_commands.js), so you hear every
 * change immediately; they live in the pedal's working buffer until saved.
 * Saving writes the whole preset with the 0x1D stream (webmidi_write.js); a
 * safety copy is taken first and the result is verified by read-back.
 */
(() => {
  const D = window.WebMidiDevice;
  const Cmd = window.GP5Commands;
  const W = window.WebMidiWrite;
  const UI = window.Controls;
  const { h, escapeHtml: esc } = UI;
  const $ = (s) => document.querySelector(s);

  const BLOCKS = PatchLib.BLOCK_NAMES; // record order: NR PRE DST AMP CAB EQ MOD DLY RVB N->S
  const ABBR = { "N->S": "N→S" };
  const TITLE = {
    NR: "Reducción de ruido", PRE: "Pre-efectos", DST: "Distorsión / Overdrive", AMP: "Amplificador",
    CAB: "Gabinete / IR", EQ: "Ecualizador", MOD: "Modulación", DLY: "Delay", RVB: "Reverb", "N->S": "SnapTone (captura NAM)",
  };

  const S = {
    dev: null, profile: null, ring: null, lib: null,
    bankMap: { snaptone: {}, ir: {} },
    names: [], slot: null,
    prst: null,     // working copy mirrored from the pedal's buffer (+ our live edits)
    stored: null,   // the preset exactly as stored in the slot (for Discard + safety backup)
    patch: null,    // decoded view of S.prst
    sel: 3,         // selected block (record index)
    dirty: false,
    extra: {},      // edits that only apply on save: {name, settings, order, footswitches}
    busy: 0,
    lastIo: 0,
  };

  // ---------------------------------------------------------------- helpers
  const toast = UI.toast;
  const pad2 = (n) => String(n).padStart(2, "0");
  const isEmptyName = (n) => (n || "").trim().toUpperCase() === (S.profile?.name || "GP-5").toUpperCase();
  const nameOf = (slot) => (S.names.find((n) => n.slot === slot) || {}).name || "";

  async function io(fn) {
    try { return await fn(); } finally { S.lastIo = performance.now(); }
  }
  async function busy(fn) {
    S.busy++;
    setConn("busy");
    try { return await fn(); } finally {
      S.busy--;
      if (!S.busy) setConn(D.isConnected() ? "on" : "off");
    }
  }

  function setConn(state, text) {
    const c = $("#conn");
    c.className = "conn " + state;
    $("#conn-text").textContent = text || (state === "on" ? `${S.dev?.name || "Pedal"} conectado`
      : state === "busy" ? "Comunicando…" : "Sin conexión");
  }

  function decode(bytes) {
    return S.lib.inventory([{ slot: S.slot ?? 0, bytes, name: nameOf(S.slot) }]).patches[0];
  }

  // -------------------------------------------------------------- connect
  // Why the browser itself can't reach the pedal, if that's the case.
  function envProblem() {
    if (!navigator.requestMIDIAccess) {
      return "Este navegador no tiene Web MIDI. Abre la app en Google Chrome o Microsoft Edge.";
    }
    const m = navigator.userAgent.match(/Chrom(?:e|ium)\/(\d+)/);
    if (m && Number(m[1]) === 152) {
      return "Chrome 152 tiene un fallo de Web MIDI que impide hablar con el pedal. Actualiza a Chrome 153 o usa Edge.";
    }
    return null;
  }

  async function connect() {
    $("#btn-connect").disabled = true;
    $("#welcome-msg").textContent = "Buscando el pedal…";
    try {
      await busy(async () => {
        S.dev = await D.connect();
        S.profile = PRST.profileFor(S.dev.key);
        S.ring = await (await fetch(`data/${S.profile.ringFile}`)).json();
        S.names = await io(() => D.readNames());
        if (!S.names.length) throw new Error("el pedal no respondió (¿Valeton Suite abierto?)");
        await syncBanks();
        S.slot = await readCurrentSlot();
        await loadActive({ fresh: true });
      });
      $("#welcome").hidden = true;
      $("#workspace").hidden = false;
      enableUi(true);
      renderPresetList();
      toast(`${S.dev.name} conectado · ${S.names.length} presets`, "ok");
    } catch (e) {
      D.disconnect();
      setConn("off");
      $("#welcome-msg").textContent = envProblem() || `No se pudo conectar: ${e.message}. Conecta el GP-5 por USB y cierra Valeton Suite.`;
      $("#btn-connect").disabled = false;
    }
  }

  function enableUi(on) {
    for (const id of ["btn-backup", "btn-import", "btn-export", "btn-refresh", "btn-prev", "btn-next", "patch-name"]) {
      $("#" + id).disabled = !on;
    }
  }

  const nameAt = (blob, i, len) => {
    let s = "";
    for (let j = i; j < i + len && j < blob.length; j++) { if (blob[j] === 0) break; s += String.fromCharCode(blob[j]); }
    return s.trim();
  };
  // SnapTone (0x24) and User IR (0x20) names, so the N→S and CAB blocks show
  // the real names you gave them (layout from the upstream read_bank_map port).
  async function syncBanks() {
    const snap = await io(() => D.readBankBlob(0x24));
    const ir = await io(() => D.readBankBlob(0x20));
    const snaptone = {}, irs = {};
    for (let i = 82; i + 16 <= snap.length; i += 16) {
      const idx = (i - 82) / 16, nm = nameAt(snap, i, 16);
      if (idx > 0 && nm && nm !== "Empty") snaptone[idx] = nm;
    }
    for (let i = 22; i + 16 <= ir.length; i += 16) {
      const idx = (i - 22) / 16, nm = nameAt(ir, i, 16);
      if (nm && !nm.toLowerCase().startsWith("user ir")) irs[idx] = nm;
    }
    S.bankMap = { snaptone, ir: irs };
    S.lib = PatchLib.make(S.ring, S.bankMap, S.profile);
  }

  // Selector 0x43 answers [0x12, 0x43, slot_lo, slot_hi].
  async function readCurrentSlot() {
    const b = await io(() => D.readBankBlob(0x43));
    if (b.length >= 3 && b[0] === 0x12 && b[1] === 0x43) {
      const slot = b[2] | ((b[3] || 0) << 8);
      if (slot >= 0 && slot <= 99) return slot;
    }
    return S.slot ?? 0;
  }

  // Read the pedal's current buffer. fresh = it is the stored preset (no edits).
  async function loadActive({ fresh = false } = {}) {
    const bytes = await io(() => D.readActivePrst(nameOf(S.slot)));
    S.prst = bytes;
    if (fresh) {
      undoStack.length = 0;
      S.stored = bytes;
      S.extra = {};
      setDirty(false);
    }
    S.patch = decode(bytes);
    render();
  }

  // --------------------------------------------------------------- presets
  // Holding ↓ fires many requests: the running load loop always catches up to
  // the latest S.slot instead of reading every preset in between.
  let nav = null;
  async function selectPreset(slot) {
    if (!D.isConnected() || slot === S.slot || slot < 0 || slot > 99) return;
    if (S.dirty && !(await confirmDiscard())) return;
    S.slot = slot;
    $("#patch-num").textContent = pad2(slot);
    $("#patch-name").value = nameOf(slot);
    renderPresetList();
    if (nav) return nav;
    nav = (async () => {
      await flushParams();
      try {
        await busy(async () => {
          let loaded = -1;
          while (loaded !== S.slot) {
            const target = S.slot;
            await io(() => D.selectSlot(target));
            if (target !== S.slot) continue;
            await loadActive({ fresh: true });
            loaded = target;
          }
        });
      } catch (e) { toast(`No se pudo leer el preset: ${e.message}`, "err"); }
      finally { nav = null; }
    })();
    return nav;
  }

  async function confirmDiscard() {
    const v = await UI.modal({
      title: "Cambios sin guardar",
      body: `<p>El preset <b>${esc(nameOf(S.slot))}</b> tiene cambios que no se han guardado en el pedal. Si cambias de preset se pierden.</p>`,
      buttons: [{ label: "Cancelar", value: false }, { label: "Descartar cambios", value: true, kind: "danger" }],
    });
    return !!v;
  }

  async function discard() {
    if (!(await confirmDiscard())) return;
    await flushParams();
    await busy(async () => {
      // Re-selecting the slot makes the pedal reload the stored preset.
      await io(() => D.selectSlot(S.slot));
      await loadActive({ fresh: true });
    });
    toast("Cambios descartados", "ok");
  }

  // ------------------------------------------------------------ live edits
  function setDirty(v) {
    S.dirty = v;
    $("#dirty").hidden = !v;
    $("#btn-save").hidden = !v;
    $("#btn-discard").hidden = !v;
  }

  // Coalesce slider moves: only the latest value per param is sent, one
  // command at a time, so dragging never floods the pedal's small input queue.
  const pending = new Map();
  let pumping = null;
  // Undo stack: consecutive moves of the same control within 1 s collapse into
  // one step, so a slider drag undoes in a single Ctrl+Z.
  const undoStack = [];
  function pushUndo(entry) {
    const top = undoStack[undoStack.length - 1];
    const now = performance.now();
    if (top && top.key === entry.key && now - top.t < 1000) { top.t = now; return; }
    undoStack.push({ ...entry, t: now });
    if (undoStack.length > 200) undoStack.shift();
  }
  async function undo() {
    const u = undoStack.pop();
    if (!u || !S.patch) { toast("Nada que deshacer", "info", 1500); return; }
    if (u.kind === "param") queueParam(u.blk, u.alg, u.prev, { noUndo: true });
    else await setBlockOn(u.blk, u.prev, { noUndo: true });
    S.sel = u.blk;
    renderChain();
    renderEditor();
    toast(`Deshecho: ${u.label}`, "info", 1500);
  }

  function queueParam(blk, alg, value, { noUndo = false } = {}) {
    if (!noUndo) {
      const b = S.patch.blocks[blk];
      const p = b.params.find((x) => x.algId === alg);
      pushUndo({ kind: "param", key: `p${blk}:${alg}`, blk, alg, prev: PRST.paramFloats(S.prst)[blk * 8 + alg], label: `${b.block} · ${p ? p.name : alg}` });
    }
    pending.set(`${blk}:${alg}`, [blk, alg, value]);
    S.prst = PRST.applyEdits(S.prst, { params: { [blk]: { [alg]: value } } });
    S.patch = decode(S.prst);
    setDirty(true);
    scheduleChain();
    if (!pumping) pumping = pump();
  }
  async function pump() {
    try {
      while (pending.size) {
        const [key, [blk, alg, value]] = pending.entries().next().value;
        pending.delete(key);
        try { await io(() => D.sendCommand(Cmd.setParam(blk, alg, value))); }
        catch (e) { toast(`Error enviando parámetro: ${e.message}`, "err"); }
      }
    } finally { pumping = null; }
  }
  async function flushParams() { while (pumping) await pumping; }

  async function setBlockOn(blk, on, { noUndo = false } = {}) {
    if (!noUndo) pushUndo({ kind: "toggle", key: `t${blk}:${Date.now()}`, blk, prev: S.patch.blocks[blk].active, label: `${S.patch.blocks[blk].block} ${on ? "encendido" : "apagado"}` });
    try {
      await io(() => D.sendCommand(Cmd.setBlockOn(blk, on)));
      S.prst = PRST.applyEdits(S.prst, { bypass: { [blk]: on } });
      S.patch = decode(S.prst);
      setDirty(true);
      renderChain();
      if (blk === S.sel) $("#block-on").checked = on;
    } catch (e) { toast(`Error: ${e.message}`, "err"); }
  }

  async function setModel(blk, fxid) {
    await flushParams();
    try {
      await busy(async () => {
        await io(() => D.sendCommand(Cmd.setModel(blk, fxid), { settleMs: 120 }));
        // The pedal loads the model's defaults; read them back so the knobs match.
        await loadActive();
      });
      setDirty(true);
    } catch (e) { toast(`No se pudo cambiar el modelo: ${e.message}`, "err"); }
  }

  // Send a whole preset through live commands: hear it without writing anything.
  async function auditionPrst(bytes) {
    const target = decode(bytes);
    const floats = PRST.paramFloats(bytes);
    const prog = UI.progress("Cargando en el pedal", "<p>Enviando bloques y parámetros (no se guarda nada).</p>");
    try {
      await busy(async () => {
        let n = 0;
        for (let k = 0; k < BLOCKS.length; k++) {
          const b = target.blocks[k];
          if (b.fxid && b.fxid !== S.patch.blocks[k].fxid) {
            await io(() => D.sendCommand(Cmd.setModel(k, b.fxid), { settleMs: 120 }));
          }
          prog.update((++n) / 30, `${BLOCKS[k]} · modelo`);
        }
        for (let k = 0; k < BLOCKS.length; k++) {
          for (const p of target.blocks[k].params) {
            await io(() => D.sendCommand(Cmd.setParam(k, p.algId, floats[k * 8 + p.algId])));
          }
          await io(() => D.sendCommand(Cmd.setBlockOn(k, target.blocks[k].active)));
          prog.update((10 + (++n)) / 30, `${BLOCKS[k]} · parámetros`);
        }
        await loadActive();
      });
    } finally { prog.close(); }
    const settings = PatchLib.make(S.ring, S.bankMap, S.profile).inventory([{ slot: 0, bytes }]).patches[0].settings;
    S.extra = {
      name: PRST.readName(bytes),
      order: PRST.readOrder(bytes),
      settings: { patch_vol: settings.patch_vol, bpm: settings.bpm },
      footswitches: { fs1: settings.fs1, fs2: settings.fs2 },
    };
    setDirty(true);
    render();
  }

  // ------------------------------------------------------------------ save
  const writeWarning = () => W.WRITE_VERIFIED[S.profile.key] ? "" :
    `<p class="warn">${Icons.svg("exclamation-triangle")}<span>Experimental en el ${esc(S.dev.name)}: guardar presets aún no está confirmado en este pedal. La app guarda una copia antes y comprueba el resultado; si no se guardó, te lo dirá y el preset original seguirá intacto.</span></p>`;

  // Read a slot back from the pedal's memory, not its working buffer:
  // re-selecting the active slot doesn't reload it, so step through another.
  async function reloadFromFlash(slot) {
    await io(() => D.selectSlot(slot === 0 ? 1 : slot - 1));
    await io(() => D.selectSlot(slot));
    return io(() => D.readActivePrst(nameOf(slot)));
  }
  const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  // Last write's device replies, for diagnosis (window.GP5App.lastWrite).
  let lastWrite = null;

  async function save() {
    if (!S.dirty || S.slot == null) return;
    const newName = (S.extra.name ?? nameOf(S.slot)).slice(0, 16);
    const go = await UI.modal({
      title: `Guardar en el slot ${pad2(S.slot)}`,
      body: `<p>Se escribirá <b>${esc(newName)}</b> en el slot <b>${pad2(S.slot)}</b>, reemplazando <b>${esc(nameOf(S.slot))}</b>.</p>
        <p>Antes de escribir se guarda una copia del preset original en <b>${esc(window.store.backupLabel)}</b>, y después se lee de vuelta para comprobarlo.</p>${writeWarning()}`,
      buttons: [{ label: "Cancelar", value: false }, { label: "Guardar", value: true, kind: "primary" }],
    });
    if (!go) return;
    await flushParams();
    const slot = S.slot;
    try {
      await busy(async () => {
        const snapFile = await window.store.snapshot(slot, nameOf(slot), Array.from(S.stored));
        // The pedal's buffer is the truth (includes model defaults, knob moves on the pedal…).
        let buf = await io(() => D.readActivePrst(nameOf(slot)));
        const edits = { name: newName };
        if (S.extra.settings) edits.settings = S.extra.settings;
        if (S.extra.order && PRST.orderOffset(buf) >= 0) edits.order = S.extra.order;
        if (S.extra.footswitches) edits.footswitches = S.extra.footswitches;
        buf = PRST.applyEdits(buf, edits);
        const r = await io(() => W.writeSlot(slot, buf, { confirm: true, allowUnverified: true }));
        lastWrite = { slot, ...r };
        // Verify against the pedal's memory, byte for byte.
        S.names = await io(() => D.readNames());
        const back = await reloadFromFlash(slot);
        if (sameBytes(back, buf)) {
          S.prst = S.stored = back;
          S.extra = {};
          setDirty(false);
          S.patch = decode(back);
          render();
          renderPresetList();
          toast(`Guardado en el slot ${pad2(slot)} y verificado`, "ok", 6000);
        } else {
          // Not stored: put the edits back on the pedal so nothing is lost.
          S.stored = back;
          await auditionPrst(buf);
          toast(`No se pudo guardar en el pedal: el slot ${pad2(slot)} sigue con el preset original. Tus cambios siguen cargados (sin guardar). Puedes guardarlos desde el propio pedal. (${r.acks}/${r.sent} paquetes confirmados)`, "err", 15000);
        }
      });
    } catch (e) {
      toast(`Error al guardar: ${e.message}`, "err", 10000);
    }
  }

  // -------------------------------------------------------------- backup
  async function backupAll() {
    if (S.dirty && !(await confirmDiscard())) return;
    const go = await UI.modal({
      title: "Respaldar los 100 presets",
      body: `<p>Se leerá cada preset del pedal (unos 60–90 s) y se guardará como archivo <b>.prst</b>${window.store.isDesktop ? " en <b>Documentos\\GP-5 Backups</b>" : " (el navegador te pedirá una carpeta o descargará un .zip)"}.</p>
        <p>Durante la lectura el pedal irá cambiando de preset: mejor no tocar mientras tanto.</p>`,
      buttons: [{ label: "Cancelar", value: false }, { label: "Empezar", value: true, kind: "primary" }],
    });
    if (!go) return;
    await flushParams();
    const back = S.slot;
    const prog = UI.progress("Respaldando presets", "", { cancellable: true });
    const out = [];
    try {
      await busy(async () => {
        S.names = await io(() => D.readNames());
        for (let slot = 0; slot < 100 && !prog.state.cancelled; slot++) {
          const name = nameOf(slot);
          prog.update(slot / 100, `${pad2(slot)} · ${name}`);
          await io(() => D.selectSlot(slot));
          const bytes = await io(() => D.readActivePrst(name));
          out.push({ slot, name, bytes: Array.from(bytes) });
        }
        prog.update(1, "Volviendo al preset original…");
        await io(() => D.selectSlot(back));
        await loadActive({ fresh: true });
      });
    } catch (e) {
      toast(`El respaldo se detuvo: ${e.message}`, "err", 8000);
    } finally { prog.close(); }
    if (out.length) {
      const r = await window.store.saveBackup(S.dev.name, out);
      await UI.modal({
        title: "Respaldo listo",
        body: `<p>${r.count} presets guardados en:</p><p><b>${esc(r.dir)}</b></p>`,
        buttons: [{ label: "Cerrar", value: true, kind: "primary" }],
      });
    }
  }

  // ------------------------------------------------------ import / export
  async function exportPrst() {
    await flushParams();
    try {
      const bytes = await busy(() => io(() => D.readActivePrst(S.extra.name ?? nameOf(S.slot))));
      const edits = {};
      if (S.extra.settings) edits.settings = S.extra.settings;
      const out = Object.keys(edits).length ? PRST.applyEdits(bytes, edits) : bytes;
      const file = await window.store.exportPrst(`${pad2(S.slot)}-${PRST.readName(out) || "preset"}`, Array.from(out));
      if (file) toast(`Exportado: ${file}`, "ok");
    } catch (e) { toast(`No se pudo exportar: ${e.message}`, "err"); }
  }

  // A .prst file -> bytes for this pedal (GP-50 files are converted). null = skipped.
  async function preparePrst(f) {
    const bytes = Uint8Array.from(f.bytes);
    const src = PRST.detect(bytes);
    if (bytes.length !== src.prstLen) throw new Error(`${f.name}: tamaño de archivo inesperado`);
    if (src.key === S.profile.key) return bytes;
    try { return PRST.convert(bytes, S.profile.key); }
    catch (e) {
      const force = await UI.modal({
        title: "Conversión con pérdidas",
        body: `<p><b>${esc(f.name)}</b>: ${esc(e.message)}</p><p>¿Convertir de todas formas quitando esos bloques?</p>`,
        buttons: [{ label: "Omitir", value: false }, { label: "Convertir", value: true, kind: "primary" }],
      });
      return force ? PRST.convert(bytes, S.profile.key, { force: true }) : null;
    }
  }

  const sortedNames = () => [...S.names].sort((a, z) => a.slot - z.slot);
  function slotOptions(selected) {
    return sortedNames().map(({ slot, name }) =>
      `<option value="${slot}"${slot === selected ? " selected" : ""}>${pad2(slot)} · ${esc(isEmptyName(name) ? "(vacío)" : name)}</option>`).join("");
  }
  const firstEmpty = () => (sortedNames().find((n) => isEmptyName(n.name)) || {}).slot;

  // "Subir presets": one or many .prst files -> listen (live) or write to slots.
  async function importPrst(given) {
    if (!D.isConnected()) { toast("Conecta el pedal primero", "warn"); return; }
    const files = Array.isArray(given) ? given : await window.store.importPrst();
    if (!files || !files.length) return;
    const items = [];
    for (const f of files) {
      try {
        const bytes = await preparePrst(f);
        if (bytes) items.push({ name: PRST.readName(bytes) || f.name, bytes });
      } catch (e) { toast(`Archivo no válido: ${e.message}`, "err"); }
    }
    if (!items.length) return;
    const warn = writeWarning();
    const start = firstEmpty() ?? S.slot;

    if (items.length === 1) {
      const it = items[0];
      const v = await UI.modal({
        title: `Preset «${it.name}»`,
        body: `<p>Puedes <b>escucharlo</b> sin guardar (se carga sobre el preset actual) o <b>escribirlo</b> directamente en un slot del pedal.</p>
          <label class="field"><span>Slot de destino</span><select id="imp-slot">${slotOptions(start)}</select></label>${warn}`,
        buttons: [{ label: "Cancelar", value: null }, { label: "Escuchar sin guardar", value: "listen" }, { label: "Escribir en el pedal", value: "write", kind: "primary" }],
      });
      if (!v) return;
      await flushParams();
      if (v === "listen") {
        try {
          await auditionPrst(it.bytes);
          toast(`«${it.name}» cargado. Pulsa «Guardar en el pedal» para conservarlo en el slot ${pad2(S.slot)}.`, "ok", 7000);
        } catch (e) { toast(`No se pudo cargar: ${e.message}`, "err"); }
        return;
      }
      const slot = Number($("#imp-slot").value);
      if (!isEmptyName(nameOf(slot)) && !(await confirmOverwrite([{ slot, name: it.name }]))) return;
      await writePresets([{ ...it, slot }]);
      return;
    }

    const v = await UI.modal({
      title: `Subir ${items.length} presets`,
      body: `<p>Se escribirán en slots consecutivos a partir del elegido:</p>
        <label class="field"><span>Primer slot</span><select id="imp-slot">${slotOptions(start)}</select></label>
        <ul class="imp-list">${items.map((it) => `<li>${esc(it.name)}</li>`).join("")}</ul>${warn}`,
      buttons: [{ label: "Cancelar", value: false }, { label: "Escribir en el pedal", value: true, kind: "primary" }],
    });
    if (!v) return;
    const first = Number($("#imp-slot").value);
    if (first + items.length > 100) { toast("No caben: elige un slot inicial más bajo", "err"); return; }
    const plan = items.map((it, i) => ({ ...it, slot: first + i }));
    const over = plan.filter((p) => !isEmptyName(nameOf(p.slot)));
    if (over.length && !(await confirmOverwrite(over))) return;
    await flushParams();
    await writePresets(plan);
  }

  async function confirmOverwrite(list) {
    return !!(await UI.modal({
      title: "Se reemplazarán presets",
      body: `<p>Estos slots no están vacíos y se sobrescribirán (antes se guarda una copia):</p>
        <ul class="imp-list">${list.map((p) => `<li>${pad2(p.slot)} · ${esc(nameOf(p.slot))} → ${esc(p.name)}</li>`).join("")}</ul>`,
      buttons: [{ label: "Cancelar", value: false }, { label: "Reemplazar", value: true, kind: "danger" }],
    }));
  }

  // Write whole presets to slots: back up each slot, write, read back to verify.
  // skipDirtyCheck: the caller already confirmed (e.g. saving an AI preset
  // that was being auditioned — those live edits are exactly what we write).
  async function writePresets(plan, { skipDirtyCheck = false } = {}) {
    if (S.dirty && !skipDirtyCheck && !(await confirmDiscard())) return;
    const prog = UI.progress("Escribiendo en el pedal", "", { cancellable: plan.length > 1 });
    const results = [];
    try {
      await busy(async () => {
        for (let i = 0; i < plan.length && !prog.state.cancelled; i++) {
          const { slot, name, bytes } = plan[i];
          prog.update(i / plan.length, `${pad2(slot)} · ${name}`);
          await io(() => D.selectSlot(slot));
          const before = await io(() => D.readActivePrst(nameOf(slot)));
          await window.store.snapshot(slot, nameOf(slot), Array.from(before));
          const r = await io(() => W.writeSlot(slot, bytes, { confirm: true, allowUnverified: true }));
          lastWrite = { slot, ...r };
          S.names = await io(() => D.readNames());
          const back = await reloadFromFlash(slot);
          results.push({ slot, name, ok: sameBytes(back, bytes), acks: r.acks, sent: r.sent });
        }
        prog.update(1, "Cargando…");
        if (results.length) S.slot = results[results.length - 1].slot;
        await io(() => D.selectSlot(S.slot));
        await loadActive({ fresh: true });
      });
    } catch (e) {
      toast(`Error al escribir: ${e.message}`, "err", 10000);
    } finally { prog.close(); }
    renderPresetList();
    const bad = results.filter((r) => !r.ok);
    if (results.length && !bad.length) {
      toast(results.length === 1 ? `«${results[0].name}» escrito en el slot ${pad2(results[0].slot)} y verificado` : `${results.length} presets escritos y verificados`, "ok", 6000);
    } else if (bad.length) {
      toast(`No se pudo guardar en el pedal (slot ${bad.map((r) => pad2(r.slot)).join(", ")}): sigue con el preset original. Puedes cargarlo con «Escuchar sin guardar» y guardarlo desde el propio pedal.`, "err", 15000);
    }
  }

  // ---------------------------------------------------------------- render
  function render() {
    if (!S.patch) return;
    $("#patch-num").textContent = pad2(S.slot);
    const nm = $("#patch-name");
    if (document.activeElement !== nm) nm.value = S.extra.name ?? nameOf(S.slot);
    renderChain();
    renderEditor();
    renderSettings();
  }

  function renderPresetList() {
    const ul = $("#preset-list");
    const q = $("#search").value.trim().toLowerCase();
    ul.innerHTML = "";
    for (const { slot, name } of [...S.names].sort((a, z) => a.slot - z.slot)) {
      if (q && !name.toLowerCase().includes(q) && !pad2(slot).includes(q)) continue;
      const li = h("li");
      if (slot === S.slot) li.classList.add("active");
      if (isEmptyName(name)) li.classList.add("empty");
      li.append(h("span", "num", pad2(slot)), h("span", "nm", name || "—"));
      li.onclick = () => selectPreset(slot);
      ul.append(li);
    }
    const act = ul.querySelector(".active");
    if (act) act.scrollIntoView({ block: "nearest" });
  }

  function shortModel(b) {
    if (b.block === "N->S") return b.index ? (b.model || `SnapTone ${b.index}`) : "—";
    return (b.model || "—").trim();
  }

  function renderChain() {
    const el = $("#chain");
    el.innerHTML = "";
    const order = S.extra.order || S.patch.order || BLOCKS.map((_, i) => i);
    order.forEach((k, pos) => {
      const b = { ...S.patch.blocks[k], model: shortModel(S.patch.blocks[k]) };
      const u = Pedals.unit(b, {
        selected: k === S.sel,
        keyHint: (pos + 1) % 10,
        onSelect: () => { S.sel = k; renderChain(); renderEditor(); },
        onToggle: () => setBlockOn(k, !S.patch.blocks[k].active),
      });
      u.title = `${TITLE[b.block]}: ${b.model}
Clic para editar · LED o pulsador para encender/apagar`;
      el.append(u);
    });
  }
  // Knob pointers on the board follow slider drags, at most once per frame.
  let chainFrame = 0;
  function scheduleChain() {
    if (chainFrame) return;
    chainFrame = requestAnimationFrame(() => { chainFrame = 0; renderChain(); });
  }

  function renderEditor() {
    const b = S.patch.blocks[S.sel];
    Pedals.badge($("#block-badge"), b);
    $("#block-title").textContent = TITLE[b.block];
    $("#model-name").textContent = shortModel(b);
    $("#model-origin").textContent = b.block === "N->S" ? "" : (b.official && b.official !== b.model ? b.official : (b.type || ""));
    $("#block-on").checked = b.active;

    const box = $("#params");
    box.innerHTML = "";
    if (!b.params.length) {
      box.append(h("div", "empty-params", "Este modelo no tiene parámetros."));
      return;
    }
    const k = S.sel;
    for (const p of b.params) {
      if (p.toggle) {
        box.append(UI.toggleRow(p.name, Math.round(p.value) !== 0, (on) => queueParam(k, p.algId, on ? 1 : 0)));
      } else {
        box.append(UI.slider({
          name: p.name, value: p.value, min: p.min, max: p.max, step: p.step, unit: p.unit,
          defaultValue: defaultFor(b, p.algId),
          onInput: (v) => queueParam(k, p.algId, v),
        }));
      }
    }
  }

  // Factory default of a parameter, from the model catalog.
  function defaultFor(b, algId) {
    const fxid = b.block === "N->S" ? (0x0f << 24) >>> 0 : b.fxid;
    const e = S.ring && S.ring[String(fxid)];
    const p = e && (e.params || []).find((x) => x.algId === algId);
    return p && p.default != null ? p.default : null;
  }

  function renderSettings() {
    const box = $("#ps-params");
    box.innerHTML = "";
    const st = { ...S.patch.settings, ...(S.extra.settings || {}) };
    const upd = (key) => (v) => {
      S.extra.settings = { patch_vol: st.patch_vol, bpm: st.bpm, ...(S.extra.settings || {}), [key]: v };
      setDirty(true);
    };
    box.append(
      UI.slider({ name: "Volumen", value: st.patch_vol, min: 0, max: 100, step: 1, onInput: upd("patch_vol") }),
      UI.slider({ name: "BPM", value: st.bpm, min: 40, max: 300, step: 1, onInput: upd("bpm") }),
    );
  }

  async function openPicker() {
    const b = S.patch.blocks[S.sel];
    const models = S.lib.modelsForBlock(b.block, snaptoneList());
    const fxid = await UI.pickModel({ models, current: b.fxid });
    if (fxid == null || fxid === b.fxid) return;
    await setModel(S.sel, fxid);
  }
  function snaptoneList() {
    return Object.entries(S.bankMap.snaptone).map(([slot, name]) => ({ slot: Number(slot), name }))
      .sort((a, z) => a.slot - z.slot);
  }

  // ----------------------------------------------------------- pedal sync
  // When you turn a knob or switch presets on the pedal itself it sends MIDI;
  // re-read so the screen follows (ignoring the echo of our own traffic).
  let syncTimer = null;
  D.onIdleMessage(() => {
    if (!S.patch || S.busy || performance.now() - S.lastIo < 1200) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncFromPedal, 450);
  });
  async function syncFromPedal() {
    if (S.busy || pumping) return;
    try {
      await busy(async () => {
        const slot = await readCurrentSlot();
        if (slot !== S.slot) {
          S.slot = slot;
          renderPresetList();
          await loadActive({ fresh: true });
        } else {
          await loadActive();
        }
      });
    } catch (e) { console.warn("sync", e); }
  }
  async function refresh() {
    await flushParams();
    try {
      await busy(async () => {
        S.names = await io(() => D.readNames());
        await syncBanks();
        const slot = await readCurrentSlot();
        const changed = slot !== S.slot;
        S.slot = slot;
        await loadActive({ fresh: changed || !S.dirty });
      });
      renderPresetList();
      toast("Leído del pedal", "ok", 1800);
    } catch (e) { toast(`No se pudo leer: ${e.message}`, "err"); }
  }

  D.onStateChange(() => {
    setConn("off", "Desconectado");
    enableUi(false);
    toast("El pedal se desconectó", "err");
    $("#workspace").hidden = true;
    $("#welcome").hidden = false;
    $("#welcome-msg").textContent = "Se perdió la conexión. Vuelve a conectar el cable USB.";
    $("#btn-connect").disabled = false;
    S.patch = null;
    setDirty(false);
    watchForPedal();
  });
  // Auto-connect when the pedal appears (plugged in after the app started).
  let watching = null;
  function watchForPedal() {
    if (watching) return;
    watching = setInterval(async () => {
      if (D.isConnected() || S.busy) return;
      try {
        const acc = await navigator.requestMIDIAccess({ sysex: true });
        const found = [...acc.inputs.values()].some((p) => /GP-5/.test(p.name || ""));
        if (found) { clearInterval(watching); watching = null; connect(); }
      } catch { /* keep watching */ }
    }, 2500);
  }

  function showShortcuts() {
    const rows = [
      ["↑ / ↓", "Preset anterior / siguiente"],
      ["1 … 0", "Seleccionar bloque por posición"],
      ["Espacio", "Encender / apagar el bloque"],
      ["Enter", "Cambiar el modelo del bloque"],
      ["Ctrl+Z", "Deshacer el último cambio"],
      ["Ctrl+S", "Guardar en el pedal"],
      ["F5", "Volver a leer del pedal"],
      ["Rueda sobre una barra", "Ajuste fino (Shift = ×10)"],
      ["Doble clic en una barra", "Volver al valor de fábrica"],
      ["Clic en el número", "Escribir el valor exacto"],
      ["Arrastrar .prst a la ventana", "Subir presets"],
      ["?", "Esta ayuda"],
    ];
    UI.modal({
      title: "Atajos de teclado",
      body: `<table class="keys">${rows.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join("")}</table>`,
      buttons: [{ label: "Cerrar", value: true, kind: "primary" }],
    });
  }

  // Drop .prst files anywhere to upload them.
  let dragDepth = 0;
  const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  document.addEventListener("dragenter", (e) => { if (!isFileDrag(e)) return; e.preventDefault(); dragDepth++; $("#drop").hidden = false; });
  document.addEventListener("dragover", (e) => { if (isFileDrag(e)) e.preventDefault(); });
  document.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; $("#drop").hidden = true; } });
  document.addEventListener("drop", async (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    $("#drop").hidden = true;
    const files = [...e.dataTransfer.files].filter((f) => /\.prst$/i.test(f.name));
    if (!files.length) { toast("Solo se pueden soltar archivos .prst", "warn"); return; }
    const items = await Promise.all(files.map(async (f) => ({ file: f.name, name: f.name, bytes: Array.from(new Uint8Array(await f.arrayBuffer())) })));
    importPrst(items);
  });

  // In a browser tab, closing with unsaved live edits deserves a warning.
  window.addEventListener("beforeunload", (e) => {
    if (S.dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  // ------------------------------------------------------------- wiring
  $("#btn-help").onclick = showShortcuts;
  $("#btn-connect").onclick = connect;
  $("#btn-save").onclick = save;
  $("#btn-discard").onclick = discard;
  $("#btn-backup").onclick = backupAll;
  $("#btn-open-backups").onclick = () => window.store.openBackupFolder();
  $("#btn-export").onclick = exportPrst;
  $("#btn-import").onclick = importPrst;
  $("#btn-refresh").onclick = refresh;
  $("#btn-prev").onclick = () => selectPreset(S.slot - 1);
  $("#btn-next").onclick = () => selectPreset(S.slot + 1);
  $("#model-btn").onclick = openPicker;
  $("#block-on").onchange = (e) => setBlockOn(S.sel, e.target.checked);
  $("#search").oninput = renderPresetList;
  $("#patch-name").addEventListener("input", (e) => {
    const v = e.target.value.replace(/[^\x20-\x7e]/g, "");
    if (v !== e.target.value) e.target.value = v;
    S.extra.name = v;
    setDirty(true);
  });
  $("#patch-name").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
    if (e.ctrlKey && e.key.toLowerCase() === "z" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); undo(); return; }
    if ((e.key === "?" || e.key === "F1") && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); showShortcuts(); return; }
    if (e.key === "F5") { e.preventDefault(); if (D.isConnected()) refresh(); return; }
    const tag = document.activeElement?.tagName;
    const typing = tag === "INPUT" || document.activeElement?.classList.contains("pslider");
    if (typing || !S.patch || !$("#modal").hidden || !$("#picker").hidden) return;
    if (e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); selectPreset(S.slot - 1); }
    else if (e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); selectPreset(S.slot + 1); }
    else if (/^[0-9]$/.test(e.key)) {
      const order = S.extra.order || S.patch.order;
      const pos = (Number(e.key) + 9) % 10;
      S.sel = order[pos];
      renderChain();
      renderEditor();
    } else if (e.key === " ") { e.preventDefault(); setBlockOn(S.sel, !S.patch.blocks[S.sel].active); }
    else if (e.key === "Enter") { e.preventDefault(); openPicker(); }
  });

  // Surface for ui/ai_panel.js.
  window.GP5App = {
    state: S,
    connected: () => D.isConnected() && !!S.patch,
    slotOptions, decode, shortModel, nameOf, isEmptyName, pad2,
    // Layout the AI result is written into: the loaded preset (same device
    // format; name, models, params, on/off and volume are all replaced).
    templateFor: () => S.stored,
    writeWarning,
    lastWrite: () => lastWrite,
    audition: async (bytes) => { await flushParams(); await auditionPrst(bytes); },
    writePresets: async (plan, opts) => { await flushParams(); await writePresets(plan, opts); },
  };

  Icons.hydrate();
  connect();
})();
