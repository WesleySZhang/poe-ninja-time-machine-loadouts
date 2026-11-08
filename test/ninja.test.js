"use strict";
// poe.ninja behaviour these tests encode was read from poe.ninja's site code and live API (Nov 2026):
// character page /poe1/builds/{league}/character/{account}/{name}?type=&timemachine=,
// API /poe1/api/builds/{version}/character?account&name&overview&type&timeMachine, "tmz" header,
// index-state snapshotVersions {url, type, snapshotName, version}.
const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../src/ninja.js");

test("parseCharacterUrl reads league, account, name and type from a character page", () => {
  assert.deepEqual(N.parseCharacterUrl("https://poe.ninja/poe1/builds/allflame/character/Example-1234/SomeCharacter"),
    { league: "allflame", account: "Example-1234", name: "SomeCharacter", type: "exp" });
  assert.deepEqual(N.parseCharacterUrl("https://poe.ninja/poe1/builds/allflamehc/character/Some%20One-1/My_Char?type=depthsolo&timemachine=week-2"),
    { league: "allflamehc", account: "Some One-1", name: "My_Char", type: "depthsolo" });
  assert.equal(N.parseCharacterUrl("https://poe.ninja/poe1/builds/allflame/character/A-1/B/").name, "B");
});

test("parseCharacterUrl ignores pages that are not PoE 1 character pages", () => {
  for (const url of [
    "https://poe.ninja/poe1/builds/allflame",
    "https://poe.ninja/poe2/builds/dawn/character/A-1/B",
    "https://poe.ninja/poe1/builds/allflame/character/A-1/B/passive-tree",
    "https://evil.example/poe1/builds/allflame/character/A-1/B",
    "https://poe.ninja/poe1/builds/allflame/character/A-1/%E0%A4%A",
    "not a url",
  ]) assert.equal(N.parseCharacterUrl(url), null, url);
});

test("sortLabels orders hours, days, weeks numerically, then latest; drops duplicates", () => {
  assert.deepEqual(
    N.sortLabels(["latest", "week-10", "week-2", "day-5", "hour-18", "hour-3", "week-2", "day-1", "odd"]),
    ["hour-3", "hour-18", "day-1", "day-5", "week-2", "week-10", "latest", "odd"]);
});

test("parseTmzHeader turns the tmz header into a sorted list that always has latest", () => {
  // Real header value seen on a character response.
  const real = "latest,week-7,week-4,week-6,week-10,week-5,day-5,week-3,week-2,week-13,week-8,week-12,week-9,week-11,week-15,week-14";
  const labels = N.parseTmzHeader(real);
  assert.equal(labels[0], "day-5");
  assert.equal(labels[labels.length - 1], "latest");
  assert.equal(labels.length, 16);
  assert.deepEqual(N.parseTmzHeader(null), ["latest"]);
  assert.deepEqual(N.parseTmzHeader("week-1, day-2"), ["day-2", "week-1", "latest"]);
});

test("displayLabel gives readable names", () => {
  assert.equal(N.displayLabel("latest"), "Latest");
  assert.equal(N.displayLabel("week-12"), "Week 12");
  assert.equal(N.displayLabel("hour-3"), "Hour 3");
  assert.equal(N.displayLabel("weird"), "weird");
});

const INDEX = { snapshotVersions: [
  { url: "allflame", type: "exp", snapshotName: "allflame", version: "0015-20261108-13716" },
  { url: "allflame", type: "depthsolo", snapshotName: "allflame", version: "0022-x" },
] };
const CH = { league: "allflame", account: "A-1", name: "B c", type: "exp" };

test("findSnapshotVersion matches league url and type, and fails clearly when missing", () => {
  assert.equal(N.findSnapshotVersion(INDEX, "allflame", "depthsolo").version, "0022-x");
  assert.throws(() => N.findSnapshotVersion(INDEX, "nope", "exp"), /no exp snapshot for league "nope"/);
  assert.throws(() => N.findSnapshotVersion({}, "allflame", "exp"), /no exp snapshot/);
});

