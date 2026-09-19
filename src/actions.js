const { EmbedBuilder, ChannelType, PermissionsBitField } = require("discord.js");
const { commit } = require("../config");
const { sendCaughtDm, auraEventLine, auraMeter } = require("./aura");
const { successfulTimeoutsForUser, updateIncident } = require("./incidents");
const { markSecurityDelete } = require("./messageAudit");


const actionLocks = new Map();

function actionLockKey(guildId, userId) { return `${guildId}:${userId}`; }
function acquireActionLock(guildId, userId, dedupMs) {
  const key = actionLockKey(guildId, userId);
  const now = Date.now();
  const last = actionLocks.get(key) || 0;
  if (now - last < dedupMs) return false;
  actionLocks.set(key, now);
  setTimeout(() => {
    if (actionLocks.get(key) === now) actionLocks.delete(key);
  }, dedupMs).unref?.();
  return true;
}

function releaseActionLock(guildId, userId) { actionLocks.delete(actionLockKey(guildId, userId)); }

async function applyTimeoutAtLeast(member, minutes, reason) {
  const requestedMs = Math.max(60_000, Number(minutes || 1) * 60_000);
  const currentUntil = member.communicationDisabledUntilTimestamp || 0;
  const currentRemaining = Math.max(0, currentUntil - Date.now());
  if (currentRemaining >= requestedMs - 1000) {
    return { ok: true, unchangedLongerTimeout: true, effectiveMs: currentRemaining };
  }
  const ok = await member.timeout(requestedMs, reason).then(() => true).catch(() => false);
  return { ok, unchangedLongerTimeout: false, effectiveMs: requestedMs };
}
async function sendLog(guild, cfg, title, description, severity = "info", fields = []) {
  if (!cfg.logChannelId) return false;

  const channel = guild.channels.cache.get(cfg.logChannelId);
  if (!channel?.isTextBased()) return false;

  const color =
    severity === "danger" ? 0xff3b30 :
    severity === "warn" ? 0xffa500 :
    0x60a5fa;

  const icon = severity === "danger" ? "🌀" : severity === "warn" ? "⚠️" : "👁️";
  const pressure = severity === "danger" ? "critical" : severity === "warn" ? "high" : "guarded";
  const embed = new EmbedBuilder()
    .setTitle(`${icon} ∞ AEGIS LOG • ${title}`)
    .setDescription(`${description}\n\n**DOMAIN PRESSURE**  ${auraMeter(pressure)}`)
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: "Infinity Security • Six Eyes Audit Domain" });

  if (fields.length) embed.addFields(fields);

  return channel.send({ embeds: [embed] })
    .then(() => true)
    .catch(() => false);
}

function timeoutForStrike(category, strike) {
  if (category === "scam") {
    if (strike <= 1) return 30;
    if (strike === 2) return 120;
    return 1440;
  }

  if (category === "mass_mention" || category === "harassment") {
    if (strike <= 1) return 10;
    if (strike === 2) return 30;
    return 120;
  }

  if (category === "anti-nuke") {
    if (strike <= 1) return 120;
    return 1440;
  }

  if (strike <= 1) return 5;
  if (strike === 2) return 15;
  if (strike === 3) return 60;
  return 120;
}

function formatMinutes(minutes) {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} day timeout`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hour timeout`;
  return `${minutes} minute timeout`;
}

async function sendOwnerTimeoutDm(guild, incident, actionText, details = {}) {
  const owner = await guild.fetchOwner().catch(() => null);
  if (!owner) return false;

  const lines = [
    `**${auraEventLine(incident.category || "general")}**`,
    "",
    `Infinity Security contained <@${incident.userId}> on **${guild.name}**.`,
    "",
    `**What happened:** ${incident.reason}`,
    `**Category:** ${incident.category}`,
    `**Action:** ${actionText}`,
    `**Incident:** \`${incident.id}\``
  ];

  if (details.channelId) lines.push(`**Channel:** <#${details.channelId}>`);
  if (details.contentPreview) {
    const preview = String(details.contentPreview).replace(/`/g, "ˋ").slice(0, 500);
    lines.push(`**Message:** \`${preview || "(empty)"}\``);
  }

  const embed = new EmbedBuilder()
    .setTitle("👁️ SIX EYES REPORT • TIMEOUT CONFIRMED")
    .setDescription(lines.join("\n"))
    .setColor(0x7dd3fc)
    .setFooter({ text: "Aegis containment complete • Evidence preserved" })
    .setTimestamp();

  return owner.send({ embeds: [embed] })
    .then(() => true)
    .catch(() => false);
}

