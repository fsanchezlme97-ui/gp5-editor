"use strict";
// "Crear con IA" end to end, offline, for every provider: fake transports
// check the request we send and replay typical answers (including models that
// don't support JSON Schema output), then the answer must become a valid
// GP-5 .prst.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

globalThis.window = globalThis;
const store = { "gp5.anthropicKey": "sk-ant-legacy" }; // key saved by v0.4
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
window.PRST = require("../src/lib/prst.js");
window.PatchLib = require("../src/lib/patchlib.js");
require("../src/lib/anthropic-sdk.js");
require("../src/ai_providers.js");
require("../src/ai.js");
const AI = window.AIPreset;
const PV = window.AIProviders;

const ring = require("../src/data/fxid_ring_gp5.json");
const bankMap = { snaptone: { 52: "JCM800 220" }, ir: { 1: "TL DLX GP5" } };
const base = new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures", "65-Puppy.prst")));
const cat = AI.catalog(ring, bankMap);
const request = { song: "Comfortably Numb", pickups: "Single coil", notes: "" };

// A plausible answer built from the real catalog.
function cannedResult() {
  const blocks = AI.BLOCKS.map((b) => {
    if (b === "NS") return { block: "NS", enabled: false, model_id: 0x0f000000, params: [], why: "Sin SnapTone" };
    const m = cat[b][0];
    return {
      block: b, enabled: b !== "MOD", model_id: m.id,
      params: m.params.filter((p) => !p.toggle).slice(0, 2).map((p) => ({ name: p.name, value: p.max + 999 })), // out of range on purpose
      why: `${b} elegido`,
    };
  });
  blocks.find((x) => x.block === "DLY").model_id = 123456; // invalid on purpose
  return { name: "Test Tone ñ 1234567890", summary: "Resumen", patch_volume: 62, blocks };
}

// Fake netFetch: records calls, answers from a queue of {status, body}.
function fakeNet(queue) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const r = queue.shift();
    return { status: r.status || 200, text: typeof r.body === "string" ? r.body : JSON.stringify(r.body) };
  };
  fn.calls = calls;
  return fn;
}

function sseResponse(obj) {
  const text = JSON.stringify(obj);
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const body =
    ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }) +
    ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
    [text.slice(0, 40), text.slice(40)].map((c) => ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: c } })).join("") +
    ev("content_block_stop", { index: 0 }) +
    ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 99 } }) +
    ev("message_stop", {});
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_test" } });
}

test("anthropic: SDK request (model, schema, cache, fallbacks) and streamed answer", async () => {
  let sent = null;
  const fetch = async (url, init) => { sent = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) }; return sseResponse(cannedResult()); };
  let progress = 0;
  const { result, history } = await AI.generate({
    provider: "anthropic", cfg: { key: "sk-ant-test", model: "claude-opus-5", fetch }, ring, bankMap, request,
    onProgress: (n) => { progress = n; },
  });
  assert.match(sent.url, /\/v1\/messages/);
  assert.strictEqual(sent.body.model, "claude-opus-5");
  assert.strictEqual(sent.body.stream, true);
  assert.strictEqual(sent.body.fallbacks, "default");
  assert.deepStrictEqual(sent.body.thinking, { type: "adaptive" });
  assert.strictEqual(sent.body.output_config.format.type, "json_schema");
  assert.deepStrictEqual(sent.body.system[0].cache_control, { type: "ephemeral" });
  assert.match(sent.headers.get("anthropic-beta"), /server-side-fallback-2026-07-01/);
  assert.strictEqual(sent.headers.get("anthropic-dangerous-direct-browser-access"), "true");
  assert.match(sent.body.messages[0].content, /JCM800 220/); // user SnapTones in the message
  assert.doesNotMatch(sent.body.system[0].text, /JCM800 220/); // ...not in the cached system prompt
  assert.ok(progress > 0);
  assert.strictEqual(result.name, "Test Tone ñ 1234567890");
  assert.strictEqual(history.length, 2);
});