test("characterApiUrl sends latest as an empty timeMachine and other labels as-is", () => {
  const v = INDEX.snapshotVersions[0];
  assert.equal(N.characterApiUrl("https://poe.ninja", v, CH, "latest"),
    "https://poe.ninja/poe1/api/builds/0015-20261108-13716/character?account=A-1&name=B+c&overview=allflame&type=exp&timeMachine=");
  assert.match(N.characterApiUrl("https://poe.ninja", v, CH, "week-2"), /&timeMachine=week-2$/);
});

test("characterPageUrl links back to the snapshot on poe.ninja", () => {
  assert.equal(N.characterPageUrl("https://poe.ninja", CH, "latest"), "https://poe.ninja/poe1/builds/allflame/character/A-1/B%20c");
  assert.equal(N.characterPageUrl("https://poe.ninja", Object.assign({}, CH, { type: "depthsolo" }), "day-5"),
    "https://poe.ninja/poe1/builds/allflame/character/A-1/B%20c?type=depthsolo&timemachine=day-5");
});

function response(status, body, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers || {})),
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
  };
}

test("client fetches the version, then a snapshot with its code, level and tmz labels", async () => {
  const calls = [];
  const fetchStub = async (url) => {
    calls.push(url);
    if (url.endsWith("/index-state")) return response(200, INDEX);
    return response(200, { level: 97, pathOfBuildingExport: "CODE" }, { tmz: "latest,week-2,day-1" });
  };
  const client = N.createClient(fetchStub, { delayMs: 0 });
  const v = await client.getVersion(CH);
  const s = await client.getSnapshot(v, CH, "week-2");
  assert.deepEqual(s, { label: "week-2", level: 97, code: "CODE", labels: ["day-1", "week-2", "latest"] });
  assert.equal(calls[0], "https://poe.ninja/poe1/api/data/index-state");
  assert.match(calls[1], /timeMachine=week-2/);
});

test("client with concurrency 1 spaces requests out by delayMs and runs them one at a time", async () => {
  let active = 0, maxActive = 0;
  const slept = [];
  const fetchStub = async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return response(200, { pathOfBuildingExport: "X" });
  };
  const client = N.createClient(fetchStub, { concurrency: 1, delayMs: 400, sleep: async (ms) => { slept.push(ms); } });
  const v = INDEX.snapshotVersions[0];
  await Promise.all(["day-1", "day-2", "day-3"].map((l) => client.getSnapshot(v, CH, l)));
  assert.equal(maxActive, 1);
  assert.equal(slept.length, 2); // no wait before the first request
  for (const ms of slept) assert.ok(ms > 300 && ms <= 400, String(ms));
});

test("client by default runs up to 4 requests at once, never more, with no pause", async () => {
  let active = 0, maxActive = 0;
  const slept = [];
  const fetchStub = async (url) => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return response(200, { pathOfBuildingExport: new URL(url).searchParams.get("timeMachine") });
  };
  const client = N.createClient(fetchStub, { sleep: async (ms) => { slept.push(ms); } });
  const v = INDEX.snapshotVersions[0];
  const labels = ["day-1", "day-2", "day-3", "day-4", "day-5", "day-6", "week-1", "week-2", "week-3", "week-4"];
  const got = await Promise.all(labels.map((l) => client.getSnapshot(v, CH, l)));
  assert.equal(maxActive, 4);
  assert.deepEqual(slept, []);
  assert.deepEqual(got.map((s) => s.code), labels); // each caller gets its own reply
  assert.throws(() => N.createClient(fetchStub, { concurrency: 0 }), /at least 1/);
});

