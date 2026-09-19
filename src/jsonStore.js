const fs = require("fs");
const path = require("path");

function cloneFallback(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function parseFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadJson(file, fallback) {
  ensureParent(file);
  try {
    return parseFile(file);
  } catch (mainError) {
    const backup = `${file}.bak`;
    try {
      const recovered = parseFile(backup);
      // Restore the last known-good backup without overwriting that backup again.
      fs.writeFileSync(file, JSON.stringify(recovered, null, 2));
      console.warn(`[Infinity Storage] Recovered ${path.basename(file)} from backup.`);
      return recovered;
    } catch {}

    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
    } else {
      console.error(`[Infinity Storage] Could not parse ${path.basename(file)}; using in-memory fallback.`, mainError?.message || mainError);
    }
    return cloneFallback(fallback);
  }
}

function saveJson(file, value) {
  ensureParent(file);
  const tmp = `${file}.tmp`;
  const backup = `${file}.bak`;

  // Only copy a valid current file into .bak.
  if (fs.existsSync(file)) {
    try {
      parseFile(file);
      fs.copyFileSync(file, backup);
    } catch {}
  }

  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

module.exports = { loadJson, saveJson };
