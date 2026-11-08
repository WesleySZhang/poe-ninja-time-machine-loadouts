"use strict";
// The release workflow (.github/workflows/release.yml) refuses to publish when the tag and the versions
// inside the files disagree.
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkReleaseVersion } = require("../tools/release_version.js");

test("checkReleaseVersion accepts a tag that matches both files", () => {
  assert.equal(checkReleaseVersion("v1.2.3", "1.2.3", "1.2.3"), "1.2.3");
});

test("checkReleaseVersion rejects malformed tags and mismatched versions", () => {
  for (const tag of ["1.2.3", "v1.2", "v1.2.3-beta", "", undefined]) {
    assert.throws(() => checkReleaseVersion(tag, "1.2.3", "1.2.3"), /look like "v1.2.3"/, String(tag));
  }
  assert.throws(() => checkReleaseVersion("v1.2.4", "1.2.3", "1.2.4"), /manifest.base.json has version 1.2.3/);
  assert.throws(() => checkReleaseVersion("v1.2.4", "1.2.4", "1.2.3"), /package.json has version 1.2.3/);
});
