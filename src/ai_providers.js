"use strict";
/*
 * ai_providers.js — the AI back ends "Crear con IA" can use.
 *
 * Each provider knows how to list its models and how to turn
 * {system, messages, schema} into one JSON answer:
 *   anthropic  Claude, official SDK (window.Anthropic), streaming + structured outputs
 *   gemini     Google Gemini REST API (free tier with an AI Studio key)
 *   openai     any OpenAI-compatible API: OpenRouter, Groq, OpenAI, LM Studio...
 *   ollama     local models through Ollama's native API (free, offline)
 *
 * HTTP for the non-SDK providers uses the browser's fetch, falling back to the
 * local server's /__proxy for APIs that block browser (CORS) calls.
 * Exposes window.AIProviders.
 */
(() => {
  // ---- HTTP -------------------------------------------------------------------
  async function http(url, { method = "GET", headers = {}, body, signal } = {}, netFetch) {
    const init = { method, headers, body: body == null ? undefined : JSON.stringify(body) };
    if (body != null) init.headers = { "Content-Type": "application/json", ...headers };
    let res;
    if (netFetch) res = await netFetch(url, init);
    else {
      try {
        const r = await fetch(url, { ...init, signal });
        res = { status: r.status, text: await r.text() };
      } catch (e) {
        if (e.name === "AbortError") throw e;
        // Blocked by CORS (or the host is down): retry through the local server.
        const r = await fetch("/__proxy", {
          method: "POST", signal,
          headers: { "Content-Type": "application/json", "X-GP5-Proxy": "1" },
          body: JSON.stringify({ url, ...init }),
        }).catch(() => null);
        if (!r || r.status === 404) throw new Error(`No se pudo conectar con ${new URL(url).host}`);
        res = await r.json();
        if (res.error) throw new Error(res.error);
      }
    }
    let json = null;
    try { json = JSON.parse(res.text); } catch { /* not JSON */ }
    if (res.status >= 400) {
      const msg = (json && (json.error?.message || json.error || json.message)) || res.text.slice(0, 300);
      const err = new Error(`${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  // Models often wrap JSON in ``` fences or add a sentence around it.
  function parseJSON(text) {
    const t = String(text || "").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    try { return JSON.parse(t); } catch { /* fall through */ }
    const a = t.indexOf("{"), z = t.lastIndexOf("}");
    if (a >= 0 && z > a) { try { return JSON.parse(t.slice(a, z + 1)); } catch { /* fall through */ } }
    throw new Error("El modelo no devolvió un preset válido (JSON). Prueba otra vez u otro modelo.");
  }

  const jsonInstruction = (schema) =>
    `\n\nRespond with a single JSON object and nothing else. It must match this JSON Schema:\n${JSON.stringify(schema)}`;

  // ---- Anthropic (Claude) -------------------------------------------------------
  const anthropic = {
    id: "anthropic",
    label: "Claude (Anthropic)",
    needsKey: true,
    keyHint: "Clave de console.anthropic.com → API Keys (sk-ant-…). De pago por uso; la mejor calidad.",
    keyPattern: /^sk-ant-/,
    defaultModel: "claude-opus-5",
    client(cfg) {
      if (!window.Anthropic) throw new Error("No se cargó el SDK de Anthropic");
      return new window.Anthropic({ apiKey: cfg.key, dangerouslyAllowBrowser: true, ...(cfg.fetch ? { fetch: cfg.fetch } : {}) });
    },
    async listModels(cfg) {
      const out = [];
      for await (const m of this.client(cfg).models.list()) out.push({ id: m.id, label: m.display_name || m.id });
      return out;
    },
    async chat(cfg, { system, messages, schema, signal, onProgress }) {
      const client = this.client(cfg);
      const model = cfg.model || this.defaultModel;
      const params = {
        model,
        max_tokens: 32000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: messages.map((m) => ({ role: m.role, content: m.text })),
        output_config: { format: { type: "json_schema", schema } },
      };
      if (!/haiku/.test(model)) params.thinking = { type: "adaptive" };
      // Server-side refusal fallback where the model supports it.
      const fallback = /^claude-(opus-5|fable-5-1)$/.test(model);
      const stream = fallback
        ? client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal })
        : client.messages.stream(params, { signal });
      let chars = 0;
      stream.on("text", (t) => { chars += t.length; if (onProgress) onProgress(chars); });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") throw new Error("Claude no pudo crear este preset (solicitud rechazada). Prueba con otra descripción.");
      if (msg.stop_reason === "max_tokens") throw new Error("La respuesta quedó incompleta. Inténtalo de nuevo.");
      return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    },
    explainError(e) {
      const A = window.Anthropic;
      if (!A) return null;
      // The API's own message, without the raw JSON around it.
      const apiMsg = (e.error && e.error.error && e.error.error.message) || "";
      if (/credit balance is too low/i.test(apiMsg)) {
        return { msg: "Tu cuenta de la API de Anthropic no tiene saldo. Recarga créditos en console.anthropic.com → Plans & Billing (la API se paga aparte de la suscripción a Claude.ai), o usa Google Gemini, que es gratis.", noCredit: true };
      }
      if (e instanceof A.AuthenticationError) return { msg: "La clave de API no es válida. Revísala.", badKey: true };
      if (e instanceof A.PermissionDeniedError) return { msg: "Tu clave no tiene permiso para usar este modelo." };
      if (e instanceof A.RateLimitError) return { msg: "Demasiadas solicitudes o sin saldo. Espera un momento o revisa tu cuenta." };
      if (e instanceof A.APIUserAbortError) return { msg: "Cancelado.", cancelled: true };
      if (e instanceof A.APIConnectionError) return { msg: "No hay conexión con la API de Anthropic. ¿Tienes internet?" };
      if (e instanceof A.APIError) return { msg: `Error de la API de Anthropic (${e.status}): ${apiMsg || e.message}` };
      return null;
    },
  };

  // ---- Google Gemini -------------------------------------------------------------
  const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
  const gemini = {
    id: "gemini",
    label: "Google Gemini",
    needsKey: true,
    keyHint: "Clave gratuita en aistudio.google.com → Get API key. El nivel gratuito tiene límites por minuto/día y Google puede usar esos datos para mejorar sus productos.",
    keyPattern: /^AI/,
    async listModels(cfg) {
      const j = await http(`${GEMINI}/models?pageSize=1000`, { headers: { "x-goog-api-key": cfg.key } }, cfg.netFetch);
      return (j.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""))
        .filter((id) => /^gemini/.test(id) && !/embedding|tts|image|live|audio|robotics|computer-use/.test(id))
        .map((id) => ({ id, label: id }));
    },
    // Newest non-lite "flash": good quality inside the free tier.
    pickDefault(models) {
      const ver = (id) => Number((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
      const flash = models.filter((m) => /flash/.test(m.id) && !/lite|preview|exp/.test(m.id)).sort((a, z) => ver(z.id) - ver(a.id));
      return (flash[0] || models[0] || {}).id;
    },
    async chat(cfg, { system, messages, schema, signal }) {
      const url = `${GEMINI}/models/${encodeURIComponent(cfg.model)}:generateContent`;
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] })),
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema },
      };
      let j;
      try {
        j = await http(url, { method: "POST", headers: { "x-goog-api-key": cfg.key }, body, signal }, cfg.netFetch);
      } catch (e) {
        if (e.status !== 400) throw e;
        // Older models reject responseJsonSchema: plain JSON mode + schema in the prompt.
        delete body.generationConfig.responseJsonSchema;
        body.contents[body.contents.length - 1].parts[0].text += jsonInstruction(schema);
        j = await http(url, { method: "POST", headers: { "x-goog-api-key": cfg.key }, body, signal }, cfg.netFetch);
      }
      if (j.promptFeedback && j.promptFeedback.blockReason) throw new Error(`Gemini bloqueó la solicitud (${j.promptFeedback.blockReason}).`);
      const c = (j.candidates || [])[0];
      if (!c) throw new Error("Gemini no devolvió respuesta.");
      if (c.finishReason === "MAX_TOKENS") throw new Error("La respuesta quedó incompleta. Inténtalo de nuevo.");
      return ((c.content && c.content.parts) || []).map((p) => p.text || "").join("");
    },
  };

  // ---- OpenAI-compatible (OpenRouter, Groq, OpenAI, LM Studio, …) -----------------
  function openaiCompatible({ id, label, base, keyHint, needsKey = true, freeFilter = false, extraHeaders = {} }) {
    return {
      id, label, needsKey, keyHint, defaultBase: base, editableBase: id === "openai",
      headers(cfg) { return { ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}), ...extraHeaders }; },
      async listModels(cfg) {
        const j = await http(`${cfg.base || base}/models`, { headers: this.headers(cfg) }, cfg.netFetch);
        let list = (j.data || j.models || []).map((m) => {
          const free = /:free$/.test(m.id) || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0);
          return { id: m.id, label: `${m.name || m.id}${freeFilter && free ? " · gratis" : ""}`, free };
        }).filter((m) => !/whisper|tts|embed|guard|moderation|dall-e|image/i.test(m.id));
        if (freeFilter) list = list.filter((m) => m.free).concat(list.filter((m) => !m.free));
        return list;
      },
      pickDefault(models) { return (models.find((m) => m.free) || models[0] || {}).id; },
      async chat(cfg, { system, messages, schema, signal }) {
        const url = `${cfg.base || base}/chat/completions`;
        const body = {
          model: cfg.model,
          messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.text }))],
          response_format: { type: "json_schema", json_schema: { name: "gp5_preset", strict: true, schema } },
        };
        const send = () => http(url, { method: "POST", headers: this.headers(cfg), body, signal }, cfg.netFetch);
        let j;
        try { j = await send(); } catch (e) {
          if (![400, 404, 422].includes(e.status)) throw e;
          // Not every model supports JSON Schema output: JSON mode, then plain text.
          body.messages[body.messages.length - 1].content += jsonInstruction(schema);
          body.response_format = { type: "json_object" };
          try { j = await send(); } catch (e2) {
            if (![400, 404, 422].includes(e2.status)) throw e2;
            delete body.response_format;
            j = await send();
          }
        }
        const c = (j.choices || [])[0];
        if (!c) throw new Error("El modelo no devolvió respuesta.");
        if (c.finish_reason === "length") throw new Error("La respuesta quedó incompleta (límite de tokens del modelo).");
        return c.message && c.message.content || "";
      },
    };
  }

  const openrouter = openaiCompatible({
    id: "openrouter", label: "OpenRouter (hay modelos gratis)", base: "https://openrouter.ai/api/v1", freeFilter: true,
    keyHint: "Clave en openrouter.ai → Keys. Los modelos marcados «gratis» no cuestan nada (con límites de uso).",
    extraHeaders: { "X-Title": "GP-5 Editor" },
  });
  const groq = openaiCompatible({
    id: "groq", label: "Groq (gratis, muy rápido)", base: "https://api.groq.com/openai/v1",
    keyHint: "Clave gratuita en console.groq.com → API Keys. Nivel gratuito con límites por minuto.",
  });
  const openai = openaiCompatible({
    id: "openai", label: "Otra API compatible con OpenAI", base: "https://api.openai.com/v1",
    keyHint: "Cualquier servicio con API estilo OpenAI (OpenAI, Mistral, DeepSeek, LM Studio en http://127.0.0.1:1234/v1…). Cambia la URL base si no es OpenAI.",
  });

  // ---- Ollama (local) ---------------------------------------------------------------
  const ollama = {
    id: "ollama", label: "Ollama (local, gratis, sin internet)", needsKey: false,
    defaultBase: "http://127.0.0.1:11434", editableBase: true,
    keyHint: "Instala Ollama (ollama.com) y descarga un modelo, p. ej. «ollama pull qwen3». Todo corre en tu PC. Los modelos pequeños dan resultados más pobres.",
    async listModels(cfg) {
      const j = await http(`${cfg.base || this.defaultBase}/api/tags`, {}, cfg.netFetch);
      return (j.models || []).map((m) => ({ id: m.name, label: m.name }));
    },
    pickDefault(models) { return (models[0] || {}).id; },
    async chat(cfg, { system, messages, schema, signal }) {
      const j = await http(`${cfg.base || this.defaultBase}/api/chat`, {
        method: "POST", signal,
        body: {
          model: cfg.model, stream: false, format: schema,
          options: { num_ctx: 16384 }, // the catalog alone is ~6k tokens
          messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.text }))],
        },
      }, cfg.netFetch);
      return (j.message && j.message.content) || "";
    },
  };

  const LIST = [anthropic, gemini, openrouter, groq, ollama, openai];
  const byId = Object.fromEntries(LIST.map((p) => [p.id, p]));

  // ---- settings (this device only) ---------------------------------------------------
  const K = (p, f) => `gp5.ai.${p}.${f}`;
  const ls = {
    get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
    set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* private mode */ } },
  };
  // One-time migration of the Claude-only key saved by v0.4.
  if (ls.get("gp5.anthropicKey") && !ls.get(K("anthropic", "key"))) ls.set(K("anthropic", "key"), ls.get("gp5.anthropicKey"));

  const settings = {
    provider: () => byId[ls.get("gp5.ai.provider")] ? ls.get("gp5.ai.provider") : "anthropic",
    setProvider: (id) => ls.set("gp5.ai.provider", id),
    get(id) {
      const p = byId[id];
      return { key: ls.get(K(id, "key")), model: ls.get(K(id, "model")) || p.defaultModel || "", base: ls.get(K(id, "base")) || p.defaultBase || "" };
    },
    set(id, patch) { for (const [f, v] of Object.entries(patch)) ls.set(K(id, f), (v || "").trim()); },
  };

  window.AIProviders = { LIST, byId, settings, parseJSON, http };
})();
