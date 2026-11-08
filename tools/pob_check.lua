-- Acceptance check in real Path of Building (headless, PoB v2.67.2 from ../PoE-Sim/sources/pob).
-- Run through tools/pob_check.ps1. Reads DIR/manifest.tsv and DIR/merged.xml (from fetch_snapshots.js).
--   1. The merged build shows exactly one loadout per snapshot (Build.lua SyncLoadouts).
--   2. Selecting each loadout gives the same stats as loading that snapshot alone. Exact match:
--      same engine, same input. Both sides are set to the snapshot's real level first, so the
--      comparison isolates the merge from PoB's Auto level estimate, which is reported separately.
--      PoB keeps one Party tab per build; a loadout flagged "party" in the manifest is compared with
--      its snapshot carrying the latest snapshot's Party (the one the merged build keeps).
local dir = CHECK_DIR

local function readFile(p)
	local f = assert(io.open(p, "rb"), "cannot open " .. p)
	local s = f:read("*a"); f:close(); return s
end

local snapshots = {}
for line in readFile(dir .. "/manifest.tsv"):gmatch("[^\n]+") do
	local name, level, file, flag = line:match("^([^\t]+)\t([^\t]+)\t([^\t]+)\t?([^\t]*)$")
	snapshots[#snapshots + 1] = { name = name, level = tonumber(level), file = file, party = flag == "party" }
end

local function recalc()
	build.buildFlag = true
	runCallback("OnFrame")
end

local function setLevel(level)
	build.characterLevelAutoMode = false
	build.characterLevel = level
	build.controls.characterLevel:SetText(tostring(level))
	recalc()
end

local function mainSkillName()
	local group = build.skillsTab.socketGroupList[build.mainSocketGroup]
	if not group or not group.displaySkillList then return "?" end
	local skill = group.displaySkillList[group.mainActiveSkill]
	return skill and skill.activeEffect and skill.activeEffect.grantedEffect.name or "?"
end

local function snapshotOutput()
	local out = {}
	for k, v in pairs(build.calcsTab.mainOutput) do
		if type(v) == "number" or type(v) == "string" or type(v) == "boolean" then out[k] = v end
	end
	return out
end

-- Standalone results first.
local expected = {}
for i, s in ipairs(snapshots) do
	loadBuildFromXML(readFile(dir .. "/" .. s.file), s.name)
	setLevel(s.level)
	expected[i] = { out = snapshotOutput(), skill = mainSkillName() }
end

loadBuildFromXML(readFile(dir .. "/merged.xml"), "merged")
local failures = 0
local loadouts = {}
for _, v in ipairs(build.controls.buildLoadouts.list) do
	if not v:match("^%^7%^7") and v ~= "No Loadouts" then loadouts[#loadouts + 1] = v end
end
print(("loadouts in merged build: %d (snapshots: %d)"):format(#loadouts, #snapshots))
if #loadouts ~= #snapshots then failures = failures + 1; print("FAIL loadout count") end

for i, s in ipairs(snapshots) do
	local want = s.name .. " {" .. i .. "}"
	local idx
	for j, v in ipairs(build.controls.buildLoadouts.list) do if v == want then idx = j end end
	if not idx then
		failures = failures + 1
		print("FAIL no loadout named " .. want)
	else
		build.controls.buildLoadouts.selFunc(idx, want)
		build.characterLevelAutoMode = true
		recalc()
		local autoLevel = build.characterLevel
		setLevel(s.level)
		local got, exp = snapshotOutput(), expected[i].out
		local diffs, compared = {}, 0
		for k, v in pairs(exp) do
			compared = compared + 1
			if got[k] ~= v then diffs[#diffs + 1] = ("%s: alone %s, merged %s"):format(k, tostring(v), tostring(got[k])) end
		end
		for k in pairs(got) do if exp[k] == nil then diffs[#diffs + 1] = k .. ": only in merged" end end
		local skill = mainSkillName()
		if skill ~= expected[i].skill then diffs[#diffs + 1] = ("main skill: alone %s, merged %s"):format(expected[i].skill, skill) end
		if #diffs == 0 then
			print(("ok   %-22s main skill %-22s %d stats equal%s; Auto level %d (real %d), CombinedDPS %.0f, Life %.0f")
				:format(s.name, skill, compared, s.party and " (vs snapshot with Latest's Party)" or "", autoLevel, s.level, got.CombinedDPS or 0, got.Life or 0))
		else
			failures = failures + 1
			table.sort(diffs)
			print(("FAIL %s: %d differences"):format(s.name, #diffs))
			for n = 1, math.min(#diffs, 15) do print("     " .. diffs[n]) end
		end
	end
end
print(failures == 0 and "PASS" or ("FAILURES: " .. failures))
os.exit(failures == 0 and 0 or 1)
