const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { canPostPublicly } = require("./channelSafety");
const { sendReactionClip } = require("./reactionClips");

const PACKS = {
  general: [
    "You reached the barrier. The barrier did not care.",
    "Six Eyes caught that before the audit log finished blinking.",
    "Infinity was already between you and the server.",
    "Interesting technique. Terrible matchup.",
    "You tried chaos. The Domain returned a timeout.",
    "The server is under Infinity. Find another hobby.",
    "Six Eyes report: attempt detected, aura denied.",
    "You had a plan. Infinity had permissions.",
    "That move had confidence. It did not have clearance.",
    "You touched the barrier. Now the barrier knows your name.",
    "Caught before the damage could get comfortable.",
    "Wait... that was the whole plan?"
  ],
  spam: [
    "Your keyboard entered the Domain before you did.",
    "Message flood detected. Infinity closed the tap.",
    "Six Eyes counted every message. Yes, all of them.",
    "You spammed faster. Infinity processed faster.",
    "The chat survived. Your cooldown did not."
  ],
  scam: [
    "That link had cursed energy all over it.",
    "Six Eyes inspected the bait. Nobody is biting.",
    "Fake rewards, real timeout energy.",
    "The Domain does not accept suspicious login techniques.",
    "Nice phishing rod. Wrong ocean.",
    "Your link met Infinity before it met a victim."
  ],
  harassment: [
    "Aura is cool. Harassing people is not.",
    "Six Eyes saw the target. Keep the pressure in a game, not on a person.",
    "That crossed from trash-talk into an incident.",
    "The Domain allows jokes. It does not allow targeted abuse.",
    "Keep the aura. Lose the harassment."
  ],
  mass_mention: [
    "You summoned the whole server. Infinity answered instead.",
    "Mass mention technique intercepted.",
    "Everyone did not need that ping. Six Eyes agrees.",
    "Ping storm cancelled at the barrier."
  ],
  "anti-nuke": [
    "You touched the server structure. Six Eyes opened both eyes.",
    "Destruction pattern detected. The Domain is no longer relaxed.",
    "Channels fall. Audit logs remember. Infinity reacts.",
    "Server structure is protected territory.",
    "That was not moderation. That was demolition."
  ],
  raid: [
    "Too many cursed spirits entered at once. The gates are sealed.",
    "Raid pattern detected. Domain lockdown engaged.",
    "Everybody rushed the barrier. The barrier won.",
    "The lobby became an invasion. Infinity changed the rules."
  ],
  permission_escalation: [
    "Administrator power appeared where it should not. Six Eyes noticed.",
    "Permission escalation detected. The crown does not transfer that easily.",
    "You reached for dangerous permissions. Aegis reached first.",
    "Role power changed. The audit trail started glowing."
  ],
  ghost_ping: [
    "Ping deleted. Evidence not deleted.",
    "You removed the message. Six Eyes kept the memory.",
    "Ghost ping detected. Even ghosts leave cursed energy.",
    "Delete button pressed. Audit memory remained."
  ],
  voice_abuse: [
    "Voice chaos detected. Infinity muted the technique, not the vibe.",
    "Moving everyone around is not a Domain Expansion.",
    "Six Eyes saw the voice controls getting abused.",
    "The VC is a room, not a pinball machine."
  ],
  voice_spam: [
    "You entered and left so often the barrier started counting.",
    "Join. Leave. Join. Leave. Six Eyes got the pattern.",
    "The VC door is not a drum pad."
  ],
  mediation_refused: [
    "The peaceful route was offered. Owner review is next.",
    "Mediation declined. The case moves up the Domain.",
    "You skipped the negotiation phase. Six Eyes logged that choice."
  ],
  raid_lock: [
    "Domain Expansion: Server Lockdown.",
    "Barrier maximum. New chaos stays outside.",
    "The Domain is sealed until the threat level drops."
  ],
  emergency: [
    "Maximum barrier output. Emergency Domain active.",
    "Six Eyes stopped observing and started defending.",
    "Aegis entered full response mode.",
    "The server is now inside the inner barrier."
  ],
  verification: [
    "Six Eyes check complete. Human presence confirmed.",
    "Barrier recognizes you. Welcome in.",
    "Identity challenge cleared. The Domain opens."
  ],
  appeal_approved: [
    "Review complete. Infinity corrected the record.",
    "Six Eyes reviewed the evidence. Timeout released.",
    "Aegis can defend and still admit when a case should be reversed."
  ],
  appeal_denied: [
    "Review complete. The original action stands.",
    "Six Eyes checked the case again. The timeout remains.",
    "Appeal reviewed. Evidence did not change the outcome."
  ],
  friendly: [
    "Six Eyes caught the vibe. Keep it funny, not personal.",
    "Aura approved. Escalation not approved.",
    "You two are joking. Keep it that way before the Domain gets serious.",
    "Trash-talk level: funny. Keep it below incident level."
  ]
};

