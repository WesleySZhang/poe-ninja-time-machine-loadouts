"use strict";
// PoB code format = base64url(zlib deflate(XML)), per PoB v2.67.2 src/Classes/ImportTab.lua:504 (export)
// and :631 (import). Independent reference here: Node's zlib (inflateSync / deflateSync).
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { decode, encode } = require("../src/pobcode.js");

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n<PathOfBuilding><Notes>Kaom’s Heart éè 漢字</Notes></PathOfBuilding>';

function pobStyle(xml) {
  return zlib.deflateSync(Buffer.from(xml, "utf8")).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

test("decode reads a code made the way PoB makes it (zlib + base64 with - and _)", async () => {
  assert.equal(await decode(pobStyle(XML)), XML);
});

test("decode accepts codes without padding and with surrounding whitespace", async () => {
  const code = pobStyle(XML).replace(/=+$/, "");
  assert.equal(await decode("  " + code + "\n"), XML);
});

test("encode produces a code that zlib inflates back to the same XML, using only PoB's alphabet", async () => {
  const code = await encode(XML);
  assert.match(code, /^[A-Za-z0-9_-]+=*$/);
  const back = zlib.inflateSync(Buffer.from(code.replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString("utf8");
  assert.equal(back, XML);
});

test("encode and decode round-trip a large build (>64 KB, exercises chunked base64)", async () => {
  let big = "<PathOfBuilding>";
  for (let i = 0; i < 20000; i++) big += `<Item id="${i}">${(i * 2654435761 % 1000003).toString(36)}</Item>`;
  big += "</PathOfBuilding>";
  assert.equal(await decode(await encode(big)), big);
});

test("bad codes fail with a clear message", async () => {
  await assert.rejects(decode(""), /not valid base64/);
  await assert.rejects(decode("not a code!"), /not valid base64/);
  await assert.rejects(decode(Buffer.from("plain text, not deflate").toString("base64")), /could not be decompressed/);
  await assert.rejects(decode(42), /must be a string/);
  await assert.rejects(encode(""), /non-empty string/);
});
