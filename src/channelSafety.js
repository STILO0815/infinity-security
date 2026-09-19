const { ChannelType, PermissionsBitField } = require("discord.js");
const { commit } = require("../config");

const TRAP_TERMS = [
  "honeypot", "honey pot", "honey-pot",
  "anti catch", "anti-catch", "anticatch",
  "bot trap", "bot-trap", "trap channel",
  "do not type", "dont type", "don't type",
  "do not talk", "dont talk", "don't talk",
  "instant kick", "kick on message", "kick-if-message",
  "catch bot", "catch-bot"
];

const BOT_INTERACTION_TERMS = [
  "owo", "minigame", "mini game", "mini-game",
  "bot commands", "bot-commands", "botcommands",
  "bot chat", "bot-chat", "bot spam", "bot-spam",
  "counting", "economy", "grind", "games", "game commands"
];

function normalizeText(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function channelCorpus(channel) {
  const parentName = channel.parent?.name || "";
  return normalizeText(`${channel.name || ""} ${channel.topic || ""} ${parentName}`);
}

function hasTerm(corpus, terms) {
  return terms.some(term => corpus.includes(normalizeText(term)));
}

function autoPolicyForChannel(channel) {
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    return { type: "ignore", source: "auto", reason: "Non-text channel" };
  }

  const corpus = channelCorpus(channel);

  if (normalizeText(channel.name) === "bot logs") {
    return { type: "logs", source: "auto", reason: "Infinity Security log channel" };
  }

  if (hasTerm(corpus, TRAP_TERMS)) {
    return {
      type: "trap",
      source: "auto",
      reason: "Name/topic/category looks like a honeypot, anti-catch or do-not-type channel"
    };
  }

  if (hasTerm(corpus, BOT_INTERACTION_TERMS)) {
    return {
      type: "bot_interaction",
      source: "auto",
      reason: "Name/topic/category looks like a bot/minigame command channel"
    };
  }

  return { type: "normal", source: "auto", reason: "Normal monitored channel" };
}

async function scanGuildChannels(guild, cfg) {
  await guild.channels.fetch().catch(() => null);

  const old = cfg.channelSafety.policies || {};
  const next = {};

  let normal = 0;
  let botInteraction = 0;
  let traps = 0;
  let ignored = 0;

  for (const channel of guild.channels.cache.values()) {
    if (!channel) continue;

    const existing = old[channel.id];
    const policy = existing?.source === "manual"
      ? existing
      : autoPolicyForChannel(channel);

    next[channel.id] = policy;

    if (policy.type === "normal" || policy.type === "logs") normal++;
    else if (policy.type === "bot_interaction") botInteraction++;
    else if (policy.type === "trap") traps++;
    else ignored++;
  }

  cfg.channelSafety.policies = next;
  cfg.channelSafety.lastScanAt = Date.now();
  commit();

  return { normal, botInteraction, traps, ignored, total: Object.keys(next).length };
}

function getChannelPolicy(cfg, channelId) {
  return cfg.channelSafety?.policies?.[channelId] || { type: "normal", source: "fallback", reason: "No scan data" };
}

function isTrapChannel(cfg, channelId) {
  return getChannelPolicy(cfg, channelId).type === "trap";
}

function isBotInteractionChannel(cfg, channelId) {
  return (
    getChannelPolicy(cfg, channelId).type === "bot_interaction" ||
    cfg.botInteractions?.trustedChannelIds?.includes(channelId)
  );
}

function canPostPublicly(cfg, channel) {
  if (!channel?.isTextBased()) return false;
  const policy = getChannelPolicy(cfg, channel.id);

  // Cautious outbound policy:
  // public personality/aura messages are only allowed in normal channels.
  // Never talk publicly in trap, bot/minigame, logs or unknown special channels.
  return policy.type === "normal";
}

async function detectBotInteraction(message, cfg) {
  if (!cfg.botInteractions?.enabled) {
    return { isBotInteraction: false, reason: null };
  }

  if (isBotInteractionChannel(cfg, message.channel.id)) {
    return { isBotInteraction: true, reason: "bot/minigame channel" };
  }

  if ([...message.mentions.users.values()].some(user => user.bot)) {
    return { isBotInteraction: true, reason: "mentions a bot" };
  }

  const trustedBotIds = cfg.botInteractions.trustedBotIds || [];
  if ([...message.mentions.users.keys()].some(id => trustedBotIds.includes(id))) {
    return { isBotInteraction: true, reason: "mentions a trusted interaction bot" };
  }

  const content = normalizeText(message.content || "");
  for (const rawPrefix of cfg.botInteractions.prefixes || []) {
    const prefix = normalizeText(rawPrefix);
    if (prefix && (content === prefix || content.startsWith(`${prefix} `))) {
      return { isBotInteraction: true, reason: `known bot prefix: ${rawPrefix}` };
    }
  }

  if (message.reference?.messageId) {
    const referenced = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (referenced?.author?.bot) {
      return { isBotInteraction: true, reason: "reply to a bot" };
    }
  }

  return { isBotInteraction: false, reason: null };
}

async function ensureBotLogs(guild, cfg, botUserId) {
  let logChannel = cfg.logChannelId ? guild.channels.cache.get(cfg.logChannelId) : null;

  if (!logChannel?.isTextBased() || normalizeText(logChannel.name) !== "bot logs") {
    logChannel = guild.channels.cache.find(
      c => c.isTextBased() && normalizeText(c.name) === "bot logs"
    );
  }

  if (!logChannel) {
    const overwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      }
    ];

    if (botUserId) {
      overwrites.push({
        id: botUserId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      });
    }

    logChannel = await guild.channels.create({
      name: "bot-logs",
      type: ChannelType.GuildText,
      topic: "∞ Infinity Security • incidents, timeout actions and Six Eyes reports",
      permissionOverwrites: overwrites
    }).catch(() => null);
  }

  if (logChannel) {
    cfg.logChannelId = logChannel.id;
    cfg.channelSafety.policies[logChannel.id] = {
      type: "logs",
      source: "manual",
      reason: "Infinity Security private log channel"
    };
    commit();
  }

  return logChannel;
}

function setManualChannelPolicy(cfg, channelId, type, reason) {
  cfg.channelSafety.policies[channelId] = {
    type,
    source: "manual",
    reason: reason || "Set manually"
  };
  commit();
}

module.exports = {
  normalizeText,
  scanGuildChannels,
  getChannelPolicy,
  isTrapChannel,
  isBotInteractionChannel,
  canPostPublicly,
  detectBotInteraction,
  ensureBotLogs,
  setManualChannelPolicy
};
