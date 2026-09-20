const assert = require("assert");
const fs = require("fs");
const path = require("path");
const source = fs.readFileSync(path.join(__dirname, "..", "src", "security", "reactionClips.js"), "utf8");
for (const id of ["raid_convoy","limitless_burst","six_eyes_calm","purple_finish"]) {
  assert(source.includes(`id: "${id}"`), `Missing clip id ${id}`);
}
for (const name of ["raid_convoy.mp4","limitless_burst.mp4","six_eyes_calm.mp4","purple_finish.mp4"]) {
  const file = path.join(__dirname, "..", "assets", "reactions", name);
  assert(fs.existsSync(file), `Missing asset ${name}`);
  assert(fs.statSync(file).size > 100000, `Asset too small ${name}`);
}
assert(source.includes('chance: Number.isFinite(Number(raw.chance))'));
assert(source.includes('cooldownMs'));
assert(source.includes('files: [{ attachment: filePath'));
console.log("reaction-clips: PASS");
