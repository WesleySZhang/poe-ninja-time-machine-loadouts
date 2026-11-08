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
      // 140 (ESR) / 142 on Android are the first versions with data_collection_permissions; supporting older
      // ones would need a consent screen of our own (Mozilla add-on policies).
      strict_min_version: "140.0",
      // Nothing is sent to the developer. When the user presses Generate, the character's build (fetched
      // from poe.ninja) is uploaded to pobb.in: Mozilla's "websiteContent" category, declared so the
      // install prompt says so (extensionworkshop.com, firefox-builtin-data-consent and add-on policies).
      data_collection_permissions: { required: ["websiteContent"] },
    }, gecko_android: { strict_min_version: "142.0" } },
  }),
};
const files = ["pobcode.js", "merge.js", "ninja.js", "content.js", "upload.js", "background.js"];

for (const [name, manifest] of Object.entries(targets)) {
  const out = path.join(root, "dist", name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "src"), { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(root, "src", f), path.join(out, "src", f));
  fs.mkdirSync(path.join(out, "icons"));
  for (const size of Object.keys(manifest.icons)) {
    const icon = manifest.icons[size];
    fs.copyFileSync(path.join(root, icon), path.join(out, icon));
  }
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("built " + path.relative(root, out));
}
