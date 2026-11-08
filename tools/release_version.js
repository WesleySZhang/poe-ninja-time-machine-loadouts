// Checks that a release tag ("v1.2.3") matches the version in manifest.base.json and package.json, so a
// release can't ship files that say a different version. Prints the version.
// Usage: node tools/release_version.js <tag>   (the release workflow passes the pushed tag)
"use strict";
const fs = require("fs");
const path = require("path");

/** @returns {string} the version, or throws with a message saying what to fix. */
function checkReleaseVersion(tag, manifestVersion, packageVersion) {
  const m = /^v(\d+\.\d+\.\d+)$/.exec(String(tag || ""));
  if (!m) throw new Error('Release tags look like "v1.2.3", got "' + tag + '"');
  const v = m[1];
  if (manifestVersion !== v) throw new Error("Tag " + tag + " but manifest.base.json has version " + manifestVersion);
  if (packageVersion !== v) throw new Error("Tag " + tag + " but package.json has version " + packageVersion);
  return v;
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), "utf8")).version;
  try {
    console.log(checkReleaseVersion(process.argv[2], read("manifest.base.json"), read("package.json")));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { checkReleaseVersion };
