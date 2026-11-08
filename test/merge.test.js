"use strict";
// Merge rules, each checked against the PoB v2.67.2 behaviour it relies on (cited in src/merge.js):
// loadout tags (Build.lua SyncLoadouts), global item ids (ItemsTab.lua / PassiveSpec.lua Load),
// one mainSocketGroup for the build (Build.lua Load), Auto level (Build.lua EstimatePlayerProgress).
const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeSnapshots } = require("../src/merge.js");
const { dom, pobXml, parse, kids, one, itemTexts } = require("./helpers.js");

const xmlOf = (snapshots) => mergeSnapshots(snapshots, dom).xml;

const RING_A = "Rarity: RARE\nGale Loop\nTwo-Stone Ring\n+30 to maximum Life";
const RING_B = "Rarity: RARE\nDoom Band\nTwo-Stone Ring\n+50 to maximum Life";
const JEWEL = "Rarity: RARE\nGlow Eye\nCobalt Jewel\n+5% to maximum Energy Shield";
const BODY = "Rarity: UNIQUE\nKaom's Heart\nGlorious Plate";

function twoSnapshots() {
  return [
    {
      name: "Day 5 (Lv 72)", level: 72, url: "https://poe.ninja/a?timemachine=day-5",
      xml: pobXml({
        level: 72, mainSocketGroup: 2, skills: ["Arc", "Ball Lightning"],
        items: [{ id: 3, text: RING_A }, { id: 7, text: JEWEL }],
        itemSets: [{ id: 1, slots: [["Ring 1", 3], ["Ring 2", 0]] }],
        specs: [{ nodes: "1,2", sockets: [["26196", 7], ["61419", 0]] }],
      }),
    },
    {
      name: "Latest (Lv 100)", level: 100, url: "https://poe.ninja/a",
      xml: pobXml({
        level: 100, mainSocketGroup: 3, skills: ["Frostbolt", "Herald of Ice", "Vortex"],
        items: [{ id: 1, text: RING_B }, { id: 2, text: JEWEL }, { id: 5, text: BODY }],
        itemSets: [
          { id: 1, slots: [["Ring 1", 1], ["Body Armour", 5]] },
          { id: 2, title: "Animate Guardian", slots: [["Body Armour", 5]] },
        ],
        specs: [{ nodes: "1,2,3,4", sockets: [["26196", 2]] }],
      }),
    },
  ];
}

test("each snapshot becomes a loadout: tree, item, skill and config sets share its {tag}", () => {
  const doc = parse(xmlOf(twoSnapshots()));
  const titles = (tag) => Array.from(doc.getElementsByTagName(tag)).map((n) => n.getAttribute("title"));
  assert.deepEqual(titles("Spec"), ["Day 5 (Lv 72) {1}", "Latest (Lv 100) {2}"]);
  assert.deepEqual(titles("SkillSet"), ["Day 5 (Lv 72) {1}", "Latest (Lv 100) {2}"]);
  assert.deepEqual(titles("ConfigSet"), ["Day 5 (Lv 72) {1}", "Latest (Lv 100) {2}"]);
  // The extra "Animate Guardian" set keeps its name, carries no tag, so it can't join a loadout.
  assert.deepEqual(titles("ItemSet"), ["Day 5 (Lv 72) {1}", "Latest (Lv 100) {2}", "Latest (Lv 100) - Animate Guardian"]);
});

test("set ids are sequential and the latest snapshot's loadout is active", () => {
  const doc = parse(xmlOf(twoSnapshots()));
  const ids = (tag) => Array.from(doc.getElementsByTagName(tag)).map((n) => n.getAttribute("id"));
  assert.deepEqual(ids("ItemSet"), ["1", "2", "3"]);
  assert.deepEqual(ids("SkillSet"), ["1", "2"]);
  assert.deepEqual(ids("ConfigSet"), ["1", "2"]);
  assert.equal(one(doc, "Items").getAttribute("activeItemSet"), "2");
  assert.equal(one(doc, "Skills").getAttribute("activeSkillSet"), "2");
  assert.equal(one(doc, "Config").getAttribute("activeConfigSet"), "2");
  assert.equal(one(doc, "Tree").getAttribute("activeSpec"), "2"); // activeSpec is a 1-based index
});

