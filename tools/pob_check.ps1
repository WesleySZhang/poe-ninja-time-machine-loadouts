# Run tools/pob_check.lua in headless PoB, using PoE-Sim's pinned PoB checkout and LuaJIT build.
# Usage: tools\pob_check.ps1 <folder from fetch_snapshots.js> [-PoeSim <path to PoE-Sim repo>]
param([Parameter(Mandatory)][string]$Dir, [string]$PoeSim = "$PSScriptRoot/../../PoE-Sim")
$ErrorActionPreference = 'Stop'
$Sim = (Resolve-Path $PoeSim).Path -replace '\\', '/'
$Check = (Resolve-Path $Dir).Path -replace '\\', '/'
$Script = (Resolve-Path "$PSScriptRoot/pob_check.lua").Path -replace '\\', '/'
$Lj = "$Sim/.local/luajit"
Push-Location "$Sim/sources/pob/src"
try {
	$env:LUA_PATH = "../runtime/lua/?.lua;../runtime/lua/?/init.lua;./?.lua;$Lj/lua/?.lua;;"
	$env:LUA_CPATH = "$Lj/?.dll;;"
	& "$Lj/luajit.exe" -joff -e "CHECK_DIR='$Check'; dofile('HeadlessWrapper.lua'); dofile('$Script')"
	exit $LASTEXITCODE
} finally { Pop-Location }
