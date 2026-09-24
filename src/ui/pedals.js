"use strict";
/*
 * pedals.js — draws each block of the chain as the hardware it models:
 * stompboxes for NR/PRE/DST/MOD/DLY/RVB, an amp head, a speaker cabinet, a
 * graphic EQ and a capture unit for N→S. Knob pointers and fader positions
 * follow the block's real parameter values, so the board reads at a glance.
 * Exposes window.Pedals.
 */
(() => {
  const { h } = window.Controls;

  // Enclosure colors: [light, dark] ends of the paint gradient.
  const PAINT = {
    NR: ["#c9ccd1", "#8e9299"],
    PRE: ["#b388ff", "#7446d6"],
    DST: ["#ff7a7a", "#c73a44"],
    AMP: ["#e9c27a", "#b98b3c"],
    CAB: ["#6b5a48", "#3d3228"],
    EQ: ["#e7d3ad", "#b89f73"],
    MOD: ["#5fd6e6", "#1f9fb3"],
    DLY: ["#ff85b3", "#cf4a7f"],
    RVB: ["#9fb4d1", "#63789a"],
    "N->S": ["#9d8cff", "#5b48d6"],
  };
  const ABBR = { "N->S": "N→S" };
  const KIND = { AMP: "amp", CAB: "cab", EQ: "eq", "N->S": "capture" };

  const norm = (p) => {
    const span = (p.max ?? 100) - (p.min ?? 0) || 1;
    return Math.min(1, Math.max(0, (p.value - (p.min ?? 0)) / span));
  };
  const knobParams = (b, n) => b.params.filter((p) => !p.toggle).slice(0, n);

  // A knob whose pointer sweeps -135°..135° across the parameter range.
  function knob(p, cls = "") {
    const k = h("span", "knob " + cls);
    const angle = p ? -135 + norm(p) * 270 : 0;
    k.style.setProperty("--a", `${angle}deg`);
    if (p) k.title = `${p.name}: ${p.display}`;
    return k;
  }
  const led = () => h("span", "led");

  function stomp(b) {
    const u = h("div", "enc");
    const knobs = h("div", "knobs");
    const ps = knobParams(b, 3);
    (ps.length ? ps : [null]).forEach((p) => knobs.append(knob(p)));
    const plate = h("div", "plate", ABBR[b.block] || b.block);
    const model = h("div", "model", b.model || "—");
    const fs = h("div", "footswitch");
    u.append(led(), knobs, plate, model, fs);
    return u;
  }

  function amp(b) {
    const u = h("div", "enc");
    u.append(h("div", "handle"));
    const panel = h("div", "panel");
    const ks = h("div", "knobs");
    knobParams(b, 4).forEach((p) => ks.append(knob(p, "sm")));
    panel.append(ks, h("span", "jewel"));
    const grille = h("div", "grille");
    const badge = h("div", "badge-logo", b.model || "AMP");
    grille.append(badge);
    u.append(panel, grille, h("div", "plate", "AMP"));
    return u;
  }

  function cab(b) {
    const u = h("div", "enc");
    const grille = h("div", "grille");
    grille.append(h("span", "cone"));
    u.append(grille, h("div", "plate", "CAB"), h("div", "model", b.model || "—"));
    return u;
  }

  function eq(b) {
    const u = h("div", "enc");
    const bank = h("div", "faders");
    const bands = b.params.filter((p) => !p.toggle && !/^vol/i.test(p.name)).slice(0, 6);
    for (const p of bands) {
      const f = h("span", "fader");
      f.style.setProperty("--v", norm(p));
      f.title = `${p.name}: ${p.display}`;
      f.append(h("span", "cap"));
      bank.append(f);
    }
    u.append(led(), bank, h("div", "plate", "EQ"), h("div", "model", b.model || "—"));
    return u;
  }

  function capture(b) {
    const u = h("div", "enc");
    const screen = h("div", "screen");
    screen.innerHTML = `<svg viewBox="0 0 60 20" preserveAspectRatio="none" aria-hidden="true"><path d="M0 10 Q5 1 10 10 T20 10 T30 10 T40 10 T50 10 T60 10" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
    u.append(led(), screen, h("div", "plate", "N→S"), h("div", "model", b.model || "Sin captura"));
    return u;
  }

  // One unit of the board. opts: {selected, keyHint, onSelect, onToggle}
  function unit(b, opts = {}) {
    const kind = KIND[b.block] || "stomp";
    const el = h("div", `unit ${kind}` + (b.active ? "" : " off") + (opts.selected ? " sel" : ""));
    const [c1, c2] = PAINT[b.block] || ["#888", "#555"];
    el.style.setProperty("--c1", c1);
    el.style.setProperty("--c2", c2);
    el.tabIndex = -1;
    const body = { amp, cab, eq, capture, stomp }[kind](b);
    el.append(body);
    if (opts.keyHint != null) el.append(h("span", "keyhint", String(opts.keyHint)));
    // The LED / footswitch toggle the block; anywhere else selects it.
    body.querySelectorAll(".led, .footswitch, .jewel").forEach((t) => {
      t.title = b.active ? "Apagar" : "Encender";
      t.addEventListener("click", (e) => { e.stopPropagation(); opts.onToggle && opts.onToggle(); });
    });
    el.addEventListener("click", () => opts.onSelect && opts.onSelect());
    el.addEventListener("dblclick", (e) => {
      if (e.target.closest(".led, .footswitch, .jewel")) return;
      opts.onToggle && opts.onToggle();
    });
    return el;
  }

  // Small colored badge for the editor header.
  function badge(el, b) {
    const [c1, c2] = PAINT[b.block] || ["#888", "#555"];
    el.style.setProperty("--c1", c1);
    el.style.setProperty("--c2", c2);
    el.textContent = ABBR[b.block] || b.block;
    el.classList.toggle("dark-text", ["NR", "AMP", "EQ", "MOD", "RVB"].includes(b.block));
  }

  window.Pedals = { unit, badge, PAINT };
})();
