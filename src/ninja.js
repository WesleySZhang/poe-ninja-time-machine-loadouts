// poe.ninja builds API, as used by poe.ninja's own character page (site code, Nov 2026):
//   GET /poe1/api/data/index-state -> snapshotVersions[] {url, type, snapshotName, version}
//   GET /poe1/api/builds/{version}/character?account=&name=&overview=<snapshotName>&type=&timeMachine=<label>
//     -> JSON with pathOfBuildingExport (PoB code) and level; the "tmz" response header lists the
//        time machine labels that exist for this character ("latest" = empty timeMachine).
// Page URL: /poe1/builds/{league}/character/{account}/{name}[?type=...][&timemachine=...]
// Labels count from league start (checked: a character was level 72 at day-5, 100 at week-3).
(function (root) {
  "use strict";

  const CHARACTER_PATH = /^\/poe1\/builds\/([^/]+)\/character\/([^/]+)\/([^/?#]+)\/?$/;

  /** @returns {{league, account, name, type}|null} */
  function parseCharacterUrl(href) {
    let url;
    try { url = new URL(href); } catch (e) { return null; }
    if (url.hostname !== "poe.ninja") return null;
    const m = CHARACTER_PATH.exec(url.pathname);
    if (!m) return null;
    try {
      return {
        league: decodeURIComponent(m[1]),
        account: decodeURIComponent(m[2]),
        name: decodeURIComponent(m[3]),
        type: url.searchParams.get("type") || "exp",
      };
    } catch (e) {
      return null;
    }
  }

  const UNIT_ORDER = { hour: 0, day: 1, week: 2 };

  /** Sort key: hours, then days, then weeks, then latest; unknown labels last but stable. */
  function labelOrder(label) {
    if (label === "latest") return [3, 0];
    const m = /^(hour|day|week)-(\d+)$/.exec(label);
    if (!m) return [4, 0];
    return [UNIT_ORDER[m[1]], parseInt(m[2], 10)];
  }

  function sortLabels(labels) {
    const unique = Array.from(new Set(labels.map(function (l) { return String(l).trim(); }).filter(Boolean)));
    return unique.sort(function (a, b) {
      const x = labelOrder(a), y = labelOrder(b);
      return x[0] - y[0] || x[1] - y[1] || (a < b ? -1 : a > b ? 1 : 0);
    });
  }

  function displayLabel(label) {
    if (label === "latest") return "Latest";
    const m = /^(hour|day|week)-(\d+)$/.exec(label);
    if (!m) return label;
    return m[1].charAt(0).toUpperCase() + m[1].slice(1) + " " + m[2];
  }

  /** Name for a run of snapshots: "Week 3" or "Week 10 - Latest" (ASCII, as it ends up in PoB). */
  function rangeLabel(labels) {
    if (!labels || labels.length === 0) throw new Error("rangeLabel needs at least one label");
    const first = displayLabel(labels[0]);
    return labels.length === 1 ? first : first + " - " + displayLabel(labels[labels.length - 1]);
  }

  /**
   * Groups runs of consecutive snapshots that have the same PoB code. When a player stops playing a
   * character, poe.ninja keeps adding snapshots with the identical build (checked Nov 2026: Week 10 to
   * Week 15 and Latest of one character all had the same pathOfBuildingExport), so each run is shown
   * and merged once. `labels` are in time order; `codeOf(label)` returns the code, or undefined when it
   * isn't known, and an unknown code never joins a group. Only neighbours are grouped: a build that
   * changed and later changed back is a real point in the character's history.
   * @returns {{key, labels, name}[]} key = the run's first label.
   */
  function groupSnapshots(labels, codeOf) {
    const groups = [];
    let prev;
    for (const label of labels) {
      const code = codeOf(label);
      const last = groups[groups.length - 1];
      if (last && typeof code === "string" && code === prev) last.labels.push(label);
      else groups.push({ key: label, labels: [label] });
      prev = typeof code === "string" ? code : undefined;
    }
    for (const g of groups) g.name = rangeLabel(g.labels);
    return groups;
  }

  function parseTmzHeader(value) {
    if (!value) return ["latest"];
    const labels = sortLabels(value.split(","));
    if (labels.indexOf("latest") === -1) labels.push("latest");
    return labels;
  }

  function findSnapshotVersion(indexState, league, type) {
    const list = (indexState && indexState.snapshotVersions) || [];
    const v = list.find(function (s) { return s.url === league && s.type === type; });
    if (!v) throw new Error("poe.ninja has no " + type + " snapshot for league \"" + league + "\"");
    return v;
  }

  function characterApiUrl(origin, version, ch, label) {
    const q = new URLSearchParams({
      account: ch.account,
      name: ch.name,
      overview: version.snapshotName,
      type: ch.type,
      timeMachine: label === "latest" ? "" : label,
    });
    return origin + "/poe1/api/builds/" + encodeURIComponent(version.version) + "/character?" + q.toString();
  }

  function characterPageUrl(origin, ch, label) {
    const q = new URLSearchParams();
    if (ch.type && ch.type !== "exp") q.set("type", ch.type);
    if (label !== "latest") q.set("timemachine", label);
    const qs = q.toString();
    return origin + "/poe1/builds/" + encodeURIComponent(ch.league) + "/character/" +
      encodeURIComponent(ch.account) + "/" + encodeURIComponent(ch.name) + (qs ? "?" + qs : "");
  }

  /**
   * Talks to poe.ninja. `fetchImpl` is window.fetch in the extension and a stub in tests.
   * At most `concurrency` requests run at once (default 4), and request starts are spaced by `delayMs`
   * (default 0). A request took about 0.1 s (Nov 2026) and the replies come from Cloudflare's cache
   * (Cache-Control max-age=1800, cf-cache-status HIT), so a few at a time is gentle. A 429 (too many
   * requests) is retried once after `retryMs` (default 2000).
   */
  function createClient(fetchImpl, options) {
    const opts = options || {};
    const origin = opts.origin || "https://poe.ninja";
    const delayMs = opts.delayMs !== undefined ? opts.delayMs : 0;
    const concurrency = opts.concurrency !== undefined ? opts.concurrency : 4;
    const retryMs = opts.retryMs !== undefined ? opts.retryMs : 2000;
    const sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    if (!(concurrency >= 1)) throw new Error("concurrency must be at least 1");
    let active = 0;
    const waiting = [];
    let nextStart = 0; // earliest time the next request may start
    let spacing = Promise.resolve();

    function acquire() {
      if (active < concurrency) { active++; return Promise.resolve(); }
      return new Promise(function (r) { waiting.push(r); });
    }
    function release() {
      const next = waiting.shift();
      if (next) next(); else active--;
    }
    // Spaces request starts by delayMs (in order); a no-op when delayMs is 0.
    function spaced() {
      const turn = spacing.then(async function () {
        const wait = nextStart - Date.now();
        if (nextStart && wait > 0) await sleep(wait);
        nextStart = Date.now() + delayMs;
      });
      spacing = turn;
      return turn;
    }

    async function politeFetch(url) {
      await acquire();
      try {
        for (let attempt = 0; ; attempt++) {
          if (delayMs > 0) await spaced();
          const res = await fetchImpl(url, { credentials: "omit", headers: { Accept: "application/json" } });
          if (res.status !== 429 || attempt >= 1) return res;
          await sleep(retryMs);
        }
      } finally {
        release();
      }
    }

    async function getJson(url, what) {
      let res;
      try { res = await politeFetch(url); } catch (e) { throw new Error("Could not reach poe.ninja (" + what + ")"); }
      if (!res.ok) {
        throw new Error(res.status === 404 ? what + " not found on poe.ninja" : "poe.ninja returned HTTP " + res.status + " for " + what);
      }
      let data;
      try { data = await res.json(); } catch (e) { throw new Error("poe.ninja sent an unreadable reply for " + what); }
      return { data: data, headers: res.headers };
    }

    async function getVersion(ch) {
      const r = await getJson(origin + "/poe1/api/data/index-state", "league list");
      return findSnapshotVersion(r.data, ch.league, ch.type);
    }

    /** @returns {{label, level, code, labels}} labels = snapshots this character has (from "tmz"). */
    async function getSnapshot(version, ch, label) {
      const what = displayLabel(label) + " snapshot";
      const r = await getJson(characterApiUrl(origin, version, ch, label), what);
      const code = r.data && r.data.pathOfBuildingExport;
      if (typeof code !== "string" || code.length === 0) throw new Error(what + " has no PoB code");
      return {
        label: label,
        level: typeof r.data.level === "number" ? r.data.level : undefined,
        code: code,
        labels: parseTmzHeader(r.headers && r.headers.get ? r.headers.get("tmz") : null),
      };
    }

    return { getVersion: getVersion, getSnapshot: getSnapshot };
  }

  const api = {
    parseCharacterUrl: parseCharacterUrl,
    sortLabels: sortLabels,
    displayLabel: displayLabel,
    rangeLabel: rangeLabel,
    groupSnapshots: groupSnapshots,
    parseTmzHeader: parseTmzHeader,
    findSnapshotVersion: findSnapshotVersion,
    characterApiUrl: characterApiUrl,
    characterPageUrl: characterPageUrl,
    createClient: createClient,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NinjaApi = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
