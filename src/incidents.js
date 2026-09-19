const path = require("path");
const crypto = require("crypto");
const { loadJson, saveJson } = require("./jsonStore");

const FILE = path.join(__dirname, "..", "..", "data", "incidents.json");
let incidents = loadJson(FILE, []);
function save() {
  incidents = incidents.slice(-3000);
  saveJson(FILE, incidents);
}
function makeId() {
  const d = new Date();
  const date = [d.getUTCFullYear(), String(d.getUTCMonth()+1).padStart(2,"0"), String(d.getUTCDate()).padStart(2,"0")].join("");
  return `INF-${date}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}
function createIncident(data) {
  const incident = {
    id: makeId(), createdAt: Date.now(), guildId: data.guildId, userId: data.userId || null,
    category: data.category || "unknown", severity: data.severity || "medium",
    reason: data.reason || "Security detection",
    confidence: typeof data.confidence === "number" ? data.confidence : null,
    action: data.action || "logged", metadata: data.metadata || {}
  };
  incidents.push(incident); save(); return incident;
}
function getIncident(id) { return incidents.find(x => x.id === id) || null; }
function updateIncident(id, patch) { const incident = incidents.find(x => x.id === id); if (!incident) return null; Object.assign(incident, patch); save(); return incident; }
function recentForUser(guildId, userId, hours = 24) {
  const cutoff = Date.now() - hours * 3600000;
  return incidents.filter(x => x.guildId === guildId && x.userId === userId && x.createdAt >= cutoff);
}
function successfulTimeoutsForUser(guildId, userId, hours = 24, excludeIncidentId = null) {
  return recentForUser(guildId, userId, hours).filter(x => {
    if (excludeIncidentId && x.id === excludeIncidentId) return false;
    const meta = x.metadata || {};
    if (!meta.timeoutMinutes) return false;
    if (meta.appealStatus === "approved") return false;
    if (meta.timeoutRemovedBy || meta.reviewOverturned) return false;
    if (/failed|deduplicated|removed/i.test(String(x.action || ""))) return false;
    return true;
  });
}
function recentForGuild(guildId, limit = 10) { return incidents.filter(x => x.guildId === guildId).slice(-limit).reverse(); }
module.exports = { createIncident, getIncident, updateIncident, recentForUser, successfulTimeoutsForUser, recentForGuild };
