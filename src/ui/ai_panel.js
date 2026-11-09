"use strict";
/*
 * ai_panel.js — the "Crear con IA" panel: pick an AI provider (ai_providers.js),
 * ask for a song, let the model design a preset (ai.js), preview it on the
 * board, then listen (live, nothing stored), refine it, or write it over a
 * preset of your choice. Talks to the app through window.GP5App (app.js).
 */
(() => {
  const UI = window.Controls;
  const { h, escapeHtml: esc } = UI;
  const $ = (s) => document.querySelector(s);
  const AI = window.AIPreset;
  const PV = window.AIProviders;

  let session = null; // { request, history, result, bytes, warnings, name, provider, model }
  let aborter = null;

  const App = () => window.GP5App;
  const current = () => ({ id: PV.settings.provider(), p: PV.byId[PV.settings.provider()], cfg: PV.settings.get(PV.settings.provider()) });
  const ready = () => { const { p, cfg } = current(); return (!p.needsKey || !!cfg.key) && !!cfg.model; };

  // ---- provider settings ------------------------------------------------------
  function renderProviderSummary() {
    const { p, cfg } = current();
    $("#ai-prov-text").textContent = `${p.label} · ${cfg.model || "sin modelo elegido"}`;
    $("#ai-footer-model").textContent = `${p.label.replace(/ \(.*\)$/, "")} · ${cfg.model || "—"}`;
  }

  function fillProviderForm(id) {
    const p = PV.byId[id];
    const cfg = PV.settings.get(id);
    $("#ai-prov").value = id;
    $("#ai-prov-hint").textContent = p.keyHint || "";
    $("#ai-key-field").hidden = !p.needsKey;
    $("#ai-key").value = cfg.key;
    $("#ai-base-field").hidden = !p.editableBase;
    $("#ai-base").value = cfg.base || p.defaultBase || "";
    const sel = $("#ai-model");
    sel.innerHTML = cfg.model ? `<option value="${esc(cfg.model)}">${esc(cfg.model)}</option>` : `<option value="">Pulsa «Guardar y cargar modelos»</option>`;
    $("#ai-prov-status").textContent = "";
  }

  function openProviderForm(open) {
    $("#ai-prov-form").hidden = !open;
    $("#ai-prov-summary").hidden = open;
    if (open) fillProviderForm(PV.settings.provider());
  }

  async function saveProvider() {
    const id = $("#ai-prov").value;
    const p = PV.byId[id];
    const key = $("#ai-key").value.trim();
    if (p.needsKey && !key) { UI.toast("Escribe la clave de API", "warn"); $("#ai-key").focus(); return; }
    if (p.keyPattern && key && !p.keyPattern.test(key)) {
      const go = await UI.modal({ title: "¿Seguro que es la clave correcta?", body: `<p>No tiene el formato habitual de ${esc(p.label)}. ¿Guardarla igualmente?</p>`, buttons: [{ label: "Revisar", value: false }, { label: "Guardar", value: true, kind: "primary" }] });
      if (!go) return;
    }
    PV.settings.set(id, { key, base: p.editableBase ? $("#ai-base").value.trim() : "" });
    PV.settings.setProvider(id);
    const btn = $("#ai-prov-save");
    btn.disabled = true;
    $("#ai-prov-status").textContent = "Cargando modelos…";
    try {
      const cfg = PV.settings.get(id);
      const models = await p.listModels(cfg);
      if (!models.length) throw new Error(id === "ollama" ? "Ollama no tiene modelos. Descarga uno, p. ej.: ollama pull qwen3" : "El proveedor no devolvió modelos.");
      const keep = models.find((m) => m.id === cfg.model);
      const chosen = keep ? cfg.model : (p.defaultModel && models.find((m) => m.id === p.defaultModel) ? p.defaultModel : (p.pickDefault ? p.pickDefault(models) : models[0].id));
      $("#ai-model").innerHTML = models.map((m) => `<option value="${esc(m.id)}"${m.id === chosen ? " selected" : ""}>${esc(m.label)}</option>`).join("");
      PV.settings.set(id, { model: chosen });
      $("#ai-prov-status").textContent = `${models.length} modelos disponibles`;
      renderProviderSummary();
      UI.toast(`${p.label}: listo (${chosen})`, "ok", 3000);
    } catch (e) {
      const st = e.status;
      $("#ai-prov-status").textContent = st === 401 || st === 403 ? "La clave no es válida." : (e.message || "No se pudo conectar");
      if (id === "ollama" && !st) $("#ai-prov-status").textContent = "No se encontró Ollama. ¿Está instalado y abierto?";
    } finally { btn.disabled = false; }
  }

  // ---- views --------------------------------------------------------------------
  function open() {
    const app = App();
    if (!app.connected()) { UI.toast("Conecta el pedal primero", "warn"); return; }
    $("#ai").hidden = false;
    renderProviderSummary();
    openProviderForm(!ready());
    $("#ai-slot").innerHTML = app.slotOptions(app.state.slot);
    $("#ai-slot-res").innerHTML = $("#ai-slot").innerHTML;
    if (!session) showForm();
    else showResult();
    setTimeout(() => (ready() ? $("#ai-song") : ($("#ai-key-field").hidden ? $("#ai-prov-save") : $("#ai-key"))).focus(), 30);
  }
  function close() {
    if (aborter) return; // cancel the running request first
    $("#ai").hidden = true;
  }

  function showForm() {
    $("#ai-form").hidden = false;
    $("#ai-busy").hidden = true;
    $("#ai-result").hidden = true;
  }
  function showBusy(text) {
    $("#ai-form").hidden = true;
    $("#ai-result").hidden = true;
    $("#ai-busy").hidden = false;
    $("#ai-busy-text").textContent = text;
    $("#ai-busy-count").textContent = "";
  }
  const BLOCK_TITLE = {
    NR: "Reducción de ruido", PRE: "Pre-efectos", DST: "Distorsión / Overdrive", AMP: "Amplificador", CAB: "Gabinete / IR",
    EQ: "Ecualizador", MOD: "Modulación", DLY: "Delay", RVB: "Reverb", "N->S": "SnapTone",
  };
  const fmtTime = (ms) => ms >= 60000 ? `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s` : `${Math.round(ms / 1000)} s`;

  // One parameter as a small meter (or an On/Off pill for switches).
  function paramChip(p) {
    if (p.toggle) {
      const on = Math.round(p.value) !== 0;
      return `<span class="ai-param tog${on ? " on" : ""}"><span class="ai-param-name">${esc(p.name)}</span><b>${on ? "On" : "Off"}</b></span>`;
    }
    const span = (p.max - p.min) || 1;
    const f = Math.min(1, Math.max(0, (p.value - p.min) / span));
    return `<span class="ai-param" style="--v:${f.toFixed(3)}"><span class="ai-param-name">${esc(p.name)}</span><b>${esc(p.display)}</b><span class="ai-param-bar"></span></span>`;
  }

  function showResult() {
    const app = App();
    const s = session;
    const res = AI.normalize(s.result);
    $("#ai-form").hidden = true;
    $("#ai-busy").hidden = true;
    $("#ai-result").hidden = false;
    $("#ai-res-name").textContent = s.name;
    $("#ai-res-song").textContent = s.request.song;
    $("#ai-res-summary").textContent = res.summary || "";

    const view = app.decode(s.bytes);
    const settings = view.settings || {};
    const meta = [
      ["IA", `${PV.byId[s.provider].label.replace(/ \(.*\)$/, "")} · ${s.model}`],
      s.elapsed ? ["Tiempo", fmtTime(s.elapsed)] : null,
      ["Pastillas", s.request.pickups],
      Number(res.bpm) >= 40 ? ["Tempo", `${Math.round(res.bpm)} BPM`] : null,
      ["Volumen del preset", settings.patch_vol],
      s.refinements ? ["Ajustes", s.refinements] : null,
    ].filter(Boolean);
    $("#ai-res-meta").innerHTML = meta.map(([k, v]) => `<span>${esc(k)}: <b>${esc(v)}</b></span>`).join("");
    const note = (id, text) => { $(`#${id}`).hidden = !text; $(`#${id}-text`).textContent = text || ""; };
    note("ai-gear", res.original_gear);
    note("ai-tips", res.playing_tips);

    const order = view.order || view.blocks.map((_, i) => i);
    const whyOf = (b) => res.blocks.find((x) => x.block === (b.block === "N->S" ? "NS" : b.block));

    // Detail card per active block, in signal order; bypassed ones listed after.
    const box = $("#ai-blocks");
    box.innerHTML = "";
    const cards = {};
    const off = [];
    for (const k of order) {
      const b = view.blocks[k];
      if (!b.active) { off.push(`${b.block === "N->S" ? "N→S" : b.block} (${app.shortModel(b)})`); continue; }
      const why = whyOf(b);
      const card = h("div", "ai-block");
      const badge = h("div", "badge");
      window.Pedals.badge(badge, b);
      const body = h("div");
      const origin = b.official && b.official !== b.model ? b.official : (b.type || "");
      body.innerHTML = `<div class="ai-block-head"><span class="ai-block-name">${esc(app.shortModel(b))}</span>
          <span class="ai-block-origin">${esc(BLOCK_TITLE[b.block] || b.block)}${origin ? " · " + esc(origin) : ""}</span></div>
        ${why && why.why ? `<p class="ai-block-why">${esc(why.why)}</p>` : ""}
        <div class="ai-params">${b.params.map(paramChip).join("")}</div>`;
      card.append(badge, body);
      box.append(card);
      cards[k] = card;
    }
    if (off.length) box.append(h("div", "ai-off", `Apagados: ${off.join(" · ")}`));

    // Board preview; clicking a unit jumps to its card.
    const board = $("#ai-board");
    board.innerHTML = "";
    for (const k of order) {
      const b = view.blocks[k];
      const why = whyOf(b);
      const u = window.Pedals.unit({ ...b, model: app.shortModel(b) }, {
        onSelect: () => {
          const c = cards[k];
          if (!c) return;
          c.scrollIntoView({ behavior: "smooth", block: "center" });
          c.classList.add("flash");
          setTimeout(() => c.classList.remove("flash"), 1200);
        },
      });
      u.classList.add("mini");
      u.title = `${b.block} · ${app.shortModel(b)}${why && why.why ? " — " + why.why : ""}`;
      board.append(u);
    }

    const warn = $("#ai-warn");
    warn.hidden = !s.warnings.length;
    warn.innerHTML = s.warnings.length ? `${Icons.svg("exclamation-triangle")}<span>${s.warnings.map(esc).join("<br>")}</span>` : "";
    $("#ai-refine").value = "";
    $("#ai-slot-res").value = $("#ai-slot").value;
  }

  // ---- generate -------------------------------------------------------------------
  function explain(p, e) {
    const known = p.explainError && p.explainError(e);
    if (known) return known;
    if (e.name === "AbortError") return { msg: "Cancelado.", cancelled: true };
    if (e.status === 401 || e.status === 403) return { msg: "La clave de API no es válida o no tiene acceso a este modelo.", badKey: true };
    if (AI.isDailyQuota(e)) return { msg: "Se acabó el cupo diario gratuito de este modelo. Prueba con otro modelo o vuelve mañana.", overloaded: true };
    if (e.status === 429) return { msg: "Límite de uso por minuto alcanzado, incluso tras reintentar.", overloaded: true };
    if (AI.TRANSIENT.has(e.status)) return { msg: `El modelo está saturado en este momento (error ${e.status} del proveedor), incluso tras reintentar.`, overloaded: true };
    if (e.status === 404) return { msg: "El modelo elegido ya no existe. Recarga la lista de modelos." };
    return { msg: e.message || String(e) };
  }

  // When a model stays overloaded, offer another one from the same provider
  // for this request only (the saved default doesn't change).
  async function offerOtherModel(p, cfg, again) {
    let models = [];
    try { models = (await p.listModels(cfg)).filter((m) => m.id !== cfg.model); } catch { return; }
    if (!models.length) return;
    const pick = (p.pickDefault ? p.pickDefault(models) : models[0].id) || models[0].id;
    const choice = await UI.modal({
      title: "¿Probar con otro modelo?",
      body: `<p><b>${esc(cfg.model)}</b> no responde ahora mismo. Puedes intentarlo con otro modelo de ${esc(p.label.replace(/ \(.*\)$/, ""))}:</p>
        <label class="field"><span>Modelo</span><select id="ai-alt-model">${models.map((m) => `<option value="${esc(m.id)}"${m.id === pick ? " selected" : ""}>${esc(m.label)}</option>`).join("")}</select></label>
        <label class="ai-check"><input id="ai-alt-save" type="checkbox"> Usarlo como predeterminado</label>`,
      buttons: [{ label: "Ahora no", value: false }, { label: "Probar con este modelo", value: true, kind: "primary" }],
    });
    if (!choice) return;
    const model = $("#ai-alt-model").value;
    if ($("#ai-alt-save").checked) { PV.settings.set(PV.settings.provider(), { model }); renderProviderSummary(); }
    again(model);
  }

  // No credit on a paid account: point to the free option in one click.
  async function offerFreeProvider() {
    const go = await UI.modal({
      title: "Sin saldo en la API de Anthropic",
      body: `<p>Tu clave funciona, pero la cuenta no tiene créditos. La API de Anthropic se paga aparte de la suscripción a Claude.ai.</p>
        <p>Puedes recargar en <b>console.anthropic.com → Plans &amp; Billing</b>, o usar <b>Google Gemini</b>, que tiene un nivel gratuito (clave en aistudio.google.com).</p>`,
      buttons: [{ label: "Cerrar", value: false }, { label: "Configurar Gemini (gratis)", value: true, kind: "primary" }],
    });
    if (!go) return;
    openProviderForm(true);
    fillProviderForm("gemini");
    $("#ai-key").focus();
  }

  async function run({ refine, model } = {}) {
    const app = App();
    const { id, p } = current();
    const cfg = { ...current().cfg, ...(model ? { model } : {}) };
    if (!ready()) { UI.toast("Configura primero el proveedor de IA", "warn"); openProviderForm(true); return; }
    const request = refine ? session.request : {
      song: $("#ai-song").value.trim(),
      pickups: $("#ai-pickups").value,
      notes: $("#ai-notes").value.trim(),
    };
    if (!request.song) { UI.toast("Escribe una canción, artista o sonido", "warn"); $("#ai-song").focus(); return; }
    showBusy(refine ? "Ajustando el preset…" : `Diseñando «${request.song}»…`);
    $("#ai-busy-model").textContent = `${p.label.replace(/ \(.*\)$/, "")} · ${cfg.model}`;
    aborter = new AbortController();
    const t0 = Date.now();
    let chars = 0;
    const timer = setInterval(() => {
      const s = Math.round((Date.now() - t0) / 1000);
      $("#ai-busy-count").textContent = chars ? `${s} s · ${chars} caracteres recibidos` : `${s} s`;
    }, 500);
    // Not every transport can be interrupted mid-request (e.g. the local
    // proxy), so Cancel also stops waiting on our side.
    const cancelled = new Promise((_, reject) => aborter.signal.addEventListener("abort", () => reject(Object.assign(new Error("Cancelado."), { name: "AbortError" }))));
    try {
      const st = app.state;
      const { result, history } = await Promise.race([
        AI.generate({
          provider: id, cfg, ring: st.ring, bankMap: st.bankMap, request,
          refine, history: refine ? session.history : null, signal: aborter.signal,
          onProgress: (n) => { chars = n; },
          onRetry: (n, max, wait, err) => {
            $("#ai-busy-text").textContent = `${err.status === 429 ? "Límite por minuto" : "Modelo saturado"}: reintentando (${n}/${max}) en ${Math.round(wait / 1000)} s…`;
          },
        }),
        cancelled,
      ]);
      const base = app.templateFor(Number($("#ai-slot").value));
      const { bytes, warnings, name } = AI.toPrst(base, result, st.ring, st.bankMap);
      session = {
        request, history, result, bytes, warnings, name, provider: id, model: cfg.model,
        elapsed: Date.now() - t0,
        refinements: refine ? (session.refinements || 0) + 1 : 0,
      };
      showResult();
    } catch (e) {
      const x = explain(p, e);
      if (x.badKey) openProviderForm(true);
      UI.toast(x.msg, x.cancelled ? "info" : "err", 9000);
      if (session) showResult(); else showForm();
      if (x.overloaded) setTimeout(() => offerOtherModel(p, cfg, (m) => run({ refine, model: m })), 0);
      if (x.noCredit) setTimeout(() => offerFreeProvider(), 0);
    } finally {
      clearInterval(timer);
      aborter = null;
    }
  }

  async function listen() {
    const app = App();
    $("#ai").hidden = true;
    await app.audition(session.bytes);
    UI.toast(`«${session.name}» cargado en el pedal (sin guardar). Pulsa «Guardar en el pedal» para conservarlo.`, "ok", 7000);
  }

  async function save() {
    const app = App();
    const slot = Number($("#ai-slot").value);
    const target = app.nameOf(slot);
    if (!app.isEmptyName(target)) {
      const ok = await UI.modal({
        title: "Reemplazar preset",
        body: `<p>Se reemplazará <b>${esc(app.pad2(slot))} · ${esc(target)}</b> por <b>${esc(session.name)}</b>. Antes se guarda una copia del original.</p>${app.writeWarning()}`,
        buttons: [{ label: "Cancelar", value: false }, { label: "Reemplazar", value: true, kind: "danger" }],
      });
      if (!ok) return;
    }
    $("#ai").hidden = true;
    await app.writePresets([{ slot, name: session.name, bytes: session.bytes }], { skipDirtyCheck: true });
  }

  // ---- wiring ----------------------------------------------------------------------
  $("#ai-prov").innerHTML = PV.LIST.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join("");
  $("#btn-ai").onclick = open;
  $("#ai-close").onclick = close;
  $("#ai").addEventListener("click", (e) => { if (e.target.id === "ai") close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#ai").hidden && $("#modal").hidden) close(); });
  $("#ai-prov-edit").onclick = () => openProviderForm(true);
  $("#ai-prov-cancel").onclick = () => openProviderForm(!ready());
  $("#ai-prov").onchange = () => fillProviderForm($("#ai-prov").value);
  $("#ai-prov-save").onclick = saveProvider;
  $("#ai-key").addEventListener("keydown", (e) => { if (e.key === "Enter") saveProvider(); });
  $("#ai-model").onchange = () => {
    const id = $("#ai-prov").value;
    PV.settings.set(id, { model: $("#ai-model").value });
    if (id === PV.settings.provider()) renderProviderSummary();
  };
  $("#ai-go").onclick = () => run();
  document.querySelectorAll(".ai-chip[data-song]").forEach((b) => {
    b.onclick = () => { $("#ai-song").value = b.dataset.song; $("#ai-song").focus(); };
  });
  $("#ai-song").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  $("#ai-cancel").onclick = () => { if (aborter) aborter.abort(); };
  $("#ai-listen").onclick = listen;
  $("#ai-save").onclick = save;
  $("#ai-new").onclick = () => { session = null; showForm(); $("#ai-song").select(); };
  $("#ai-refine-go").onclick = () => {
    const r = $("#ai-refine").value.trim();
    if (!r) { $("#ai-refine").focus(); return; }
    run({ refine: r });
  };
  $("#ai-refine").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#ai-refine-go").click(); });
  // The target slot can be picked in the form or next to the Save button.
  const syncSlot = (from, to) => $(from).addEventListener("change", () => { $(to).value = $(from).value; });
  syncSlot("#ai-slot", "#ai-slot-res");
  syncSlot("#ai-slot-res", "#ai-slot");
})();