test("item ids are renumbered and every slot and jewel socket still points at the same item", () => {
  const snaps = twoSnapshots();
  const doc = parse(xmlOf(snaps));
  const texts = itemTexts(doc);
  const sets = kids(one(doc, "Items"), "ItemSet");
  const slot = (set, name) => kids(set, "Slot").find((s) => s.getAttribute("name") === name).getAttribute("itemId");
  assert.equal(texts.get(slot(sets[0], "Ring 1")), RING_A);
  assert.equal(slot(sets[0], "Ring 2"), "0"); // empty stays empty
  assert.equal(texts.get(slot(sets[1], "Ring 1")), RING_B);
  assert.equal(texts.get(slot(sets[1], "Body Armour")), BODY);
  assert.equal(texts.get(slot(sets[2], "Body Armour")), BODY);
  const specs = Array.from(doc.getElementsByTagName("Spec"));
  const socket = (spec, node) => kids(one(spec, "Sockets"), "Socket").find((s) => s.getAttribute("nodeId") === node).getAttribute("itemId");
  assert.equal(texts.get(socket(specs[0], "26196")), JEWEL);
  assert.equal(socket(specs[0], "61419"), "0");
  assert.equal(texts.get(socket(specs[1], "26196")), JEWEL);
});

test("identical items are kept once; items that differ in text or attributes are kept apart", () => {
  const doc = parse(xmlOf(twoSnapshots()));
  const texts = Array.from(itemTexts(doc).values());
  assert.deepEqual(texts.slice().sort(), [BODY, JEWEL, RING_A, RING_B].sort()); // JEWEL in both snapshots, kept once
  assert.deepEqual(Array.from(itemTexts(doc).keys()), ["1", "2", "3", "4"]);

  const variants = [
    { name: "A", xml: pobXml({ items: [{ id: 1, text: BODY, attrs: { variant: "1" } }], itemSets: [{ id: 1, slots: [["Body Armour", 1]] }] }) },
    { name: "B", xml: pobXml({ items: [{ id: 1, text: BODY, attrs: { variant: "2" } }], itemSets: [{ id: 1, slots: [["Body Armour", 1]] }] }) },
  ];
  const vdoc = parse(xmlOf(variants));
  const items = kids(one(vdoc, "Items"), "Item");
  assert.deepEqual(items.map((i) => i.getAttribute("variant")), ["1", "2"]);
});

test("a slot pointing at an item that does not exist becomes empty instead of pointing at another item", () => {
  const snaps = [{ name: "A", xml: pobXml({ items: [{ id: 1, text: RING_A }], itemSets: [{ id: 1, slots: [["Ring 1", 1], ["Ring 2", 99]] }] }) }];
  const doc = parse(xmlOf(snaps));
  const slots = kids(kids(one(doc, "Items"), "ItemSet")[0], "Slot");
  assert.deepEqual(slots.map((s) => s.getAttribute("itemId")), ["1", "0"]);
});

test("each snapshot's main socket group moves to position 1, and the build points at group 1", () => {
  const doc = parse(xmlOf(twoSnapshots()));
  const sets = Array.from(doc.getElementsByTagName("SkillSet"));
  const gems = (set) => kids(set, "Skill").map((s) => one(s, "Gem").getAttribute("nameSpec"));
  assert.deepEqual(gems(sets[0]), ["Ball Lightning", "Arc"]); // was group 2
  assert.deepEqual(gems(sets[1]), ["Vortex", "Frostbolt", "Herald of Ice"]); // was group 3
  const build = one(doc, "Build");
  assert.equal(build.getAttribute("mainSocketGroup"), "1");
  const skillNumber = kids(one(doc, "Calcs"), "Input").find((i) => i.getAttribute("name") === "skill_number");
  assert.equal(skillNumber.getAttribute("number"), "1");
});

