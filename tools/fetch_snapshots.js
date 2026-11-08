// Dev tool: fetch every time machine snapshot of one character, merge them like the extension
// does, and write everything to an output folder (default .local/<name>/, gitignored: it holds
// account names). Usage: node tools/fetch_snapshots.js <poe.ninja character page URL> [outDir] [labels,comma,separated]
"use strict";
const fs = require("fs");
const path = require("path");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const N = require("../src/ninja.js");
const Code = require("../src/pobcode.js");
const { mergeSnapshots } = require("../src/merge.js");

async function main() {
  const [pageUrl, outArg, labelsArg] = process.argv.slice(2);
  const ch = N.parseCharacterUrl(pageUrl || "");
  if (!ch) throw new Error("Give a poe.ninja PoE 1 character page URL");
  const out = outArg || path.join(__dirname, "..", ".local", ch.name);
  fs.mkdirSync(out, { recursive: true });
  const ua = (url, init) => fetch(url, Object.assign({}, init, {
    headers: Object.assign({}, init && init.headers, { "User-Agent": "PoE-Ninja-Extension-dev (test fixtures)" }),
  }));
  const client = N.createClient(ua, { concurrency: 1, delayMs: 1000 });
  const version = await client.getVersion(ch);
  const latest = await client.getSnapshot(version, ch, "latest");
  const labels = labelsArg ? N.sortLabels(labelsArg.split(",")) : latest.labels;
  const snaps = new Map();
  for (const label of labels) {
    const snap = label === "latest" ? latest : await client.getSnapshot(version, ch, label);
    snaps.set(label, snap);
    console.log("fetched " + label + " (level " + snap.level + ", " + snap.code.length + " chars code)");
  }
  // Same grouping as the panel: a run of identical snapshots becomes one loadout, from its first snapshot.
  const groups = N.groupSnapshots(labels, (l) => snaps.get(l).code);
  const reps = groups.map((g) => g.key);
  const parts = [];
  const manifest = [];
  for (const g of groups) {
    const snap = snaps.get(g.key);
    const xml = await Code.decode(snap.code);
    const name = g.name + (snap.level ? " (Lv " + snap.level + ")" : "");
    fs.writeFileSync(path.join(out, g.key + ".xml"), xml);
    parts.push({ name, level: snap.level, url: N.characterPageUrl("https://poe.ninja", ch, g.key), xml });
    manifest.push([name, snap.level || 0, g.key + ".xml"].join("\t"));
    if (g.labels.length > 1) console.log("grouped " + g.labels.join(", ") + " as " + g.name);
  }
  const res = mergeSnapshots(parts, { DOMParser, XMLSerializer });
  const merged = res.xml;
  const code = await Code.encode(merged);
  fs.writeFileSync(path.join(out, "merged.xml"), merged);
  // PoB keeps one Party for the whole build (the latest snapshot's). For loadouts whose Party
  // differed, pob_check compares against the snapshot with that Party swapped in, so every other
  // difference still has to be zero.
  const baseParty = new DOMParser().parseFromString(parts[parts.length - 1].xml, "text/xml").getElementsByTagName("Party")[0];
  parts.forEach((p, i) => {
    if (res.partyDiffers.indexOf(p.name) === -1) return;
    const doc = new DOMParser().parseFromString(p.xml, "text/xml");
    const old = doc.getElementsByTagName("Party")[0];
    if (old) old.parentNode.removeChild(old);
    if (baseParty) doc.documentElement.appendChild(doc.importNode(baseParty, true));
    const file = reps[i] + ".withLatestParty.xml";
    fs.writeFileSync(path.join(out, file), '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(doc.documentElement));
    manifest[i] = manifest[i].replace(/[^\t]+$/, file) + "\tparty";
  });
  for (const w of res.warnings) console.log("warning: " + w);
  fs.writeFileSync(path.join(out, "merged.code.txt"), code);
  fs.writeFileSync(path.join(out, "manifest.tsv"), manifest.join("\n") + "\n");
  console.log("merged " + labels.length + " snapshots as " + parts.length + " loadouts: " + merged.length + " chars XML, " + code.length + " chars code -> " + out);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