test("anthropic: other Claude models skip the fallback beta", async () => {
  let sent = null;
  const fetch = async (url, init) => { sent = { headers: new Headers(init.headers), body: JSON.parse(init.body) }; return sseResponse(cannedResult()); };
  await AI.generate({ provider: "anthropic", cfg: { key: "sk-ant-test", model: "claude-sonnet-5", fetch }, ring, bankMap, request });
  assert.strictEqual(sent.body.fallbacks, undefined);
  assert.doesNotMatch(sent.headers.get("anthropic-beta") || "", /server-side-fallback/);
});

test("gemini: generateContent with JSON schema, retries without it on 400", async () => {
  const answer = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(cannedResult()) }] } }] };
  const net = fakeNet([{ status: 400, body: { error: { message: "Unknown name responseJsonSchema" } } }, { body: answer }]);
  const { result } = await AI.generate({ provider: "gemini", cfg: { key: "AIzaTEST", model: "gemini-2.5-flash", netFetch: net }, ring, bankMap, request });
  const [first, second] = net.calls;
  assert.match(first.url, /models\/gemini-2\.5-flash:generateContent$/);
  assert.strictEqual(first.headers["x-goog-api-key"], "AIzaTEST");
  assert.strictEqual(first.body.generationConfig.responseMimeType, "application/json");
  assert.ok(first.body.generationConfig.responseJsonSchema);
  assert.ok(first.body.systemInstruction.parts[0].text.includes("GP-5 model catalog"));
  assert.strictEqual(second.body.generationConfig.responseJsonSchema, undefined);
  assert.match(second.body.contents[0].parts[0].text, /JSON Schema/);
  assert.strictEqual(result.patch_volume, 62);
});