test("character level is set to Auto and Build settings come from the latest snapshot", () => {
  const doc = parse(xmlOf(twoSnapshots()));
  const build = one(doc, "Build");
  assert.equal(build.getAttribute("characterLevelAutoMode"), "true");
  assert.equal(build.getAttribute("level"), "100");
  assert.equal(one(doc, "TreeView").getAttribute("zoomLevel"), "3");
});

test("only the active set of each kind joins the loadout; other sets get a plain name", () => {
  const snaps = [{
    name: "Week 2",
    xml: pobXml({
      activeSkillSet: 2, extraSkillSets: [{ title: "Mapping", gems: ["Flame Dash"] }],
      activeSpec: 2, specs: [{ nodes: "1", title: "Leveling" }, { nodes: "1,2" }],
    }),
  }];
  const doc = parse(xmlOf(snaps));
  const titles = (tag) => Array.from(doc.getElementsByTagName(tag)).map((n) => n.getAttribute("title"));
  assert.deepEqual(titles("SkillSet"), ["Week 2 - Skill set 1", "Week 2 {1}"]);
  assert.deepEqual(titles("Spec"), ["Week 2 - Leveling", "Week 2 {1}"]);
  assert.equal(one(doc, "Skills").getAttribute("activeSkillSet"), "2");
  assert.equal(one(doc, "Tree").getAttribute("activeSpec"), "2");
});

test("legacy layouts (skills and config inputs without sets) are wrapped into sets", () => {
  const snaps = [
    { name: "Old", xml: pobXml({ legacySkills: true, legacyConfig: true, skills: ["Arc", "Spark"], mainSocketGroup: 2 }) },
    { name: "New", xml: pobXml({}) },
  ];
  const doc = parse(xmlOf(snaps));
  const sets = Array.from(doc.getElementsByTagName("SkillSet"));
  assert.equal(sets.length, 2);
  assert.deepEqual(kids(sets[0], "Skill").map((s) => one(s, "Gem").getAttribute("nameSpec")), ["Spark", "Arc"]);
  assert.equal(kids(one(doc, "Skills"), "Skill").length, 0); // no stray direct children
  const configSets = Array.from(doc.getElementsByTagName("ConfigSet"));
  assert.equal(configSets.length, 2);
  assert.equal(kids(configSets[0], "Input")[0].getAttribute("name"), "usePowerCharges");
  assert.equal(kids(one(doc, "Config"), "Input").length, 0);
});

test("notes list every snapshot with its level and link, then the latest snapshot's own notes", () => {
  const snaps = twoSnapshots();
  snaps[1].xml = snaps[1].xml.replace("<Notes></Notes>", "<Notes>my notes</Notes>");
  const notes = one(parse(xmlOf(snaps)), "Notes").textContent;
  assert.match(notes, /- Day 5 \(Lv 72\) \(level 72\): https:\/\/poe\.ninja\/a\?timemachine=day-5/);
  assert.match(notes, /- Latest \(Lv 100\) \(level 100\): https:\/\/poe\.ninja\/a\n/);
  assert.match(notes, /my notes\s*$/);
});

test("output starts with the XML declaration and has one PathOfBuilding root", () => {
  const xml = xmlOf(twoSnapshots());
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<PathOfBuilding>'));
  assert.equal((xml.match(/<PathOfBuilding>/g) || []).length, 1);
});

test("a single snapshot still forms a loadout", () => {
  const doc = parse(xmlOf([{ name: "Latest", xml: pobXml({}) }]));
  assert.equal(one(doc, "Spec").getAttribute("title"), "Latest {1}");
  assert.equal(one(doc, "ItemSet").getAttribute("title"), "Latest {1}");
});

