// Builds dist/chrome and dist/firefox from manifest.base.json and src/.
// Chrome MV3 needs a service worker background; Firefox MV3 uses background scripts and a gecko id.
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const base = JSON.parse(fs.readFileSync(path.join(root, "manifest.base.json"), "utf8"));
const targets = {
  chrome: Object.assign({}, base, { background: { service_worker: "src/background.js" } }),
  firefox: Object.assign({}, base, {
    background: { scripts: ["src/pobcode.js", "src/upload.js", "src/background.js"] },
    browser_specific_settings: { gecko: {
      id: "time-machine-loadouts@poe-ninja-extension",
      strict_min_version: "115.0",
      // Nothing is sent to the developer; the only upload is the build the user chooses to share on pobb.in.
      data_collection_permissions: { required: ["none"] },
    } },
  }),
};
const files = ["pobcode.js", "merge.js", "ninja.js", "content.js", "upload.js", "background.js"];

for (const [name, manifest] of Object.entries(targets)) {
  const out = path.join(root, "dist", name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "src"), { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(root, "src", f), path.join(out, "src", f));
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("built " + path.relative(root, out));
}
