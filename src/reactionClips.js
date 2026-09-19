const path = require("path");
const fs = require("fs");
const { canPostPublicly } = require("./channelSafety");

const ASSET_DIR = path.join(__dirname, "..", "..", "assets", "reactions");

const CLIPS = [
  {
    id: "raid_convoy",
    file: "raid_convoy.mp4",
    label: "Raid Convoy",
    emoji: "🚓",
    tags: ["raid", "anti-nuke", "permission_escalation", "critical"]
  },
  {
    id: "limitless_burst",
    file: "limitless_burst.mp4",
    label: "Limitless Burst",
    emoji: "💠",
    tags: ["timeout", "scam", "spam", "harassment", "mass_mention", "critical"]
  },
  {
    id: "six_eyes_calm",
    file: "six_eyes_calm.mp4",
    label: "Six Eyes Calm",
    emoji: "👁️",
    tags: ["general", "mediation", "friendly", "appeal", "verification"]
  },
  {
    id: "purple_finish",
    file: "purple_finish.mp4",
    label: "Purple Finish",
    emoji: "💜",
    tags: ["anti-nuke", "timeout", "scam", "voice_abuse", "permission_escalation", "critical"]
  }
];

const CATEGORY_CHOICES = [
  "general", "timeout", "raid", "anti-nuke", "scam", "spam",
  "harassment", "mass_mention", "permission_escalation", "voice_abuse",
  "mediation", "friendly", "verification", "critical"
];

const lastSentByChannel = new Map();
const lastClipByGuild = new Map();

function normalizeCategory(input) {
  const value = typeof input === "object" && input
    ? String(input.category || input.type || "general")
    : String(input || "general");
  const c = value.toLowerCase();
  if (c.includes("raid")) return "raid";
  if (c.includes("nuke") || c.includes("destruct")) return "anti-nuke";
  if (c.includes("permission") || c.includes("role")) return "permission_escalation";
  if (c.includes("scam") || c.includes("link")) return "scam";
  if (c.includes("spam")) return "spam";
  if (c.includes("harass") || c.includes("insult")) return "harassment";
  if (c.includes("mention")) return "mass_mention";
  if (c.includes("voice")) return "voice_abuse";
  if (c.includes("mediat")) return "mediation";
  if (c.includes("friend")) return "friendly";
  if (c.includes("verif")) return "verification";
  if (c.includes("timeout") || c.includes("quarantine")) return "timeout";
  return CATEGORY_CHOICES.includes(c) ? c : "general";
}

function settings(cfg = {}) {
  const raw = cfg.reactionClips || {};
  return {
    enabled: raw.enabled !== false,
    chance: Number.isFinite(Number(raw.chance)) ? Math.max(0, Math.min(1, Number(raw.chance))) : 0.65,
    criticalBoost: Number.isFinite(Number(raw.criticalBoost)) ? Math.max(0, Math.min(0.35, Number(raw.criticalBoost))) : 0.15,
    cooldownMs: Number.isFinite(Number(raw.cooldownMs)) ? Math.max(5000, Number(raw.cooldownMs)) : 18000,
    disabledClipIds: Array.isArray(raw.disabledClipIds) ? raw.disabledClipIds : [],
    categoryOverrides: raw.categoryOverrides && typeof raw.categoryOverrides === "object" ? raw.categoryOverrides : {}
  };
}

function effectiveTags(clip, cfg) {
  const override = settings(cfg).categoryOverrides[clip.id];
  if (!override) return clip.tags;
  return [...new Set([override, ...clip.tags])];
}

function availableClips(cfg = {}) {
  const s = settings(cfg);
  return CLIPS.filter(clip => !s.disabledClipIds.includes(clip.id) && fs.existsSync(path.join(ASSET_DIR, clip.file)));
}

function scoreClip(clip, category, cfg) {
  const tags = effectiveTags(clip, cfg);
  let score = 1;
  if (tags.includes(category)) score += 9;
  if (tags.includes("critical") && ["raid", "anti-nuke", "permission_escalation", "scam"].includes(category)) score += 4;
  if (tags.includes("general")) score += 1;
  if (lastClipByGuild.get(cfg.__reactionGuildId) === clip.id) score *= 0.25;
  return Math.max(0.1, score);
}

function chooseClip(category, cfg = {}, forcedId = null) {
  const clips = availableClips(cfg);
  if (!clips.length) return null;
  if (forcedId) return clips.find(c => c.id === forcedId) || null;

  const weighted = clips.map(clip => ({ clip, score: scoreClip(clip, category, cfg) }));
  const total = weighted.reduce((sum, item) => sum + item.score, 0);
  let roll = Math.random() * total;
  for (const item of weighted) {
    roll -= item.score;
    if (roll <= 0) return item.clip;
  }
  return weighted[weighted.length - 1].clip;
}

function reactionChance(category, incident, cfg, override) {
  if (typeof override === "number") return Math.max(0, Math.min(1, override));
  const s = settings(cfg);
  const severity = String(incident?.severity || "").toLowerCase();
  const critical = severity === "critical" || ["raid", "anti-nuke", "permission_escalation"].includes(category);
  return Math.min(0.95, s.chance + (critical ? s.criticalBoost : 0));
}

async function sendReactionClip(channel, incidentOrCategory, cfg = {}, options = {}) {
  if (!channel?.isTextBased?.()) return false;
  const s = settings(cfg);
  if (!s.enabled || cfg?.aura?.clips === false) return false;
  if (!options.force && !canPostPublicly(cfg, channel)) return false;

  const incident = typeof incidentOrCategory === "object" ? incidentOrCategory : null;
  const category = normalizeCategory(incident || incidentOrCategory);
  const key = `${channel.guild?.id || "dm"}:${channel.id}`;
  const now = Date.now();
  const previous = lastSentByChannel.get(key) || 0;

  if (!options.force && now - previous < s.cooldownMs) return false;
  if (!options.force && Math.random() >= reactionChance(category, incident, cfg, options.chance)) return false;

  const scopedCfg = { ...cfg, __reactionGuildId: channel.guild?.id };
  const clip = chooseClip(category, scopedCfg, options.clipId || null);
  if (!clip) return false;

  const filePath = path.join(ASSET_DIR, clip.file);
  const title = options.caption || `${clip.emoji} **INFINITY EDIT • ${category.toUpperCase().replaceAll("_", " ")}**`;
  const sent = await channel.send({
    content: title,
    files: [{ attachment: filePath, name: clip.file }],
    allowedMentions: { parse: [] }
  }).then(() => true).catch(error => {
    console.error(`Reaction clip ${clip.id} failed:`, error?.message || error);
    return false;
  });

  if (sent) {
    lastSentByChannel.set(key, now);
    if (channel.guild?.id) lastClipByGuild.set(channel.guild.id, clip.id);
  }
  return sent;
}

function clipSummary(cfg = {}) {
  const s = settings(cfg);
  return CLIPS.map(clip => ({
    ...clip,
    enabled: !s.disabledClipIds.includes(clip.id),
    effectiveTags: effectiveTags(clip, cfg),
    exists: fs.existsSync(path.join(ASSET_DIR, clip.file))
  }));
}

module.exports = {
  CLIPS,
  CATEGORY_CHOICES,
  normalizeCategory,
  availableClips,
  chooseClip,
  settings,
  clipSummary,
  sendReactionClip
};
