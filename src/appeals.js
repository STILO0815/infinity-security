const path = require("path");
const crypto = require("crypto");
const { loadJson, saveJson } = require("./jsonStore");

const FILE = path.join(__dirname, "..", "..", "data", "appeals.json");
let appeals = loadJson(FILE, []);

function save() {
  appeals = appeals.slice(-2000);
  saveJson(FILE, appeals);
}

function makeId() {
  return `APP-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function findByIncident(guildId, userId, incidentId) {
  return [...appeals].reverse().find(item =>
    item.guildId === guildId &&
    item.userId === userId &&
    item.incidentId === incidentId
  ) || null;
}

function createAppeal({ guildId, userId, incidentId, reason }) {
  const existing = findByIncident(guildId, userId, incidentId);
  if (existing) return existing;

  const appeal = {
    id: makeId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    guildId,
    userId,
    incidentId,
    reason: String(reason || "No reason provided").slice(0, 1500),
    status: "pending",
    reviewedBy: null,
    reviewNote: null
  };
  appeals.push(appeal);
  save();
  return appeal;
}

function getAppeal(id) {
  return appeals.find(item => item.id === id) || null;
}

function updateAppeal(id, patch) {
  const appeal = getAppeal(id);
  if (!appeal) return null;
  Object.assign(appeal, patch, { updatedAt: Date.now() });
  save();
  return appeal;
}

function pendingForGuild(guildId, limit = 20) {
  return appeals
    .filter(item => item.guildId === guildId && item.status === "pending")
    .slice(-limit)
    .reverse();
}

function recentForGuild(guildId, limit = 20) {
  return appeals.filter(item => item.guildId === guildId).slice(-limit).reverse();
}

module.exports = { createAppeal, getAppeal, findByIncident, updateAppeal, pendingForGuild, recentForGuild };