test("gemini: model list filtering and default pick", async () => {
  const net = fakeNet([{ body: { models: [
    { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-2.5-flash-lite", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
    { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
    { name: "models/gemini-2.5-flash-preview-tts", supportedGenerationMethods: ["generateContent"] },
  ] } }]);
  const models = await PV.byId.gemini.listModels({ key: "k", netFetch: net });
  assert.deepStrictEqual(models.map((m) => m.id), ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"]);
  assert.strictEqual(PV.byId.gemini.pickDefault(models), "gemini-2.5-flash");
});

test("openai-compatible: json_schema, falls back to JSON mode, tolerates ``` fences", async () => {
  const fenced = "Aquí tienes:\n```json\n" + JSON.stringify(cannedResult()) + "\n```";
  const net = fakeNet([
    { status: 400, body: { error: { message: "response_format json_schema not supported" } } },
    { body: { choices: [{ finish_reason: "stop", message: { content: fenced } }] } },
  ]);
  const { result } = await AI.generate({ provider: "openrouter", cfg: { key: "sk-or-x", model: "some/model:free", netFetch: net }, ring, bankMap, request });
  const [first, second] = net.calls;
  assert.strictEqual(first.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.strictEqual(first.headers.Authorization, "Bearer sk-or-x");
  assert.strictEqual(first.body.response_format.type, "json_schema");
  assert.strictEqual(first.body.messages[0].role, "system");
  assert.strictEqual(second.body.response_format.type, "json_object");
  assert.strictEqual(result.name, "Test Tone ñ 1234567890");
});

test("openrouter: free models listed first", async () => {
  const net = fakeNet([{ body: { data: [
    { id: "paid/model", name: "Paid", pricing: { prompt: "0.000001", completion: "0.000002" } },
    { id: "meta/llama:free", name: "Llama", pricing: { prompt: "0", completion: "0" } },
  ] } }]);
  const models = await PV.byId.openrouter.listModels({ key: "k", netFetch: net });
  assert.strictEqual(models[0].id, "meta/llama:free");
  assert.match(models[0].label, /gratis/);
  assert.strictEqual(PV.byId.openrouter.pickDefault(models), "meta/llama:free");
});

test("ollama: native chat with schema format and a large context", async () => {
  const net = fakeNet([{ body: { message: { role: "assistant", content: JSON.stringify(cannedResult()) } } }]);
  await AI.generate({ provider: "ollama", cfg: { model: "qwen3", base: "http://127.0.0.1:11434", netFetch: net }, ring, bankMap, request });
  const c = net.calls[0];
  assert.strictEqual(c.url, "http://127.0.0.1:11434/api/chat");
  assert.strictEqual(c.body.stream, false);
  assert.strictEqual(c.body.format.type, "object");
  assert.ok(c.body.options.num_ctx >= 16384);
});

test("refine keeps the conversation and asks for the full preset again", async () => {
  const answer = () => ({ body: { choices: [{ message: { content: JSON.stringify(cannedResult()) } }] } });
  const net = fakeNet([answer(), answer()]);
  const cfg = { key: "k", model: "m", netFetch: net };
  const first = await AI.generate({ provider: "groq", cfg, ring, bankMap, request });
  await AI.generate({ provider: "groq", cfg, ring, bankMap, request, refine: "más ganancia", history: first.history });
  const msgs = net.calls[1].body.messages;
  assert.deepStrictEqual(msgs.map((m) => m.role), ["system", "user", "assistant", "user"]);
  assert.match(msgs[3].content, /más ganancia/);
});

test("system prompt is byte-stable across users (prompt caching)", () => {
  const a = AI.systemPrompt(AI.catalog(ring, bankMap));
  const b = AI.systemPrompt(AI.catalog(ring, { snaptone: {}, ir: {} }));
  assert.strictEqual(a, b);
  assert.ok(a.length > 15000);
});

test("toPrst validates against the catalog and builds a valid .prst", () => {
  const res = cannedResult();
  const { bytes, warnings, name } = AI.toPrst(base, res, ring, bankMap);
  assert.strictEqual(bytes.length, 507); // GP-5
  assert.strictEqual(window.PRST.detect(bytes).key, "gp5");
  assert.strictEqual(name, "Test Tone  12345"); // ASCII only, 16 chars
  assert.ok(warnings.some((w) => w.startsWith("DLY")), "invalid model reported");
  const lib = window.PatchLib.make(ring, bankMap, window.PRST.GP5);
  const p = lib.inventory([{ slot: 0, bytes }]).patches[0];
  const byName = Object.fromEntries(p.blocks.map((b) => [b.block, b]));
  const amp = res.blocks.find((b) => b.block === "AMP");
  assert.strictEqual(byName.AMP.fxid, amp.model_id);
  assert.strictEqual(byName.MOD.active, false);
  assert.strictEqual(byName.AMP.active, true);
  const ampModel = cat.AMP.find((m) => m.id === amp.model_id);
  const p0 = ampModel.params.filter((q) => !q.toggle)[0];
  assert.strictEqual(byName.AMP.params.find((q) => q.name === p0.name).value, p0.max); // clamped
  assert.strictEqual(p.settings.patch_vol, 62);
  const baseP = lib.inventory([{ slot: 0, bytes: base }]).patches[0];
  assert.strictEqual(byName.DLY.fxid, baseP.blocks.find((b) => b.block === "DLY").fxid); // kept
  assert.strictEqual(bytes[window.PRST.CRC_OFF], window.PRST.crc8(bytes.subarray(window.PRST.CRC_OFF + 1)));
});

test("sloppy answers from small models are normalized", () => {
  const res = cannedResult();
  const amp = res.blocks.find((b) => b.block === "AMP");
  amp.model_id = String(amp.model_id);                                         // id as string
  amp.params = Object.fromEntries(amp.params.map((p) => [p.name, 10]));        // params as object
  res.blocks.find((b) => b.block === "NS").block = "N->S";                     // arrow name
  res.blocks.find((b) => b.block === "EQ").enabled = "true";                   // bool as string
  const { bytes, warnings } = AI.toPrst(base, res, ring, bankMap);
  assert.ok(!warnings.some((w) => /^(AMP|NS|EQ):/.test(w)), warnings.join(" | "));
  const p = window.PatchLib.make(ring, bankMap, window.PRST.GP5).inventory([{ slot: 0, bytes }]).patches[0];
  const ampB = p.blocks.find((b) => b.block === "AMP");
  assert.strictEqual(ampB.fxid, Number(amp.model_id));
  assert.ok(ampB.params.some((q) => q.value === 10));
  assert.strictEqual(p.blocks.find((b) => b.block === "EQ").active, true);
});

test("provider settings stay on this device; old Claude key is migrated", () => {
  assert.strictEqual(PV.settings.get("anthropic").key, "sk-ant-legacy");
  assert.strictEqual(PV.settings.provider(), "anthropic");
  PV.settings.setProvider("gemini");
  PV.settings.set("gemini", { key: " AIzaX ", model: "gemini-2.5-flash" });
  assert.deepStrictEqual(PV.settings.get("gemini"), { key: "AIzaX", model: "gemini-2.5-flash", base: "" });
  assert.strictEqual(PV.settings.provider(), "gemini");
  assert.strictEqual(PV.settings.get("ollama").base, "http://127.0.0.1:11434");
});

test("overloaded (503) is retried, then succeeds", async () => {
  const ok = { body: { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(cannedResult()) }] } }] } };
  const busy = { status: 503, body: { error: { message: "This model is currently experiencing high demand." } } };
  const net = fakeNet([busy, busy, ok]);
  const retries = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0); // don't actually wait
  try {
    const { result } = await AI.generate({
      provider: "gemini", cfg: { key: "k", model: "gemini-3.8-flash", netFetch: net }, ring, bankMap, request,
      onRetry: (n, max, wait) => retries.push([n, max, wait]),
    });
    assert.strictEqual(result.patch_volume, 62);
  } finally { globalThis.setTimeout = realSetTimeout; }
  assert.deepStrictEqual(retries.map((r) => r[0]), [1, 2]);
  assert.strictEqual(net.calls.length, 3);
});