const LIMITLESS = [
  "∞ LIMITLESS RESPONSE — Six Eyes did not blink. The threat did.",
  "∞ LIMITLESS RESPONSE — You found the edge of Infinity. There was still more Infinity.",
  "∞ LIMITLESS RESPONSE — Threat contained before the server finished noticing.",
  "∞ LIMITLESS RESPONSE — Aegis correlation complete. Bad day to be suspicious.",
  "∞ LIMITLESS RESPONSE — The Domain recognized the threat and closed around it."
];

const SHORT_ICONIC = ["Nah, I'd win."];

const GOJO_CLIPS = [
  "https://tenor.com/view/gojo-domain-expansion-skill-jujutsu-kaisen-satoru-gojo-gif-5860080899208530061",
  "https://tenor.com/view/jujutsu-kaisen-satoru-gojo-domain-expansion-gif-19189720",
  "https://tenor.com/view/gojo-satoru-domain-expansion-jujutsu-kaisen-gif-22405509",
  "https://tenor.com/view/gojo-domain-expansion-domain-expansion-gojo-gif-25606081"
];

function randomItem(list) { return list[Math.floor(Math.random() * list.length)]; }
function intensity(cfg) { return cfg?.aura?.intensity || "overdrive"; }

function normalizedCategory(category = "general") {
  const c = String(category || "general").toLowerCase();
  if (PACKS[c]) return c;
  if (c.includes("scam") || c.includes("link")) return "scam";
  if (c.includes("spam")) return "spam";
  if (c.includes("harass") || c.includes("insult")) return "harassment";
  if (c.includes("mention")) return "mass_mention";
  if (c.includes("nuke") || c.includes("destruct")) return "anti-nuke";
  if (c.includes("raid")) return "raid";
  if (c.includes("permission") || c.includes("role")) return "permission_escalation";
  if (c.includes("ghost")) return "ghost_ping";
  if (c.includes("voice")) return "voice_abuse";
  return "general";
}

function auraMeter(level = "normal") {
  const map = {
    normal: "▰▰▱▱▱",
    guarded: "▰▰▰▱▱",
    high: "▰▰▰▰▱",
    critical: "▰▰▰▰▰"
  };
  return map[level] || map.normal;
}

function threatLevelForIncident(incident = {}) {
  const severity = String(incident.severity || "").toLowerCase();
  const cat = normalizedCategory(incident.category);
  if (severity === "critical" || cat === "anti-nuke" || cat === "raid") return "critical";
  if (severity === "high" || ["scam", "permission_escalation", "voice_abuse"].includes(cat)) return "high";
  if (severity === "medium") return "guarded";
  return "normal";
}

function auraColor(level) {
  return level === "critical" ? 0x7c3aed :
    level === "high" ? 0x2563eb :
    level === "guarded" ? 0x06b6d4 :
    0x7dd3fc;
}

function auraTitle(category, level = "normal", rare = false) {
  if (rare) return "∞ LIMITLESS RESPONSE";
  const c = normalizedCategory(category);
  const titles = {
    spam: "👁️ SIX EYES • MESSAGE FLOOD",
    scam: "🔗 SIX EYES • CURSED LINK INTERCEPTED",
    harassment: "⚠️ SIX EYES • LINE CROSSED",
    mass_mention: "📣 SIX EYES • PING STORM STOPPED",
    "anti-nuke": "🌀 AEGIS • STRUCTURAL THREAT",
    raid: "🚨 DOMAIN • RAID CONTAINMENT",
    permission_escalation: "🛡️ AEGIS • POWER ESCALATION",
    ghost_ping: "👻 SIX EYES • GHOST PING CAUGHT",
    voice_abuse: "🎙️ SIX EYES • VOICE CONTROL ABUSE",
    voice_spam: "🎙️ SIX EYES • VOICE SPAM",
    mediation_refused: "🤝 DOMAIN • MEDIATION ESCALATED"
  };
  return titles[c] || (level === "critical" ? "🌀 AEGIS • THREAT CONTAINED" : "∞ SIX EYES • THREAT CAUGHT");
}

function randomAuraLine(category = "general", cfg = null) {
  const mode = intensity(cfg);
  const rareChance = Math.max(0, Math.min(0.25, Number(cfg?.aura?.rareChance ?? 0.05)));
  if (mode === "overdrive" && Math.random() < rareChance) return randomItem(LIMITLESS);
  if (mode !== "subtle" && Math.random() < 0.035) return randomItem(SHORT_ICONIC);
  const pack = PACKS[normalizedCategory(category)] || PACKS.general;
  return randomItem(pack);
}

