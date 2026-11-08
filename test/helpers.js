"use strict";
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");

const dom = { DOMParser, XMLSerializer };

// Small synthetic PoB build in the shape poe.ninja exports (see a real export's structure:
// Build, Calcs, Config/ConfigSet, Items/Item+ItemSet, Skills/SkillSet/Skill, Tree/Spec/Sockets).
function pobXml(opts) {
  const o = Object.assign({
    level: 90,
    mainSocketGroup: 1,
    items: [], // [{id, text, attrs?}]
    itemSets: [{ id: 1, slots: [] }], // [{id, title?, slots: [[name, itemId]]}]
    activeItemSet: 1,
    skills: ["Arc"], // one socket group per entry
    activeSkillSet: 1,
    extraSkillSets: [],
    config: [["usePowerCharges", "true"]],
    specs: [{ nodes: "1,2,3", sockets: [] }], // sockets: [[nodeId, itemId]]
    activeSpec: 1,
    notes: "",
    legacySkills: false,
    legacyConfig: false,
    gemAttrs: {}, // extra attributes on every Gem
    party: null, // ImportedBuffs text for a Party element
  }, opts);
  const items = o.items.map((it) =>
    `<Item id="${it.id}"${Object.entries(it.attrs || {}).map(([k, v]) => ` ${k}="${v}"`).join("")}>\n${it.text}\n</Item>`).join("\n");
  const itemSets = o.itemSets.map((s) =>
    `<ItemSet id="${s.id}"${s.title ? ` title="${s.title}"` : ""} useSecondWeaponSet="nil">` +
    s.slots.map(([n, id]) => `<Slot itemId="${id}" itemPbURL="" name="${n}"/>`).join("") + `</ItemSet>`).join("\n");
  const group = (gem) => `<Skill enabled="true" label="" mainActiveSkill="1" slot="Body Armour"><Gem nameSpec="${gem}" level="20" quality="0" enabled="true"${Object.entries(o.gemAttrs).map(([k, v]) => ` ${k}="${v}"`).join("")}/></Skill>`;
  const skillSet = (id, gems, title) => `<SkillSet id="${id}"${title ? ` title="${title}"` : ""}>${gems.map(group).join("")}</SkillSet>`;
  const skills = o.legacySkills
    ? o.skills.map(group).join("")
    : skillSet(1, o.skills) + o.extraSkillSets.map((s, i) => skillSet(i + 2, s.gems, s.title)).join("");
  const inputs = o.config.map(([n, v]) => `<Input name="${n}" boolean="${v}"/>`).join("");
  const config = o.legacyConfig ? inputs : `<ConfigSet id="1">${inputs}</ConfigSet>`;
  const specs = o.specs.map((s) =>
    `<Spec treeVersion="3_29" classId="5" ascendClassId="2" nodes="${s.nodes}"${s.title ? ` title="${s.title}"` : ""}><URL>x</URL><Sockets>` +
    (s.sockets || []).map(([n, id]) => `<Socket nodeId="${n}" itemId="${id}"/>`).join("") + `</Sockets><Overrides/></Spec>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
<Build level="${o.level}" className="Templar" ascendClassName="Hierophant" characterLevelAutoMode="false" mainSocketGroup="${o.mainSocketGroup}" targetVersion="3_0" viewMode="TREE"></Build>
<Calcs><Input name="misc_buffMode" string="EFFECTIVE"/><Input name="skill_number" number="${o.mainSocketGroup}"/></Calcs>
<Config activeConfigSet="1">${config}</Config>
<Import exportParty="false"/>
<Items activeItemSet="${o.activeItemSet}" showStatDifferences="true">
${items}
${itemSets}
</Items>
<Notes>${o.notes}</Notes>
${o.party === null ? "" : `<Party destination="All"><ImportedBuffs name="Aura">${o.party}</ImportedBuffs></Party>`}
<Skills activeSkillSet="${o.activeSkillSet}" defaultGemLevel="normalMaximum">${skills}</Skills>
<Tree activeSpec="${o.activeSpec}">${specs}</Tree>
<TreeView searchStr="" zoomLevel="3"/>
</PathOfBuilding>`;
}

function parse(xml) {
  return new DOMParser().parseFromString(xml, "text/xml");
}

function kids(node, tag) {
  const out = [];
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && (!tag || c.nodeName === tag)) out.push(c);
  return out;
}

function one(doc, tag) {
  return doc.getElementsByTagName(tag)[0];
}

// item id -> raw item text, for checking that remapped ids still point at the right item.
function itemTexts(doc) {
  const map = new Map();
  for (const it of kids(one(doc, "Items"), "Item")) map.set(it.getAttribute("id"), it.textContent.trim());
  return map;
}

module.exports = { dom, pobXml, parse, kids, one, itemTexts };
