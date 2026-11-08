# poe.ninja Time Machine Loadouts

An unofficial browser extension for Chrome, Edge and Firefox. On a Path of Exile 1 character page on
[poe.ninja](https://poe.ninja/poe1/builds), it combines the character's time machine snapshots into one
Path of Building build, with **one loadout per snapshot**, and shares it on [pobb.in](https://pobb.in).

A small **PoB snapshots** button sits at the bottom right of the character page. Click it, tick the snapshots
you want (or **Select all**), then press **Generate**. You get a pobb.in link with **Copy** and **Open** buttons.
In PoB, switch between snapshots with the **Loadouts** dropdown at the top.

Free and unofficial. Game names and data belong to Grinding Gear Games; poe.ninja, pobb.in and Path of Building
belong to their authors.

## Install (unpacked, for development)

```
npm install
npm run build        # writes dist/chrome and dist/firefox
```

- **Chrome / Edge:** open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, choose
  **Load unpacked**, and pick `dist/chrome`.
- **Firefox (140+):** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and pick
  `dist/firefox/manifest.json`. If Generate says it can't reach pobb.in, allow the extension's access to pobb.in
  in `about:addons` → the extension → Permissions.

## Packaging and stores

```
npm run package      # dist/packages/firefox-<version>.zip and chrome-<version>.zip
npm run lint:firefox # Mozilla's add-on linter on dist/firefox
npm run icons        # re-render icons/*.png from icons/icon.svg (uses Edge)
```

The Firefox zip is what you upload to addons.mozilla.org. The listing text is in `store/firefox-listing.md`, and
the privacy policy is in `PRIVACY.md`. Firefox needs version 140 or later, because the manifest declares its
data use (the build sent to pobb.in) with `data_collection_permissions`, which Firefox supports from 140.

## Releases

GitHub Actions does this (`.github/workflows/`):

- **CI** (every push to `main` and every pull request): unit tests, Mozilla's linter and a packaging run.
- **Release** (pushing a tag like `v0.2.0`): checks the tag matches the version in `manifest.base.json` and
  `package.json`, runs the tests, gets the Firefox add-on signed by Mozilla as an unlisted add-on, and publishes
  a GitHub release with the `.xpi` (drag onto Firefox to install) and the Chrome/Edge zip, plus install steps.

To release: set the same new version in `manifest.base.json` and `package.json`, commit, then
`git tag v0.2.0 && git push origin main v0.2.0`. Mozilla signs each version number only once, whether it's for
the store listing or a release file.

One-time setup: in addons.mozilla.org → Developer Hub → Tools → Manage API Keys, create a key, then add it to the
GitHub repo (Settings → Secrets and variables → Actions) as `AMO_JWT_ISSUER` (the JWT issuer) and
`AMO_JWT_SECRET` (the JWT secret).

## How it works

1. **Snapshots.** The panel asks poe.ninja's builds API for the character, the same request poe.ninja's own page
   makes. The `tmz` header in the reply lists the snapshots this character has (hour-3 … week-15, latest).
   Labels count from league start.
2. **Download.** When the panel opens, it fetches every snapshot's PoB code, up to 4 requests at a time
   (poe.ninja serves these replies from Cloudflare's cache). A 429 "too many requests" reply is retried once
   after 2 seconds. A character with 16 snapshots is ready in under a second.
3. **Repeats.** Once a player stops playing a character, poe.ninja keeps adding snapshots with exactly the same
   build. A run of identical snapshots in a row is listed once, for example **Week 10 - Latest**, and becomes one
   loadout. A build that changed and later changed back keeps separate entries.
4. **Merge** (`src/merge.js`). Each snapshot's tree, item set, skill set and config set are tagged
   `Name {n}`. That's how PoB links them into a loadout (`Build.lua`, `SyncLoadouts`). The merge also:
   - renumbers items everywhere they're used: item set slots, tree jewel sockets, and Animate Guardian's item set
     link on its gem;
   - keeps identical items once;
   - moves each snapshot's main skill to the top of its skill set, because PoB has one main-skill index for the
     whole build.
5. **Level.** The build's character level is set to PoB's **Auto** mode, which estimates the level from the
   active tree's points. Each loadout's name also shows its real level.
6. **Upload.** The background script encodes the build the way PoB does and posts it to pobb.in, like PoB's own
   Share button.

### Known PoB limits

- **Party tab.** PoB has one Party tab for the whole build. poe.ninja puts ally buffs there (for example from
  Animate Guardian's gear). The merged build keeps the newest selected snapshot's Party. The panel and the
  build's Notes name the loadouts whose own Party was different.
- **Level.** Auto level is an estimate from passive points. In testing it was within 1–3 levels of the real level.

## Tests

| Command | What it checks |
| --- | --- |
| `npm test` | Unit tests (Node's built-in runner): merge rules and error cases, PoB code format against Node's zlib, the poe.ninja client and URL handling, the pobb.in upload. |
| `node tools/fetch_snapshots.js <character URL>` | Fetches a real character's snapshots into `.local/<name>/` (gitignored, since it holds account names) and writes the merged build. |
| `tools\pob_check.ps1 .local\<name>` | Loads the merged build in headless Path of Building v2.67.2, using the PoE-Sim repo's pinned PoB and LuaJIT. Checks there's one loadout per snapshot, and that every loadout gives exactly the same stats as its snapshot loaded alone. |
| `npm run e2e:edge -- <character URL>` | Real Edge with the extension loaded: opens the page, uses the panel, generates. pobb.in is intercepted, so nothing is uploaded. |
| `npm run e2e:firefox -- <character URL>` | The same in Firefox, with uploads sent to a local stand-in server. |

The two `e2e` tests make real requests to poe.ninja. Set `E2E_CHROMIUM` or `E2E_FIREFOX` to use a browser that
isn't in the default install location.
