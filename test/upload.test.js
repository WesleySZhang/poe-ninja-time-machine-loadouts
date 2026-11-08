"use strict";
// pobb.in upload as PoB v2.67.2 does it (src/Modules/BuildSiteTools.lua): POST the raw code to
// https://pobb.in/pob/, a 200 reply body is the id, link = "https://pobb.in/" .. id.
const test = require("node:test");
const assert = require("node:assert/strict");
const { uploadToPobbin } = require("../src/upload.js");

function reply(status, text) {
  return { ok: status === 200, status, text: async () => text };
}

test("posts the raw code to pobb.in and returns the share link", async () => {
  let seen;
  const link = await uploadToPobbin("eNrCODE", async (url, init) => { seen = { url, init }; return reply(200, "AbC_12-x\n"); });
  assert.equal(link, "https://pobb.in/AbC_12-x");
  assert.equal(seen.url, "https://pobb.in/pob/");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.body, "eNrCODE");
});

test("upload failures give clear messages", async () => {
  await assert.rejects(uploadToPobbin("", async () => reply(200, "x")), /Nothing to upload/);
  await assert.rejects(uploadToPobbin("c", async () => { throw new TypeError("offline"); }), /Could not reach pobb.in/);
  await assert.rejects(uploadToPobbin("c", async () => reply(413, "too large")), /refused the upload \(HTTP 413: too large\)/);
  await assert.rejects(uploadToPobbin("c", async () => reply(200, "<html>oops</html>")), /unexpected reply/);
});
