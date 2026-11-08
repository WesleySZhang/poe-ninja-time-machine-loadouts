// Renders icons/icon.svg to the PNG sizes the manifests and the store listings use, with headless Edge
// (E2E_CHROMIUM overrides the browser path). Usage: node tools/icons.js
"use strict";
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const root = path.join(__dirname, "..");
const SIZES = [16, 32, 48, 96, 128];
const browserPath = process.env.E2E_CHROMIUM || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

(async () => {
  const svg = fs.readFileSync(path.join(root, "icons", "icon.svg"), "utf8");
  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage();
    for (const size of SIZES) {
      await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
      await page.setContent('<html><body style="margin:0;background:transparent">' +
        svg.replace(/width="128" height="128"/, 'width="' + size + '" height="' + size + '"') + "</body></html>");
      const out = path.join(root, "icons", "icon-" + size + ".png");
      await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
      console.log("wrote " + path.relative(root, out));
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
