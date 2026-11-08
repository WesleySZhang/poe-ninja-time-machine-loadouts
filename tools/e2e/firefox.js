// Firefox end-to-end: a copy of dist/firefox with the pobb.in URL pointed at a local stand-in server.
const puppeteer = require("puppeteer-core");
const fs = require("fs"), path = require("path"), http = require("http");
const root = path.join(__dirname, "..", "..");
const pageUrl = process.argv[2];
if (!pageUrl) { console.error("Usage: npm run e2e:firefox -- <poe.ninja character page URL>"); process.exit(2); }
const src = path.join(root, "dist", "firefox");
const work = path.join(root, ".local", "e2e-firefox-ext");
(async () => {
  let uploaded = null;
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", (d) => body += d);
    req.on("end", () => { uploaded = { method: req.method, url: req.url, body };
      res.writeHead(200, { "Content-Type": "text/plain" }); res.end("FakeFx456"); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  fs.rmSync(work, { recursive: true, force: true });
  fs.cpSync(src, work, { recursive: true });
  const up = path.join(work, "src", "upload.js");
  fs.writeFileSync(up, fs.readFileSync(up, "utf8").replace('POST_URL = "https://pobb.in/pob/"', `POST_URL = "http://127.0.0.1:${port}/pob/"`));
  const mf = JSON.parse(fs.readFileSync(path.join(work, "manifest.json"), "utf8"));
  mf.host_permissions.push("http://127.0.0.1/*");
  fs.writeFileSync(path.join(work, "manifest.json"), JSON.stringify(mf, null, 2));

  if (!fs.readFileSync(up, "utf8").includes(`POST_URL = "http://127.0.0.1:${port}/pob/"`)) throw new Error("patch to the local upload server did not apply; refusing to run");
  console.log("patched upload.js ->", fs.readFileSync(up, "utf8").match(/POST_URL = [^;]+/)[0]);
  const browser = await puppeteer.launch({ browser: "firefox", executablePath: process.env.E2E_FIREFOX || "C:/Program Files/Mozilla Firefox/firefox.exe", headless: true,
    // Safety net: pobb.in resolves to this machine, so a real upload can't happen from this test.
    extraPrefsFirefox: { "network.dns.localDomains": "pobb.in" } });
  try {
    const id = await browser.installExtension(work);
    console.log("installed", id, "firefox", await browser.version());
    const page = await browser.newPage();
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => { const h = document.getElementById("ninja-pob-snapshots"); return h && h.shadowRoot && h.shadowRoot.querySelector(".tab"); }, { timeout: 30000 });
    const opened = Date.now();
    await page.evaluate(() => document.getElementById("ninja-pob-snapshots").shadowRoot.querySelector(".tab").click());
    await page.waitForFunction(() => document.getElementById("ninja-pob-snapshots").shadowRoot.querySelectorAll(".list input").length > 0, { timeout: 30000 });
    console.log("snapshot list ready in " + (Date.now() - opened) + " ms");
    const n = await page.evaluate(() => {
      const r = document.getElementById("ninja-pob-snapshots").shadowRoot;
      r.querySelector(".all input").click(); // all -> none
      const boxes = r.querySelectorAll(".list input"); boxes[0].click(); boxes[boxes.length - 1].click();
      r.querySelector(".gen").click();
      return boxes.length;
    });
    await page.waitForFunction(() => { const r = document.getElementById("ninja-pob-snapshots").shadowRoot; return r.querySelector(".result input") || r.querySelector(".status.err"); }, { timeout: 60000 });
    const res = await page.evaluate(() => { const r = document.getElementById("ninja-pob-snapshots").shadowRoot; const i = r.querySelector(".result input"); return { link: i && i.value, status: r.querySelector(".status").textContent }; });
    console.log("snapshots:", n, "| status:", res.status, "| link:", res.link);
    console.log("upload:", uploaded ? uploaded.method + " " + uploaded.url + " " + uploaded.body.length + " chars" : "none");
    if (uploaded) fs.writeFileSync(path.join(work, "..", "uploaded_fx.txt"), uploaded.body);
    if (!uploaded || res.link !== "https://pobb.in/FakeFx456") process.exitCode = 1;
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error("E2E FAIL:", e.message); process.exit(1); });