test("bad input fails with a clear message", () => {
  assert.throws(() => mergeSnapshots([], dom), /No snapshots selected/);
  assert.throws(() => mergeSnapshots(null, dom), /No snapshots selected/);
  assert.throws(() => mergeSnapshots([{ name: "A", xml: pobXml({}) }], {}), /DOMParser and XMLSerializer are required/);
  assert.throws(() => mergeSnapshots([{ name: "", xml: pobXml({}) }], dom), /needs a name/);
  assert.throws(() => mergeSnapshots([{ name: "A", xml: pobXml({}) }, { name: "A", xml: pobXml({}) }], dom), /Duplicate snapshot name: A/);
  assert.throws(() => mergeSnapshots([{ name: "A", xml: "" }], dom), /Snapshot 1 has no build XML/);
  assert.throws(() => mergeSnapshots([{ name: "A", xml: "<NotPoB/>" }], dom), /Snapshot 1 is not a PoB build/);
  assert.throws(() => mergeSnapshots([{ name: "A", xml: "<PathOfBuilding><Build" }], dom), /Snapshot 1 is not a PoB build/);
  assert.throws(() => mergeSnapshots([{ name: "A", xml: "<PathOfBuilding><Build/></PathOfBuilding>" }], dom), /Snapshot A has no passive tree/);
});

// Regression: found by tools/pob_check.lua on a real Hierophant. Animate Guardian's gem points at
// its gear set by item set id (Gem@skillMinionItemSet, PoB SkillsTab.lua:483); before the fix the
// id was left as-is after item sets were renumbered, so it pointed at another snapshot's set and
// the Latest loadout's TotalMinionLife differed from the snapshot alone (26124 vs 26810).
test("gem links to item sets (skillMinionItemSet) follow the item set renumbering", () => {
  const guardian = (n) => pobXml({
    items: [{ id: 1, text: BODY + n }],
    itemSets: [{ id: 1, slots: [] }, { id: 2, title: "Animate Guardian", slots: [["Body Armour", 1]] }],
    skills: ["Animate Guardian"], gemAttrs: { skillMinionItemSet: 2, skillMinionItemSetCalcs: 2 },
  });
  const doc = parse(xmlOf([{ name: "A", xml: guardian("1") }, { name: "B", xml: guardian("2") }]));
  const sets = kids(one(doc, "Items"), "ItemSet");
  const gems = Array.from(doc.getElementsByTagName("Gem"));
  const target = (gem, attr) => sets.find((s) => s.getAttribute("id") === gem.getAttribute(attr));
  assert.equal(target(gems[0], "skillMinionItemSet").getAttribute("title"), "A - Animate Guardian");
  assert.equal(target(gems[0], "skillMinionItemSetCalcs").getAttribute("title"), "A - Animate Guardian");
  assert.equal(target(gems[1], "skillMinionItemSet").getAttribute("title"), "B - Animate Guardian");
});

test("a gem link to an item set that does not exist is dropped rather than pointing at another set", () => {
  const doc = parse(xmlOf([{ name: "A", xml: pobXml({ gemAttrs: { skillMinionItemSet: 9 } }) }]));
  assert.equal(one(doc, "Gem").hasAttribute("skillMinionItemSet"), false);
});

// Regression: found by tools/pob_check.lua. The Party tab is build-wide in PoB (no per-config
// switch, CalcPerform.lua partyTabEnableExportBuffs), so the latest snapshot's Animate Guardian
// ally buffs applied to older loadouts that never had them (damage taken x0.9). PoB can't hold a
// Party per loadout, so the merge keeps the latest one and must say which loadouts differ.
test("the latest snapshot's Party is kept, and loadouts whose Party differed are reported", () => {
  const party = "otherEffects\nLeer Cast|100|50|Item:27:Leer Cast|Damage|INC|-|-|-\n---";
  const res = mergeSnapshots([
    { name: "Day 5", xml: pobXml({}) },
    { name: "Week 9", xml: pobXml({ party: "  " + party.replace(/\n/g, "\n   ") + "  " }) }, // same, other spacing
    { name: "Latest", xml: pobXml({ party }) },
  ], dom);
  assert.deepEqual(res.partyDiffers, ["Day 5"]);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /come from Latest; these loadouts had different ones: Day 5\./);
  const doc = parse(res.xml);
  assert.equal(doc.getElementsByTagName("Party").length, 1);
  assert.match(one(doc, "Party").textContent, /Leer Cast/);
  assert.match(one(doc, "Notes").textContent, /had different ones: Day 5/);
  assert.deepEqual(mergeSnapshots([{ name: "A", xml: pobXml({}) }, { name: "B", xml: pobXml({}) }], dom).warnings, []);
});
