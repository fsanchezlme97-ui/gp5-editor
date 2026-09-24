"use strict";
/*
 * ai.js — "Crear con IA": Claude designs a GP-5 preset for a song.
 *
 * Claude gets the pedal's model catalog (every block's models, real-gear
 * origin and parameter ranges) in a cached system prompt, the user's own
 * SnapTones / IRs in the request, and must answer with JSON matching
 * PRESET_SCHEMA (structured outputs). toPrst() then validates every choice
 * against the catalog and turns it into a real .prst for the pedal.
 *
 * Works with any back end in ai_providers.js (Claude, Gemini, OpenRouter,
 * Groq, Ollama, any OpenAI-compatible API). Keys stay on this device.
 * Exposes window.AIPreset.
 */
(() => {
  const BLOCKS = ["NR", "PRE", "DST", "AMP", "CAB", "EQ", "MOD", "DLY", "RVB", "NS"]; // .prst record order
  const RING_MODULE = { NS: "N→S" };
  const NS_CAT = 0x0f, CAB_CAT = 0x0a, USER_IR_BASE = 0x100000;

  // ---- catalog ---------------------------------------------------------------
  // Models available per block: {block: [{id, name, type, origin, params:[...]}]}
  function catalog(ring, bankMap) {
    const out = Object.fromEntries(BLOCKS.map((b) => [b, []]));
    const ids = Object.keys(ring).map(Number).sort((a, z) => a - z);
    for (const id of ids) {
      const e = ring[id];
      const block = BLOCKS.find((b) => (RING_MODULE[b] || b) === e.module);
      if (!block || block === "NS") continue; // SnapTones come from the pedal below
      let name = (e.name || e.fxtitle || "").trim();
      if (block === "CAB" && (id & 0xffffff) >= USER_IR_BASE) {
        const slot = (id & 0xffffff) - USER_IR_BASE;
        const real = bankMap.ir && bankMap.ir[slot];
        if (!real) continue; // unnamed user slot: unknown content
        name = `User IR: ${real}`;
      }
      out[block].push({ id, name, type: e.type || "", origin: e.origin || "", params: e.params || [] });
    }
    const nsParams = (ring[(NS_CAT << 24) >>> 0] || {}).params || [];
    for (const [slot, name] of Object.entries(bankMap.snaptone || {}).sort((a, z) => a[0] - z[0])) {
      out.NS.push({ id: ((NS_CAT << 24) | Number(slot)) >>> 0, name: `SnapTone: ${name}`, type: "SnapTone (NAM capture)", origin: "", params: nsParams });
    }
    return out;
  }

  const fmtParam = (p) => p.toggle ? `${p.name} (on/off)` : `${p.name} (${p.min}..${p.max}${p.unit ? " " + p.unit : ""}, default ${p.default})`;

  // The fixed part of the system prompt: identical bytes on every request so
  // prompt caching can serve it. User-specific SnapTones/IRs go in the message.
  function systemPrompt(cat) {
    const lines = [];
    for (const b of BLOCKS) {
      if (b === "NS") continue;
      lines.push(`### ${b}`);
      for (const m of cat[b].filter((x) => !x.name.startsWith("User IR"))) {
        lines.push(`- id ${m.id} | ${m.name}${m.type ? ` [${m.type}]` : ""}${m.origin ? ` — models: ${m.origin}` : ""} | params: ${m.params.map(fmtParam).join("; ") || "none"}`);
      }
    }
    return `You are an expert guitar tone designer for the Valeton GP-5 multi-effects pedal. Given a song, artist or sound description, you design one preset that recreates that guitar tone as faithfully as the GP-5 allows, drawing on what you know about the recording, the player's rig and the tone's character.

## The GP-5 signal chain
A preset always has exactly these 10 blocks, each one either enabled or bypassed:
- NR: noise gate.
- PRE: compressor, boost, wah/filter or pitch, before the drive.
- DST: overdrive, distortion or fuzz pedal.
- AMP: amp model.
- CAB: speaker cabinet impulse response. Pick one that matches the amp's real cabinet.
- EQ: graphic EQ after the amp. Band values run from -50 to 50 around a flat 0.
- MOD: chorus, flanger, phaser, tremolo, vibrato, rotary...
- DLY: delay.
- RVB: reverb.
- NS: a SnapTone, a NAM capture the player loaded into the pedal. When NS is enabled it replaces the AMP and CAB tone, so enable it only if one of the player's SnapTones clearly fits the song better than any amp model. The player's SnapTones are listed in their message; if none are listed, leave NS disabled.

## How to answer
- Include all 10 blocks, each exactly once. Bypassed blocks still need a valid model_id from their list.
- model_id must be one of the ids listed for that block below (or in the player's message for NS and user IRs).
- Use parameter names exactly as listed for the chosen model and keep values inside their ranges. On/off parameters take 0 or 1. Parameters you leave out are set to their defaults, but tone-defining ones (gain, EQ, level, mix, time, feedback) should always be set on purpose.
- Keep the output level sensible: amp and pedal volumes around unity, patch_volume around 50 unless there is a reason.
- For delay times, match the song's tempo when you know it.
- name: up to 16 plain ASCII characters, recognisable (e.g. "Comf Numb Solo").
- summary and each block's why: short, practical, written in the same language as the player's request. Mention any assumption (which part of the song, which guitar) in the summary.
- original_gear: what the guitarist used on that recording (guitar, pickups, pedals, amp, cab) as far as is known; say so plainly when it is uncertain. Same language as the request.
- playing_tips: 2-4 concrete tips to get the sound with this preset: pickup selector, guitar volume/tone knobs, picking or technique. Same language as the request.
- bpm: the song's tempo when you know it (delay times should follow it), otherwise 0.

## GP-5 model catalog
${lines.join("\n")}`;
  }

  function userMessage(req, cat) {
    const snaps = cat.NS.map((m) => `- id ${m.id} | ${m.name}`).join("\n") || "(none: keep NS disabled; use model_id " + ((NS_CAT << 24) >>> 0) + ")";
    const irs = cat.CAB.filter((m) => m.name.startsWith("User IR")).map((m) => `- id ${m.id} | ${m.name}`).join("\n") || "(none)";
    return `Song / tone requested: ${req.song}
Guitar pickups: ${req.pickups}
${req.notes ? `Extra notes: ${req.notes}\n` : ""}
Player's SnapTones (for NS):
${snaps}

Player's own cabinet IRs (also valid CAB ids):
${irs}`;
  }

  // Structured-output schema for the answer.
  const PRESET_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["name", "summary", "original_gear", "playing_tips", "bpm", "patch_volume", "blocks"],
    properties: {
      name: { type: "string", description: "Preset name, max 16 ASCII characters" },
      summary: { type: "string", description: "2-4 sentences: the tone and any assumptions" },
      original_gear: { type: "string", description: "The guitar, pedals and amp used on the recording, as far as known" },
      playing_tips: { type: "string", description: "How to play it: pickup position, guitar volume/tone knobs, technique" },
      bpm: { type: "integer", description: "Song tempo in BPM, or 0 if unknown" },
      patch_volume: { type: "integer", description: "Preset output level 0-100" },
      blocks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["block", "enabled", "model_id", "params", "why"],
          properties: {
            block: { type: "string", enum: BLOCKS },
            enabled: { type: "boolean" },
            model_id: { type: "integer" },
            params: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "value"],
                properties: { name: { type: "string" }, value: { type: "number" } },
              },
            },
            why: { type: "string", description: "One short sentence" },
          },
        },
      },
    },
  };

  // ---- the request -----------------------------------------------------------
  // provider: id from AIProviders; cfg: {key, model, base}. history = prior
  // turns ([{role, text}]) for "Ajustar" refinements; returned for the next one.
  // Overloaded / rate-limited answers are usually gone within seconds: retry
  // with growing waits. (The Anthropic SDK already retries these itself.)
  const TRANSIENT = new Set([429, 500, 502, 503, 504, 529]);
  const RETRY_WAITS = [3000, 8000, 15000];
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("Cancelado."), { name: "AbortError" })); });
  });
  const isDailyQuota = (e) => e.status === 429 && /per.?day|daily|PerDay/i.test(e.message || "");

  async function generate({ provider, cfg, ring, bankMap, request, refine, history, onProgress, onRetry, signal }) {
    const P = window.AIProviders.byId[provider];
    if (!P) throw new Error(`Proveedor desconocido: ${provider}`);
    const cat = catalog(ring, bankMap);
    const messages = history ? [...history] : [{ role: "user", text: userMessage(request, cat) }];
    if (refine) messages.push({ role: "user", text: `Adjust the preset: ${refine}
Return the complete updated preset.` });
    let text;
    for (let attempt = 0; ; attempt++) {
      try {
        text = await P.chat(cfg, { system: systemPrompt(cat), messages, schema: PRESET_SCHEMA, signal, onProgress });
        break;
      } catch (e) {
        const retry = provider !== "anthropic" && TRANSIENT.has(e.status) && !isDailyQuota(e)
          && attempt < RETRY_WAITS.length && !(signal && signal.aborted);
        if (!retry) throw e;
        if (onRetry) onRetry(attempt + 1, RETRY_WAITS.length, RETRY_WAITS[attempt], e);
        await sleep(RETRY_WAITS[attempt], signal);
      }
    }
    const result = window.AIProviders.parseJSON(text);
    messages.push({ role: "assistant", text: JSON.stringify(result) });
    return { result, history: messages };
  }

  // Smaller models bend the format: "N->S" for NS, ids as strings, params as
  // an object. Bring those back to the schema before validating.
  function normalize(result) {
    const r = result && typeof result === "object" ? result : {};
    const blocks = Array.isArray(r.blocks) ? r.blocks : [];
    return {
      ...r,
      blocks: blocks.map((b) => {
        const name = String(b.block || "").toUpperCase().replace(/[^A-Z]/g, "");
        const params = Array.isArray(b.params) ? b.params
          : b.params && typeof b.params === "object" ? Object.entries(b.params).map(([n, v]) => ({ name: n, value: v })) : [];
        return { ...b, block: name, model_id: Number(b.model_id), enabled: b.enabled === true || b.enabled === "true" || b.enabled === 1, params };
      }),
    };
  }

  // ---- result -> .prst -------------------------------------------------------
  // Validates each block against the catalog; anything invalid keeps the base
  // preset's choice and is reported in warnings.
  function toPrst(base, rawResult, ring, bankMap) {
    const result = normalize(rawResult);
    const cat = catalog(ring, bankMap);
    const warnings = [];
    const edits = { models: {}, params: {}, bypass: {}, settings: {} };
    const seen = new Set();
    for (const blk of result.blocks || []) {
      const k = BLOCKS.indexOf(blk.block);
      if (k < 0 || seen.has(k)) continue;
      seen.add(k);
      let model = cat[blk.block].find((m) => m.id === blk.model_id);
      if (!model && blk.block === "NS" && (blk.model_id & 0xffffff) === 0) {
        model = { id: (NS_CAT << 24) >>> 0, params: [] }; // "no SnapTone"
      }
      if (!model) {
        warnings.push(`${blk.block}: modelo ${blk.model_id} no existe en tu GP-5; se mantuvo el anterior`);
        edits.bypass[k] = !!blk.enabled && blk.block !== "NS";
        continue;
      }
      edits.models[k] = model.id;
      const values = {};
      for (let a = 0; a < 8; a++) values[a] = 0;
      for (const p of model.params) values[p.algId] = p.default ?? p.min ?? 0;
      for (const { name, value } of blk.params || []) {
        const p = model.params.find((x) => x.name.trim().toLowerCase() === String(name).trim().toLowerCase());
        if (!p) { warnings.push(`${blk.block}: parámetro «${name}» no existe en ${model.name}`); continue; }
        let v = Number(value);
        if (!Number.isFinite(v)) continue;
        v = p.toggle ? (v >= 0.5 ? 1 : 0) : Math.min(p.max, Math.max(p.min, v));
        values[p.algId] = v;
      }
      edits.params[k] = values;
      edits.bypass[k] = !!blk.enabled && !(blk.block === "NS" && (model.id & 0xffffff) === 0);
    }
    for (const b of BLOCKS) if (!seen.has(BLOCKS.indexOf(b))) warnings.push(`${b}: Claude no lo incluyó; se mantuvo el anterior`);
    const name = String(result.name || "AI Preset").replace(/[^\x20-\x7e]/g, "").slice(0, 16).trim() || "AI Preset";
    edits.name = name;
    if (Number.isFinite(result.patch_volume)) edits.settings.patch_vol = Math.min(100, Math.max(0, Math.round(result.patch_volume)));
    const bpm = Number(result.bpm);
    if (Number.isFinite(bpm) && bpm >= 40 && bpm <= 300) edits.settings.bpm = Math.round(bpm);
    return { bytes: window.PRST.applyEdits(base, edits), warnings, name };
  }

  window.AIPreset = { TRANSIENT, isDailyQuota, generate, toPrst, normalize, catalog, systemPrompt, userMessage, PRESET_SCHEMA, BLOCKS };
})();
