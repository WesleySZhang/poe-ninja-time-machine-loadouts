// End-to-end (Edge/Chromium): load dist/chrome, open a character page, use the panel, check the result.
// pobb.in is intercepted in the extension's service worker: the code is saved, a fake id returned.
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "..");
const pageUrl = process.argv[2];
if (!pageUrl) { console.error("Usage: npm run e2e:edge -- <poe.ninja character page URL>"); process.exit(2); }
const ext = path.join(root, "dist", "chrome");
const outFile = path.join(root, ".local", "e2e-edge-upload.txt");
const shot = path.join(root, ".local", "e2e-edge.png");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.E2E_CHROMIUM || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
    // Safety net: pobb.in resolves to this machine, so if interception ever fails no real upload happens.
    args: ["--disable-extensions-except=" + ext, "--load-extension=" + ext, "--no-first-run", "--host-resolver-rules=MAP pobb.in 127.0.0.1"],
  });
  try {
    const sw = await browser.waitForTarget((t) => t.type() === "service_worker", { timeout: 15000 });
    const cdp = await sw.createCDPSession();
    let uploaded = null;
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "https://pobb.in/*" }] });
    cdp.on("Fetch.requestPaused", async (ev) => {
      uploaded = { url: ev.request.url, method: ev.request.method, body: ev.request.postData || "" };
      if (ev.request.hasPostData && !uploaded.body) {
        try { uploaded.body = (await cdp.send("Fetch.getRequestPostData", { requestId: ev.requestId })).postData; } catch (e) {}
      }
      await cdp.send("Fetch.fulfillRequest", { requestId: ev.requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "text/plain" }, { name: "Access-Control-Allow-Origin", value: "*" }],
        body: Buffer.from("FakeId123").toString("base64") });
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    const tab = await page.waitForFunction(() => {
      const h = document.getElementById("ninja-pob-snapshots");
      return h && h.shadowRoot && h.shadowRoot.querySelector(".tab");
    }, { timeout: 20000 });
    const opened = Date.now();
    await tab.click();
    await page.waitForFunction(() => document.getElementById("ninja-pob-snapshots").shadowRoot.querySelectorAll(".list input").length > 0, { timeout: 30000 });
    console.log("snapshot list ready in " + (Date.now() - opened) + " ms");
    const labels = await page.evaluate(() => Array.from(document.getElementById("ninja-pob-snapshots").shadowRoot.querySelectorAll(".list label")).map((l) => l.textContent));
    console.log("snapshots shown:", labels.join(", "));
    // Untick everything, then tick the first, a middle one and the last: exercises Select all and single boxes.
    await page.evaluate(() => {
      const r = document.getElementById("ninja-pob-snapshots").shadowRoot;
      const all = r.querySelector(".all input");
      if (all.checked) all.click();
      const boxes = r.querySelectorAll(".list input");
      [0, Math.floor(boxes.length / 2), boxes.length - 1].forEach((i) => boxes[i].click());
    });
    const state = await page.evaluate(() => {
      const r = document.getElementById("ninja-pob-snapshots").shadowRoot;
      return { all: r.querySelector(".all input").indeterminate, gen: r.querySelector(".gen").disabled,
        checked: Array.from(r.querySelectorAll(".list input")).filter((b) => b.checked).map((b) => b.dataset.label) };
    });
    console.log("selected:", state.checked.join(", "), "| select-all indeterminate:", state.all, "| generate disabled:", state.gen);
    await page.evaluate(() => document.getElementById("ninja-pob-snapshots").shadowRoot.querySelector(".gen").click());
    await page.waitForFunction(() => {
      const r = document.getElementById("ninja-pob-snapshots").shadowRoot;
      return r.querySelector(".result input") || (r.querySelector(".status.err"));
    }, { timeout: 60000 });
    const result = await page.evaluate(() => {
      const r = document.getElementById("ninja-pob-snapshots").shadowRoot;
      const i = r.querySelector(".result input");
      return { link: i && i.value, status: r.querySelector(".status").textContent };
    });
    console.log("status:", result.status);
    console.log("link:", result.link);
    if (shot) await page.screenshot({ path: shot });
    if (!uploaded) throw new Error("no upload reached pobb.in");
    console.log("upload:", uploaded.method, uploaded.url, uploaded.body.length, "chars");
    fs.writeFileSync(outFile, uploaded.body);
    if (result.link !== "https://pobb.in/FakeId123") throw new Error("panel did not show the expected link");
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error("E2E FAIL:", e.message); process.exit(1); });