test("client retries a 429 once after retryMs, then reports it", async () => {
  const v = INDEX.snapshotVersions[0];
  let n = 0;
  const slept = [];
  const once = async () => (n++ === 0 ? response(429, {}) : response(200, { pathOfBuildingExport: "OK" }));
  const c1 = N.createClient(once, { retryMs: 2000, sleep: async (ms) => { slept.push(ms); } });
  assert.equal((await c1.getSnapshot(v, CH, "day-1")).code, "OK");
  assert.deepEqual(slept, [2000]);
  let calls = 0;
  const always = async () => { calls++; return response(429, {}); };
  const c2 = N.createClient(always, { sleep: async () => {} });
  await assert.rejects(c2.getSnapshot(v, CH, "day-1"), /HTTP 429 for Day 1 snapshot/);
  assert.equal(calls, 2);
});

test("client errors are clear: 404, other HTTP errors, network failure, bad JSON, missing code", async () => {
  const v = INDEX.snapshotVersions[0];
  const cases = [
    [async () => response(404, {}), /Week 2 snapshot not found on poe.ninja/],
    [async () => response(503, {}), /HTTP 503 for Week 2 snapshot/],
    [async () => { throw new TypeError("network"); }, /Could not reach poe.ninja/],
    [async () => response(200, "{not json"), /unreadable reply/],
    [async () => response(200, { level: 1 }), /Week 2 snapshot has no PoB code/],
  ];
  for (const [stub, re] of cases) {
    await assert.rejects(N.createClient(stub, { delayMs: 0 }).getSnapshot(v, CH, "week-2"), re);
  }
  // A failed request doesn't block the next one.
  let n = 0;
  const flaky = async () => (n++ === 0 ? response(500, {}) : response(200, { pathOfBuildingExport: "OK" }));
  const client = N.createClient(flaky, { delayMs: 0 });
  await assert.rejects(client.getSnapshot(v, CH, "day-1"));
  assert.equal((await client.getSnapshot(v, CH, "day-1")).code, "OK");
});

test("rangeLabel names one snapshot or a run of them", () => {
  assert.equal(N.rangeLabel(["week-3"]), "Week 3");
  assert.equal(N.rangeLabel(["week-10", "week-11", "latest"]), "Week 10 - Latest");
  assert.throws(() => N.rangeLabel([]), /at least one label/);
});

test("groupSnapshots folds a character that stopped changing into one entry", () => {
  // Shape of a real character (Nov 2026): Week 3-9 identical, Week 10-15 and Latest identical.
  const codes = { "day-5": "a", "week-2": "b", "week-3": "c", "week-9": "c", "week-10": "d", "week-15": "d", latest: "d" };
  const groups = N.groupSnapshots(Object.keys(codes), (l) => codes[l]);
  assert.deepEqual(groups.map((g) => [g.key, g.name, g.labels]), [
    ["day-5", "Day 5", ["day-5"]],
    ["week-2", "Week 2", ["week-2"]],
    ["week-3", "Week 3 - Week 9", ["week-3", "week-9"]],
    ["week-10", "Week 10 - Latest", ["week-10", "week-15", "latest"]],
  ]);
});

test("groupSnapshots only groups neighbours: a build that changed back stays its own entry", () => {
  const codes = { "week-1": "a", "week-2": "b", "week-3": "a" };
  assert.deepEqual(N.groupSnapshots(Object.keys(codes), (l) => codes[l]).map((g) => g.key), ["week-1", "week-2", "week-3"]);
});

test("groupSnapshots never groups snapshots whose code is unknown", () => {
  // A snapshot that failed to download has no code; it must not join, or be joined by, its neighbours.
  const codes = { "week-1": "a", "week-2": undefined, "week-3": undefined, "week-4": "a" };
  assert.deepEqual(N.groupSnapshots(Object.keys(codes), (l) => codes[l]).map((g) => g.labels),
    [["week-1"], ["week-2"], ["week-3"], ["week-4"]]);
  assert.deepEqual(N.groupSnapshots([], () => "x"), []);
});