test("daily quota and permanent errors are not retried; retries are bounded", async () => {
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);
  try {
    const daily = fakeNet([{ status: 429, body: { error: { message: "Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel-FreeTier" } } }]);
    await assert.rejects(AI.generate({ provider: "gemini", cfg: { key: "k", model: "m", netFetch: daily }, ring, bankMap, request }), (e) => e.status === 429 && AI.isDailyQuota(e));
    assert.strictEqual(daily.calls.length, 1);
    const bad = fakeNet([{ status: 400, body: { error: { message: "bad request" } } }, { status: 400, body: { error: { message: "bad request" } } }]);
    await assert.rejects(AI.generate({ provider: "gemini", cfg: { key: "k", model: "m", netFetch: bad }, ring, bankMap, request }), (e) => e.status === 400);
    const busy = { status: 503, body: { error: { message: "busy" } } };
    const always = fakeNet([busy, busy, busy, busy, busy]);
    await assert.rejects(AI.generate({ provider: "groq", cfg: { key: "k", model: "m", netFetch: always }, ring, bankMap, request }), (e) => e.status === 503);
    assert.strictEqual(always.calls.length, 4); // 1 try + 3 retries
  } finally { globalThis.setTimeout = realSetTimeout; }
});

test("anthropic: 'no credit' becomes a clear message, not raw JSON", async () => {
  const fetch = async () => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." }, request_id: "req_x" }), { status: 400, headers: { "content-type": "application/json" } });
  let err = null;
  try { await AI.generate({ provider: "anthropic", cfg: { key: "sk-ant-test", model: "claude-opus-5", fetch }, ring, bankMap, request }); }
  catch (e) { err = e; }
  const x = PV.byId.anthropic.explainError(err);
  assert.ok(x.noCredit);
  assert.match(x.msg, /no tiene saldo/);
  assert.doesNotMatch(x.msg, /\{/);
});

test("song tempo from the AI sets the preset BPM; nonsense tempos are ignored", () => {
  const lib = window.PatchLib.make(ring, bankMap, window.PRST.GP5);
  const bpmOf = (bpm) => lib.inventory([{ slot: 0, bytes: AI.toPrst(base, { ...cannedResult(), bpm }, ring, bankMap).bytes }]).patches[0].settings.bpm;
  const baseBpm = lib.inventory([{ slot: 0, bytes: base }]).patches[0].settings.bpm;
  assert.strictEqual(bpmOf(134), 134);
  assert.strictEqual(bpmOf(0), baseBpm);
  assert.strictEqual(bpmOf(900), baseBpm);
  assert.ok(AI.PRESET_SCHEMA.required.includes("original_gear") && AI.PRESET_SCHEMA.required.includes("playing_tips"));
});
