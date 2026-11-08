// Sets the version in manifest.base.json, package.json and package-lock.json together (the release workflow checks they match
// the tag). Usage: npm run bump -- 0.1.1
"use strict";
const fs = require("fs");
const path = require("path");

function setVersion(text, version) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ""))) throw new Error('Versions look like "1.2.3", got "' + version + '"');
  const re = /("version"\s*:\s*")[^"]*(")/;
  if (!re.test(text)) throw new Error("No version field found");
  return text.replace(re, "$1" + version + "$2"); // first "version" only: the top-level one in both files
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
  try {
    for (const f of ["manifest.base.json", "package.json"]) {
      const p = path.join(root, f);
      const before = fs.readFileSync(p, "utf8");
      const after = setVersion(before, process.argv[2]);
      if (JSON.parse(after).version !== process.argv[2]) throw new Error(f + ": top-level version did not change");
      fs.writeFileSync(p, after);
      console.log(f + " -> " + process.argv[2]);
    }
    // package-lock.json repeats the version at the top and under packages[""].
    const lockPath = path.join(root, "package-lock.json");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    lock.version = process.argv[2];
    if (lock.packages && lock.packages[""]) lock.packages[""].version = process.argv[2];
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
    console.log("package-lock.json -> " + process.argv[2]);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { setVersion };
