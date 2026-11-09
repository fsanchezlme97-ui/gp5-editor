"use strict";
// The in-app guide must cover the whole GP-5 catalog: every parameter of every
// model has an explanation, and every factory model has a description.
const test = require("node:test");
const assert = require("node:assert");

globalThis.window = globalThis;
require("../src/ui/guide_data.js");
const G = window.GuideData;
const ring = require("../src/data/fxid_ring_gp5.json");

const BLOCK = { "N→S": "N->S" };
const entries = Object.entries(ring).map(([id, e]) => ({ id: Number(id), block: BLOCK[e.module] || e.module, ...e }));

test("every block has a description and a tip", () => {
  for (const b of ["NR", "PRE", "DST", "AMP", "CAB", "EQ", "MOD", "DLY", "RVB", "N->S"]) {
    assert.ok(G.BLOCKS[b] && G.BLOCKS[b].what && G.BLOCKS[b].tip, b);
  }
});

test("every parameter of every model is explained", () => {
  const missing = new Set();
  for (const e of entries) {
    for (const p of e.params || []) {
      const info = G.param(e.block, p.name);
      if (!info || !info.what) missing.add(`${e.block}/${p.name}`);
    }
  }
  assert.deepStrictEqual([...missing], []);
});

test("every factory model has a description", () => {
  const missing = entries
    .filter((e) => e.block !== "N->S" && !(e.block === "CAB" && (e.id & 0xffffff) >= 0x100000))
    .filter((e) => !(G.model(e.id, e.block) || {}).desc)
    .map((e) => `${e.block}/${e.name}`);
  assert.deepStrictEqual(missing, []);
});

test("value bands are ordered and end at the top of the range", () => {
  for (const e of entries) {
    for (const p of e.params || []) {
      const info = G.param(e.block, p.name);
      if (!info || !info.bands) continue;
      const lims = info.bands.map((b) => b[0]);
      assert.deepStrictEqual(lims, [...lims].sort((a, z) => a - z), `${e.block}/${p.name}`);
      assert.strictEqual(lims[lims.length - 1], 1, `${e.block}/${p.name}`);
    }
  }
});