async function sendOwnerMediationDm(guild, caseData, title, summary, fields = []) {
  const owner = await guild.fetchOwner().catch(() => null);
  if (!owner) return false;

  const embed = new EmbedBuilder()
    .setTitle(`🤝 ∞ DOMAIN MEDIATION • ${title}`)
    .setDescription(
      `**Mediation:** \`${caseData.id}\`\n` +
      `**Users:** <@${caseData.users[0]}> and <@${caseData.users[1]}>\n\n` +
      summary
    )
    .setColor(0x7dd3fc)
    .setFooter({ text: "Six Eyes mediation • Facts over ego" })
    .setTimestamp();

  if (fields.length) embed.addFields(fields);

  return owner.send({ embeds: [embed] })
    .then(() => true)
    .catch(() => false);
}

async function enforceMessageIncident(message, incident, cfg) {
  if (cfg.mode !== "enforce") {
    return { acted: false, actionText: "Alert only — no timeout" };
  }

  const member = message.member;
  if (!member?.moderatable) {
    await sendLog(
      message.guild,
      cfg,
      "Timeout failed",
      `<@${message.author.id}> triggered **${incident.category.toUpperCase()}**, but the member is not moderatable.\nIncident: \`${incident.id}\``,
      "danger"
    );
    return { acted: false, actionText: "Timeout failed — role/permission issue" };
  }

  const dedupMs = Math.max(2000, Number(cfg.punishment.actionDedupMs || 10000));
  if (!acquireActionLock(message.guild.id, message.author.id, dedupMs)) {
    updateIncident(incident.id, { action: "deduplicated security action", metadata: { ...incident.metadata, deduplicated: true } });
    return { acted: false, deduplicated: true, actionText: "Already handled by another detector" };
  }

  const previous = successfulTimeoutsForUser(
    message.guild.id,
    message.author.id,
    cfg.punishment.strikeWindowHours,
    incident.id
  );
  const strike = previous.length + 1;
  const minutes = timeoutForStrike(incident.category, strike);
  const actionText = formatMinutes(minutes);

  // Never shorten an existing longer timeout.
  const timeoutResult = await applyTimeoutAtLeast(
    member,
    minutes,
    `Infinity Security ${incident.id}: ${incident.category}`
  );
  const timeoutApplied = timeoutResult.ok;
  const effectiveActionText = timeoutResult.unchangedLongerTimeout
    ? `existing longer timeout kept (~${formatMinutes(Math.max(1, Math.ceil(timeoutResult.effectiveMs / 60000)))} remaining)`
    : actionText;

  if (!timeoutApplied) {
    releaseActionLock(message.guild.id, message.author.id);
    updateIncident(incident.id, {
      action: "timeout failed",
      metadata: { ...incident.metadata, strike, timeoutMinutes: minutes }
    });

    await sendLog(
      message.guild,
      cfg,
      "Timeout failed",
      `<@${message.author.id}> should have received **${actionText}**, but Discord rejected the timeout.\n` +
      `Check role order and **Moderate Members** permission.\nIncident: \`${incident.id}\``,
      "danger"
    );

    return { acted: false, actionText: "Timeout failed — role/permission issue" };
  }

  // Security content can still be removed; the member sanction remains timeout-only.
  markSecurityDelete(message.id);
  await message.delete().catch(() => {});

  updateIncident(incident.id, {
    action: effectiveActionText,
    metadata: { ...incident.metadata, strike, timeoutMinutes: minutes, preservedLongerTimeout: Boolean(timeoutResult?.unchangedLongerTimeout) }
  });

  const offenderDm = await sendCaughtDm(
    member,
    incident,
    effectiveActionText,
    message.guild.name,
    cfg
  );

  const ownerDm = await sendOwnerTimeoutDm(
    message.guild,
    incident,
    effectiveActionText,
    {
      channelId: message.channel.id,
      contentPreview: incident.metadata?.contentPreview || message.content
    }
  );

  await sendLog(
    message.guild,
    cfg,
    "Timeout applied",
    `<@${message.author.id}> • **${incident.category.toUpperCase()}**\n` +
    `${incident.reason}\n**Action:** ${effectiveActionText}\n**Incident:** \`${incident.id}\``,
    "danger",
    [
      { name: "Strike", value: String(strike), inline: true },
      { name: "Owner DM", value: ownerDm ? "✅ Sent" : "⚪ Closed/failed", inline: true },
      { name: "User DM", value: offenderDm ? "✅ Sent" : "⚪ Closed/failed", inline: true }
    ]
  );

  return { acted: true, actionText: effectiveActionText, strike, ownerDm, offenderDm };
}

