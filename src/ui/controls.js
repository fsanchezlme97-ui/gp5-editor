"use strict";
/*
 * controls.js — small UI kit: bar slider, switch row, toast, modal, model picker.
 * Exposes window.Controls. No device knowledge here.
 */
(() => {
  const h = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const decimalsFor = (step) => {
    if (!step || step >= 1) return 0;
    return Math.min(3, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
  };
  const quantize = (v, min, max, step) => {
    const s = step > 0 ? step : 1;
    const q = Math.round((v - min) / s) * s + min;
    return Math.min(max, Math.max(min, Number(q.toFixed(6))));
  };

  // Horizontal bar slider like the mobile app. Drag, wheel (Shift = x10),
  // arrow keys, Home/End, double-click the value to type it.
  // opts: {name, value, min, max, step, unit, onInput(v), onCommit(v)}
  function slider(opts) {
    const { name, min = 0, max = 100, unit = "" } = opts;
    const step = opts.step > 0 ? opts.step : 1;
    const dec = decimalsFor(step);
    let value = quantize(Number(opts.value) || 0, min, max, step);

    const el = h("div", "pslider");
    el.tabIndex = 0;
    el.setAttribute("role", "slider");
    el.setAttribute("aria-label", name);
    el.setAttribute("aria-valuemin", min);
    el.setAttribute("aria-valuemax", max);
    const fill = h("div", "fill");
    const lbl = h("span", "lbl", name);
    const val = h("span", "val");
    el.append(fill);
    const bipolar = min < 0 && max > 0;
    let zero = null;
    if (bipolar) {
      el.classList.add("bipolar");
      zero = h("div", "zero");
      zero.style.left = `${((0 - min) / (max - min)) * 100}%`;
      el.append(zero);
    }
    el.append(lbl, val);

    const fmt = (v) => `${v.toFixed(dec)}${unit ? " " + unit : ""}`;
    function paint() {
      const f = (value - min) / (max - min || 1);
      if (bipolar) {
        const z = (0 - min) / (max - min);
        fill.style.left = `${Math.min(f, z) * 100}%`;
        fill.style.width = `${Math.abs(f - z) * 100}%`;
      } else {
        fill.style.left = "0";
        fill.style.width = `${f * 100}%`;
      }
      val.textContent = fmt(value);
      el.setAttribute("aria-valuenow", value);
    }
    function set(v, commit) {
      const nv = quantize(v, min, max, step);
      if (nv === value && !commit) return;
      const changed = nv !== value;
      value = nv;
      paint();
      if (changed && opts.onInput) opts.onInput(value);
      if (commit && opts.onCommit) opts.onCommit(value);
    }

    // Drag: relative to the grab point so a click doesn't jump unexpectedly far.
    let drag = null;
    el.addEventListener("pointerdown", (e) => {
      if (e.target === val || e.target.tagName === "INPUT" || e.button !== 0) return;
      el.focus();
      el.setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect();
      const f = (e.clientX - r.left) / r.width;
      set(min + f * (max - min));
      drag = { id: e.pointerId };
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const r = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      set(min + f * (max - min));
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      drag = null;
      set(value, true);
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);

    let wheelTimer = null;
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      set(value + dir * step * (e.shiftKey ? 10 : 1));
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => set(value, true), 250);
    }, { passive: false });

    el.addEventListener("keydown", (e) => {
      let nv = null;
      const big = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") nv = value + step * big;
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") nv = value - step * big;
      else if (e.key === "PageUp") nv = value + step * 10;
      else if (e.key === "PageDown") nv = value - step * 10;
      else if (e.key === "Home") nv = min;
      else if (e.key === "End") nv = max;
      else if (e.key === "Enter") { startEdit(); e.preventDefault(); return; }
      if (nv == null) return;
      e.preventDefault();
      e.stopPropagation();
      set(nv, true);
    });

    function startEdit() {
      if (el.querySelector("input")) return;
      const inp = h("input", "val-edit");
      inp.type = "number";
      inp.step = String(step);
      inp.min = String(min);
      inp.max = String(max);
      inp.value = value.toFixed(dec);
      val.style.visibility = "hidden";
      el.append(inp);
      inp.focus();
      inp.select();
      let done = false;
      const finish = (apply) => {
        if (done) return;
        done = true;
        const v = Number(inp.value);
        inp.remove();
        val.style.visibility = "";
        el.focus();
        if (apply && Number.isFinite(v)) set(v, true);
      };
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      });
      inp.addEventListener("blur", () => finish(true));
    }
    val.addEventListener("dblclick", (e) => e.stopPropagation());
    val.addEventListener("click", startEdit);
    if (opts.defaultValue != null) {
      el.title = `Doble clic: valor de fábrica (${Number(opts.defaultValue).toFixed(dec)}${unit ? " " + unit : ""})`;
      el.addEventListener("dblclick", (e) => {
        if (e.target === val || e.target.tagName === "INPUT") return;
        set(opts.defaultValue, true);
      });
    }

    paint();
    el.getValue = () => value;
    el.setValue = (v) => { value = quantize(v, min, max, step); paint(); };
    return el;
  }

  function switchInput(checked, onChange, big) {
    const lab = h("label", "switch" + (big ? " big" : ""));
    const inp = h("input");
    inp.type = "checkbox";
    inp.checked = !!checked;
    const tr = h("span", "track");
    tr.append(h("span", "thumb"));
    lab.append(inp, tr);
    inp.addEventListener("change", () => onChange(inp.checked));
    lab.input = inp;
    return lab;
  }

  function toggleRow(name, checked, onChange) {
    const row = h("div", "ptoggle");
    row.append(h("span", null, name), switchInput(checked, onChange));
    return row;
  }

  const TOAST_ICON = { ok: "check-circle", err: "x-circle", warn: "exclamation-triangle", info: "information-circle" };
  function toast(msg, kind = "info", ms = 4200) {
    const t = h("div", "toast " + kind);
    t.innerHTML = window.Icons ? window.Icons.svg(TOAST_ICON[kind] || TOAST_ICON.info) : "";
    t.append(h("span", null, msg));
    document.getElementById("toasts").append(t);
    setTimeout(() => t.remove(), ms);
  }

  // Modal dialog. buttons: [{label, value, kind}] -> resolves with the value
  // (Esc / backdrop = null). body is trusted HTML built by the app.
  function modal({ title, body, buttons = [{ label: "Aceptar", value: true, kind: "primary" }], dismissable = true }) {
    const ov = document.getElementById("modal");
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-body").innerHTML = body || "";
    document.getElementById("modal-progress").hidden = true;
    const actions = document.getElementById("modal-actions");
    actions.innerHTML = "";
    ov.hidden = false;
    return new Promise((resolve) => {
      const close = (v) => {
        ov.hidden = true;
        ov.onclick = null;
        document.removeEventListener("keydown", onKey, true);
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === "Escape" && dismissable) { e.stopPropagation(); close(null); }
      };
      document.addEventListener("keydown", onKey, true);
      ov.onclick = (e) => { if (e.target === ov && dismissable) close(null); };
      let firstPrimary = null;
      for (const b of buttons) {
        const btn = h("button", "btn " + (b.kind || ""), b.label);
        btn.onclick = () => close(b.value);
        actions.append(btn);
        if (b.kind === "primary" && !firstPrimary) firstPrimary = btn;
      }
      (firstPrimary || actions.lastChild)?.focus();
    });
  }

  // Non-dismissable progress dialog with an optional Cancel button.
  function progress(title, body, { cancellable = false } = {}) {
    const ov = document.getElementById("modal");
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-body").innerHTML = body || "";
    document.getElementById("modal-progress").hidden = false;
    const bar = document.getElementById("modal-bar");
    const txt = document.getElementById("modal-progress-text");
    const actions = document.getElementById("modal-actions");
    actions.innerHTML = "";
    const state = { cancelled: false };
    if (cancellable) {
      const btn = h("button", "btn", "Cancelar");
      btn.onclick = () => { state.cancelled = true; btn.disabled = true; btn.textContent = "Cancelando…"; };
      actions.append(btn);
    }
    bar.style.width = "0";
    txt.textContent = "";
    ov.onclick = null;
    ov.hidden = false;
    return {
      state,
      update(frac, text) { bar.style.width = `${Math.round(frac * 100)}%`; if (text != null) txt.textContent = text; },
      close() { ov.hidden = true; },
    };
  }

  // Model picker. models: [{fxid, name, official, type}]; resolves fxid or null.
  function pickModel({ models, current }) {
    const ov = document.getElementById("picker");
    const list = document.getElementById("picker-list");
    const search = document.getElementById("picker-search");
    const closeBtn = document.getElementById("picker-close");
    search.value = "";
    ov.hidden = false;
    let items = [];
    let kb = -1;
    return new Promise((resolve) => {
      function render() {
        const q = search.value.trim().toLowerCase();
        list.innerHTML = "";
        items = [];
        const groups = new Map();
        for (const m of models) {
          const hay = `${m.name} ${m.official || ""} ${m.type || ""}`.toLowerCase();
          if (q && !hay.includes(q)) continue;
          const g = m.type || "Modelos";
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(m);
        }
        for (const [g, ms] of groups) {
          list.append(h("div", "pk-group", g));
          for (const m of ms) {
            const b = h("button", "pk-item" + (m.fxid === current ? " cur" : ""));
            b.innerHTML = `<span class="pk-name">${escapeHtml(m.name)}</span>${m.official ? `<span class="pk-origin">${escapeHtml(m.official)}</span>` : ""}`;
            b.onclick = () => close(m.fxid);
            list.append(b);
            items.push(b);
          }
        }
        if (!items.length) list.append(h("div", "empty-params", "Sin resultados"));
        kb = -1;
      }
      function mark(i) {
        items.forEach((b) => b.classList.remove("kb"));
        kb = Math.max(0, Math.min(items.length - 1, i));
        if (items[kb]) { items[kb].classList.add("kb"); items[kb].scrollIntoView({ block: "nearest" }); }
      }
      function close(v) {
        ov.hidden = true;
        search.oninput = null;
        document.removeEventListener("keydown", onKey, true);
        ov.onclick = closeBtn.onclick = null;
        resolve(v);
      }
      const onKey = (e) => {
        if (e.key === "Escape") { e.stopPropagation(); close(null); }
        else if (e.key === "ArrowDown") { e.preventDefault(); mark(kb + 1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); mark(kb - 1); }
        else if (e.key === "Enter" && items.length) { e.preventDefault(); items[kb >= 0 ? kb : 0].click(); }
      };
      document.addEventListener("keydown", onKey, true);
      ov.onclick = (e) => { if (e.target === ov) close(null); };
      closeBtn.onclick = () => close(null);
      search.oninput = render;
      render();
      search.focus();
      const cur = list.querySelector(".pk-item.cur");
      if (cur) cur.scrollIntoView({ block: "center" });
    });
  }

  window.Controls = { h, escapeHtml, slider, switchInput, toggleRow, toast, modal, progress, pickModel, quantize };
})();
