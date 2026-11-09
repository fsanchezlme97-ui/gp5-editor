"use strict";
/*
 * guide.js — the "Guía" under the block editor: a live diagram of what the
 * block does (redrawn from the current parameter values), what the model is
 * and who made it famous, and what every control does at its current value.
 * Content comes from guide_data.js. Exposes window.Guide.
 */
(() => {
  const G = window.GuideData;
  const { h, escapeHtml: esc } = window.Controls;
  const W = 320, H = 132;

  // ------------------------------------------------------------- helpers
  const frac = (p) => {
    if (!p) return null;
    const span = (p.max - p.min) || 1;
    return Math.min(1, Math.max(0, (p.value - p.min) / span));
  };
  const finder = (b) => (re, fallback = null) => {
    const p = b.params.find((x) => re.test(x.name));
    return p ? frac(p) : fallback;
  };
  const pts = (arr) => arr.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const svg = (inner, label) =>
    `<svg class="gv" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
  const axis = (y = H / 2) => `<line class="gv-axis" x1="8" x2="${W - 8}" y1="${y}" y2="${y}"/>`;
  const txt = (x, y, s, cls = "gv-lbl", anchor = "start") => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(s)}</text>`;
  // deterministic pseudo-random (stable drawings between redraws)
  const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  // ------------------------------------------------------------ diagrams
  // Noise gate: note bursts over a noise floor; below the threshold it's muted.
  function gate(b) {
    const t = finder(b)(/THRE/, 0.5);
    const mid = H / 2, amp = 50, thr = 0.04 + t * 0.5;
    const open = [], shut = [];
    let cur = null, curOpen = null;
    for (let x = 8; x <= W - 8; x += 1.5) {
      const ph = (x - 8) / (W - 16);
      // two notes that decay, with noise in between
      const note = [0.05, 0.55].map((s) => (ph >= s ? Math.exp(-(ph - s) * 7) : 0)).reduce((a, z) => Math.max(a, z), 0);
      const env = Math.max(note, 0.12);
      const y = mid - Math.sin(x * 0.55) * env * amp * (note > 0.12 ? 1 : (rnd(x) * 0.8 + 0.2));
      const isOpen = env > thr;
      if (isOpen !== curOpen) { if (cur) (curOpen ? open : shut).push(cur); cur = cur ? [cur[cur.length - 1]] : []; curOpen = isOpen; }
      cur.push([x, y]);
    }
    if (cur) (curOpen ? open : shut).push(cur);
    const ty = thr * amp;
    return svg(`${axis()}
      <rect class="gv-zone" x="8" y="${mid - ty}" width="${W - 16}" height="${ty * 2}"/>
      <line class="gv-thr" x1="8" x2="${W - 8}" y1="${mid - ty}" y2="${mid - ty}"/><line class="gv-thr" x1="8" x2="${W - 8}" y1="${mid + ty}" y2="${mid + ty}"/>
      ${shut.map((s) => `<polyline class="gv-ghost" points="${pts(s)}"/>`).join("")}
      ${open.map((s) => `<polyline class="gv-sig" points="${pts(s)}"/>`).join("")}
      ${txt(W - 10, mid - ty - 4, "umbral", "gv-lbl gv-acc", "end")}${txt(10, H - 6, "gris = silenciado")}`, "Puerta de ruido");
  }

  // Compressor: input → output curve; Sustain lowers the threshold and raises the ratio.
  function comp(b) {
    const s = finder(b)(/Sustain/, 0.5);
    const x0 = 30, y0 = H - 16, w = W - 60, hh = H - 30;
    const thr = 0.85 - s * 0.6, ratio = 1 + s * 7;
    const P = (i, o) => [x0 + i * w, y0 - o * hh];
    const curve = [];
    for (let i = 0; i <= 1.0001; i += 0.02) curve.push(P(i, i <= thr ? i : thr + (i - thr) / ratio));
    return svg(`<line class="gv-axis" x1="${x0}" y1="${y0}" x2="${x0 + w}" y2="${y0}"/><line class="gv-axis" x1="${x0}" y1="${y0}" x2="${x0}" y2="${y0 - hh}"/>
      <line class="gv-ghost dash" x1="${x0}" y1="${y0}" x2="${x0 + w}" y2="${y0 - hh}"/>
      <polyline class="gv-sig" points="${pts(curve)}"/>
      <circle class="gv-dot" cx="${P(thr, thr)[0]}" cy="${P(thr, thr)[1]}" r="3.5"/>
      ${txt(x0 + w, y0 + 12, "entrada →", "gv-lbl", "end")}${txt(x0 - 4, y0 - hh + 8, "salida", "gv-lbl", "end")}
      ${txt(P(thr, thr)[0] + 6, P(thr, thr)[1] + 14, `comprime desde aquí (≈${ratio.toFixed(1)}:1)`, "gv-lbl gv-acc")}`, "Compresor");
  }

  // Boost: level before and after.
  function boost(b) {
    const g = finder(b)(/Gain/, 0.5), v = finder(b)(/VOL/, 0.5);
    const out = Math.min(1, 0.35 + g * 0.5 + (v - 0.5) * 0.3);
    const bar = (x, hgt, cls, lbl) => `<rect class="${cls}" x="${x}" y="${H - 22 - hgt * 90}" width="56" height="${hgt * 90}" rx="5"/>${txt(x + 28, H - 8, lbl, "gv-lbl", "middle")}`;
    return svg(`${axis(H - 22)}${bar(80, 0.35, "gv-barg", "guitarra")}${bar(184, out, "gv-bar", "con boost")}
      <path class="gv-arrow" d="M146 ${H - 60} h26 m-7 -6 l7 6 l-7 6"/>`, "Boost");
  }

  // Filter / wah: resonant peak moving across the spectrum.
  function filter(b) {
    const q = finder(b)(/^Q$/, 0.5), d = finder(b)(/Depth|Range|Sense/, 0.6);
    const peak = (c, hgt) => { const a = []; for (let x = 8; x <= W - 8; x += 2) { const u = (x - c) / (18 + (1 - q) * 40); a.push([x, H - 18 - hgt * Math.exp(-u * u) * 80 - 6]); } return a; };
    const lo = 60, hi = 60 + d * 200;
    return svg(`${axis(H - 18)}
      <polyline class="gv-ghost" points="${pts(peak(lo, 0.5 + q * 0.5))}"/>
      <polyline class="gv-sig" points="${pts(peak(hi, 0.5 + q * 0.5))}"/>
      <path class="gv-arrow" d="M${lo + 14} 22 H${hi - 14} m-7 -6 l7 6 l-7 6"/>
      ${txt(10, H - 5, "graves")}${txt(W - 10, H - 5, "agudos", "gv-lbl", "end")}${txt((lo + hi) / 2, 14, "barrido", "gv-lbl gv-acc", "middle")}`, "Filtro");
  }

  // Pitch / octave: the original wave and the added voices.
  function pitch(b, kind) {
    const wave = (yc, f, a, cls) => { const p = []; for (let x = 8; x <= W - 8; x += 2) p.push([x, yc - Math.sin((x - 8) / (W - 16) * Math.PI * 2 * f) * a]); return `<polyline class="${cls}" points="${pts(p)}"/>`; };
    if (kind === "detune") return svg(`${axis()}${wave(H / 2, 3, 36, "gv-ghost")}${wave(H / 2, 3.25, 36, "gv-sig")}${txt(10, H - 6, "dos voces casi iguales: sonido más ancho")}`, "Detune");
    return svg(`${wave(28, 6, 14, "gv-sig")}${wave(H / 2, 3, 16, "gv-ghost")}${wave(H - 26, 1.5, 14, "gv-sig")}
      ${txt(W - 10, 12, "octava arriba", "gv-lbl gv-acc", "end")}${txt(W - 10, H / 2 - 20, "original", "gv-lbl", "end")}${txt(W - 10, H - 4, "octava abajo", "gv-lbl gv-acc", "end")}`, "Octavador");
  }

  // Drive: a clean sine and the clipped wave.
  function drive(b, fuzz) {
    const g = finder(b)(/Gain|Fuzz/, 0.5);
    const k = 1 + g * (fuzz ? 30 : 14);
    const mid = H / 2, amp = 48, inn = [], out = [];
    for (let x = 8; x <= W - 8; x += 1.5) {
      const s = Math.sin((x - 8) / (W - 16) * Math.PI * 4);
      inn.push([x, mid - s * amp * 0.75]);
      const y = fuzz ? Math.max(-1, Math.min(1, s * k * 0.25)) : Math.tanh(k * s) / Math.tanh(k);
      out.push([x, mid - y * amp]);
    }
    return svg(`${axis()}<polyline class="gv-ghost" points="${pts(inn)}"/><polyline class="gv-sig" points="${pts(out)}"/>
      ${txt(10, 12, "gris = señal limpia")}${txt(W - 10, 12, g < 0.3 ? "recorte suave" : g < 0.7 ? "recorte medio" : "recorte fuerte", "gv-lbl gv-acc", "end")}`, "Distorsión");
  }

  // Amp: tone-stack curve + where the gain sits.
  function amp(b) {
    const f = finder(b);
    const bands = [[/^Bass$/, 0.12], [/^(Middle|Edge)$/, 0.45], [/^Treble$/, 0.72], [/^PRES$/, 0.9], [/^Tone( Cut)?$/, 0.7]];
    const curve = [];
    for (let x = 8; x <= W - 8; x += 2) {
      const u = (x - 8) / (W - 16);
      let y = 0;
      for (const [re, c] of bands) {
        const v = f(re);
        if (v == null) continue;
        const sign = /Cut/.test(String(re)) ? -1 : 1;
        y += sign * (v - 0.5) * 2 * Math.exp(-(((u - c) / 0.13) ** 2));
      }
      curve.push([x, 52 - y * 28]);
    }
    const g = f(/^Gain/, null);
    const gx = 8 + (g ?? 0) * (W - 16);
    return svg(`<line class="gv-axis" x1="8" x2="${W - 8}" y1="52" y2="52"/>
      <polyline class="gv-sig" points="${pts(curve)}"/>
      ${txt(10, 98, "graves")}${txt(W / 2, 98, "medios", "gv-lbl", "middle")}${txt(W - 10, 98, "agudos", "gv-lbl", "end")}
      ${g == null ? "" : `<defs><linearGradient id="gvg" x1="0" x2="1"><stop offset="0" stop-color="#4ade80"/><stop offset=".5" stop-color="#fbbf24"/><stop offset="1" stop-color="#f87171"/></linearGradient></defs>
      <rect x="8" y="110" width="${W - 16}" height="6" rx="3" fill="url(#gvg)" opacity=".75"/>
      <circle class="gv-knob" cx="${gx}" cy="113" r="6"/>
      ${txt(8, 130, "limpio")}${txt(W / 2, 130, "crunch", "gv-lbl", "middle")}${txt(W - 8, 130, "saturado", "gv-lbl", "end")}`}`, "Ecualización y ganancia del ampli");
  }

  // Cabinet: speakers + mic + band-limited response.
  function cab(b, name) {
    const m = /(\d)x(\d+)/.exec(name || "") || [0, "2", "12"];
    const n = Number(m[1]);
    const cols = n >= 4 ? 2 : n, rows = n >= 4 ? 2 : 1, r = rows === 2 ? 20 : 26;
    let spk = "";
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const cx = 60 + (j - (cols - 1) / 2) * (r * 2 + 6), cy = H / 2 + (i - (rows - 1) / 2) * (r * 2 + 6);
      spk += `<circle class="gv-spk" cx="${cx}" cy="${cy}" r="${r}"/><circle class="gv-spk2" cx="${cx}" cy="${cy}" r="${r * 0.35}"/>`;
    }
    const resp = [];
    for (let x = 140; x <= W - 10; x += 2) {
      const u = (x - 140) / (W - 150);
      const y = 1 / (1 + Math.exp(-(u - 0.12) * 30)) * (1 / (1 + Math.exp((u - 0.78) * 18))) * (1 + 0.15 * Math.sin(u * 22));
      resp.push([x, H - 26 - y * 70]);
    }
    return svg(`<rect class="gv-box" x="${60 - (cols * (r * 2 + 6)) / 2 - 4}" y="${H / 2 - (rows * (r * 2 + 6)) / 2 - 4}" width="${cols * (r * 2 + 6) + 8}" height="${rows * (r * 2 + 6) + 8}" rx="6"/>${spk}
      <path class="gv-mic" d="M${118} ${H / 2 - 4} h10 v8 h-10 z M128 ${H / 2} h8"/>
      <line class="gv-axis" x1="140" x2="${W - 10}" y1="${H - 26}" y2="${H - 26}"/><polyline class="gv-sig" points="${pts(resp)}"/>
      ${txt(140, H - 10, "graves")}${txt(W - 10, H - 10, "agudos", "gv-lbl", "end")}${txt(W - 10, 14, "corta los agudos ásperos", "gv-lbl gv-acc", "end")}`, "Gabinete");
  }

  // EQ: smooth curve through the band values.
  function eq(b) {
    const bands = b.params.filter((p) => /Hz$/.test(p.name));
    if (!bands.length) return "";
    const n = bands.length, x0 = 28, x1 = W - 20, mid = 58;
    const P = bands.map((p, i) => [x0 + (i / (n - 1)) * (x1 - x0), mid - (frac(p) - 0.5) * 2 * 40]);
    // Catmull-Rom through the points
    let d = `M${x0 - 16},${P[0][1]} L${P[0][0]},${P[0][1]}`;
    for (let i = 0; i < n - 1; i++) {
      const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
      d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
    }
    d += ` L${x1 + 12},${P[n - 1][1]}`;
    return svg(`<rect class="gv-zone" x="8" y="${mid - 40}" width="${W - 16}" height="80" rx="4"/>
      <line class="gv-axis" x1="8" x2="${W - 8}" y1="${mid}" y2="${mid}"/>
      <path class="gv-sig" d="${d}" fill="none"/>
      ${P.map(([x, y]) => `<circle class="gv-dot" cx="${x}" cy="${y}" r="3.5"/>`).join("")}
      ${bands.map((p, i) => txt(P[i][0], H - 8, p.name.replace("Hz", ""), "gv-lbl", "middle")).join("")}
      ${txt(10, 14, "+ realza")}${txt(10, mid + 52, "− recorta")}`, "Ecualizador");
  }

  // Modulation: the LFO; tremolo shows the volume envelope over a wave.
  function mod(b, type) {
    const f = finder(b);
    const rate = f(/Rate/, 0.4), depth = f(/Depth/, 0.6);
    const cycles = 1 + rate * 7, mid = H / 2;
    if (/Trem/i.test(type)) {
      const env = [], wave = [], envLow = [];
      for (let x = 8; x <= W - 8; x += 1) {
        const u = (x - 8) / (W - 16);
        const e = 1 - depth * (0.5 + 0.5 * Math.sin(u * Math.PI * 2 * cycles));
        env.push([x, mid - e * 48]); envLow.push([x, mid + e * 48]);
        wave.push([x, mid - Math.sin(x * 0.9) * e * 48]);
      }
      return svg(`${axis()}<polyline class="gv-ghost thin" points="${pts(wave)}"/><polyline class="gv-sig" points="${pts(env)}"/><polyline class="gv-sig" points="${pts(envLow)}"/>
        ${txt(10, 12, "el volumen sube y baja")}${txt(W - 10, 12, `${cycles.toFixed(1)} ciclos`, "gv-lbl gv-acc", "end")}`, "Trémolo");
    }
    const lfo = [];
    for (let x = 8; x <= W - 8; x += 1.5) lfo.push([x, mid - Math.sin((x - 8) / (W - 16) * Math.PI * 2 * cycles) * (8 + depth * 40)]);
    const what = /Chorus/i.test(type) ? "el chorus desafina ligeramente una copia de la señal"
      : /Flanger/i.test(type) ? "el flanger barre un retardo muy corto" : /Phaser/i.test(type) ? "el phaser barre unas muescas en el espectro"
        : "el vibrato mueve la afinación";
    return svg(`${axis()}<polyline class="gv-sig" points="${pts(lfo)}"/>
      ${txt(10, 12, "oscilador (LFO)")}${txt(W - 10, 12, `velocidad · intensidad`, "gv-lbl gv-acc", "end")}${txt(10, H - 6, what)}`, "Modulación");
  }

  // Delay: the hit and its repeats over time.
  function delay(b) {
    const tp = b.params.find((p) => p.name === "Time");
    const mix = finder(b)(/^Mix$/, 0.3), fb = finder(b)(/F\.Back|Feedback/, 0.3);
    const span = Math.max(1000, tp ? tp.max : 1000), t = tp ? tp.value : 300;
    const x0 = 16, w = W - 30, base = H - 26;
    let bars = `<rect class="gv-bar" x="${x0 - 3}" y="${base - 84}" width="6" height="84" rx="2"/>`;
    let hgt = (0.25 + mix * 0.75) * 84, k = 1;
    while (k * t <= span && hgt > 2 && k < 40) {
      const x = x0 + (k * t / span) * w;
      bars += `<rect class="gv-rep" x="${x - 3}" y="${base - hgt}" width="6" height="${hgt}" rx="2"/>`;
      hgt *= 0.15 + fb * 0.8; k++;
    }
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((u) => txt(x0 + u * w, H - 8, `${Math.round(u * span)}${u === 1 ? " ms" : ""}`, "gv-lbl", u === 0 ? "start" : u === 1 ? "end" : "middle")).join("");
    return svg(`<line class="gv-axis" x1="8" x2="${W - 8}" y1="${base}" y2="${base}"/>${bars}${ticks}
      ${txt(W - 10, 14, `${Math.round(t)} ms entre repeticiones`, "gv-lbl gv-acc", "end")}${txt(x0 + 8, 14, "nota")}`, "Delay");
  }

  // Reverb: the dry hit and a dense tail that decays.
  function reverb(b) {
    const f = finder(b);
    const decay = f(/Decay/, 0.5), mix = f(/^Mix$/, 0.3), damp = f(/Damp/, 0.4);
    const x0 = 16, base = H - 26, len = 0.12 + decay * 0.85, w = W - 30;
    let lines = `<rect class="gv-bar" x="${x0 - 3}" y="${base - 84}" width="6" height="84" rx="2"/>`;
    const n = 110;
    for (let i = 0; i < n; i++) {
      const u = 0.03 + (i / n) * len;
      const e = Math.exp(-(u - 0.03) / len * 4) * (0.3 + mix * 0.7);
      const hh = e * 80 * (0.45 + 0.55 * rnd(i));
      if (hh < 1) continue;
      lines += `<line class="gv-tail${damp > 0.6 && i > n / 2 ? " dim" : ""}" x1="${x0 + u * w}" x2="${x0 + u * w}" y1="${base}" y2="${base - hh}"/>`;
    }
    return svg(`<line class="gv-axis" x1="8" x2="${W - 8}" y1="${base}" y2="${base}"/>${lines}
      ${txt(x0 + 8, 14, "nota")}${txt(W - 10, 14, decay < 0.3 ? "cola corta" : decay < 0.65 ? "cola media" : "cola larga", "gv-lbl gv-acc", "end")}${txt(W - 10, H - 8, "tiempo →", "gv-lbl", "end")}`, "Reverb");
  }

  function capture() {
    const wave = []; for (let x = 8; x <= W - 8; x += 2) wave.push([x, H / 2 - Math.sin(x * 0.12) * 20 * Math.sin(x * 0.02)]);
    return svg(`<polyline class="gv-sig" points="${pts(wave)}"/>${txt(W / 2, H - 10, "una red neuronal reproduce el equipo capturado", "gv-lbl", "middle")}`, "Captura");
  }

  function diagram(b) {
    const type = b.type || "";
    switch (b.block) {
      case "NR": return gate(b);
      case "PRE":
        if (/Comp/i.test(type)) return comp(b);
        if (/Boost/i.test(type)) return boost(b);
        if (/Filter/i.test(type)) return filter(b);
        if (/Pitch/i.test(type)) return pitch(b, /Detune/i.test(b.model || "") ? "detune" : "octave");
        return boost(b);
      case "DST": return drive(b, /Fuzz/i.test(type));
      case "AMP": return amp(b);
      case "CAB": return cab(b, b.model);
      case "EQ": return eq(b);
      case "MOD": return mod(b, type);
      case "DLY": return delay(b);
      case "RVB": return reverb(b);
      case "N->S": return capture();
      default: return "";
    }
  }

  // ------------------------------------------------------------ text bits
  function bandText(info, p) {
    if (!info) return "";
    if (info.eq) {
      const v = frac(p) - 0.5;
      return Math.abs(v) < 0.03 ? "Plano: sin cambios." : v > 0 ? "Realzada: más presencia en esta zona." : "Recortada: menos presencia en esta zona.";
    }
    if (p.toggle) return Math.round(p.value) ? "Activado." : "Desactivado.";
    if (!info.bands) return "";
    const f = frac(p);
    return (info.bands.find(([lim]) => f <= lim + 1e-9) || info.bands[info.bands.length - 1])[1];
  }

  // -------------------------------------------------------------- render
  let root = null, current = null;
  const OPEN_KEY = "gp5.guide.open";
  const isOpen = () => { try { return localStorage.getItem(OPEN_KEY) !== "0"; } catch { return true; } };

  function render(container, b) {
    root = container;
    current = b;
    root.innerHTML = "";
    const blockInfo = G.BLOCKS[b.block] || {};
    const m = G.model(b.fxid, b.block) || {};

    const head = h("button", "guide-toggle");
    head.type = "button";
    head.setAttribute("aria-expanded", String(isOpen()));
    head.innerHTML = `${Icons.svg("information-circle")}<span>Guía: cómo funciona este efecto</span>${Icons.svg("chevron-down", "guide-caret")}`;
    head.onclick = () => {
      const open = root.classList.toggle("closed") === false;
      head.setAttribute("aria-expanded", String(open));
      try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* private mode */ }
    };
    root.classList.toggle("closed", !isOpen());

    const body = h("div", "guide-body");
    const vis = h("div", "guide-visual");
    vis.innerHTML = `<div class="guide-label">Cómo funciona</div><div class="guide-svg"></div><p class="guide-what">${esc(blockInfo.what || "")}</p>`;
    const info = h("div", "guide-info");

    let modelHtml = "";
    if (m.desc) {
      modelHtml += `<div class="guide-label">Sobre ${esc(b.model || "este modelo")}</div><p class="guide-desc">${esc(m.desc)}</p>`;
      if (m.pair) modelHtml += `<p class="guide-pair">${Icons.svg("check-circle")}<span>Combina bien con: <b>${esc(m.pair)}</b></span></p>`;
    }
    if (m.refs && m.refs.length) {
      modelHtml += `<div class="guide-label">Referencias</div><ul class="guide-refs">${m.refs.map((r) => `<li>${Icons.svg("musical-note")}<div><span class="guide-who">${esc(r.who)}</span>${r.songs && r.songs.length ? `<span class="guide-songs">${r.songs.map((s) => `<span class="guide-song">${esc(s)}</span>`).join("")}</span>` : ""}</div></li>`).join("")}</ul>`;
    }
    const tip = m.tip || blockInfo.tip;
    if (tip) modelHtml += `<p class="guide-tip">${Icons.svg("sparkles")}<span>${esc(tip)}</span></p>`;
    info.innerHTML = modelHtml;

    const plist = h("div", "guide-params");
    if (b.params.length) plist.append(h("div", "guide-label", "Qué hace cada control"));
    for (const p of b.params) {
      const pi = G.param(b.block, p.name);
      const row = h("div", "guide-param");
      row.dataset.name = p.name;
      row.innerHTML = `<div class="gp-head"><span class="gp-name">${esc(p.name)}</span><span class="gp-val"></span></div>
        <div class="gp-now"></div><div class="gp-what">${esc(pi ? pi.what : "")}</div>`;
      plist.append(row);
    }
    info.append(plist);
    if (m.refs && m.refs.length) info.append(h("p", "guide-note", "Las referencias son orientativas: el equipo de cada grabación varía."));

    body.append(vis, info);
    root.append(head, body);
    update(b);
  }

  // Redraw the diagram and the "now" texts for the current values.
  function update(b) {
    if (!root || !b) return;
    current = b;
    const box = root.querySelector(".guide-svg");
    if (box) box.innerHTML = diagram(b);
    for (const p of b.params) {
      const row = root.querySelector(`.guide-param[data-name="${CSS.escape(p.name)}"]`);
      if (!row) continue;
      row.querySelector(".gp-val").textContent = p.display;
      row.querySelector(".gp-now").textContent = bandText(G.param(b.block, p.name), p);
    }
  }

  function focus(name) {
    if (!root) return;
    root.querySelectorAll(".guide-param").forEach((r) => r.classList.toggle("hl", r.dataset.name === name));
  }

  // Short description for the model picker.
  function describe(fxid, block) {
    const m = G.model(fxid, block);
    return m && m.desc ? m.desc : "";
  }

  window.Guide = { render, update, focus, describe, diagram };
})();
