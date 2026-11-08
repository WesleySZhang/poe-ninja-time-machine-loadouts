"use strict";
// Self-update file for Firefox (format: extensionworkshop.com, "Updating your extension") and the version bump.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeUpdates, xpiName, SITE, UPDATE_URL } = require("../tools/updates_json.js");
const { setVersion } = require("../tools/set_version.js");

const OPTS = { id: "x@y", version: "0.1.1", link: SITE + xpiName("0.1.1"), sha256: "a".repeat(64), minVersion: "140.0" };

test("makeUpdates writes Mozilla's update manifest shape for the newest version", () => {
  assert.deepEqual(makeUpdates(OPTS), {
    addons: { "x@y": { updates: [{
      version: "0.1.1",
      update_link: "https://wesleyszhang.github.io/poe-ninja-time-machine-loadouts/poe-ninja-time-machine-loadouts-0.1.1-firefox.xpi",
      update_hash: "sha256:" + "a".repeat(64),
      applications: { gecko: { strict_min_version: "140.0" } },
    }] } },
  });
  assert.equal(UPDATE_URL, SITE + "updates.json");
});

test("makeUpdates rejects missing fields, non-https links and bad hashes", () => {
  for (const k of Object.keys(OPTS)) assert.throws(() => makeUpdates(Object.assign({}, OPTS, { [k]: "" })), new RegExp("needs " + k));
  assert.throws(() => makeUpdates(Object.assign({}, OPTS, { link: "http://x/a.xpi" })), /https/);
  assert.throws(() => makeUpdates(Object.assign({}, OPTS, { sha256: "abc" })), /64 hex/);
});

test("setVersion changes only the top-level version and keeps formatting", () => {
  const text = '{\n  "name": "n",\n  "version": "0.1.0",\n  "deps": { "a": { "version": "9.9.9" } }\n}\n';
  assert.equal(setVersion(text, "0.1.1"), text.replace('"0.1.0"', '"0.1.1"'));
  assert.throws(() => setVersion(text, "0.1"), /look like/);
  assert.throws(() => setVersion("{}", "1.0.0"), /No version field/);
});
