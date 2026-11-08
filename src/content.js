// Content script on poe.ninja: a small floating panel on PoE 1 character pages that turns the
// character's time machine snapshots into one PoB build (a loadout per snapshot) on pobb.in.
(function () {
  "use strict";
  if (window.__ninjaPobSnapshots) return;
  window.__ninjaPobSnapshots = true;

  const ext = typeof browser !== "undefined" ? browser : chrome;
  const Api = globalThis.NinjaApi, Merge = globalThis.NinjaPobMerge;

  // PoB code decoding/encoding and the upload run in the background script (see background.js).
  async function ask(msg) {
    const reply = await ext.runtime.sendMessage(msg);
    if (!reply || !reply.ok) throw new Error((reply && reply.error) || "The extension's background script did not answer");
    return reply;
  }

  const CSS = `
    :host { all: initial; }
    .wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e6e6e6; }
    .tab { background: #1f2430; border: 1px solid #3a4152; border-radius: 6px; color: #e6e6e6;
      padding: 6px 10px; cursor: pointer; font: inherit; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
    .tab:hover { background: #2a3040; }
    .panel { width: 260px; background: #1f2430; border: 1px solid #3a4152; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,.5); padding: 10px; }
    .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-weight: 600; }
    .x { background: none; border: none; color: #aab; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; }
    .x:hover { color: #fff; }
    label { display: flex; gap: 6px; align-items: center; cursor: pointer; padding: 1px 0; }
    .all { border-bottom: 1px solid #3a4152; padding-bottom: 4px; margin-bottom: 4px; }
    .list { max-height: 260px; overflow-y: auto; }
    .gen { width: 100%; margin-top: 8px; padding: 6px; border-radius: 5px; border: 1px solid #4a6fa5;
      background: #2f5b94; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
    .gen:disabled { opacity: .5; cursor: default; }
    .status { margin-top: 6px; color: #aab; min-height: 1em; }
    .status.err { color: #ff8a80; }
    .result { display: flex; gap: 4px; margin-top: 6px; }
    .result input { flex: 1; min-width: 0; background: #12151c; border: 1px solid #3a4152; color: #e6e6e6;
      border-radius: 4px; padding: 3px 5px; font: inherit; }
    .result button { background: #2a3040; border: 1px solid #3a4152; color: #e6e6e6; border-radius: 4px;
      cursor: pointer; font: inherit; padding: 3px 8px; }
    .hidden { display: none; }
  `;

  let host = null, shadow = null;
  let current = null;
  // { ch, key, labels, groups: [{key, labels, name}], selected: Set(group key),
  //   snapshots: Map(label -> {level, code}), version, busy, link, status }
  let client = null;
  let expanded = false;

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === "text") e.textContent = attrs[k];
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    for (const c of children || []) e.appendChild(c);
    return e;
  }

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement("div");
    host.id = "ninja-pob-snapshots";
    shadow = host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
  }

  function removeHost() {
    if (host) host.remove();
    host = null; shadow = null;
  }

  function setStatus(text, isError) {
    const s = shadow && shadow.querySelector(".status");
    if (!s) return;
    s.textContent = text || "";
    s.classList.toggle("err", !!isError);
  }

  function render() {
    ensureHost();
    shadow.innerHTML = "";
    shadow.appendChild(el("style", { text: CSS }));
    const wrap = el("div", { class: "wrap" });
    shadow.appendChild(wrap);

    if (!expanded) {
      wrap.appendChild(el("button", { class: "tab", text: "PoB snapshots", onclick: function () { expanded = true; render(); load(); } }));
      return;
    }

    const panel = el("div", { class: "panel" });
    wrap.appendChild(panel);
    panel.appendChild(el("div", { class: "head" }, [
      el("span", { text: "Snapshots to pobb.in" }),
      el("button", { class: "x", title: "Close", text: "×", onclick: function () { expanded = false; render(); } }),
    ]));

    const groups = current && current.groups;
    if (groups) {
      const all = el("input", { type: "checkbox" });
      const list = el("div", { class: "list" });
      const boxes = groups.map(function (g) {
        const box = el("input", { type: "checkbox", "data-label": g.key });
        box.checked = current.selected.has(g.key);
        box.addEventListener("change", function () {
          if (box.checked) current.selected.add(g.key); else current.selected.delete(g.key);
          syncAll();
        });
        const title = g.labels.length > 1 ? g.labels.length + " snapshots with the same build" : "";
        list.appendChild(el("label", title ? { title: title } : {}, [box, el("span", { text: g.name })]));
        return box;
      });
      function syncAll() {
        const n = current.selected.size;
        all.checked = n === groups.length;
        all.indeterminate = n > 0 && n < groups.length;
        gen.disabled = n === 0 || current.busy;
      }
      all.addEventListener("change", function () {
        current.selected = new Set(all.checked ? groups.map(function (g) { return g.key; }) : []);
        boxes.forEach(function (b) { b.checked = all.checked; });
        syncAll();
      });
      panel.appendChild(el("label", { class: "all" }, [all, el("span", { text: "Select all" })]));
      panel.appendChild(list);
      const gen = el("button", { class: "gen", text: current.busy ? "Working…" : "Generate", onclick: generate });
      panel.appendChild(gen);
      syncAll();
    }

    panel.appendChild(el("div", { class: "status" }));
    if (current && current.status) setStatus(current.status.text, current.status.error);

    if (current && current.link) {
      const input = el("input", { readonly: "", value: current.link });
      input.addEventListener("focus", function () { input.select(); });
      const copy = el("button", { text: "Copy", onclick: function () {
        navigator.clipboard.writeText(current.link).then(
          function () { copy.textContent = "Copied"; },
          function () { input.select(); document.execCommand("copy"); copy.textContent = "Copied"; }
        );
      } });
      const open = el("button", { text: "Open", onclick: function () { window.open(current.link, "_blank", "noopener"); } });
      panel.appendChild(el("div", { class: "result" }, [input, copy, open]));
    }
  }

  function status(text, error) {
    if (current) current.status = { text: text, error: !!error };
    setStatus(text, error);
  }

  // Opening the panel downloads every snapshot once, so runs of identical snapshots (a character
  // that is no longer played) can be shown as one entry. Generate then reuses the downloads.
  async function load() {
    if (!current || current.groups || current.loading) return;
    const state = current;
    state.loading = true;
    status("Loading snapshots…");
    try {
      state.version = await client.getVersion(state.ch);
      const latest = await client.getSnapshot(state.version, state.ch, "latest");
      if (state !== current) return;
      state.snapshots.set("latest", latest);
      state.labels = latest.labels;
      const failed = [];
      const others = state.labels.filter(function (l) { return l !== "latest"; });
      // All requests start now; the client keeps at most a few in flight.
      let done = 0;
      status("Checking snapshots (0/" + others.length + ")…");
      await Promise.all(others.map(function (label) {
        return client.getSnapshot(state.version, state.ch, label).then(
          function (snap) { state.snapshots.set(label, snap); },
          function () { failed.push(label); }
        ).then(function () {
          done++;
          if (state === current) status("Checking snapshots (" + done + "/" + others.length + ")…");
        });
      }));
      if (state !== current) return;
      // Failures finish in any order; name them in time order.
      const failedNames = state.labels.filter(function (l) { return failed.indexOf(l) !== -1; }).map(Api.displayLabel);
      state.groups = Api.groupSnapshots(state.labels, function (l) {
        const snap = state.snapshots.get(l);
        return snap && snap.code;
      });
      state.selected = new Set(state.groups.map(function (g) { return g.key; }));
      const n = state.labels.length, k = state.groups.length;
      let text = k === n ? n + " snapshots" : k + " different builds in " + n + " snapshots";
      if (failedNames.length > 0) text += ". Couldn't check " + failedNames.join(", ") + "; they are listed on their own.";
      state.status = { text: text, error: false };
    } catch (e) {
      if (state !== current) return;
      state.status = { text: e.message || String(e), error: true };
    } finally {
      state.loading = false;
    }
    if (state === current) render();
  }

  async function generate() {
    const state = current;
    if (!state || state.busy || state.selected.size === 0) return;
    state.busy = true;
    state.link = null;
    render();
    try {
      // poe.ninja's data version changes every few hours; refresh it in case the panel was left open.
      // Snapshots fetched under an older version are dropped so every part comes from the same data.
      const version = await client.getVersion(state.ch);
      if (state !== current) return;
      if (!state.version || version.version !== state.version.version) {
        state.version = version;
        state.snapshots.clear();
      }
      // Each entry is a run of identical snapshots; its first snapshot stands for the run.
      const chosen = state.groups.filter(function (g) { return state.selected.has(g.key); });
      const parts = [];
      for (let i = 0; i < chosen.length; i++) {
        const label = chosen[i].key;
        if (!state.snapshots.has(label)) {
          status("Fetching " + Api.displayLabel(label) + " (" + (i + 1) + "/" + chosen.length + ")…");
          state.snapshots.set(label, await client.getSnapshot(state.version, state.ch, label));
        }
        if (state !== current) return;
        const snap = state.snapshots.get(label);
        const name = chosen[i].name + (snap.level ? " (Lv " + snap.level + ")" : "");
        parts.push({
          name: name,
          level: snap.level,
          url: Api.characterPageUrl(location.origin, state.ch, label),
          xml: (await ask({ type: "decode-pob", code: snap.code })).xml,
        });
      }
      status("Merging " + parts.length + " snapshots…");
      const merged = Merge.mergeSnapshots(parts, { DOMParser: DOMParser, XMLSerializer: XMLSerializer });
      status("Uploading to pobb.in…");
      const reply = await ask({ type: "upload-pobbin", xml: merged.xml });
      if (state !== current) return;
      state.link = reply.url;
      const note = merged.partyDiffers.length > 0
        ? " Note: PoB's Party tab is shared, so it uses " + parts[parts.length - 1].name + "'s ally buffs; it differs for " + merged.partyDiffers.join(", ") + "."
        : "";
      state.status = { text: "Done: " + parts.length + " loadouts." + note, error: false };
    } catch (e) {
      if (state !== current) return;
      state.status = { text: e.message || String(e), error: true };
    } finally {
      state.busy = false;
    }
    if (state === current) render();
  }

  function onLocation() {
    const ch = Api.parseCharacterUrl(location.href);
    if (!ch) { current = null; removeHost(); return; }
    const key = [ch.league, ch.account, ch.name, ch.type].join("|");
    if (current && current.key === key) { ensureHost(); if (!shadow.firstChild) render(); return; }
    current = { ch: ch, key: key, labels: null, groups: null, selected: new Set(), snapshots: new Map(), busy: false, link: null, status: null };
    render();
    if (expanded) load();
  }

  client = Api.createClient(window.fetch.bind(window), { origin: location.origin });
  onLocation();
  // poe.ninja changes pages without reloading; check the address once a second.
  let lastHref = location.href;
  setInterval(function () {
    if (location.href !== lastHref) { lastHref = location.href; onLocation(); }
    else if (current && !(host && document.documentElement.contains(host))) render();
  }, 1000);
})();