function auraStatusLine(cfg = null) {
  const mode = intensity(cfg);
  if (mode === "subtle") return "Six Eyes online. Aegis is watching quietly.";
  if (mode === "balanced") return randomItem([
    "Six Eyes online. The barrier is stable.",
    "Aegis correlation active. Nothing suspicious gets a free pass.",
    "Infinity is between the server and whatever comes next."
  ]);
  return randomItem([
    "∞ Six Eyes online. Every audit trail is inside the Domain.",
    "🌀 Infinity active. Aegis is correlating the entire battlefield.",
    "👁️ The server is inside the Domain now. Suspicious moves glow brighter in here.",
    "∞ Barrier stable. Threat correlation armed. Aura unnecessarily high."
  ]);
}

function auraEventLine(type, cfg = null) {
  const pack = PACKS[type] || PACKS.general;
  return randomAuraLine(type, cfg) || randomItem(pack);
}

function signature(level, cfg) {
  if (cfg?.aura?.signatureBars === false) return "";
  return `\n\n**DOMAIN PRESSURE**  ${auraMeter(level)}`;
}

async function sendAuraCatch(channel, userId, incident, cfg) {
  if (!cfg.aura.publicReplies || !channel?.isTextBased()) return false;
  if (!canPostPublicly(cfg, channel)) return false;

  const level = threatLevelForIncident(incident);
  const line = randomAuraLine(incident.category, cfg);
  const rare = line.startsWith("∞ LIMITLESS RESPONSE");
  const embed = new EmbedBuilder()
    .setTitle(auraTitle(incident.category, level, rare))
    .setDescription(
      `**${line}**\n\n` +
      `<@${userId}> • \`${String(incident.category || "security").toUpperCase()}\`\n` +
      `${incident.reason}\n\n` +
      `**Incident:** \`${incident.id}\`` +
      signature(level, cfg)
    )
    .setColor(auraColor(level))
    .setFooter({ text: `Infinity Security • ${level.toUpperCase()} DOMAIN • Six Eyes active` })
    .setTimestamp();

  const sent = await channel.send({
    embeds: [embed],
    allowedMentions: { users: [userId] }
  }).then(() => true).catch(() => false);

  let localClipSent = false;
  if (sent && cfg.aura.clips) {
    localClipSent = await sendReactionClip(channel, incident, cfg).catch(() => false);
  }

  // Keep the old external GIF pool only as a rare fallback. User-provided
  // MP4 edits with audio are now Infinity's primary reaction system.
  const fallbackGifChance = intensity(cfg) === "overdrive" ? 0.08 : 0.04;
  if (sent && cfg.aura.clips && !localClipSent && Math.random() < fallbackGifChance) {
    await channel.send({
      content: randomItem(GOJO_CLIPS),
      allowedMentions: { parse: [] }
    }).catch(() => {});
  }

  return sent;
}

async function sendCaughtDm(member, incident, actionText, guildName, cfg) {
  if (!cfg.aura.offenderDms || !member) return false;

  const level = threatLevelForIncident(incident);
  const line = randomAuraLine(incident.category, cfg);
  const embed = new EmbedBuilder()
    .setTitle(level === "critical" ? "🌀 You entered the inner Domain." : "👁️ Wait... what are you doing?")
    .setDescription(
      `**${line}**\n\n` +
      `Six Eyes detected an incident on **${guildName}**.\n` +
      `**Reason:** ${incident.reason}\n` +
      `**Action:** ${actionText}\n` +
      `**Incident:** \`${incident.id}\`` +
      signature(level, cfg) +
      `\n\nIf you think this was a mistake, use **Appeal Timeout** below. The server owner will review the evidence.`
    )
    .setColor(auraColor(level))
    .setFooter({ text: "Infinity Security • Aegis has the receipt" })
    .setTimestamp();

  if (!cfg.appeals?.enabled) {
    return member.send({ embeds: [embed] }).then(() => true).catch(() => false);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`appeal_open_${incident.id}`)
      .setLabel("Appeal to Six Eyes")
      .setEmoji("👁️")
      .setStyle(ButtonStyle.Primary)
  );

  return member.send({ embeds: [embed], components: [row] }).then(() => true).catch(() => false);
}

module.exports = {
  randomAuraLine,
  auraStatusLine,
  auraEventLine,
  auraMeter,
  auraTitle,
  threatLevelForIncident,
  sendAuraCatch,
  sendCaughtDm
};
