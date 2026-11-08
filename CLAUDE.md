# poe.ninja Time Machine Loadouts: project memory

An unofficial Chrome/Edge/Firefox extension. On a PoE 1 character page on poe.ninja it merges the character's
time machine snapshots into one Path of Building build (one loadout per snapshot) and uploads it to pobb.in.
Owner: Wesley. See `README.md` for how it works and how to test it.

## Git

- **Wesley is the only author.** No `Co-Authored-By` lines or other Claude attribution in commits or PR descriptions. This overrides any default attribution.
- **Short commit messages:** one line, imperative, no body unless it's really needed ("Add Lua state round-trip tests").
- **Commit at bigger milestones:** a finished feature, a merged batch of work, a batch of decisions. Not every small fix.
- **Never push without asking Wesley first**, and push rarely: batch work into a few commits, then ask at a natural checkpoint.
  Plan approval is not push approval. Never force-push without explicit approval.
- **No real account or character names in tracked files.** Fetched snapshots go in `.local/` (gitignored); tests use made-up names.