async function punishExecutor(guild, user, incident, cfg, requestedMinutes = 60) {
  if (cfg.mode !== "enforce" || !user) return { acted: false };

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member?.moderatable) {
    await sendLog(
      guild,
      cfg,
      "Timeout failed",
      `<@${user.id}> triggered **${incident.category.toUpperCase()}**, but cannot be timed out.\nIncident: \`${incident.id}\``,
      "danger"
    );
    return { acted: false };
  }

  const dedupMs = Math.max(2000, Number(cfg.punishment.actionDedupMs || 10000));
  if (!acquireActionLock(guild.id, user.id, dedupMs)) {
    updateIncident(incident.id, { action: "deduplicated security action", metadata: { ...incident.metadata, deduplicated: true } });
    return { acted: false, deduplicated: true, actionText: "Already handled by another detector" };
  }

  const previous = successfulTimeoutsForUser(
    guild.id,
    user.id,
    cfg.punishment.strikeWindowHours,
    incident.id
  );
  const strike = previous.length + 1;
  const minutes = Math.max(requestedMinutes, timeoutForStrike(incident.category, strike));
  const actionText = formatMinutes(minutes);

  const timeoutResult = await applyTimeoutAtLeast(
    member,
    minutes,
    `Infinity Security ${incident.id}: ${incident.reason}`
  );
  const timeoutApplied = timeoutResult.ok;
  const effectiveActionText = timeoutResult.unchangedLongerTimeout
    ? `existing longer timeout kept (~${formatMinutes(Math.max(1, Math.ceil(timeoutResult.effectiveMs / 60000)))} remaining)`
    : actionText;

  if (!timeoutApplied) {
    releaseActionLock(guild.id, user.id);
    updateIncident(incident.id, {
      action: "timeout failed",
      metadata: { ...incident.metadata, strike, timeoutMinutes: minutes }
    });

    await sendLog(
      guild,
      cfg,
      "Timeout failed",
      `<@${user.id}> should have received **${actionText}**, but Discord rejected the timeout.\n` +
      `Check role order and **Moderate Members** permission.\nIncident: \`${incident.id}\``,
      "danger"
    );

    return { acted: false, actionText: "Timeout failed — role/permission issue" };
  }

  updateIncident(incident.id, {
    action: effectiveActionText,
    metadata: { ...incident.metadata, strike, timeoutMinutes: minutes, preservedLongerTimeout: Boolean(timeoutResult?.unchangedLongerTimeout) }
  });

  const offenderDm = await sendCaughtDm(member, incident, effectiveActionText, guild.name, cfg);
  const ownerDm = await sendOwnerTimeoutDm(guild, incident, effectiveActionText, {
    channelId: incident.metadata?.channelId || null
  });

  await sendLog(
    guild,
    cfg,
    "Timeout applied",
    `<@${user.id}> • **${incident.category.toUpperCase()}**\n` +
    `${incident.reason}\n**Action:** ${effectiveActionText}\n**Incident:** \`${incident.id}\``,
    "danger",
    [
      { name: "Owner DM", value: ownerDm ? "✅ Sent" : "⚪ Closed/failed", inline: true },
      { name: "User DM", value: offenderDm ? "✅ Sent" : "⚪ Closed/failed", inline: true }
    ]
  );

  return { acted: true, actionText: effectiveActionText, offenderDm, ownerDm };
}

async function lockdownGuild(guild, cfg) {
  if (cfg.lockdown.active) return 0;

  const snapshot = {};
  let changed = 0;

  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText) continue;

    const overwrite = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
    let prior = null;

    if (overwrite?.allow.has(PermissionsBitField.Flags.SendMessages)) prior = true;
    if (overwrite?.deny.has(PermissionsBitField.Flags.SendMessages)) prior = false;

    snapshot[channel.id] = prior;

    try {
      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { SendMessages: false }
      );
      changed++;
    } catch {}
  }

  cfg.lockdown.active = true;
  cfg.lockdown.snapshot = snapshot;
  commit();

  return changed;
}

async function unlockGuild(guild, cfg) {
  if (!cfg.lockdown.active) return 0;

  let changed = 0;
  const snapshot = cfg.lockdown.snapshot || {};

  for (const [channelId, prior] of Object.entries(snapshot)) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) continue;

    try {
      await channel.permissionOverwrites.edit(
        guild.roles.everyone,
        { SendMessages: prior }
      );
      changed++;
    } catch {}
  }

  cfg.lockdown.active = false;
  cfg.lockdown.snapshot = {};
  commit();

  return changed;
}

module.exports = {
  sendLog,
  sendOwnerTimeoutDm,
  sendOwnerMediationDm,
  enforceMessageIncident,
  punishExecutor,
  lockdownGuild,
  unlockGuild
};
