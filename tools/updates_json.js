// Writes the self-update site for Firefox: updates.json plus the signed .xpi it points to. The release
// workflow publishes this folder to GitHub Pages, which the add-on's update_url (tools/build.js) reads.
// Format: extensionworkshop.com, "Updating your extension" (addons -> id -> updates[] with version,
// update_link, update_hash "sha256:...", applications.gecko.strict_min_version). Firefox checks daily.
// Usage: node tools/updates_json.js <signed.xpi> <outDir>   (reads id/version from dist/firefox/manifest.json)
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SITE = "https://wesleyszhang.github.io/poe-ninja-time-machine-loadouts/";
const UPDATE_URL = SITE + "updates.json";

/** Firefox only needs the newest version, so the file lists just that one. */
function makeUpdates(opts) {
  for (const k of ["id", "version", "link", "sha256", "minVersion"]) {
    if (!opts || !opts[k]) throw new Error("makeUpdates needs " + k);
  }
  if (!/^https:\/\//.test(opts.link)) throw new Error("update_link must be https");
  if (!/^[0-9a-f]{64}$/.test(opts.sha256)) throw new Error("sha256 must be 64 hex characters");
  return {
    addons: {
      [opts.id]: {
        updates: [{
          version: opts.version,
          update_link: opts.link,
          update_hash: "sha256:" + opts.sha256,
          applications: { gecko: { strict_min_version: opts.minVersion } },
        }],
      },
    },
  };
}

function xpiName(version) {
  return "poe-ninja-time-machine-loadouts-" + version + "-firefox.xpi";
}

if (require.main === module) {
  const [xpi, outDir] = process.argv.slice(2);
  if (!xpi || !outDir) { console.error("Usage: node tools/updates_json.js <signed.xpi> <outDir>"); process.exit(1); }
  const root = path.join(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "dist", "firefox", "manifest.json"), "utf8"));
  const gecko = manifest.browser_specific_settings.gecko;
  if (gecko.update_url !== UPDATE_URL) throw new Error("manifest update_url is " + gecko.update_url + ", expected " + UPDATE_URL);
  const bytes = fs.readFileSync(xpi);
  const name = xpiName(manifest.version);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), bytes);
  const updates = makeUpdates({
    id: gecko.id,
    version: manifest.version,
    link: SITE + name,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    minVersion: gecko.strict_min_version,
  });
  fs.writeFileSync(path.join(outDir, "updates.json"), JSON.stringify(updates, null, 2) + "\n");
  console.log("wrote " + path.join(outDir, "updates.json") + " for " + manifest.version);
}

module.exports = { makeUpdates, xpiName, SITE, UPDATE_URL };
