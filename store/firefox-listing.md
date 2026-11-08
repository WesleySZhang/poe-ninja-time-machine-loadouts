# addons.mozilla.org listing

Text to paste into the Developer Hub when submitting `dist/packages/firefox-<version>.zip` (`npm run package`).

## Name

poe.ninja Time Machine Loadouts

## Summary (250 characters max)

Unofficial. On a Path of Exile character page on poe.ninja, turns the character's time machine snapshots into one Path of Building build with a loadout per snapshot, and shares it as a pobb.in link.

## Description

See how a Path of Exile character grew over the league, in Path of Building.

On a PoE 1 character page on poe.ninja, a small "PoB snapshots" button appears at the bottom right. Click it, tick the time machine snapshots you want (or Select all), and press Generate. You get a pobb.in link to one Path of Building build with a loadout for each snapshot. In PoB, switch between them with the Loadouts dropdown.

- Each loadout has that snapshot's passive tree, gear, skills and config.
- Snapshots that are exactly the same in a row, which happens once a player stops playing a character, are shown and merged once (for example "Week 10 - Latest").
- Each loadout's name shows the character's real level at that time.

Known Path of Building limits:
- PoB has one Party tab for the whole build, so ally buffs come from the newest selected snapshot. The panel and the build's Notes name the loadouts this affects.
- The build uses PoB's Auto level, which estimates the level from passive points. Each loadout's name shows the real level.

Data: the extension asks poe.ninja's public API for the snapshots. When you press Generate, the merged build is uploaded to pobb.in so you get a link. Nothing is sent to the developer.

Free and unofficial. Not affiliated with poe.ninja, pobb.in, Path of Building or Grinding Gear Games. Game names and data belong to Grinding Gear Games.

## Categories

- Firefox: Games & Entertainment

## Other fields

- License: MIT
- Privacy policy: paste the text of `PRIVACY.md`.
- Support email: your choice.
- Homepage / support site: leave empty while the GitHub repo is private.
- Tags: path of exile, poe, path of building, pob, poe.ninja
- Notes to reviewer: Plain, unminified JavaScript, so no build step to reproduce (the zip is the files in `src/`
  plus a generated manifest). To test: open any PoE 1 character page, for example from
  https://poe.ninja/poe1/builds, click "PoB snapshots" at the bottom right, then Generate. The only upload is the
  POST to https://pobb.in/pob/ when Generate is pressed, which is why websiteContent is declared.
