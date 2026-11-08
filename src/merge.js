// Merge several PoB builds (poe.ninja time machine snapshots of one character) into one PoB
// build with one loadout per snapshot.
//
// PoB rules this relies on (Path of Building v2.67.2):
// - A loadout is a tree spec, item set, skill set and config set that share a "{tag}" in
//   their titles (src/Modules/Build.lua, buildMode:SyncLoadouts; tags are [%w,]+). Tags are
//   used instead of identical plain titles, because PoB prefixes an older tree's name with
//   its version, which would break plain-title matching.
// - Items are global and referenced by id from ItemSet/Slot@itemId and
//   Tree/Spec/Sockets/Socket@itemId (src/Classes/ItemsTab.lua Load, src/Classes/PassiveSpec.lua
//   Load); id 0 means "empty".
// - Build@mainSocketGroup is one index for the whole build into the active skill set's groups
//   (src/Modules/Build.lua Load), so each snapshot's main group is moved to position 1.
// - Build@characterLevelAutoMode="true" makes PoB estimate the level from the active tree's
//   points (buildMode:EstimatePlayerProgress), so each loadout gets roughly its own level.
// - Gems point at item sets by id: Gem@skillMinionItemSet / @skillMinionItemSetCalcs (Animate
//   Guardian's gear; src/Classes/SkillsTab.lua:483), so they follow the item set renumbering.
// - The Party tab (ally buffs, e.g. from Animate Guardian's gear) is one for the whole build and
//   has no per-config switch (src/Modules/CalcPerform.lua, partyTabEnableExportBuffs). The latest
//   snapshot's Party is kept; loadouts whose own Party differed are reported in `warnings`.
//
// The function is pure: it takes XML strings and DOM classes, so it runs in a content script
// (native DOMParser) and in Node tests (@xmldom/xmldom).
(function (root) {
  "use strict";

  function elementChildren(node, tag) {
    const out = [];
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && (!tag || c.nodeName === tag)) out.push(c);
    }
    return out;
  }

  function firstChild(node, tag) {
    return elementChildren(node, tag)[0] || null;
  }

  function removeChildren(node, tags) {
    for (const c of elementChildren(node)) {
      if (tags.indexOf(c.nodeName) !== -1) node.removeChild(c);
    }
  }

  function parse(xml, DOMParserImpl, index) {
    if (typeof xml !== "string" || xml.trim() === "") {
      throw new Error("Snapshot " + (index + 1) + " has no build XML");
    }
    let doc;
    let parseError = null;
    try {
      doc = new DOMParserImpl({
        onError: function (level, msg) { if (level !== "warning" && !parseError) parseError = msg; },
      }).parseFromString(xml, "text/xml");
    } catch (e) {
      parseError = e.message || String(e);
    }
    if (!parseError && doc && doc.getElementsByTagName("parsererror").length > 0) {
      parseError = doc.getElementsByTagName("parsererror")[0].textContent;
    }
    const pob = doc && doc.documentElement;
    if (parseError || !pob || pob.nodeName !== "PathOfBuilding") {
      throw new Error("Snapshot " + (index + 1) + " is not a PoB build" + (parseError ? ": " + parseError : ""));
    }
    return doc;
  }

  // Index (into `sets`) of the active set, given a 1-based id attribute; falls back to the first.
  function activeIndexById(sets, activeId) {
    const i = sets.findIndex(function (s) { return s.getAttribute("id") === String(activeId); });
    return i >= 0 ? i : 0;
  }

  // Wrap legacy direct children (Skill under Skills, Input under Config) in one set element.
  function setsOf(doc, containerTag, setTag, legacyTags) {
    const container = firstChild(doc.documentElement, containerTag);
    if (!container) return { container: null, sets: [] };
    let sets = elementChildren(container, setTag);
    if (sets.length === 0) {
      const set = doc.createElement(setTag);
      set.setAttribute("id", "1");
      for (const c of elementChildren(container)) {
        if (legacyTags.indexOf(c.nodeName) !== -1) set.appendChild(c.cloneNode(true));
      }
      sets = [set];
    }
    return { container: container, sets: sets };
  }

  function itemKey(item) {
    const attrs = [];
    for (let i = 0; i < item.attributes.length; i++) {
      const a = item.attributes[i];
      if (a.name !== "id") attrs.push(a.name + "=" + a.value);
    }
    attrs.sort();
    // Raw item text plus child elements (ModRange), with whitespace at the ends trimmed.
    let body = "";
    for (let c = item.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3 || c.nodeType === 4) body += c.nodeValue.trim();
      else if (c.nodeType === 1) {
        const ca = [];
        for (let i = 0; i < c.attributes.length; i++) ca.push(c.attributes[i].name + "=" + c.attributes[i].value);
        body += "<" + c.nodeName + " " + ca.sort().join(" ") + ">";
      }
    }
    return attrs.join("|") + "\n" + body;
  }

  // Party content without whitespace differences; "" when there is no Party or no imported buffs.
  function partyKey(party) {
    if (!party) return "";
    const parts = [];
    for (const c of elementChildren(party)) {
      const text = (c.textContent || "").replace(/\s+/g, " ").trim();
      if (text) parts.push(c.nodeName + ":" + (c.getAttribute("name") || "") + ":" + text);
    }
    return parts.sort().join("\n");
  }

  function title(name, tag) {
    return name + " {" + tag + "}";
  }

  function extraTitle(name, original, kind, index) {
    return name + " - " + (original || kind + " " + (index + 1));
  }

  /**
   * @param {Array<{xml: string, name: string, level?: number, url?: string}>} snapshots
   *   oldest first; the last one is the "base" (its general settings win and its loadout is active).
   * @param {{DOMParser: Function, XMLSerializer: Function, header?: string}} dom
   * @returns {{xml: string, warnings: string[], partyDiffers: string[]}} merged PoB XML, plus notes
   *   on what PoB can't keep per loadout (partyDiffers = names of loadouts whose Party differed)
   */
  function mergeSnapshots(snapshots, dom) {
    if (!Array.isArray(snapshots) || snapshots.length === 0) throw new Error("No snapshots selected");
    if (!dom || !dom.DOMParser || !dom.XMLSerializer) throw new Error("DOMParser and XMLSerializer are required");
    const names = new Set();
    for (const s of snapshots) {
      if (!s || typeof s.name !== "string" || s.name.trim() === "") throw new Error("Every snapshot needs a name");
      if (names.has(s.name)) throw new Error("Duplicate snapshot name: " + s.name);
      names.add(s.name);
    }

    const docs = snapshots.map(function (s, i) { return parse(s.xml, dom.DOMParser, i); });
    const baseIndex = docs.length - 1;
    const out = docs[baseIndex]; // mutate the base document into the merged one
    const outRoot = out.documentElement;

    function ensureContainer(tag) {
      let c = firstChild(outRoot, tag);
      if (!c) { c = out.createElement(tag); outRoot.appendChild(c); }
      return c;
    }
    const outItems = ensureContainer("Items");
    const outSkills = ensureContainer("Skills");
    const outTree = ensureContainer("Tree");
    const outConfig = ensureContainer("Config");

    // Collect everything from every snapshot before clearing the base containers.
    const collected = docs.map(function (doc, i) {
      const pob = doc.documentElement;
      const build = firstChild(pob, "Build");
      const items = firstChild(pob, "Items");
      const tree = firstChild(pob, "Tree");
      const skills = setsOf(doc, "Skills", "SkillSet", ["Skill"]);
      const config = setsOf(doc, "Config", "ConfigSet", ["Input", "Placeholder"]);
      const itemSets = items ? elementChildren(items, "ItemSet") : [];
      const specs = tree ? elementChildren(tree, "Spec") : [];
      if (specs.length === 0) throw new Error("Snapshot " + snapshots[i].name + " has no passive tree");
      return {
        name: snapshots[i].name.trim(),
        tag: String(i + 1),
        mainSocketGroup: build ? parseInt(build.getAttribute("mainSocketGroup") || build.getAttribute("mainSkillIndex") || "1", 10) || 1 : 1,
        party: partyKey(firstChild(pob, "Party")),
        items: items ? elementChildren(items, "Item").map(function (n) { return n.cloneNode(true); }) : [],
        itemSets: itemSets.map(function (n) { return n.cloneNode(true); }),
        activeItemSet: activeIndexById(itemSets, items ? items.getAttribute("activeItemSet") || 1 : 1),
        skillSets: skills.sets.map(function (n) { return n.cloneNode(true); }),
        activeSkillSet: activeIndexById(skills.sets, skills.container ? skills.container.getAttribute("activeSkillSet") || 1 : 1),
        configSets: config.sets.map(function (n) { return n.cloneNode(true); }),
        activeConfigSet: activeIndexById(config.sets, config.container ? config.container.getAttribute("activeConfigSet") || 1 : 1),
        specs: specs.map(function (n) { return n.cloneNode(true); }),
        activeSpec: Math.min(Math.max((parseInt(tree.getAttribute("activeSpec") || "1", 10) || 1) - 1, 0), specs.length - 1),
      };
    });

    removeChildren(outItems, ["Item", "ItemSet", "Slot"]);
    removeChildren(outSkills, ["SkillSet", "Skill"]);
    removeChildren(outTree, ["Spec"]);
    removeChildren(outConfig, ["ConfigSet", "Input", "Placeholder"]);

    // Items: dedupe identical items, renumber from 1.
    const keyToId = new Map();
    let nextItemId = 1;
    const tradeWeights = firstChild(outItems, "TradeSearchWeights");
    const idMaps = collected.map(function (c) {
      const map = new Map();
      for (const item of c.items) {
        const oldId = item.getAttribute("id");
        const key = itemKey(item);
        let newId = keyToId.get(key);
        if (newId === undefined) {
          newId = nextItemId++;
          keyToId.set(key, newId);
          const node = out.importNode ? out.importNode(item, true) : item;
          node.setAttribute("id", String(newId));
          if (tradeWeights) outItems.insertBefore(node, tradeWeights); else outItems.appendChild(node);
        }
        map.set(oldId, newId);
      }
      return map;
    });
    function remap(map, oldId) {
      if (oldId === null || oldId === "" || oldId === "0") return "0";
      const id = map.get(oldId);
      return id === undefined ? "0" : String(id);
    }

    function place(container, node, before) {
      const n = out.importNode ? out.importNode(node, true) : node;
      if (before) container.insertBefore(n, before); else container.appendChild(n);
      return n;
    }

    let activeItemSetId = 1, activeSkillSetId = 1, activeConfigSetId = 1, activeSpecIndex = 1;
    let itemSetId = 0, skillSetId = 0, configSetId = 0, specIndex = 0;

    collected.forEach(function (c, i) {
      const isBase = i === baseIndex;
      const map = idMaps[i];

      // Item sets (a snapshot with no ItemSet gets an empty one so the loadout still forms).
      const setMap = new Map();
      const itemSets = c.itemSets.length > 0 ? c.itemSets : [out.createElement("ItemSet")];
      itemSets.forEach(function (set, k) {
        const primary = k === (c.itemSets.length > 0 ? c.activeItemSet : 0);
        const node = place(outItems, set, tradeWeights);
        if (set.getAttribute("id")) setMap.set(set.getAttribute("id"), itemSetId + 1);
        node.setAttribute("id", String(++itemSetId));
        node.setAttribute("title", primary ? title(c.name, c.tag) : extraTitle(c.name, set.getAttribute("title"), "Item set", k));
        for (const slot of elementChildren(node, "Slot")) slot.setAttribute("itemId", remap(map, slot.getAttribute("itemId")));
        if (primary && isBase) activeItemSetId = itemSetId;
      });

      // Skill sets: the main socket group moves to position 1 of the snapshot's active set.
      c.skillSets.forEach(function (set, k) {
        const primary = k === c.activeSkillSet;
        const node = place(outSkills, set);
        node.setAttribute("id", String(++skillSetId));
        node.setAttribute("title", primary ? title(c.name, c.tag) : extraTitle(c.name, set.getAttribute("title"), "Skill set", k));
        const gems = node.getElementsByTagName("Gem");
        for (let g = 0; g < gems.length; g++) {
          for (const attr of ["skillMinionItemSet", "skillMinionItemSetCalcs"]) {
            if (!gems[g].hasAttribute(attr)) continue;
            const id = setMap.get(gems[g].getAttribute(attr));
            if (id === undefined) gems[g].removeAttribute(attr); else gems[g].setAttribute(attr, String(id));
          }
        }
        if (primary) {
          const groups = elementChildren(node, "Skill");
          const main = groups[c.mainSocketGroup - 1];
          if (main && c.mainSocketGroup > 1) node.insertBefore(main, groups[0]);
          if (isBase) activeSkillSetId = skillSetId;
        }
      });
      if (c.skillSets.length === 0) {
        const node = out.createElement("SkillSet");
        node.setAttribute("id", String(++skillSetId));
        node.setAttribute("title", title(c.name, c.tag));
        outSkills.appendChild(node);
        if (isBase) activeSkillSetId = skillSetId;
      }

      // Config sets.
      c.configSets.forEach(function (set, k) {
        const primary = k === c.activeConfigSet;
        const node = place(outConfig, set);
        node.setAttribute("id", String(++configSetId));
        node.setAttribute("title", primary ? title(c.name, c.tag) : extraTitle(c.name, set.getAttribute("title"), "Config", k));
        if (primary && isBase) activeConfigSetId = configSetId;
      });
      if (c.configSets.length === 0) {
        const node = out.createElement("ConfigSet");
        node.setAttribute("id", String(++configSetId));
        node.setAttribute("title", title(c.name, c.tag));
        outConfig.appendChild(node);
        if (isBase) activeConfigSetId = configSetId;
      }

      // Tree specs: jewel sockets point at the renumbered items.
      c.specs.forEach(function (spec, k) {
        const primary = k === c.activeSpec;
        const node = place(outTree, spec);
        specIndex++;
        node.setAttribute("title", primary ? title(c.name, c.tag) : extraTitle(c.name, spec.getAttribute("title"), "Tree", k));
        for (const sockets of elementChildren(node, "Sockets")) {
          for (const socket of elementChildren(sockets, "Socket")) {
            socket.setAttribute("itemId", remap(map, socket.getAttribute("itemId")));
          }
        }
        if (primary && isBase) activeSpecIndex = specIndex;
      });
    });

    outItems.setAttribute("activeItemSet", String(activeItemSetId));
    outSkills.setAttribute("activeSkillSet", String(activeSkillSetId));
    outConfig.setAttribute("activeConfigSet", String(activeConfigSetId));
    outTree.setAttribute("activeSpec", String(activeSpecIndex));

    const build = firstChild(outRoot, "Build");
    if (build) {
      build.setAttribute("characterLevelAutoMode", "true");
      build.setAttribute("mainSocketGroup", "1");
      if (build.hasAttribute("mainSkillIndex")) build.removeAttribute("mainSkillIndex");
    }
    // The Calcs tab's selected skill follows the same index.
    const calcs = firstChild(outRoot, "Calcs");
    if (calcs) {
      for (const input of elementChildren(calcs, "Input")) {
        if (input.getAttribute("name") === "skill_number") input.setAttribute("number", "1");
      }
    }

    // Notes: list the snapshots, then keep the base snapshot's own notes.
    let notes = firstChild(outRoot, "Notes");
    if (!notes) { notes = out.createElement("Notes"); outRoot.appendChild(notes); }
    const oldNotes = (notes.textContent || "").trim();
    while (notes.firstChild) notes.removeChild(notes.firstChild);
    const lines = ["poe.ninja time machine snapshots (one loadout each):"];
    snapshots.forEach(function (s) {
      lines.push("- " + s.name.trim() + (s.level ? " (level " + s.level + ")" : "") + (s.url ? ": " + s.url : ""));
    });
    lines.push("Character level is set to Auto: PoB estimates it from the active tree's points.");
    const baseParty = collected[baseIndex].party;
    const partyDiffers = collected.filter(function (c) { return c.party !== baseParty; }).map(function (c) { return c.name; });
    const warnings = [];
    if (partyDiffers.length > 0) {
      const w = "Party tab buffs are shared by the whole build and come from " + collected[baseIndex].name +
        "; these loadouts had different ones: " + partyDiffers.join(", ") + ".";
      warnings.push(w);
      lines.push(w);
    }
    if (oldNotes) lines.push("", oldNotes);
    notes.appendChild(out.createTextNode("\n" + lines.join("\n") + "\n"));

    const header = dom.header === undefined ? '<?xml version="1.0" encoding="UTF-8"?>\n' : dom.header;
    return { xml: header + new dom.XMLSerializer().serializeToString(outRoot), warnings: warnings, partyDiffers: partyDiffers };
  }

  const api = { mergeSnapshots: mergeSnapshots };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NinjaPobMerge = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
