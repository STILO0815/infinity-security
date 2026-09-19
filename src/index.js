require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  AuditLogEvent,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const { getConfig, commit } = require("./config");
const { analyzeLocal } = require("./security/risk");
const { classify } = require("./security/aiGuard");
const { createIncident, getIncident, updateIncident, recentForGuild } = require("./security/incidents");
const { sendAuraCatch, randomAuraLine, auraStatusLine, auraEventLine, auraMeter } = require("./security/aura");
const { clipSummary, sendReactionClip } = require("./security/reactionClips");
const {
  sendLog,
  sendOwnerMediationDm,
  enforceMessageIncident,
  punishExecutor,
  lockdownGuild,
  unlockGuild
} = require("./security/actions");
const {
  scanGuildChannels,
  getChannelPolicy,
  isTrapChannel,
  detectBotInteraction,
  ensureBotLogs,
  setManualChannelPolicy,
  canPostPublicly
} = require("./security/channelSafety");
const {
  createMediationCase,
  getCase,
  findByChannel,
  findActivePair,
  updateCase,
  setVote,
  setResolutionVote,
  addTranscript,
  activeCasesForGuild,
  observeConflictMessage,
  getConflictReviewSnapshot
} = require("./security/mediation");
const {
  classifyConflict,
  mediationReply,
  finalAssessment,
  mergeMediatorState
} = require("./security/mediatorAI");
const { createAppeal, getAppeal, findByIncident: findAppealByIncident, updateAppeal, pendingForGuild } = require("./security/appeals");
const { snapshotMessage, getSnapshot, removeSnapshot, wasSecurityDelete, recordGhostPing } = require("./security/messageAudit");
const { analyzeMessageLinks } = require("./security/linkSafety");
const { accountRisk } = require("./security/accountRisk");
const { trackSelfVoiceChange, trackExecutorMove, trackExecutorModeration } = require("./security/voiceSecurity");
const {
  voiceLine, hasRoomControl, refreshRoomPanel, ensureVoiceHub, createTempRoom, scheduleEmptyDelete, cancelEmptyDelete,
  getRoom, isTempRoom, roomControls, toggleLock, toggleHide, setRoomLimit, renameRoom, permitUser, claimRoom,
  panicRoom, addCoOwner, transferOwnership, blockUser, requestKnock, resolveKnock, joinQueue, processRoomQueue,
  applyPreset, setAutoPrivate, maybeAutoPrivate, createTeamRooms, createMatchRooms, createParty, listParties,
  getVoiceLeaderboard, voiceXpFromMs, smartAfkSweep, trackVoiceSession, getVoiceStats, trackChannelJoin,
  applyVoiceRaidLock, recoverRaidLocks, cleanOrphanRooms, reconcileVoiceSessions, formatDuration
} = require("./security/voiceRooms");
const { calculateSecurityScore } = require("./security/securityScore");
const { ensureVerificationSetup, applyRestrictionsGuild, applyRestrictionToChannel, markNewMemberUnverified, buildChallengeModal, completeChallenge } = require("./security/verification");
const { dangerousAdded, dangerousPermissions, stripDangerous } = require("./security/permissionGuard");
const { createBackup, listBackups, getBackup, restoreBackup, verifyBackup } = require("./security/backups");
const { activateEmergency, deactivateEmergency } = require("./security/emergency");
const { reportForGuild, compactCounts } = require("./security/reports");
const { applyQuarantine, releaseQuarantine } = require("./security/quarantine");
const { recordThreatSignal, topThreatsForGuild } = require("./security/threatEngine");
const { auditGuildHealth, healthSignature } = require("./security/healthGuard");
const { applySecurityPreset } = require("./security/presets");
const { applyAutoSetupProfile } = require("./security/autoSetup");
const {
  openMain: openCursedRealms,
  handleGameButton: handleCursedRealmsButton,
  challengeDuel: challengeCursedDuel,
  handleDuelButton: handleCursedDuelButton
} = require("./games/cursedRealms");
const {
  handleBossCommand: handleServerBossCommand,
  handleBossButton: handleServerBossButton,
  recordBossMessage: recordServerBossMessage,
  tickAllBosses: tickAllServerBosses
} = require("./events/serverBoss");
const { buildReinviteUrl, assessSelfProtection, rememberSelfProtection, protectionSummary, notifyOwnerAfterRemoval } = require("./security/selfProtection");
const {
  isProtectedMember,
  cachedRecoveryInvite,
  createRecoveryInvite,
  ensureProtectedRecoveryInvites,
  sendProtectedKickDm,
  sendOwnerProtectedKickFallback
} = require("./security/protectedMembers");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID in .env");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

const spamTracker = new Map();
const raidTracker = new Map();
const destructiveTracker = new Map();
const conflictReviewQueue = new Map();
const friendlyWarningCooldown = new Map();
const healthCheckAt = new Map();

function isWhitelisted(guild, userId) {
  const cfg = getConfig(guild.id);
  if (userId === guild.ownerId || userId === client.user?.id || cfg.whitelist.includes(userId)) return true;
  const member = guild.members.cache.get(userId);
  return Boolean(member && cfg.trustedRoleIds?.some(roleId => member.roles.cache.has(roleId)));
}

function requireAdmin(interaction) {
  if (interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }

  interaction.reply({
    content: "❌ You need **Administrator** permission.",
    ephemeral: true
  }).catch(() => {});

  return false;
}

async function fetchExecutor(guild, type, targetId = null) {
  try {
    await new Promise(resolve => setTimeout(resolve, 850));
    const logs = await guild.fetchAuditLogs({ type, limit: 8 });
    const now = Date.now();

    const entry = logs.entries.find(item => {
      const targetOk = !targetId || item.target?.id === targetId;
      return targetOk && now - item.createdTimestamp < 15000;
    });

    return entry?.executor || null;
  } catch {
    return null;
  }
}


async function fetchMessageDeleteExecutor(guild, userId, channelId) {
  try {
    await new Promise(resolve => setTimeout(resolve, 650));
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 8 });
    const now = Date.now();
    const entry = logs.entries.find(item => {
      if (now - item.createdTimestamp > 6000) return false;
      if (item.target?.id !== userId) return false;
      const auditChannelId = item.extra?.channel?.id || item.extra?.channelId || item.extra?.channel_id || null;
      if (auditChannelId && auditChannelId !== channelId) return false;
      return true;
    });
    return entry?.executor || null;
  } catch {
    return null;
  }
}

async function fetchRecentWebhookExecutor(guild, channelId = null) {
  try {
    await new Promise(resolve => setTimeout(resolve, 800));
    const logs = await guild.fetchAuditLogs({ limit: 12 });
    const now = Date.now();
    const actions = new Set([AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookUpdate, AuditLogEvent.WebhookDelete]);
    const entry = logs.entries.find(item => {
      if (!actions.has(item.action)) return false;
      if (now - item.createdTimestamp > 10000) return false;
      const auditChannelId = item.extra?.channel?.id || item.extra?.channelId || item.extra?.channel_id || null;
      if (channelId && auditChannelId && auditChannelId !== channelId) return false;
      return true;
    });
    return entry ? { executor: entry.executor, action: entry.action, targetId: entry.target?.id || null } : null;
  } catch {
    return null;
  }
}

async function fetchVoiceAuditExecutor(guild, type, channelId = null) {
  try {
    await new Promise(resolve => setTimeout(resolve, 700));
    const logs = await guild.fetchAuditLogs({ type, limit: 6 });
    const now = Date.now();

    const entry = logs.entries.find(item => {
      if (now - item.createdTimestamp > 6000) return false;
      const auditChannelId = item.extra?.channel?.id || item.extra?.channelId || item.extra?.channel_id || null;
      if (channelId && auditChannelId && auditChannelId !== channelId) return false;
      return true;
    });

    return entry?.executor || null;
  } catch {
    return null;
  }
}

function destructiveBurst(guildId, userId, type, windowMs) {
  const key = `${guildId}:${userId}:${type}`;
  const now = Date.now();
  const recent = (destructiveTracker.get(key) || [])
    .filter(timestamp => now - timestamp < windowMs);

  recent.push(now);
  destructiveTracker.set(key, recent);
  return recent.length;
}

const AUDIT_THREAT_SIGNAL = new Map([
  [1, "guild_update"],
  [10, "channel_create"], [11, "channel_update"], [12, "channel_delete"],
  [13, "channel_overwrite"], [14, "channel_overwrite"], [15, "channel_overwrite"],
  [20, "member_kick"], [21, "member_prune"], [22, "member_ban"], [23, "member_unban"],
  [25, "member_role_update"], [26, "member_move"], [27, "member_disconnect"], [28, "bot_add"],
  [30, "role_create"], [31, "role_update"], [32, "role_delete"],
  [40, "invite"], [42, "invite"],
  [50, "webhook"], [51, "webhook"], [52, "webhook"],
  [73, "bulk_delete"],
  [80, "integration_update"], [81, "integration_update"], [82, "integration_update"],
  [121, "command_permissions"],
  [140, "automod_create"], [141, "automod_update"], [142, "automod_delete"]
]);

function auditSignalType(action) {
  return AUDIT_THREAT_SIGNAL.get(Number(action)) || null;
}

function auditActionLabel(action) {
  const type = auditSignalType(action);
  return type ? type.replaceAll("_", " ") : `audit action ${action}`;
}


function conflictReviewKey(guildId, channelId, userA, userB = null) {
  if (!userB) return `${guildId}:${channelId}:solo:${userA}`;
  const pair = [userA, userB].sort();
  return `${guildId}:${channelId}:pair:${pair[0]}:${pair[1]}`;
}

function cancelSoloConflictReviews(guildId, channelId, userIds = []) {
  for (const userId of userIds) {
    const key = conflictReviewKey(guildId, channelId, userId, null);
    const pending = conflictReviewQueue.get(key);
    if (pending?.timer) clearTimeout(pending.timer);
    conflictReviewQueue.delete(key);
  }
}


function friendlyWarningKey(guildId, channelId, userA, userB) {
  const pair = [userA, userB].sort();
  return `${guildId}:${channelId}:${pair[0]}:${pair[1]}`;
}

function friendlyWarningLine() {
  const lines = [
    "Six Eyes caught the vibe. I know you're joking — keep it friendly before I have to open the Domain.",
    "Easy. Infinity can tell this is banter, but don't turn the joke into a real fight.",
    "I saw that. No timeout — just don't make the trash-talk become an actual incident.",
    "Relax, cursed spirits. I know you're messing around. Keep the insults under control.",
    "You two are safe this time. Six Eyes says: joke around, don't escalate."
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

async function sendFriendlyBanterWarning(guild, channel, candidate, cfg) {
  if (!candidate?.userA || !candidate?.userB || !channel?.isTextBased()) return false;

  const key = friendlyWarningKey(guild.id, channel.id, candidate.userA, candidate.userB);
  const now = Date.now();
  const cooldown = Math.max(30000, Number(cfg.mediation.friendlyWarningCooldownMs || 120000));
  const last = friendlyWarningCooldown.get(key) || 0;
  if (now - last < cooldown) return false;
  friendlyWarningCooldown.set(key, now);

  if (!canPostPublicly(cfg, channel)) return false;

  const details = candidate.friendlyBanter?.reasons?.length
    ? `\n\n*Context:* ${candidate.friendlyBanter.reasons.slice(0, 2).join(" • ")}`
    : "";

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("✨ SIX EYES • AURA WARNING")
        .setDescription(
          `<@${candidate.userA}> <@${candidate.userB}>\n\n` +
          `**${friendlyWarningLine()}**\n\n` +
          `No punishment. No strike. Just a warning: keep the insults from going further.${details}`
        )
        .setColor(0x7dd3fc)
        .setFooter({ text: "Infinity Security • Aura Warning only" })
        .setTimestamp()
    ],
    allowedMentions: { users: [candidate.userA, candidate.userB] }
  }).catch(() => {});

  await sendLog(
    guild,
    cfg,
    "Friendly trash-talk warning",
    `<@${candidate.userA}> ↔ <@${candidate.userB}> were warned after context review.\n` +
    `**No timeout / no strike.** The conversation appeared playful and de-escalated.`,
    "info"
  ).catch(() => {});

  return true;
}

async function queueConflictReview(message, candidate, cfg) {
  const guildId = message.guild.id;
  const channelId = message.channel.id;

  if (candidate.userB) {
    cancelSoloConflictReviews(guildId, channelId, [candidate.userA, candidate.userB]);
  }

  const key = conflictReviewKey(guildId, channelId, candidate.userA, candidate.userB);
  const now = Date.now();
  const delay = Math.max(3000, Number(cfg.mediation.contextReviewMs || 10000));
  const maxWindow = Math.max(delay, Number(cfg.mediation.contextReviewMaxMs || 25000));
  const existing = conflictReviewQueue.get(key);

  if (existing) {
    existing.latestMessageId = message.id;
    existing.userA = candidate.userA || existing.userA;
    existing.userB = candidate.userB || existing.userB;
    existing.lastCandidateKind = candidate.kind;
    existing.strong = Boolean(existing.strong || candidate.strong);
    existing.lastUpdatedAt = now;

    // Debounce on new context, but never wait forever. This fixes the old behavior
    // where the timer was anchored to the very first insult and could classify too early.
    if (existing.timer) clearTimeout(existing.timer);
    const elapsed = now - existing.createdAt;
    const remainingBudget = Math.max(0, maxWindow - elapsed);
    const nextDelay = Math.min(delay, remainingBudget);
    existing.timer = setTimeout(() => {
      runConflictReview(key).catch(error => console.error("Conflict review failed:", error?.message || error));
    }, Math.max(50, nextDelay));
    existing.timer.unref?.();
    return;
  }

  const record = {
    key, guildId, channelId,
    userA: candidate.userA,
    userB: candidate.userB || null,
    latestMessageId: message.id,
    lastCandidateKind: candidate.kind,
    strong: Boolean(candidate.strong),
    createdAt: now,
    lastUpdatedAt: now,
    timer: null
  };

  record.timer = setTimeout(() => {
    runConflictReview(key).catch(error => console.error("Conflict review failed:", error?.message || error));
  }, delay);
  record.timer.unref?.();
  conflictReviewQueue.set(key, record);
}

async function runConflictReview(key) {
  const record = conflictReviewQueue.get(key);
  if (!record) return;
  conflictReviewQueue.delete(key);

  const guild = client.guilds.cache.get(record.guildId);
  const channel = guild?.channels.cache.get(record.channelId);
  if (!guild || !channel?.isTextBased()) return;

  const cfg = getConfig(guild.id);
  if (!cfg.enabled || !cfg.mediation.enabled || isTrapChannel(cfg, channel.id)) return;

  const candidate = getConflictReviewSnapshot({
    guildId: guild.id,
    channelId: channel.id,
    userA: record.userA,
    userB: record.userB,
    cfg
  });

  if (!candidate || candidate.kind === "none") return;

  if (candidate.userB) {
    const activePair = findActivePair(guild.id, candidate.userA, candidate.userB);
    if (activePair) return;
  }

  if (candidate.kind === "friendly_banter_candidate" && candidate.userB) {
    await sendFriendlyBanterWarning(guild, channel, candidate, cfg);
    return;
  }

  const conflictAi = await classifyConflict({
    apiKey: GEMINI_API_KEY,
    model: GEMINI_MODEL,
    guildName: guild.name,
    candidate
  });

  if (!conflictAi) return;

  if (
    conflictAi.classification === "mutual_conflict" &&
    conflictAi.confidence >= 0.82 &&
    candidate.userB
  ) {
    await startMediationInvite(
      { guild, channel },
      candidate,
      conflictAi,
      cfg
    );
    return;
  }

  if (
    conflictAi.classification === "unilateral_attack" &&
    conflictAi.confidence >= 0.92
  ) {
    const offenderId = candidate.aggressorId || candidate.userA;
    const offender = await client.users.fetch(offenderId).catch(() => null);
    if (!offender) return;

    const incident = createIncident({
      guildId: guild.id,
      userId: offenderId,
      category: "harassment",
      severity: "high",
      reason: conflictAi.reason || "Targeted insult after context review",
      confidence: conflictAi.confidence,
      action: cfg.mode === "enforce" ? "pending timeout" : "logged",
      metadata: {
        channelId: channel.id,
        targetUserId: candidate.userB || null,
        contentPreview: candidate.contentPreview || "",
        contextBufferedMs: Number(cfg.mediation.contextReviewMs || 10000),
        evidence: candidate.evidence || []
      }
    });

    if (cfg.mode === "enforce") {
      const result = await punishExecutor(guild, offender, incident, cfg, 5);

      if (result.acted && candidate.lastHostileMessageId) {
        const offendingMessage = await channel.messages.fetch(candidate.lastHostileMessageId).catch(() => null);
        if (offendingMessage) await offendingMessage.delete().catch(() => {});
      }

      if (result.acted && canPostPublicly(cfg, channel)) {
        await sendAuraCatch(channel, offenderId, incident, cfg);
      }
    } else {
      await sendLog(
        guild,
        cfg,
        "Targeted insult • context reviewed",
        `<@${offenderId}>${candidate.userB ? ` → <@${candidate.userB}>` : ""}\n` +
        `${incident.reason}\nInfinity waited **${Math.round(Number(cfg.mediation.contextReviewMs || 10000) / 1000)}s** for context before classifying this.\n` +
        `Incident: \`${incident.id}\``,
        "warn"
      );
    }
  }
}

async function autoSetupGuild(guild, announce = false) {
  const cfg = getConfig(guild.id);

  if (!cfg.whitelist.includes(guild.ownerId)) {
    cfg.whitelist.push(guild.ownerId);
  }

  const logChannel = await ensureBotLogs(guild, cfg, client.user?.id);
  const scan = await scanGuildChannels(guild, cfg);
  const voiceHub = cfg.voiceDomain.enabled && cfg.voiceDomain.autoCreateHub
    ? await ensureVoiceHub(guild, cfg, client.user?.id)
    : null;
  let verification = null;
  if (cfg.verification.enabled) {
    verification = await ensureVerificationSetup(guild, cfg, client.user?.id);
    await applyRestrictionsGuild(guild, cfg);
  }
  await recoverRaidLocks(guild).catch(() => {});
  await cleanOrphanRooms(guild, cfg).catch(() => {});
  await reconcileVoiceSessions(guild).catch(() => {});
  const protectedInvites = await ensureProtectedRecoveryInvites(guild, cfg).catch(() => []);
  commit();

  if (announce && logChannel) {
    await sendLog(
      guild,
      cfg,
      "Auto-Setup complete",
      `Six Eyes scanned **${scan.total}** channels.\n` +
      `🤖 Bot/minigame channels: **${scan.botInteraction}**\n` +
      `🍯 Honeypot/trap suspects: **${scan.traps}**\n` +
      `🤝 AI Mediation: **${cfg.mediation.enabled ? "ON" : "OFF"}**\n` +
      `🎙️ Voice Domain hub: **${voiceHub ? "READY" : "OFF"}**\n` +
      `✅ Verification: **${cfg.verification.enabled ? (verification?.channel ? "READY" : "NEEDS PERMISSIONS") : "OFF"}**\n` +
      `🛡️ Protected members: **${cfg.protectedMembers?.userIds?.length || 0}** • recovery invite **${protectedInvites.some(item => item.url) ? "READY" : "NEEDS CREATE INVITE"}**\n` +
      `📜 Private logs: ${logChannel}`,
      scan.traps > 0 ? "warn" : "info"
    );
  }

  return { logChannel, scan };
}


async function runInstantAutoSetup(guild, options = {}) {
  const cfg = getConfig(guild.id);
  const profile = applyAutoSetupProfile(cfg, options);

  if (!cfg.whitelist.includes(guild.ownerId)) {
    cfg.whitelist.push(guild.ownerId);
  }

  // Build/repair all Infinity-owned infrastructure in one pass.
  const setup = await autoSetupGuild(guild, false);

  let verification = null;
  if (cfg.verification.enabled) {
    verification = await ensureVerificationSetup(guild, cfg, client.user?.id);
    await applyRestrictionsGuild(guild, cfg);
  }

  // Prepare recovery before switching the owner to normal daily use.
  let backup = null;
  if (cfg.backups.enabled) {
    backup = await createBackup(guild, cfg.backups.maxBackups).catch(() => null);
    if (backup) cfg.backups.lastBackupAt = Date.now();
  }

  const selfGuard = cfg.selfProtection.enabled
    ? await assessSelfProtection(guild, { fetchMembers: true }).catch(() => null)
    : null;
  if (selfGuard) rememberSelfProtection(cfg, guild, selfGuard);

  const health = await auditGuildHealth(guild, cfg).catch(() => ({
    healthy: false,
    critical: true,
    issues: [{ code: 'HEALTH_CHECK_FAILED', severity: 'critical', text: 'Health check could not run.' }],
    ok: []
  }));

  const score = await calculateSecurityScore(guild, cfg, client, {
    aiConfigured: Boolean(GEMINI_API_KEY)
  }).catch(() => ({ score: 0, checks: [] }));

  commit();

  if (setup.logChannel) {
    await sendLog(
      guild,
      cfg,
      'INSTANT AUTO-SETUP COMPLETE',
      `Preset: **${profile.preset.toUpperCase()}** • Mode: **${profile.mode.toUpperCase()}**\n` +
      `Scanned **${setup.scan?.total || 0}** channels • Security score **${score.score}/100**\n` +
      `Verification: **${cfg.verification.enabled ? 'ON' : 'OFF'}** • Backup: **${backup ? backup.id : 'FAILED'}**\n` +
      `Self-Guard: **${selfGuard ? protectionSummary(selfGuard) : 'UNKNOWN'}**`,
      health.critical ? 'warn' : 'info'
    );
  }

  return { cfg, profile, setup, verification, backup, selfGuard, health, score };
}

function consentButtons(caseId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`med_yes_${caseId}`)
        .setLabel("Yes • Mediate")
        .setEmoji("🤝")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`med_no_${caseId}`)
        .setLabel("No • Owner Review")
        .setEmoji("⏱️")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    )
  ];
}

function resolveButtons(caseId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`med_resolve_${caseId}`)
        .setLabel("Resolved")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`med_owner_${caseId}`)
        .setLabel("Need Owner")
        .setEmoji("🛡️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    )
  ];
}

async function createPrivateMediationChannel(guild, caseData, cfg) {
  const userA = await guild.members.fetch(caseData.users[0]).catch(() => null);
  const userB = await guild.members.fetch(caseData.users[1]).catch(() => null);

  if (!userA || !userB) return null;

  const channel = await guild.channels.create({
    name: `mediation-${caseData.id.toLowerCase()}`,
    type: ChannelType.GuildText,
    topic: `Infinity Security private mediation ${caseData.id}`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: userA.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks
        ]
      },
      {
        id: userB.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks
        ]
      },
      {
        id: client.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageMessages,
          PermissionsBitField.Flags.EmbedLinks,
          PermissionsBitField.Flags.AttachFiles
        ]
      }
    ]
  }).catch(() => null);

  if (!channel) return null;

  setManualChannelPolicy(
    cfg,
    channel.id,
    "mediation",
    `Private mediation ${caseData.id}`
  );

  updateCase(caseData.id, {
    status: "active",
    channelId: channel.id
  });

  await channel.send({
    content: `<@${caseData.users[0]}> <@${caseData.users[1]}>`,
    embeds: [
      new EmbedBuilder()
        .setTitle("🤝 Infinity Mediation")
        .setDescription(
          `Both of you chose **Yes**.\n\n` +
          `Explain your side calmly. Infinity will respond after **every message**, keep things short, and ask for proof when a factual claim needs it.\n\n` +
          `📎 Screenshots, links, timestamps or transaction proof help.\n` +
          `👁️ Infinity will **not declare a winner**. It looks for facts, misunderstandings and clear rule violations.\n\n` +
          `Case: \`${caseData.id}\``
        )
        .setColor(0x7dd3fc)
        .setFooter({ text: "Stay factual. Six Eyes are listening." })
    ],
    allowedMentions: { users: caseData.users }
  }).catch(() => {});

  await sendLog(
    guild,
    cfg,
    "Mediation opened",
    `<@${caseData.users[0]}> and <@${caseData.users[1]}> both accepted mediation.\n` +
    `Private channel: ${channel}\nCase: \`${caseData.id}\``
  );

  await sendOwnerMediationDm(
    guild,
    caseData,
    "Mediation started",
    `Both users accepted AI mediation. Infinity will keep the private chat limited to the two participants and the bot, then send you a summary when it ends.`
  );

  return channel;
}

async function startMediationInvite(message, candidate, aiDecision, cfg) {
  const existing = findActivePair(
    message.guild.id,
    candidate.userA,
    candidate.userB
  );
  if (existing) return existing;

  const caseData = createMediationCase({
    guildId: message.guild.id,
    originChannelId: message.channel.id,
    userA: candidate.userA,
    userB: candidate.userB,
    reason: aiDecision?.reason || "Mutual conflict detected",
    evidence: candidate.evidence || []
  });

  const hasScamClaim = (candidate.evidence || []).some(item =>
    /\b(scam|scammer|scammed|gescammt|gescammed|betrueger|betrüger)\b/i.test(item.content || "")
  );

  const disputeContext = hasScamClaim
    ? "Ihr beleidigt euch inzwischen gegenseitig und es gibt zusätzlich einen Scam-Vorwurf."
    : "Ihr seid inzwischen beide aktiv im Streit und beleidigt euch gegenseitig.";

  const embed = new EmbedBuilder()
    .setTitle("👁️ Hold up. Six Eyes detected some serious beef.")
    .setDescription(
      `<@${caseData.users[0]}> ↔ <@${caseData.users[1]}>\n\n` +
      `${disputeContext}\n\n` +
      `**Soll Infinity helfen, das zu klären?**\n` +
      `Beide müssen **Yes** oder **No** wählen.\n\n` +
      `🤝 **Yes:** privater Chat für euch beide + Infinity.\n` +
      `⏱️ **No:** der User, der No drückt, bekommt einen **24h Owner-Review-Timeout** und der Owner wird informiert.\n\n` +
      `Case: \`${caseData.id}\``
    )
    .setColor(0x7dd3fc)
    .setFooter({ text: "No winner. Facts, evidence, resolution." });

  let sent = null;

  if (canPostPublicly(cfg, message.channel)) {
    sent = await message.channel.send({
      embeds: [embed],
      components: consentButtons(caseData.id),
      allowedMentions: { users: caseData.users }
    }).catch(() => null);

    if (sent) {
      updateCase(caseData.id, { invitationMessageId: sent.id });
    }
  } else {
    for (const userId of caseData.users) {
      const user = await client.users.fetch(userId).catch(() => null);
      if (!user) continue;
      await user.send({
        embeds: [embed],
        components: consentButtons(caseData.id)
      }).catch(() => {});
    }
  }

  await sendLog(
    message.guild,
    cfg,
    "Mutual dispute detected",
    `<@${caseData.users[0]}> ↔ <@${caseData.users[1]}>\n` +
    `${caseData.reason}\nCase: \`${caseData.id}\``,
    "warn"
  );

  await sendOwnerMediationDm(
    message.guild,
    caseData,
    "Dispute detected",
    `Infinity detected a likely two-person dispute and asked both users whether they want AI mediation.`
  );

  return caseData;
}

async function timeoutMediationRefusal(guild, caseData, userId, cfg) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return false;

  const incident = createIncident({
    guildId: guild.id,
    userId,
    category: "mediation_refused",
    severity: "high",
    reason: `User declined mediation in ${caseData.id}; escalated for owner review`,
    action: "pending timeout",
    metadata: {
      mediationId: caseData.id,
      channelId: caseData.originChannelId
    }
  });

  const result = await punishExecutor(
    guild,
    user,
    incident,
    cfg,
    cfg.mediation.inviteNoTimeoutMinutes
  );

  updateCase(caseData.id, {
    status: "owner_review",
    refusedBy: userId
  });

  await sendLog(
    guild,
    cfg,
    "Mediation refused",
    `<@${userId}> chose **No** on case \`${caseData.id}\`.\n` +
    `${result.acted ? "Owner Review timeout applied." : "Timeout could not be applied."}`,
    "warn"
  );

  await sendOwnerMediationDm(
    guild,
    caseData,
    "Mediation requires owner review",
    `<@${userId}> declined mediation. ${result.acted ? "A 24-hour Owner Review timeout was applied." : "Infinity could not apply the timeout; check permissions."}`
  );

  return result.acted;
}

async function ownerEscalateMediation(guild, caseData, requestedBy) {
  updateCase(caseData.id, {
    status: "owner_review",
    ownerReviewRequestedBy: requestedBy
  });

  await sendOwnerMediationDm(
    guild,
    caseData,
    "Owner help requested",
    `<@${requestedBy}> asked for owner review from inside the mediation channel. No extra punishment was applied automatically.`
  );

  const cfg = getConfig(guild.id);
  await sendLog(
    guild,
    cfg,
    "Mediation escalated",
    `<@${requestedBy}> requested owner help.\nCase: \`${caseData.id}\``,
    "warn"
  );
}

function participantMessageCounts(caseData) {
  const counts = Object.fromEntries(caseData.users.map(id => [id, 0]));
  for (const item of caseData.transcript) {
    if (counts[item.userId] !== undefined) counts[item.userId]++;
  }
  return counts;
}

function extractDiscordMessageLinks(content = "") {
  const links = [];
  const regex = /https?:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/gi;
  let match;
  while ((match = regex.exec(String(content)))) {
    links.push({ guildId: match[1], channelId: match[2], messageId: match[3], url: match[0] });
  }
  return links;
}

async function resolveVerifiedDiscordEvidence(message, cfg) {
  if (!cfg.mediation.verifiedMessageLinks) return [];
  const maxLinks = Math.max(1, Math.min(8, Number(cfg.mediation.maxVerifiedLinksPerMessage || 4)));
  const unique = [];
  const seen = new Set();

  for (const link of extractDiscordMessageLinks(message.content).slice(0, maxLinks * 2)) {
    const key = `${link.guildId}:${link.channelId}:${link.messageId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(link);
    if (unique.length >= maxLinks) break;
  }

  const verified = [];
  for (const link of unique) {
    if (link.guildId !== message.guild.id) continue;

    const channel = message.guild.channels.cache.get(link.channelId)
      || await message.guild.channels.fetch(link.channelId).catch(() => null);
    if (!channel?.isTextBased() || !channel.messages) continue;

    const original = await channel.messages.fetch(link.messageId).catch(() => null);
    if (!original) continue;

    verified.push({
      type: "verified_discord_message",
      sourceRef: `discord:${link.guildId}/${link.channelId}/${link.messageId}`,
      channelId: link.channelId,
      messageId: link.messageId,
      authorId: original.author?.id || null,
      authorTag: original.author?.tag || original.author?.username || "unknown",
      content: String(original.content || "").slice(0, 1600),
      createdTimestamp: original.createdTimestamp || null,
      editedTimestamp: original.editedTimestamp || null,
      attachments: [...original.attachments.values()].slice(0, 5).map(a => ({
        name: a.name, contentType: a.contentType || null, size: a.size
      }))
    });
  }

  return verified;
}

function mediationEvidenceStats(caseData) {
  const state = caseData.mediatorState || {};
  const findings = state.evidenceFindings || [];
  return {
    total: findings.length,
    verifiedDiscord: findings.filter(x => x.reliability === "verified_discord").length,
    screenshots: findings.filter(x => x.reliability === "screenshot").length,
    unsupportedClaims: (state.claims || []).filter(x => x.status === "unsupported").length,
    contradictions: (state.contradictions || []).length,
    openQuestions: (state.openQuestions || []).length
  };
}

async function handleMediationMessage(message, caseData, cfg) {
  if (!caseData.users.includes(message.author.id)) return true;

  const attachments = [...message.attachments.values()].map(a => ({
    name: a.name,
    contentType: a.contentType || null,
    size: a.size,
    url: a.url
  }));

  const verifiedEvidence = await resolveVerifiedDiscordEvidence(message, cfg);

  addTranscript(caseData.id, {
    userId: message.author.id,
    content: (message.content || "").slice(0, 2000),
    attachments,
    verifiedEvidence
  });

  const freshCase = getCase(caseData.id);

  const reply = await mediationReply({
    apiKey: GEMINI_API_KEY,
    model: GEMINI_MODEL,
    caseData: freshCase,
    message
  });

  if (!reply) {
    await message.channel.send({
      content: "👁️ My mediator hit a temporary AI error. Keep the explanation short; I’ll keep the case open and won’t guess.",
      allowedMentions: { parse: [] }
    }).catch(() => {});
    return true;
  }

  const mediatorState = mergeMediatorState(
    freshCase.mediatorState,
    reply,
    freshCase.users
  );

  updateCase(freshCase.id, {
    mediatorState,
    mediatorSummary: reply.summary,
    lastMediatorTurnAt: Date.now()
  });

  const extras = [];
  if (verifiedEvidence.length) {
    extras.push(`✅ Verified **${verifiedEvidence.length} Discord message link${verifiedEvidence.length === 1 ? "" : "s"}** from the original server messages.`);
  }
  if (reply.needsEvidence && reply.evidenceRequest) {
    extras.push(`📎 **Next evidence:** ${reply.evidenceRequest}`);
  }

  await message.channel.send({
    content: `👁️ ${reply.reply}${extras.length ? `\n\n${extras.join("\n")}` : ""}`,
    allowedMentions: { parse: [] }
  }).catch(() => {});

  const current = getCase(caseData.id);
  const counts = participantMessageCounts(current);
  const enoughFromBoth = current.users.every(
    id => counts[id] >= cfg.mediation.minimumMessagesPerSide
  );

  const state = current.mediatorState || {};
  const criticalUnsupported = (state.claims || []).some(
    claim => Number(claim.importance || 1) >= 3 && claim.status === "unsupported"
  );
  const tooManyOpenQuestions = (state.openQuestions || []).length > Number(cfg.mediation.maxOpenQuestionsForResolve || 1);

  if (
    reply.readyToResolve &&
    enoughFromBoth &&
    !criticalUnsupported &&
    !tooManyOpenQuestions &&
    !current.readyPromptSent
  ) {
    updateCase(current.id, {
      status: "ready_to_resolve",
      readyPromptSent: true,
      mediatorSummary: reply.summary,
      mediatorState: { ...state, phase: "ready" }
    });

    const stats = mediationEvidenceStats(getCase(current.id));

    await message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🤝 Evidence review complete")
          .setDescription(
            `I’ve heard both sides and separated the main claims from the evidence.\n\n` +
            `**Verified Discord evidence:** ${stats.verifiedDiscord}\n` +
            `**Evidence findings:** ${stats.total}\n` +
            `**Open contradictions:** ${stats.contradictions}\n` +
            `**Open questions:** ${stats.openQuestions}\n\n` +
            `Both of you can press **Resolved**. If either of you wants a human decision, press **Need Owner**.\n\n` +
            `*Infinity still has not chosen a winner.*`
          )
          .setColor(0x7dd3fc)
      ],
      components: resolveButtons(current.id)
    }).catch(() => {});
  }

  return true;
}

async function finalizeMediation(guild, caseData, cfg) {
  const final = await finalAssessment({
    apiKey: GEMINI_API_KEY,
    model: GEMINI_MODEL,
    caseData
  });

  let timeoutText = "No automatic timeout";
  let timeoutApplied = false;

  const juryThreshold = Number(cfg.mediation.finalJuryMinConfidence || 0.92);
  if (
    final.violationUserId &&
    final.confidence >= juryThreshold &&
    !final.strongDissent &&
    cfg.mode === "enforce"
  ) {
    const user = await client.users.fetch(final.violationUserId).catch(() => null);

    if (user) {
      const category = final.violationType || "harassment";
      const incident = createIncident({
        guildId: guild.id,
        userId: final.violationUserId,
        category,
        severity: "high",
        reason: `AI mediation jury found a clear conduct violation in ${caseData.id}: ${final.reason}`,
        confidence: final.confidence,
        action: "pending timeout",
        metadata: {
          mediationId: caseData.id,
          channelId: caseData.channelId,
          juryConsensus: final.consensus,
          juryReviews: final.reviews?.map(r => ({
            role: r.role,
            violationUserId: r.violationUserId,
            violationType: r.violationType,
            confidence: r.confidence
          })) || []
        }
      });

      const result = await punishExecutor(
        guild,
        user,
        incident,
        cfg,
        cfg.mediation.resolutionTimeoutMinutes
      );

      timeoutApplied = result.acted;
      timeoutText = result.acted
        ? result.actionText
        : "Timeout recommended but could not be applied";
    }
  }

  updateCase(caseData.id, {
    status: "closed",
    closedAt: Date.now(),
    finalSummary: final.summary,
    finalViolationUserId: final.violationUserId,
    finalViolationType: final.violationType || null,
    finalConfidence: final.confidence,
    finalJuryConsensus: final.consensus,
    finalJuryReviews: final.reviews || [],
    finalMissingEvidence: final.missingEvidence || [],
    finalTimeoutApplied: timeoutApplied
  });

  const closedCase = getCase(caseData.id);
  const evidenceStats = mediationEvidenceStats(closedCase);
  const channel = guild.channels.cache.get(caseData.channelId);

  if (channel?.isTextBased()) {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("✅ Infinity Mediation Jury • Case closed")
          .setDescription(
            `${final.summary}\n\n` +
            `**Jury consensus:** ${final.consensus || "0/3"}\n` +
            `**Verified Discord evidence:** ${evidenceStats.verifiedDiscord}\n` +
            `**Conduct action:** ${timeoutText}\n\n` +
            `${final.missingEvidence?.length ? `**Still unresolved:** ${final.missingEvidence.slice(0, 3).join(" • ")}\n\n` : ""}` +
            `Infinity did **not** choose who "won" the argument. Any automatic timeout requires evidence of a conduct-rule violation plus the independent AI jury threshold.\n` +
            `Case: \`${caseData.id}\``
          )
          .setColor(timeoutApplied ? 0xffa500 : 0x57f287)
      ],
      components: resolveButtons(caseData.id, true)
    }).catch(() => {});

    for (const userId of caseData.users) {
      await channel.permissionOverwrites.edit(userId, {
        SendMessages: false
      }).catch(() => {});
    }
  }

  await sendOwnerMediationDm(
    guild,
    closedCase,
    "AI Jury mediation closed",
    final.summary,
    [
      { name: "Jury consensus", value: final.consensus || "0/3", inline: true },
      { name: "AI confidence", value: `${Math.round(final.confidence * 100)}%`, inline: true },
      { name: "Verified Discord evidence", value: String(evidenceStats.verifiedDiscord), inline: true },
      { name: "Contradictions tracked", value: String(evidenceStats.contradictions), inline: true },
      { name: "Automatic conduct action", value: timeoutText, inline: false },
      {
        name: "Unresolved evidence",
        value: final.missingEvidence?.length ? final.missingEvidence.slice(0, 5).join("\n").slice(0, 1000) : "None flagged by the jury",
        inline: false
      }
    ]
  );

  await sendLog(
    guild,
    cfg,
    "AI Jury mediation closed",
    `${final.summary}\n**Jury:** ${final.consensus || "0/3"}\n**Action:** ${timeoutText}\nCase: \`${caseData.id}\``,
    timeoutApplied ? "warn" : "info"
  );
}


function requireOwner(interaction, guild) {
  if (interaction.user?.id === guild.ownerId) return true;

  interaction.reply({
    content: "👑 This action is reserved for the **server owner**.",
    ephemeral: true
  }).catch(() => {});
  return false;
}

async function sendOwnerSelfGuardAlert(guild, title, description, self = null) {
  const owner = await guild.fetchOwner().catch(() => null);
  if (!owner) return false;
  const exposed = self?.dangerousRoles?.length
    ? self.dangerousRoles.slice(0,8).map(r => `<@&${r.id}>`).join(", ")
    : "None detected";
  const embed = new EmbedBuilder()
    .setTitle(`🛡️ Infinity Self-Guard • ${title}`)
    .setDescription(
      `${description}\n\n` +
      `**Removal exposure:** ${self ? protectionSummary(self) : "UNKNOWN"}\n` +
      `**Higher risky roles:** ${exposed}\n\n` +
      `The server owner always retains Discord-level authority over installed apps.`
    )
    .setColor(self?.protectedFromStaff ? 0x57f287 : 0xffa500)
    .setFooter({ text:"Six Eyes watches its own barrier too." })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel("Recovery Invite").setEmoji("🔗").setStyle(ButtonStyle.Link).setURL(buildReinviteUrl(CLIENT_ID))
  );
  return owner.send({ embeds:[embed], components:[row] }).then(() => true).catch(() => false);
}

function appealReviewButtons(appealId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`appeal_approve_${appealId}`)
        .setLabel("Approve • Remove Timeout")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`appeal_deny_${appealId}`)
        .setLabel("Deny • Close Appeal")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    )
  ];
}

function incidentReviewButtons(incidentId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`review_untimeout_${incidentId}`)
        .setLabel("Remove Timeout")
        .setEmoji("⏱️")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`review_close_${incidentId}`)
        .setLabel("Close Review")
        .setEmoji("📁")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    )
  ];
}

function previewText(value, max = 650) {
  const text = String(value || "").replace(/`/g, "ˋ").trim();
  return text ? text.slice(0, max) : "(no text available)";
}

function incidentEvidenceFields(incident) {
  const fields = [];
  if (typeof incident.confidence === "number") {
    fields.push({
      name: "AI confidence",
      value: `${Math.round(incident.confidence * 100)}%`,
      inline: true
    });
  }

  const metadata = incident.metadata || {};
  if (metadata.channelId) {
    fields.push({ name: "Channel", value: `<#${metadata.channelId}>`, inline: true });
  }
  if (metadata.contentPreview) {
    fields.push({ name: "Message / evidence", value: previewText(metadata.contentPreview, 900) });
  }
  if (Array.isArray(metadata.linkReasons) && metadata.linkReasons.length) {
    fields.push({ name: "Link scanner", value: metadata.linkReasons.slice(0, 6).join("\n").slice(0, 900) });
  }
  if (metadata.mediationId) {
    fields.push({ name: "Mediation", value: `\`${metadata.mediationId}\``, inline: true });
  }
  return fields.slice(0, 8);
}

function incidentReviewEmbed(incident) {
  return new EmbedBuilder()
    .setTitle(`👁️ Incident Review • ${incident.id}`)
    .setDescription(
      `**User:** ${incident.userId ? `<@${incident.userId}>` : "N/A"}\n` +
      `**Category:** ${incident.category}\n` +
      `**Severity:** ${incident.severity}\n` +
      `**Action:** ${incident.action}\n\n` +
      `**Reason:** ${incident.reason}`
    )
    .addFields(incidentEvidenceFields(incident))
    .setColor(0x7dd3fc)
    .setTimestamp(incident.createdAt || Date.now())
    .setFooter({ text: "Infinity Security • Owner Review" });
}

async function sendOwnerAppealDm(guild, appeal, incident) {
  const owner = await guild.fetchOwner().catch(() => null);
  if (!owner) return false;

  const embed = new EmbedBuilder()
    .setTitle("👁️ SIX EYES • APPEAL RECEIVED")
    .setDescription(
      `**The record has been challenged. Six Eyes is reviewing the evidence.**\n\n` + `<@${appeal.userId}> appealed a timeout.\n\n` +
      `**Appeal:** \`${appeal.id}\`\n` +
      `**Incident:** \`${appeal.incidentId}\`\n` +
      `**Original reason:** ${incident?.reason || "Unknown"}\n\n` +
      `**User's appeal:**\n${previewText(appeal.reason, 1000)}`
    )
    .addFields(incident ? incidentEvidenceFields(incident) : [])
    .setColor(0x7dd3fc)
    .setFooter({ text: "Owner Review Domain • Evidence decides the outcome" })
    .setTimestamp();

  return owner.send({
    embeds: [embed],
    components: appealReviewButtons(appeal.id)
  }).then(() => true).catch(() => false);
}

async function resolveAppeal(guild, appeal, approve, reviewerId) {
  const cfg = getConfig(guild.id);
  const incident = getIncident(appeal.incidentId);
  const member = await guild.members.fetch(appeal.userId).catch(() => null);

  let timeoutRemoved = false;
  if (approve && member) {
    timeoutRemoved = await member.timeout(
      null,
      `Infinity Security appeal ${appeal.id} approved by server owner`
    ).then(() => true).catch(() => false);
  }

  updateAppeal(appeal.id, {
    status: approve ? "approved" : "denied",
    reviewedBy: reviewerId,
    reviewNote: approve
      ? (timeoutRemoved ? "Timeout removed" : "Approved; timeout was already gone or could not be changed")
      : "Appeal denied"
  });

  if (incident) {
    updateIncident(incident.id, {
      action: approve
        ? (timeoutRemoved ? "timeout removed after appeal" : "appeal approved")
        : incident.action,
      metadata: {
        ...(incident.metadata || {}),
        appealId: appeal.id,
        appealStatus: approve ? "approved" : "denied",
        appealReviewedBy: reviewerId
      }
    });
  }

  const user = await client.users.fetch(appeal.userId).catch(() => null);
  if (user) {
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(approve ? "👁️ SIX EYES • APPEAL APPROVED" : "🌀 SIX EYES • APPEAL DENIED")
          .setDescription(
            approve
              ? `**${auraEventLine("appeal_approved", cfg)}**\n\nYour appeal \`${appeal.id}\` was approved.${timeoutRemoved ? " Your timeout was removed." : " The owner approved it, but no active timeout could be removed."}`
              : `**${auraEventLine("appeal_denied", cfg)}**\n\nYour appeal \`${appeal.id}\` was denied by the server owner.`
          )
          .setColor(approve ? 0x57f287 : 0xed4245)
          .setTimestamp()
      ]
    }).catch(() => {});
  }

  await sendLog(
    guild,
    cfg,
    approve ? "Appeal approved" : "Appeal denied",
    `<@${appeal.userId}> • Appeal \`${appeal.id}\` • Incident \`${appeal.incidentId}\`\n` +
    (approve ? `Timeout removed: **${timeoutRemoved ? "YES" : "NO / already expired"}**` : "Case closed by owner."),
    approve ? "info" : "warn"
  );

  return { timeoutRemoved };
}

async function removeTimeoutFromIncident(guild, incident, ownerId) {
  if (!incident?.userId) return false;
  const member = await guild.members.fetch(incident.userId).catch(() => null);
  if (!member) return false;

  const ok = await member.timeout(
    null,
    `Infinity Security owner review ${incident.id}`
  ).then(() => true).catch(() => false);

  if (ok) {
    updateIncident(incident.id, {
      action: "timeout removed by owner",
      metadata: {
        ...(incident.metadata || {}),
        reviewClosed: true,
        timeoutRemovedBy: ownerId
      }
    });
  }
  return ok;
}

const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Run Infinity Security auto-setup and scan every channel."),

  new SlashCommandBuilder()
    .setName("auto-setup")
    .setDescription("Instantly configure and repair the complete Infinity Security system.")
    .addStringOption(option =>
      option
        .setName("preset")
        .setDescription("Security strength (default: Balanced)")
        .setRequired(false)
        .addChoices(
          { name: "Balanced • Recommended", value: "balanced" },
          { name: "Strict • Stronger", value: "strict" },
          { name: "Maximum • Domain Lock", value: "maximum" },
          { name: "Relaxed • Lower sensitivity", value: "relaxed" }
        )
    )
    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("Alert is safer for first setup; Enforce enables automatic timeouts")
        .setRequired(false)
        .addChoices(
          { name: "Alert • Recommended first", value: "alert" },
          { name: "Enforce • Automatic timeout protection", value: "enforce" }
        )
    )
    .addBooleanOption(option =>
      option
        .setName("verification")
        .setDescription("Enable the human verification gate too")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("rescan")
    .setDescription("Rescan channels for bot/minigame and honeypot/trap behavior."),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show security status."),

  new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Open the Infinity Security control panel."),

  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Change security mode.")
    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("Alert or Enforce")
        .setRequired(true)
        .addChoices(
          { name: "Alert", value: "alert" },
          { name: "Enforce", value: "enforce" }
        )
    ),

  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("Configure AI Guard.")
    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("AI scanning mode")
        .setRequired(true)
        .addChoices(
          { name: "Smart (recommended)", value: "smart" },
          { name: "All normal messages", value: "all" },
          { name: "Off", value: "off" }
        )
    ),

  new SlashCommandBuilder()
    .setName("aura")
    .setDescription("Configure Infinity Security personality.")
    .addBooleanOption(option =>
      option.setName("clips").setDescription("Random Gojo/JJK reaction clips")
    )
    .addBooleanOption(option =>
      option.setName("public_replies").setDescription("Public catch messages in safe channels")
    )
    .addBooleanOption(option =>
      option.setName("offender_dms").setDescription("DM users when they are timed out")
    )
    .addStringOption(option =>
      option.setName("intensity").setDescription("How much Six Eyes aura Infinity uses").addChoices(
        { name: "Subtle", value: "subtle" },
        { name: "Balanced", value: "balanced" },
        { name: "Overdrive", value: "overdrive" }
      )
    ),

  new SlashCommandBuilder()
    .setName("edit")
    .setDescription("Manage Infinity's MP4 reaction edits with sound.")
    .addSubcommand(sub => sub.setName("list").setDescription("Show all reaction edits and their sorting."))
    .addSubcommand(sub => sub.setName("test").setDescription("Post one edit in this channel with sound.")
      .addStringOption(option => option.setName("clip").setDescription("Edit to test").setRequired(true).addChoices(
        { name: "🚓 Raid Convoy", value: "raid_convoy" },
        { name: "💠 Limitless Burst", value: "limitless_burst" },
        { name: "👁️ Six Eyes Calm", value: "six_eyes_calm" },
        { name: "💜 Purple Finish", value: "purple_finish" }
      )))
    .addSubcommand(sub => sub.setName("frequency").setDescription("How often automatic edits should appear.")
      .addIntegerOption(option => option.setName("percent").setDescription("0-95%").setRequired(true).setMinValue(0).setMaxValue(95)))
    .addSubcommand(sub => sub.setName("autoplay").setDescription("Enable or disable automatic reaction edits.")
      .addBooleanOption(option => option.setName("enabled").setDescription("On/off").setRequired(true)))
    .addSubcommand(sub => sub.setName("clip").setDescription("Enable or disable one edit.")
      .addStringOption(option => option.setName("clip").setDescription("Edit").setRequired(true).addChoices(
        { name: "🚓 Raid Convoy", value: "raid_convoy" },
        { name: "💠 Limitless Burst", value: "limitless_burst" },
        { name: "👁️ Six Eyes Calm", value: "six_eyes_calm" },
        { name: "💜 Purple Finish", value: "purple_finish" }
      ))
      .addBooleanOption(option => option.setName("enabled").setDescription("On/off").setRequired(true)))
    .addSubcommand(sub => sub.setName("category").setDescription("Give an edit a preferred security category.")
      .addStringOption(option => option.setName("clip").setDescription("Edit").setRequired(true).addChoices(
        { name: "🚓 Raid Convoy", value: "raid_convoy" },
        { name: "💠 Limitless Burst", value: "limitless_burst" },
        { name: "👁️ Six Eyes Calm", value: "six_eyes_calm" },
        { name: "💜 Purple Finish", value: "purple_finish" }
      ))
      .addStringOption(option => option.setName("category").setDescription("Preferred category").setRequired(true).addChoices(
        {name:"General",value:"general"},{name:"Timeout",value:"timeout"},{name:"Raid",value:"raid"},
        {name:"Anti-Nuke",value:"anti-nuke"},{name:"Scam",value:"scam"},{name:"Spam",value:"spam"},
        {name:"Harassment",value:"harassment"},{name:"Mass Mention",value:"mass_mention"},
        {name:"Permission Abuse",value:"permission_escalation"},{name:"Voice Abuse",value:"voice_abuse"},
        {name:"Mediation",value:"mediation"},{name:"Critical",value:"critical"}
      )))
    .addSubcommand(sub => sub.setName("sort").setDescription("Reset all edits to Infinity's smart default sorting.")),

  new SlashCommandBuilder()
    .setName("botinteraction")
    .setDescription("Manage bot/minigame false-positive protection.")
    .addSubcommand(sub =>
      sub
        .setName("addbot")
        .setDescription("Trust a bot for interaction detection.")
        .addUserOption(option =>
          option.setName("bot").setDescription("Bot user").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("removebot")
        .setDescription("Remove a trusted interaction bot.")
        .addUserOption(option =>
          option.setName("bot").setDescription("Bot user").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("addchannel")
        .setDescription("Mark a channel as a bot/minigame channel.")
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("removechannel")
        .setDescription("Return a channel to normal monitoring.")
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand(sub =>
      sub.setName("list").setDescription("Show trusted bots/channels and auto-detected channel counts.")
    ),

  new SlashCommandBuilder()
    .setName("channelpolicy")
    .setDescription("Override Infinity Security's policy for a channel.")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel to configure")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    )
    .addStringOption(option =>
      option
        .setName("policy")
        .setDescription("How Infinity Security treats the channel")
        .setRequired(true)
        .addChoices(
          { name: "Normal", value: "normal" },
          { name: "Bot / Minigame", value: "bot_interaction" },
          { name: "Honeypot / Trap - never speak there", value: "trap" }
        )
    ),

  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Manage trusted users.")
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription("Whitelist a user")
        .addUserOption(option =>
          option.setName("user").setDescription("User").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription("Remove a user")
        .addUserOption(option =>
          option.setName("user").setDescription("User").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("list").setDescription("Show whitelist")
    ),

  new SlashCommandBuilder()
    .setName("trustedrole")
    .setDescription("Manage roles trusted by Infinity Security.")
    .addSubcommand(sub => sub.setName("add").setDescription("Trust a role for security actions.")
      .addRoleOption(option => option.setName("role").setDescription("Role").setRequired(true)))
    .addSubcommand(sub => sub.setName("remove").setDescription("Remove a trusted role.")
      .addRoleOption(option => option.setName("role").setDescription("Role").setRequired(true)))
    .addSubcommand(sub => sub.setName("list").setDescription("Show trusted roles.")),

  new SlashCommandBuilder()
    .setName("mediation")
    .setDescription("Inspect Infinity AI mediation cases.")
    .addSubcommand(sub =>
      sub.setName("status").setDescription("Show active mediation cases.")
    )
    .addSubcommand(sub =>
      sub.setName("case").setDescription("Inspect one mediation case in detail.")
        .addStringOption(option =>
          option.setName("id").setDescription("Case ID, e.g. MED-ABC123").setRequired(true)
        )
    ),


  new SlashCommandBuilder()
    .setName("voice")
    .setDescription("Infinity Voice Overdrive controls.")
    .addSubcommand(s=>s.setName("panel").setDescription("Show room controls."))
    .addSubcommand(s=>s.setName("name").setDescription("Rename your room.").addStringOption(o=>o.setName("name").setDescription("New name").setRequired(true).setMaxLength(80)))
    .addSubcommand(s=>s.setName("limit").setDescription("Set user limit.").addIntegerOption(o=>o.setName("amount").setDescription("0-99").setRequired(true).setMinValue(0).setMaxValue(99)))
    .addSubcommand(s=>s.setName("permit").setDescription("Allow a user.").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)))
    .addSubcommand(s=>s.setName("revoke").setDescription("Remove explicit access.").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)))
    .addSubcommand(s=>s.setName("coowneradd").setDescription("Add Co-Owner.").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)))
    .addSubcommand(s=>s.setName("coownerremove").setDescription("Remove Co-Owner.").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)))
    .addSubcommand(s=>s.setName("transfer").setDescription("Transfer ownership.").addUserOption(o=>o.setName("user").setDescription("New owner").setRequired(true)))
    .addSubcommand(s=>s.setName("block").setDescription("Block from this room.").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)))
    .addSubcommand(s=>s.setName("unblock").setDescription("Unblock from this room.").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)))
    .addSubcommand(s=>s.setName("knock").setDescription("Knock on a locked Domain.").addChannelOption(o=>o.setName("channel").setDescription("Voice room").setRequired(true).addChannelTypes(ChannelType.GuildVoice)))
    .addSubcommand(s=>s.setName("queue").setDescription("Join a full room queue.").addChannelOption(o=>o.setName("channel").setDescription("Voice room").setRequired(true).addChannelTypes(ChannelType.GuildVoice)))
    .addSubcommand(s=>s.setName("preset").setDescription("Apply preset.").addStringOption(o=>o.setName("preset").setDescription("Preset").setRequired(true).addChoices({name:"Gaming",value:"gaming"},{name:"Private",value:"private"},{name:"Party",value:"party"},{name:"Study",value:"study"},{name:"Tournament",value:"tournament"})))
    .addSubcommand(s=>s.setName("panic").setDescription("Hide + lock instantly."))
    .addSubcommand(s=>s.setName("autoprivate").setDescription("Auto-lock with two people.").addBooleanOption(o=>o.setName("enabled").setDescription("On/off").setRequired(true)))
    .addSubcommand(s=>s.setName("invite").setDescription("DM-invite a user.").addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)))
    .addSubcommand(s=>s.setName("claim").setDescription("Claim room if owner left."))
    .addSubcommand(s=>s.setName("stats").setDescription("Voice XP and stats.").addUserOption(o=>o.setName("user").setDescription("Optional user").setRequired(false)))
    .addSubcommand(s=>s.setName("leaderboard").setDescription("Voice XP leaderboard."))
    .addSubcommand(s=>s.setName("teams").setDescription("Random teams from current VC.").addIntegerOption(o=>o.setName("count").setDescription("2-8 teams").setRequired(true).setMinValue(2).setMaxValue(8)))
    .addSubcommand(s=>s.setName("match").setDescription("Random 1v1/2v2.").addStringOption(o=>o.setName("mode").setDescription("Mode").setRequired(true).addChoices({name:"1v1",value:"1v1"},{name:"2v2",value:"2v2"})))
    .addSubcommand(s=>s.setName("tournament").setDescription("Tournament team rooms.").addIntegerOption(o=>o.setName("teams").setDescription("2-8").setRequired(true).setMinValue(2).setMaxValue(8)))
    .addSubcommand(s=>s.setName("scan").setDescription("Six Eyes voice scan.")),

  new SlashCommandBuilder()
    .setName("party")
    .setDescription("Infinity Party Finder.")
    .addSubcommand(s=>s.setName("create").setDescription("Create party room.").addStringOption(o=>o.setName("game").setDescription("Game").setRequired(true).setMaxLength(40)).addIntegerOption(o=>o.setName("players").setDescription("Max players").setRequired(true).setMinValue(2).setMaxValue(25)))
    .addSubcommand(s=>s.setName("list").setDescription("List open parties."))
    .addSubcommand(s=>s.setName("close").setDescription("Close your party.")),

  new SlashCommandBuilder()
    .setName("voicehub")
    .setDescription("Configure the automatic Join-to-Create Voice Domain hub.")
    .addSubcommand(sub =>
      sub.setName("setup").setDescription("Create or repair the Voice Domain hub.")
    )
    .addSubcommand(sub =>
      sub.setName("enable").setDescription("Enable automatic temporary voice rooms.")
    )
    .addSubcommand(sub =>
      sub.setName("disable").setDescription("Disable new temporary voice rooms.")
    ),

  new SlashCommandBuilder()
    .setName("verification")
    .setDescription("Configure Infinity human verification.")
    .addSubcommand(sub => sub.setName("setup").setDescription("Create/repair the verification role and channel."))
    .addSubcommand(sub => sub.setName("enable").setDescription("Enable verification for new members."))
    .addSubcommand(sub => sub.setName("disable").setDescription("Disable verification for future joins."))
    .addSubcommand(sub => sub.setName("status").setDescription("Show verification status.")),

  new SlashCommandBuilder()
    .setName("emergency")
    .setDescription("Control emergency server protection.")
    .addSubcommand(sub => sub.setName("on").setDescription("Activate emergency lockdown + enforce mode."))
    .addSubcommand(sub => sub.setName("off").setDescription("Restore the pre-emergency state."))
    .addSubcommand(sub => sub.setName("status").setDescription("Show emergency status.")),

  new SlashCommandBuilder()
    .setName("backup")
    .setDescription("Create and restore Infinity server recovery snapshots.")
    .addSubcommand(sub => sub.setName("create").setDescription("Create a server structure backup."))
    .addSubcommand(sub => sub.setName("list").setDescription("List recent backups."))
    .addSubcommand(sub => sub.setName("verify").setDescription("Verify backup integrity before a restore.")
      .addStringOption(o => o.setName("id").setDescription("Backup ID").setRequired(true)))
    .addSubcommand(sub => sub.setName("restore").setDescription("Restore a backup (server owner only).")
      .addStringOption(o => o.setName("id").setDescription("Backup ID").setRequired(true))),

  new SlashCommandBuilder()
    .setName("reports")
    .setDescription("Security reports and automatic daily summaries.")
    .addSubcommand(sub => sub.setName("now").setDescription("Generate a security report now.")
      .addStringOption(o => o.setName("period").setDescription("Report period").setRequired(true).addChoices(
        {name:"24 hours",value:"24"},{name:"7 days",value:"168"},{name:"30 days",value:"720"}
      )))
    .addSubcommand(sub => sub.setName("daily").setDescription("Enable or disable automatic 24h reports.")
      .addBooleanOption(o => o.setName("enabled").setDescription("Daily report on/off").setRequired(true))),

  new SlashCommandBuilder()
    .setName("quarantine")
    .setDescription("Apply a manual timeout-only quarantine.")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("1-40320 minutes").setRequired(false).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(500)),

  new SlashCommandBuilder()
    .setName("release")
    .setDescription("Remove a user's timeout/quarantine.")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

  new SlashCommandBuilder()
    .setName("health")
    .setDescription("Run Infinity Aegis runtime and permission health checks."),

  new SlashCommandBuilder()
    .setName("threats")
    .setDescription("Show correlated audit-log threats in the current Aegis window.")
    .addUserOption(o => o.setName("user").setDescription("Inspect one user").setRequired(false)),

  new SlashCommandBuilder()
    .setName("selfprotect")
    .setDescription("Inspect or harden Infinity Security against removal.")
    .addSubcommand(sub => sub.setName("status").setDescription("Show who can currently remove Infinity through role hierarchy."))
    .addSubcommand(sub => sub.setName("harden").setDescription("Repair core infrastructure, snapshot Self-Guard state and create a recovery backup.")),

  new SlashCommandBuilder()
    .setName("preset")
    .setDescription("Apply a tuned Infinity Security preset.")
    .addStringOption(o => o.setName("level").setDescription("Security preset").setRequired(true).addChoices(
      {name:"Relaxed",value:"relaxed"}, {name:"Balanced",value:"balanced"},
      {name:"Strict",value:"strict"}, {name:"Maximum",value:"maximum"}
    )),

  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Manage Infinity Security modules.")
    .addSubcommand(sub => sub.setName("overview").setDescription("Show module configuration."))
    .addSubcommand(sub => sub.setName("module").setDescription("Enable or disable a module.")
      .addStringOption(o => o.setName("name").setDescription("Module").setRequired(true).addChoices(
        {name:"Anti-Spam",value:"antiSpam"},{name:"Anti-Raid",value:"antiRaid"},{name:"Anti-Nuke",value:"antiNuke"},
        {name:"AI Guard",value:"aiGuard"},{name:"Mediation",value:"mediation"},{name:"Link Scanner",value:"linkScanner"},
        {name:"Message Logs",value:"messageLogs"},{name:"Voice Guard",value:"voiceSecurity"},{name:"Voice Domains",value:"voiceDomain"},
        {name:"Verification",value:"verification"},{name:"Permission Guard",value:"permissionGuard"},{name:"Threat Correlation",value:"threatCorrelation"},{name:"Health Guard",value:"healthGuard"},{name:"Self-Guard",value:"selfProtection"},{name:"Reports",value:"reports"}
      ))
      .addBooleanOption(o => o.setName("enabled").setDescription("Enable/disable").setRequired(true))),

  new SlashCommandBuilder()
    .setName("securityscore")
    .setDescription("Audit the server and calculate an Infinity Security score."),

  new SlashCommandBuilder()
    .setName("review")
    .setDescription("Owner review center for appeals, incidents and disputes.")
    .addSubcommand(sub =>
      sub.setName("overview").setDescription("Show pending owner-review work.")
    )
    .addSubcommand(sub =>
      sub
        .setName("appeal")
        .setDescription("Review one appeal by ID.")
        .addStringOption(option =>
          option.setName("id").setDescription("Appeal ID, e.g. APP-ABC123").setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("incident")
        .setDescription("Review one incident by ID.")
        .addStringOption(option =>
          option.setName("id").setDescription("Incident ID, e.g. INF-20260916-ABCD").setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("boss")
    .setDescription("Server-wide 24h Infinity boss event for the whole Discord server.")
    .addStringOption(option => option
      .setName("action")
      .setDescription("Spawn, view or cancel the current server boss")
      .setRequired(false)
      .addChoices(
        { name: "Status", value: "status" },
        { name: "Spawn (Admin)", value: "spawn" },
        { name: "Cancel (Admin)", value: "cancel" }
      ))
    .addStringOption(option => option
      .setName("difficulty")
      .setDescription("Difficulty when spawning")
      .setRequired(false)
      .addChoices(
        { name: "Normal", value: "normal" },
        { name: "Hard", value: "hard" },
        { name: "Nightmare", value: "nightmare" }
      )),

  new SlashCommandBuilder()
    .setName("cursedrealms")
    .setDescription("Open the Cursed Realms JJK grind RPG."),

  new SlashCommandBuilder()
    .setName("cursedduel")
    .setDescription("Challenge another player to a Cursed Realms PvP duel.")
    .addUserOption(option =>
      option.setName("opponent").setDescription("Player to challenge").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("incidents")
    .setDescription("Show recent security incidents."),

  new SlashCommandBuilder()
    .setName("lockdown")
    .setDescription("Lock normal text channels."),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Restore channel permissions from before lockdown.")
].map(command => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  if (GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log(`Registered guild commands in ${GUILD_ID}`);
  } else {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log("Registered global commands");
  }
}

function channelPolicyCounts(cfg) {
  const policies = Object.values(cfg.channelSafety?.policies || {});
  return {
    traps: policies.filter(policy => policy.type === "trap").length,
    botInteraction: policies.filter(policy => policy.type === "bot_interaction").length,
    mediation: policies.filter(policy => policy.type === "mediation").length,
    total: policies.length
  };
}

function statusEmbed(guild, cfg) {
  const counts = channelPolicyCounts(cfg);

  return new EmbedBuilder()
    .setTitle("∞ INFINITY SECURITY • AEGIS DOMAIN")
    .setDescription(`**${auraStatusLine(cfg)}**\n\n${cfg.mode === "enforce" ? "🌀 Enforcement barrier armed." : "👁️ Observation barrier active."}`)
    .setColor(cfg.mode === "enforce" ? 0x7dd3fc : 0x5865f2)
    .addFields(
      { name: "Security", value: cfg.mode.toUpperCase(), inline: true },
      { name: "Aura", value: `✨ ${String(cfg.aura.intensity || "overdrive").toUpperCase()} ${auraMeter(cfg.emergency.active ? "critical" : (cfg.mode === "enforce" ? "high" : "guarded"))}`, inline: true },
      { name: "AI Guard", value: `${cfg.aiGuard.mode.toUpperCase()} ${GEMINI_API_KEY ? "✅" : "⚪ local"}`, inline: true },
      { name: "AI Mediation", value: cfg.mediation.enabled ? "🤝 ON" : "❌ OFF", inline: true },
      { name: "Lockdown", value: cfg.lockdown.active ? "🔒 ACTIVE" : "🔓 OFF", inline: true },
      { name: "Bot Interaction Shield", value: cfg.botInteractions.enabled ? "✅ ON" : "❌ OFF", inline: true },
      { name: "Anti-Nuke", value: cfg.antiNuke.enabled ? "✅ ON" : "❌ OFF", inline: true },
      { name: "Link Shield", value: cfg.linkScanner.enabled ? "🔗 ON" : "❌ OFF", inline: true },
      { name: "Ghost Ping", value: cfg.messageLogs.ghostPingEnabled ? "👻 ON" : "❌ OFF", inline: true },
      { name: "Voice Guard", value: cfg.voiceSecurity.enabled ? "🎙️ ON" : "❌ OFF", inline: true },
      { name: "Voice Domains", value: cfg.voiceDomain.enabled ? "👁️ JOIN-TO-CREATE" : "❌ OFF", inline: true },
      { name: "Permission Guard", value: cfg.permissionGuard.enabled ? "🛡️ ON" : "❌ OFF", inline: true },
      { name: "Self-Guard", value: cfg.selfProtection?.enabled ? `🛡️ ${String(cfg.selfProtection.lastStatus || "CHECKING").replaceAll("_", " ")}` : "❌ OFF", inline: true },
      { name: "Verification", value: cfg.verification.enabled ? "✅ ON" : "⚪ OPTIONAL", inline: true },
      { name: "Emergency", value: cfg.emergency.active ? "🚨 ACTIVE" : "✅ READY", inline: true },
      { name: "Appeals", value: cfg.appeals.enabled ? `📩 ${pendingForGuild(guild.id, 50).length} pending` : "❌ OFF", inline: true },
      { name: "Bot/Minigame Channels", value: String(counts.botInteraction), inline: true },
      { name: "Trap Channels", value: String(counts.traps), inline: true },
      { name: "Active Mediations", value: String(activeCasesForGuild(guild.id).length), inline: true },
      { name: "Punishment", value: "⏱️ TIMEOUT ONLY", inline: true },
      { name: "Owner Alerts", value: "📩 Timeouts + disputes", inline: true },
      { name: "Ping", value: `${client.ws.ping}ms`, inline: true }
    )
    .setFooter({ text: "Infinity Security v12 • COMMAND CENTER • SELF-GUARD • Aegis Defense" })
    .setTimestamp();
}

async function commandCenterEmbed(guild, cfg) {
  const [health, self] = await Promise.all([
    auditGuildHealth(guild, cfg).catch(() => ({ healthy:false, critical:true, issues:[{code:"HEALTH_CHECK_FAILED", text:"Health check failed."}] })),
    assessSelfProtection(guild, { fetchMembers:true }).catch(() => null)
  ]);

  if (self) {
    rememberSelfProtection(cfg, guild, self);
    commit();
  }

  const threats = topThreatsForGuild(guild.id, cfg.threatCorrelation, 5);
  const topThreat = threats[0];
  const backups = cfg.backups?.enabled ? listBackups(guild.id) : [];
  const pendingAppeals = pendingForGuild(guild.id, 50).length;

  return new EmbedBuilder()
    .setTitle("∞ INFINITY SECURITY • COMMAND CENTER")
    .setDescription(
      `**${auraStatusLine(cfg)}**\n\n` +
      `Everything important is one button away.\n` +
      `**DOMAIN PRESSURE**  ${auraMeter(cfg.emergency.active ? "critical" : (topThreat?.level || (cfg.mode === "enforce" ? "high" : "guarded")))}`
    )
    .setColor(cfg.emergency.active ? 0xed4245 : cfg.mode === "enforce" ? 0x7dd3fc : 0x5865f2)
    .addFields(
      { name:"🛡️ Security", value:`${cfg.mode.toUpperCase()} • ${String(cfg.securityPreset || "balanced").toUpperCase()}`, inline:true },
      { name:"🩺 Health", value:health.critical ? "🔴 CRITICAL" : health.healthy ? "🟢 HEALTHY" : "🟡 WARNING", inline:true },
      { name:"👁️ Self-Guard", value:protectionSummary(self), inline:true },
      { name:"⚠️ Live Threat", value:topThreat ? `<@${topThreat.userId}> • ${topThreat.level.toUpperCase()} ${topThreat.score}` : "✅ None", inline:true },
      { name:"🚨 Emergency", value:cfg.emergency.active ? "ACTIVE" : "READY", inline:true },
      { name:"🔒 Lockdown", value:cfg.lockdown.active ? "ACTIVE" : "OFF", inline:true },
      { name:"💾 Backups", value:String(backups.length), inline:true },
      { name:"📩 Appeals", value:String(pendingAppeals), inline:true },
      { name:"✨ Aura", value:String(cfg.aura.intensity || "overdrive").toUpperCase(), inline:true }
    )
    .setFooter({ text:"Infinity Security v12 • Discord owners can always remove apps; Self-Guard minimizes staff exposure and provides recovery." })
    .setTimestamp();
}

function controlRows(cfg) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("inf_status").setLabel("Status").setEmoji("👁️").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("inf_health").setLabel("Health").setEmoji("🩺").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("inf_threats").setLabel("Threats").setEmoji("⚠️").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("inf_score").setLabel("Score").setEmoji("💯").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("inf_rescan").setLabel("Rescan").setEmoji("🔎").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("inf_lock").setLabel("Lockdown").setEmoji("🌀").setStyle(ButtonStyle.Danger).setDisabled(cfg.lockdown.active),
      new ButtonBuilder().setCustomId("inf_unlock").setLabel("Unlock").setEmoji("🔓").setStyle(ButtonStyle.Success).setDisabled(!cfg.lockdown.active),
      new ButtonBuilder().setCustomId("inf_emergency").setLabel(cfg.emergency.active ? "End Emergency" : "Emergency").setEmoji("🚨").setStyle(cfg.emergency.active ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("inf_backup").setLabel("Backup").setEmoji("💾").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("inf_repair").setLabel("Repair").setEmoji("🛠️").setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("inf_review").setLabel("Owner Review").setEmoji("👑").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("inf_report").setLabel("24h Report").setEmoji("📊").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("inf_aura").setLabel("Aura").setEmoji("✨").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("inf_selfguard").setLabel("Self-Guard").setEmoji("🛡️").setStyle(ButtonStyle.Success)
    )
  ];
}

client.once("ready", async () => {
  console.log(`∞ Infinity Security v12.1 Protected Member Guard online as ${client.user.tag}`);
  console.log(`AI Guard/Mediator: ${GEMINI_API_KEY ? `Gemini ${GEMINI_MODEL}` : "local fallback only"}`);
  client.user.setActivity("∞ Limitless Security • Six Eyes 👁️");

  for (const guild of client.guilds.cache.values()) {
    try {
      await autoSetupGuild(guild, false);
      const cfg = getConfig(guild.id);
      if (cfg.selfProtection?.enabled) {
        const self = await assessSelfProtection(guild).catch(() => null);
        if (self) {
          rememberSelfProtection(cfg, guild, self);
          commit();
          if (!self.protectedFromStaff) {
            await sendLog(guild, cfg, "Self-Guard exposure", `${self.dangerousMembers.length} non-owner member(s) above Infinity can potentially remove it through combined Administrator/Kick/Ban permissions. Open \`/panel\` → **Self-Guard** for details.`, "warn").catch(()=>{});
            await sendOwnerSelfGuardAlert(guild, "Startup exposure detected", self.text, self).catch(()=>{});
          }
        }
      }
      if (cfg.startup.logOnlineMessage) {
        await sendLog(
          guild,
          cfg,
          "Six Eyes online",
          `**Infinity Security v12.1 • PROTECTED MEMBER GUARD is online.**\n\n**${auraStatusLine(cfg)}**\n\n👁️ Six Eyes active • 🛡️ Aegis Correlation active • 🔗 Link Shield active • 👻 Ghost-Ping watch active • 🎙️ Voice Guard active\n\n**DOMAIN PRESSURE**  ${auraMeter("high")}`
        );
      }
    } catch (error) {
      console.error(`Auto-setup failed for ${guild.id}:`, error?.message || error);
    }
  }
});


// Periodic security report scheduler. It checks hourly and only sends when 24h elapsed.
setInterval(async () => {
  for (const guild of client.guilds.cache.values()) {
    const cfg = getConfig(guild.id);
    if (!cfg.reports?.enabled || !cfg.reports.dailyEnabled || !cfg.logChannelId) continue;
    if (cfg.reports.lastSentAt && Date.now() - cfg.reports.lastSentAt < 24 * 3600000) continue;
    const report = reportForGuild(guild.id, 24);
    await sendLog(guild, cfg, "Daily Security Report", `**Incidents:** ${report.incidents.length}\n**Timeout actions:** ${report.timeouts}\n**Pending appeals:** ${report.pendingAppeals}\n**Active mediations:** ${report.activeMediations}\n\n${compactCounts(report.byCategory)}`);
    cfg.reports.lastSentAt = Date.now(); commit();
  }
}, 60 * 60 * 1000).unref();

// Server-wide Boss Event clock: voice progress, live panels, 24h deadline and reward/curse cleanup.
setInterval(async () => {
  await tickAllServerBosses(client).catch(error => {
    console.error("[ServerBoss] global tick failed:", error?.message || error);
  });
}, 60 * 1000).unref();

setInterval(async()=>{for(const g of client.guilds.cache.values()){const cfg=getConfig(g.id);if(cfg.enabled&&cfg.voiceDomain?.enabled)await smartAfkSweep(g,cfg).catch(()=>{});}},5*60*1000).unref();

// Self-healing infrastructure + automatic recovery snapshots.
setInterval(async () => {
  // Bound long-running in-memory trackers so a busy public bot does not leak keys forever.
  const now = Date.now();
  for (const [key, list] of spamTracker) {
    const fresh = list.filter(ts => now - ts < 10 * 60 * 1000);
    fresh.length ? spamTracker.set(key, fresh) : spamTracker.delete(key);
  }
  for (const [key, list] of raidTracker) {
    const fresh = list.filter(ts => now - ts < 10 * 60 * 1000);
    fresh.length ? raidTracker.set(key, fresh) : raidTracker.delete(key);
  }
  for (const [key, list] of destructiveTracker) {
    const fresh = list.filter(ts => now - ts < 10 * 60 * 1000);
    fresh.length ? destructiveTracker.set(key, fresh) : destructiveTracker.delete(key);
  }
  for (const [key, at] of friendlyWarningCooldown) if (now - at > 60 * 60 * 1000) friendlyWarningCooldown.delete(key);

  for (const guild of client.guilds.cache.values()) {
    const cfg = getConfig(guild.id);
    if (!cfg.enabled) continue;

    if (cfg.healthGuard?.enabled) {
      const interval = Math.max(1, Number(cfg.healthGuard.checkIntervalMinutes || 10)) * 60000;
      const lastCheck = healthCheckAt.get(guild.id) || 0;
      if (Date.now() - lastCheck >= interval) {
        healthCheckAt.set(guild.id, Date.now());
        const result = await auditGuildHealth(guild, cfg).catch(()=>null);
        if (result) {
          const signature = healthSignature(result);
          const cooldown = Math.max(5, Number(cfg.healthGuard.logCooldownMinutes || 30)) * 60000;
          const canLog = !cfg.healthGuard.lastLoggedAt || Date.now() - cfg.healthGuard.lastLoggedAt >= cooldown;
          if (signature !== cfg.healthGuard.lastSignature || (result.critical && canLog)) {
            if (signature === "healthy" && cfg.healthGuard.lastSignature && cfg.healthGuard.lastSignature !== "healthy") {
              await sendLog(guild,cfg,"Aegis health recovered","✅ Runtime permissions and core infrastructure are healthy again.").catch(()=>{});
              cfg.healthGuard.lastLoggedAt=Date.now();
            } else if (result.issues.length && canLog) {
              await sendLog(guild,cfg,"Aegis health warning",result.issues.slice(0,8).map(i=>`${i.severity==="critical"?"🔴":"🟡"} **${i.code}** — ${i.text}`).join("\n"),result.critical?"danger":"warn").catch(()=>{});
              cfg.healthGuard.lastLoggedAt=Date.now();
            }
            cfg.healthGuard.lastSignature=signature;
            commit();
          }
        }
      }
    }

    if (cfg.selfProtection?.enabled && cfg.selfProtection.monitorRoleHierarchy) {
      const previousStatus = cfg.selfProtection.lastStatus;
      const previousRoles = new Set(cfg.selfProtection.lastDangerousRoleIds || []);
      const self = await assessSelfProtection(guild).catch(() => null);
      if (self) {
        const currentRoles = new Set(self.dangerousRoles.map(r => r.id));
        const changed = previousStatus !== self.status ||
          previousRoles.size !== currentRoles.size ||
          [...previousRoles].some(id => !currentRoles.has(id));
        rememberSelfProtection(cfg, guild, self);
        commit();
        if (changed && self.status === "EXPOSED") {
          await sendLog(guild, cfg, "Self-Guard exposure changed", `${self.dangerousRoles.length} higher role(s) can potentially remove Infinity because they have Administrator/Kick/Ban.`, "warn").catch(()=>{});
          await sendOwnerSelfGuardAlert(guild, "Removal exposure changed", self.text, self).catch(()=>{});
        } else if (changed && self.status === "OWNER_ONLY" && previousStatus === "EXPOSED") {
          await sendLog(guild, cfg, "Self-Guard hardened", "✅ Infinity is now above all non-owner roles with Administrator/Kick/Ban exposure.").catch(()=>{});
        }
      }
    }

    if (!cfg.logChannelId || !guild.channels.cache.has(cfg.logChannelId)) {
      await ensureBotLogs(guild, cfg, client.user?.id).catch(() => null);
    }
    if (cfg.voiceDomain?.enabled && cfg.voiceDomain?.autoCreateHub && (!cfg.voiceDomain.hubChannelId || !guild.channels.cache.has(cfg.voiceDomain.hubChannelId))) {
      await ensureVoiceHub(guild, cfg, client.user?.id).catch(() => null);
    }
    if (cfg.verification?.enabled && (!cfg.verification.channelId || !guild.channels.cache.has(cfg.verification.channelId) || !cfg.verification.unverifiedRoleId || !guild.roles.cache.has(cfg.verification.unverifiedRoleId))) {
      await ensureVerificationSetup(guild, cfg, client.user?.id).catch(() => null);
      await applyRestrictionsGuild(guild, cfg).catch(() => {});
    }

    if (cfg.backups?.enabled && cfg.backups?.autoEnabled) {
      const interval = Math.max(1, Number(cfg.backups.autoIntervalHours || 12)) * 3600000;
      if (!cfg.backups.lastBackupAt || Date.now() - cfg.backups.lastBackupAt >= interval) {
        const backup = await createBackup(guild, cfg.backups.maxBackups).catch(() => null);
        if (backup) {
          cfg.backups.lastBackupAt = Date.now();
          commit();
          await sendLog(guild, cfg, "Automatic recovery backup", `Created backup \`${backup.id}\` during the integrity sweep.`).catch(() => {});
        }
      }
    }
  }
}, 10 * 60 * 1000).unref();


client.on("guildAuditLogEntryCreate", async (entry, guild) => {
  if (!guild || !entry) return;
  const cfg = getConfig(guild.id);

  const auditTargetId = entry.targetId || entry.target?.id || null;
  if (
    cfg.selfProtection?.enabled &&
    auditTargetId === client.user?.id &&
    [AuditLogEvent.MemberKick, AuditLogEvent.MemberBanAdd].includes(entry.action)
  ) {
    const executorId = entry.executorId || entry.executor?.id || null;
    const self = await assessSelfProtection(guild).catch(() => null);
    await sendOwnerSelfGuardAlert(
      guild,
      "Removal action detected",
      `${executorId ? `<@${executorId}>` : "Someone"} triggered a Discord removal action against Infinity. Discord does not expose a cancellable pre-kick/pre-ban hook, so Self-Guard is sending recovery information immediately.`,
      self
    ).catch(()=>{});
  }
  if (!cfg.enabled || !cfg.threatCorrelation?.enabled) return;

  const executorId = entry.executorId || entry.executor?.id || null;
  if (!executorId || isWhitelisted(guild, executorId)) return;
  const signalType = auditSignalType(entry.action);
  if (!signalType) return;

  const threat = recordThreatSignal(guild.id, executorId, signalType, cfg.threatCorrelation, {
    action: Number(entry.action), targetId: entry.targetId || entry.target?.id || null
  });

  if (!threat.escalationReady) return;

  const incident = createIncident({
    guildId:guild.id,
    userId:executorId,
    category:"threat_correlation",
    severity:threat.critical ? "critical" : threat.shouldAct ? "high" : "medium",
    reason:`Aegis correlated audit-log risk score ${threat.score}: ${threat.types.join(", ")}`,
    action:"logged",
    metadata:{ threatScore:threat.score, level:threat.level, types:threat.types, eventCount:threat.count }
  });

  await sendLog(
    guild, cfg, "Aegis correlated threat",
    `<@${executorId}> reached **${threat.level.toUpperCase()}** threat score **${threat.score}** across **${threat.count}** audit actions.\n` +
    `Signals: ${threat.types.map(t=>`\`${t}\``).join(" ")}\nIncident: \`${incident.id}\``,
    threat.shouldAct ? "danger" : "warn"
  );

  if (threat.shouldAct && cfg.mode === "enforce") {
    const user = await client.users.fetch(executorId).catch(()=>null);
    if (user) await punishExecutor(guild, user, incident, cfg, Number(cfg.threatCorrelation.timeoutMinutes || 240));
  }

  if (threat.critical && cfg.threatCorrelation.autoEmergencyOnCritical && !cfg.emergency?.active) {
    const result = await activateEmergency(guild, cfg, client.user.id).catch(()=>null);
    if (result) await sendLog(guild,cfg,"Aegis automatic emergency",`Critical correlated threat score **${threat.score}** triggered Emergency Mode. Text locked: **${result.textLocked}**, voice locked: **${result.voiceLocked}**.`,`danger`);
  }
});

client.on("guildMemberRemove", async member => {
  const guild = member.guild;
  if (!guild) return;

  const cfg = getConfig(guild.id);
  if (!isProtectedMember(cfg, member.id)) return;

  // guildMemberRemove also fires for voluntary leaves. Only trigger recovery when
  // the Audit Log confirms an actual kick of this exact protected user.
  const executor = await fetchExecutor(guild, AuditLogEvent.MemberKick, member.id);
  if (!executor) return;

  let inviteUrl = await createRecoveryInvite(
    guild,
    cfg,
    member.id,
    `Infinity Protected Member Guard: recovery after kick of ${member.id}`
  ).catch(() => null);

  if (!inviteUrl) inviteUrl = cachedRecoveryInvite(cfg, member.id);
  commit();

  const dmDelivered = cfg.protectedMembers?.dmOnKick !== false && inviteUrl
    ? await sendProtectedKickDm(member.user, guild.name, inviteUrl)
    : false;

  await sendLog(
    guild,
    cfg,
    "Protected member kick",
    `🛡️ <@${member.id}> was kicked by <@${executor.id}>.\n` +
      `Recovery invite: **${inviteUrl ? "READY" : "FAILED"}**\n` +
      `Protected-user DM: **${dmDelivered ? "SENT" : "FAILED / DMs CLOSED"}**\n\n` +
      `👁️ *Six Eyes saw the removal. Infinity opened the Domain again immediately.*`,
    "danger"
  ).catch(() => {});

  if (cfg.protectedMembers?.ownerFallback !== false) {
    await sendOwnerProtectedKickFallback(
      guild,
      member.id,
      executor.id,
      inviteUrl,
      dmDelivered
    ).catch(() => false);
  }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (!client.user || newMember.id !== client.user.id) return;
  const guild = newMember.guild;
  const cfg = getConfig(guild.id);
  if (!cfg.selfProtection?.enabled) return;

  const rolesChanged = oldMember.roles.cache.size !== newMember.roles.cache.size ||
    [...oldMember.roles.cache.keys()].some(id => !newMember.roles.cache.has(id));
  const permissionsChanged = oldMember.permissions.bitfield !== newMember.permissions.bitfield;
  if (!rolesChanged && !permissionsChanged) return;

  const self = await assessSelfProtection(guild).catch(() => null);
  if (!self) return;
  rememberSelfProtection(cfg, guild, self);
  commit();
  await sendLog(guild, cfg, "Self-Guard change detected", `Infinity's own roles/permissions changed. Current state: **${self.status}**.`, self.protectedFromStaff ? "info" : "warn").catch(()=>{});
  await sendOwnerSelfGuardAlert(guild, "Infinity permissions changed", "Infinity detected a change to its own guild roles or permission set. Review whether this was intentional.", self).catch(()=>{});
});

client.on("roleUpdate", async (oldRole, newRole) => {
  const guild = newRole.guild;
  const cfg = getConfig(guild.id);
  if (!cfg.selfProtection?.enabled || !cfg.selfProtection.monitorRoleHierarchy) return;
  if (oldRole.position === newRole.position && oldRole.permissions.bitfield === newRole.permissions.bitfield) return;

  const me = guild.members.me;
  if (!me) return;
  const relevant = me.roles.cache.has(newRole.id) ||
    oldRole.position >= me.roles.highest.position - 1 ||
    newRole.position >= me.roles.highest.position - 1;
  if (!relevant) return;

  const previousStatus = cfg.selfProtection.lastStatus;
  const self = await assessSelfProtection(guild).catch(() => null);
  if (!self) return;
  rememberSelfProtection(cfg, guild, self);
  commit();
  if (self.status !== previousStatus || !self.protectedFromStaff) {
    await sendOwnerSelfGuardAlert(guild, "Role hierarchy changed", "A role near/above Infinity changed position or dangerous permissions. Self-Guard recalculated removal exposure.", self).catch(()=>{});
  }
});

client.on("guildDelete", async guild => {
  const cfg = getConfig(guild.id);
  if (!cfg.selfProtection?.enabled || !cfg.selfProtection.alertOnRemoval) return;
  await notifyOwnerAfterRemoval(client, guild, cfg, CLIENT_ID).catch(() => false);
});

client.on("guildCreate", async guild => {
  await autoSetupGuild(guild, true).catch(error => {
    console.error(`Guild auto-setup failed for ${guild.id}:`, error?.message || error);
  });
});

client.on("channelCreate", async channel => {
  if (!channel.guild) return;
  const guild = channel.guild;
  const cfg = getConfig(guild.id);

  // Emergency mode must also cover channels created AFTER the emergency started.
  if (cfg.emergency?.active) {
    if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
      const ow = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
      let prior = null;
      if (ow?.allow.has(PermissionsBitField.Flags.SendMessages)) prior = true;
      if (ow?.deny.has(PermissionsBitField.Flags.SendMessages)) prior = false;
      cfg.lockdown.snapshot[channel.id] = prior;
      cfg.lockdown.active = true;
      await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});
    }
    if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
      const ow = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
      let prior = null;
      if (ow?.allow.has(PermissionsBitField.Flags.Connect)) prior = true;
      if (ow?.deny.has(PermissionsBitField.Flags.Connect)) prior = false;
      cfg.emergency.voiceSnapshot[channel.id] = prior;
      await channel.permissionOverwrites.edit(guild.roles.everyone, { Connect: false }).catch(() => {});
    }
    commit();
  }

  if (cfg.channelSafety.autoScan) await scanGuildChannels(guild, cfg).catch(() => {});
  if (cfg.verification.enabled) await applyRestrictionToChannel(channel, cfg).catch(() => {});

  if (cfg.antiNuke?.enabled) {
    const executor = await fetchExecutor(guild, AuditLogEvent.ChannelCreate, channel.id);
    if (executor && !isWhitelisted(guild, executor.id)) {
      const count = destructiveBurst(guild.id, executor.id, "channel_create_burst", cfg.antiNuke.windowMs);
      if (count >= Number(cfg.antiNuke.createThreshold || 5)) {
        const incident = createIncident({
          guildId:guild.id, userId:executor.id, category:"anti-nuke", severity:"high",
          reason:`Mass channel creation detected: ${count} channels in ${Math.round(cfg.antiNuke.windowMs/1000)} seconds`,
          action:"logged", metadata:{ channelId:channel.id, count }
        });
        await sendLog(guild,cfg,"Mass channel creation",`<@${executor.id}> created **${count} channels** in a short burst.\nIncident: \`${incident.id}\``,"danger");
        if (cfg.mode === "enforce") await punishExecutor(guild, executor, incident, cfg, 60);
      }
    }
  }
});

client.on("channelUpdate", async (_oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  const guild = newChannel.guild;
  const cfg = getConfig(guild.id);

  if (cfg.emergency?.active) {
    const everyone = newChannel.permissionOverwrites.cache.get(guild.roles.everyone.id);
    if ((newChannel.type === ChannelType.GuildText || newChannel.type === ChannelType.GuildAnnouncement) && !everyone?.deny.has(PermissionsBitField.Flags.SendMessages)) {
      if (!(newChannel.id in cfg.lockdown.snapshot)) cfg.lockdown.snapshot[newChannel.id] = null;
      await newChannel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages:false }).catch(()=>{});
      commit();
    }
    if ((newChannel.type === ChannelType.GuildVoice || newChannel.type === ChannelType.GuildStageVoice) && !everyone?.deny.has(PermissionsBitField.Flags.Connect)) {
      if (!(newChannel.id in cfg.emergency.voiceSnapshot)) cfg.emergency.voiceSnapshot[newChannel.id] = null;
      await newChannel.permissionOverwrites.edit(guild.roles.everyone, { Connect:false }).catch(()=>{});
      commit();
    }
  }

  if (cfg.channelSafety.autoScan) await scanGuildChannels(guild, cfg).catch(() => {});
});

client.on("channelDelete", async channel => {
  if (!channel.guild) return;

  const guild = channel.guild;
  const cfg = getConfig(guild.id);
  const wasLogChannel = cfg.logChannelId === channel.id;
  const wasVoiceHub = cfg.voiceDomain?.hubChannelId === channel.id;
  const wasVerifyChannel = cfg.verification?.channelId === channel.id;

  delete cfg.channelSafety.policies[channel.id];
  if (wasLogChannel) cfg.logChannelId = null;
  if (wasVoiceHub) cfg.voiceDomain.hubChannelId = null;
  if (wasVerifyChannel) cfg.verification.channelId = null;
  delete cfg.lockdown.snapshot?.[channel.id];
  delete cfg.emergency?.voiceSnapshot?.[channel.id];
  commit();

  await handleDestructiveEvent(
    guild,
    "channel_delete",
    channel.id,
    `Deleted channel #${channel.name}`,
    AuditLogEvent.ChannelDelete
  );

  // Self-heal critical Infinity infrastructure after accidental or malicious deletion.
  if (wasLogChannel) await ensureBotLogs(guild, cfg, client.user?.id).catch(() => null);
  if (wasVoiceHub && cfg.voiceDomain?.enabled && cfg.voiceDomain?.autoCreateHub) {
    await ensureVoiceHub(guild, cfg, client.user?.id).catch(() => null);
  }
  if (wasVerifyChannel && cfg.verification?.enabled) {
    await ensureVerificationSetup(guild, cfg, client.user?.id).catch(() => null);
  }
});
client.on("interactionCreate", async interaction => {
  // Appeal buttons live in offender/owner DMs, where interaction.guild is null.
  if (interaction.isButton() && interaction.customId.startsWith("appeal_open_")) {
    const incidentId = interaction.customId.replace("appeal_open_", "");
    const incident = getIncident(incidentId);

    if (!incident || incident.userId !== interaction.user.id) {
      return interaction.reply({ content: "This appeal link is not valid for your account." }).catch(() => {});
    }

    const modal = new ModalBuilder()
      .setCustomId(`appeal_submit_${incident.id}`)
      .setTitle("Appeal Infinity Timeout");

    const reason = new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Why should the owner review this?")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Explain briefly what happened. Mention evidence or context if relevant.")
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(1200);

    modal.addComponents(new ActionRowBuilder().addComponents(reason));
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("appeal_submit_")) {
    const incidentId = interaction.customId.replace("appeal_submit_", "");
    const incident = getIncident(incidentId);

    if (!incident || incident.userId !== interaction.user.id) {
      return interaction.reply({ content: "This appeal is no longer valid." }).catch(() => {});
    }

    const guild = client.guilds.cache.get(incident.guildId);
    if (!guild) {
      return interaction.reply({ content: "I can no longer access that server." }).catch(() => {});
    }

    const cfg = getConfig(guild.id);
    if (!cfg.appeals.enabled) {
      return interaction.reply({ content: "Appeals are currently disabled on that server." }).catch(() => {});
    }

    const existingAppeal = findAppealByIncident(guild.id, interaction.user.id, incidentId);
    if (existingAppeal) {
      return interaction.reply({
        content: `You already submitted appeal \`${existingAppeal.id}\`. Current status: **${existingAppeal.status}**.`
      }).catch(() => {});
    }

    const reason = interaction.fields.getTextInputValue("reason");
    const appeal = createAppeal({
      guildId: guild.id,
      userId: interaction.user.id,
      incidentId,
      reason
    });

    await sendOwnerAppealDm(guild, appeal, incident);
    await sendLog(
      guild,
      cfg,
      "New timeout appeal",
      `<@${interaction.user.id}> submitted appeal \`${appeal.id}\` for incident \`${incidentId}\`.\n**Reason:** ${previewText(reason, 800)}`,
      "warn",
      incidentEvidenceFields(incident)
    );

    return interaction.reply({
      content: `📩 **Appeal sent.** The server owner received \`${appeal.id}\`. You’ll get a DM when it is reviewed.`
    }).catch(() => {});
  }

  if (
    interaction.isButton() &&
    (interaction.customId.startsWith("appeal_approve_") || interaction.customId.startsWith("appeal_deny_"))
  ) {
    const approve = interaction.customId.startsWith("appeal_approve_");
    const appealId = interaction.customId.replace(approve ? "appeal_approve_" : "appeal_deny_", "");
    const appeal = getAppeal(appealId);

    if (!appeal) {
      return interaction.reply({ content: "That appeal no longer exists.", ephemeral: true }).catch(() => {});
    }

    const guild = client.guilds.cache.get(appeal.guildId);
    if (!guild) {
      return interaction.reply({ content: "I can no longer access that server.", ephemeral: true }).catch(() => {});
    }

    if (interaction.user.id !== guild.ownerId) {
      return interaction.reply({ content: "👑 Only the server owner can decide appeals.", ephemeral: true }).catch(() => {});
    }

    if (appeal.status !== "pending") {
      return interaction.reply({ content: `This appeal is already **${appeal.status}**.`, ephemeral: true }).catch(() => {});
    }

    await interaction.deferUpdate().catch(() => {});
    const result = await resolveAppeal(guild, appeal, approve, interaction.user.id);
    await interaction.message?.edit({ components: appealReviewButtons(appeal.id, true) }).catch(() => {});

    if (interaction.followUp) {
      await interaction.followUp({
        content: approve
          ? `✅ Appeal approved.${result.timeoutRemoved ? " Timeout removed." : " No active timeout could be removed."}`
          : "❌ Appeal denied and closed.",
        ephemeral: Boolean(interaction.guild)
      }).catch(() => {});
    }
    return;
  }

  if (!interaction.guild) return;

  const guild = interaction.guild;
  const cfg = getConfig(guild.id);

  if (interaction.isModalSubmit() && interaction.customId.startsWith("verify_submit_")) {
    const result = await completeChallenge(interaction, cfg);
    if (!result.ok) return interaction.reply({ content: "❌ Wrong or expired verification code. Press **Verify** and try again.", ephemeral: true });
    const risk = accountRisk(result.member);
    await sendLog(guild, cfg, "Member verified", `<@${interaction.user.id}> passed the human verification.${risk.ageDays < cfg.verification.warnAccountAgeDays ? `\n⚠️ Account age: **${risk.ageDays} days** — owner review may be useful.` : ""}`);
    return interaction.reply({ content: `✅ **Verified.** ${auraEventLine("verification", cfg)}\n\n**DOMAIN ACCESS:** GRANTED 👁️`, ephemeral: true });
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith("serverboss_")) {
      const handled = await handleServerBossButton(interaction);
      if (handled) return;
    }
    if (interaction.customId.startsWith("crduel_")) {
      const handled = await handleCursedDuelButton(interaction);
      if (handled) return;
    }
    if (interaction.customId.startsWith("cr_")) {
      const handled = await handleCursedRealmsButton(interaction);
      if (handled) return;
    }

    if (interaction.customId === "verify_start") {
      if (!cfg.verification.enabled) return interaction.reply({ content: "Verification is currently disabled.", ephemeral: true });
      const modal = buildChallengeModal(guild.id, interaction.user.id, cfg.verification.challengeMinutes);
      return interaction.showModal(modal);
    }
    if (
      interaction.customId.startsWith("review_untimeout_") ||
      interaction.customId.startsWith("review_close_")
    ) {
      if (!requireOwner(interaction, guild)) return;

      const removeTimeout = interaction.customId.startsWith("review_untimeout_");
      const incidentId = interaction.customId.replace(
        removeTimeout ? "review_untimeout_" : "review_close_",
        ""
      );
      const incident = getIncident(incidentId);

      if (!incident || incident.guildId !== guild.id) {
        return interaction.reply({ content: "Incident not found.", ephemeral: true });
      }

      await interaction.deferUpdate();

      if (removeTimeout) {
        const ok = await removeTimeoutFromIncident(guild, incident, interaction.user.id);
        await sendLog(
          guild,
          cfg,
          "Owner review action",
          `<@${interaction.user.id}> tried to remove the timeout for incident \`${incident.id}\`. Result: **${ok ? "removed" : "not active / failed"}**.`
        );
        await interaction.message?.edit({ components: incidentReviewButtons(incident.id, true) }).catch(() => {});
        await interaction.followUp({
          content: ok ? "✅ Timeout removed and review closed." : "⚠️ No active timeout could be removed.",
          ephemeral: true
        }).catch(() => {});
      } else {
        updateIncident(incident.id, {
          metadata: {
            ...(incident.metadata || {}),
            reviewClosed: true,
            reviewClosedBy: interaction.user.id
          }
        });
        await interaction.message?.edit({ components: incidentReviewButtons(incident.id, true) }).catch(() => {});
        await interaction.followUp({ content: "📁 Review closed. Timeout was not changed.", ephemeral: true }).catch(() => {});
      }
      return;
    }

    // Mediation buttons are intentionally usable by the two participants,
    // so they must be handled before the administrator-only control panel.
    if (interaction.customId.startsWith("med_yes_") || interaction.customId.startsWith("med_no_")) {
      const isYes = interaction.customId.startsWith("med_yes_");
      const caseId = interaction.customId.replace(isYes ? "med_yes_" : "med_no_", "");
      const caseData = getCase(caseId);

      if (!caseData || caseData.guildId !== guild.id) {
        return interaction.reply({ content: "This mediation case no longer exists.", ephemeral: true });
      }

      if (!caseData.users.includes(interaction.user.id)) {
        return interaction.reply({ content: "👁️ This button is only for the two users in this dispute.", ephemeral: true });
      }

      if (caseData.status !== "waiting_consent") {
        return interaction.reply({ content: "This mediation invitation is already closed.", ephemeral: true });
      }

      if (caseData.votes[interaction.user.id] !== null) {
        return interaction.reply({ content: "You already answered.", ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      setVote(caseId, interaction.user.id, isYes ? "yes" : "no");
      const updated = getCase(caseId);

      if (!isYes) {
        const acted = await timeoutMediationRefusal(guild, updated, interaction.user.id, cfg);

        await interaction.editReply(
          acted
            ? "⏱️ You chose **No**. The dispute is now waiting for the server owner, and an Owner Review timeout was applied."
            : "⚠️ You chose **No**. The dispute was escalated to the owner, but Infinity could not apply the timeout."
        );

        if (interaction.message?.editable) {
          await interaction.message.edit({ components: consentButtons(caseId, true) }).catch(() => {});
        }
        return;
      }

      await interaction.editReply("🤝 **Yes recorded.** Waiting for the other person.");

      if (updated.users.every(id => updated.votes[id] === "yes")) {
        const channel = await createPrivateMediationChannel(guild, updated, cfg);

        if (!channel) {
          updateCase(caseId, { status: "owner_review" });
          await sendOwnerMediationDm(
            guild,
            updated,
            "Mediation channel failed",
            "Both users accepted, but Infinity could not create the private channel. Please check Manage Channels permissions."
          );
          return;
        }

        if (interaction.message?.editable) {
          await interaction.message.edit({ components: consentButtons(caseId, true) }).catch(() => {});
        }
      }
      return;
    }

    if (
      interaction.customId.startsWith("med_resolve_") ||
      interaction.customId.startsWith("med_owner_")
    ) {
      const wantsResolve = interaction.customId.startsWith("med_resolve_");
      const caseId = interaction.customId.replace(
        wantsResolve ? "med_resolve_" : "med_owner_",
        ""
      );
      const caseData = getCase(caseId);

      if (!caseData || caseData.guildId !== guild.id) {
        return interaction.reply({ content: "This mediation case no longer exists.", ephemeral: true });
      }

      if (!caseData.users.includes(interaction.user.id)) {
        return interaction.reply({ content: "This button is only for the two participants.", ephemeral: true });
      }

      if (!wantsResolve) {
        await interaction.reply({
          content: "🛡️ Owner review requested.",
          ephemeral: true
        });
        await ownerEscalateMediation(guild, caseData, interaction.user.id);

        if (interaction.channel?.isTextBased()) {
          await interaction.channel.send(
            "🛡️ **Owner review requested.** Infinity has sent the owner a private report."
          ).catch(() => {});
        }
        return;
      }

      setResolutionVote(caseId, interaction.user.id, "resolved");
      const updated = getCase(caseId);

      await interaction.reply({
        content: "✅ Your **Resolved** vote is recorded.",
        ephemeral: true
      });

      if (updated.users.every(id => updated.resolutionVotes[id] === "resolved")) {
        if (interaction.message?.editable) {
          await interaction.message.edit({ components: resolveButtons(caseId, true) }).catch(() => {});
        }
        await finalizeMediation(guild, updated, cfg);
      }

      return;
    }

if (interaction.customId.startsWith("vknock_")) {
  const [,decision,channelId,targetId]=interaction.customId.split("_");
  const ok=await resolveKnock(guild,channelId,targetId,interaction.user.id,decision==="allow");
  return interaction.reply({content:ok?(decision==="allow"?`✅ ${voiceLine("allow")}`:`❌ ${voiceLine("deny")}`):"👁️ Only the owner/Co-Owner can answer.",ephemeral:true});
}

if (interaction.customId.startsWith("vroom_")) {
  const parts = interaction.customId.split("_");
  const action = parts[1];
  const channelId = parts.slice(2).join("_");
  const channel = guild.channels.cache.get(channelId);
  const room = channel ? getRoom(guild.id, channel.id) : null;

  if (!channel || !room) {
    return interaction.reply({ content: "That temporary Voice Domain no longer exists.", ephemeral: true });
  }

  if (!hasRoomControl(guild.id, channel.id, interaction.user.id)) {
    return interaction.reply({ content: "👁️ Only the owner of this Voice Domain can use these controls.", ephemeral: true });
  }

  if (action === "lock") {
    const locked = await toggleLock(guild, channel, interaction.user.id);
    return interaction.reply({
      content: locked ? "🔒 **Domain locked.** New users cannot connect unless permitted." : "🔓 **Domain unlocked.**",
      ephemeral: true
    });
  }

  if (action === "hide") {
    const hidden = await toggleHide(guild, channel, interaction.user.id);
    return interaction.reply({
      content: hidden ? "🌑 **Domain hidden.** Only explicitly allowed users can see it." : "👁️ **Domain visible again.**",
      ephemeral: true
    });
  }

  if (action === "panic") {
    const ok=await panicRoom(guild,channel,interaction.user.id);
    return interaction.reply({content:ok?`🌀 **${voiceLine("panic")}**`:"❌ Panic failed.",ephemeral:true});
  }

  if (action === "limit5") {
    await setRoomLimit(guild, channel, interaction.user.id, 5);
    return interaction.reply({ content: "5️⃣ User limit set to **5**.", ephemeral: true });
  }

  if (action === "unlimited") {
    await setRoomLimit(guild, channel, interaction.user.id, 0);
    return interaction.reply({ content: "♾️ User limit removed.", ephemeral: true });
  }

  return interaction.reply({ content: "Unknown Voice Domain control.", ephemeral: true });
}

if (!requireAdmin(interaction)) return;

if (interaction.customId === "inf_health") {
      await interaction.deferReply({ ephemeral:true });
      const health = await auditGuildHealth(guild, cfg);
      const issues = health.issues.length
        ? health.issues.map(i => `${i.severity === "critical" ? "🔴" : "🟡"} **${i.code}** — ${i.text}`).join("\n").slice(0, 3500)
        : "✅ No runtime permission/infrastructure problems detected.";
      return interaction.editReply({ embeds:[new EmbedBuilder()
        .setTitle(`🩺 Aegis Health • ${health.critical ? "CRITICAL" : health.healthy ? "HEALTHY" : "WARNING"}`)
        .setDescription(issues)
        .setColor(health.critical ? 0xed4245 : health.healthy ? 0x57f287 : 0xfee75c)
        .setTimestamp()] });
    }

    if (interaction.customId === "inf_threats") {
      const threats = topThreatsForGuild(guild.id, cfg.threatCorrelation, 10);
      const body = threats.length ? threats.map(t =>
        `<@${t.userId}> • **${t.level.toUpperCase()} ${t.score}** • ${t.count} action(s)\n↳ ${t.types.join(", ")}`
      ).join("\n\n").slice(0,3900) : "✅ No correlated audit-log threats are active in the current Aegis window.";
      return interaction.reply({ embeds:[new EmbedBuilder().setTitle("⚠️ Live Aegis Threats").setDescription(body).setColor(threats.length ? 0xffa500 : 0x57f287).setTimestamp()], ephemeral:true });
    }

    if (interaction.customId === "inf_emergency") {
      if (!requireOwner(interaction, guild)) return;
      await interaction.deferUpdate();
      const result = cfg.emergency.active
        ? await deactivateEmergency(guild, cfg)
        : await activateEmergency(guild, cfg, interaction.user.id);
      const panel = await commandCenterEmbed(guild, cfg);
      await interaction.editReply({ embeds:[panel], components:controlRows(cfg) });
      return interaction.followUp({
        content: cfg.emergency.active
          ? `🚨 **DOMAIN EXPANSION: AEGIS EMERGENCY**\nText locked: **${result.textLocked || 0}** • Voice locked: **${result.voiceLocked || 0}**`
          : `🔓 **Emergency ended.** Text restored: **${result.textUnlocked || 0}** • Voice restored: **${result.voiceUnlocked || 0}**`,
        ephemeral:true
      });
    }

    if (interaction.customId === "inf_backup") {
      if (!requireOwner(interaction, guild)) return;
      await interaction.deferReply({ ephemeral:true });
      const backup = await createBackup(guild, cfg.backups.maxBackups);
      cfg.backups.lastBackupAt = Date.now();
      commit();
      return interaction.editReply(`💾 **Recovery snapshot created:** \`${backup.id}\`\nSHA-256 integrity attached. Six Eyes saved the Domain.`);
    }

    if (interaction.customId === "inf_repair") {
      if (!requireOwner(interaction, guild)) return;
      await interaction.deferReply({ ephemeral:true });
      const setup = await autoSetupGuild(guild, false);
      const self = await assessSelfProtection(guild).catch(() => null);
      if (self) rememberSelfProtection(cfg, guild, self);
      let backup = null;
      if (cfg.backups?.enabled) backup = await createBackup(guild, cfg.backups.maxBackups).catch(() => null);
      commit();
      return interaction.editReply(
        `🛠️ **Infinity repair complete.**\n` +
        `Logs: ${setup.logChannel ? "✅" : "⚠️"} • Channels scanned: **${setup.scan?.total || 0}**\n` +
        `Self-Guard: **${self ? protectionSummary(self) : "UNKNOWN"}**\n` +
        `Recovery backup: **${backup ? `\`${backup.id}\`` : "not created"}**`
      );
    }

    if (interaction.customId === "inf_report") {
      const r = reportForGuild(guild.id, 24);
      return interaction.reply({ embeds:[new EmbedBuilder()
        .setTitle("📊 Infinity Security Report • 24h")
        .setDescription(`**Incidents:** ${r.incidents.length}\n**Timeout actions:** ${r.timeouts}\n**Pending appeals:** ${r.pendingAppeals}\n**Active mediations:** ${r.activeMediations}`)
        .addFields({name:"By category",value:compactCounts(r.byCategory)},{name:"Actions",value:compactCounts(r.byAction)})
        .setColor(0x7dd3fc).setTimestamp()], ephemeral:true });
    }

    if (interaction.customId === "inf_aura") {
      const order = ["subtle", "balanced", "overdrive"];
      const current = order.indexOf(String(cfg.aura.intensity || "overdrive"));
      cfg.aura.intensity = order[(current + 1) % order.length];
      commit();
      await interaction.deferUpdate();
      const panel = await commandCenterEmbed(guild, cfg);
      await interaction.editReply({ embeds:[panel], components:controlRows(cfg) });
      return interaction.followUp({ content:`✨ Aura intensity: **${cfg.aura.intensity.toUpperCase()}**\n**${auraStatusLine(cfg)}**`, ephemeral:true });
    }

    if (interaction.customId === "inf_selfguard") {
      await interaction.deferReply({ ephemeral:true });
      const self = await assessSelfProtection(guild, { fetchMembers:true });
      rememberSelfProtection(cfg, guild, self);
      commit();
      const exposed = self.dangerousMembers.length
        ? self.dangerousMembers.slice(0,10).map(m => `<@${m.id}> via <@&${m.highestRoleId}> • ${[m.administrator?"ADMIN":null,m.kick?"KICK":null,m.ban?"BAN":null].filter(Boolean).join("/")}`).join("\n")
        : "✅ No non-owner member above Infinity currently has combined Administrator/Kick/Ban.";
      const embed = new EmbedBuilder()
        .setTitle(`🛡️ Infinity Self-Guard • ${self.status}`)
        .setDescription(
          `${self.text}\n\n` +
          `**Infinity highest role:** <@&${self.botRoleId}> • position ${self.botRolePosition}\n\n` +
          `**Roles that may remove Infinity:**\n${exposed}\n\n` +
          `**Important:** the Discord server owner can always remove an app/bot. There is no API setting that makes a bot absolutely unkickable or unbannable. ` +
          `For strongest protection, place Infinity's highest role above every non-owner moderation role with Kick/Ban/Administrator.`
        )
        .setColor(self.protectedFromStaff ? 0x57f287 : 0xffa500)
        .setFooter({text:"Self-Guard prevents false claims: role hierarchy reduces staff exposure; owner authority cannot be bypassed."})
        .setTimestamp();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Recovery Invite").setEmoji("🔗").setStyle(ButtonStyle.Link).setURL(buildReinviteUrl(CLIENT_ID))
      );
      return interaction.editReply({ embeds:[embed], components:[row] });
    }

    if (interaction.customId === "inf_review") {
      if (!requireOwner(interaction, guild)) return;
      const appeals = pendingForGuild(guild.id, 6);
      const mediations = activeCasesForGuild(guild.id).slice(-6).reverse();
      const incidents = recentForGuild(guild.id, 6);

      const embed = new EmbedBuilder()
        .setTitle("👑 Infinity Owner Review Center")
        .setDescription("Quick owner dashboard. Use `/review appeal` or `/review incident` for full case controls.")
        .addFields(
          { name: "📩 Pending appeals", value: appeals.length ? appeals.map(a => `\`${a.id}\` • <@${a.userId}>`).join("\n") : "None" },
          { name: "🤝 Active mediations", value: mediations.length ? mediations.map(m => `\`${m.id}\` • ${m.status}`).join("\n") : "None" },
          { name: "👁️ Recent incidents", value: incidents.length ? incidents.map(i => `\`${i.id}\` • ${i.category}`).join("\n") : "None" }
        )
        .setColor(0x7dd3fc)
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.customId === "inf_score") {
      await interaction.deferReply({ ephemeral: true });
      const result = await calculateSecurityScore(guild, cfg, client, { aiConfigured: Boolean(GEMINI_API_KEY) });
      const bad = result.checks.filter(item => !item.ok);
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`💯 Security Score • ${result.score}/100`)
            .setDescription(bad.length ? bad.slice(0, 8).map(item => `⚠️ **-${item.penalty}** ${item.label}: ${item.detail}`).join("\n") : "✅ No major configuration gaps detected.")
            .setColor(result.score >= 80 ? 0x57f287 : result.score >= 60 ? 0xfee75c : 0xed4245)
            .setTimestamp()
        ]
      });
    }

    if (interaction.customId === "inf_status") {
      return interaction.reply({ embeds: [statusEmbed(guild, cfg)], ephemeral: true });
    }

    if (interaction.customId === "inf_rescan") {
      await interaction.deferReply({ ephemeral: true });
      const scan = await scanGuildChannels(guild, cfg);
      return interaction.editReply(
        `🔎 **Six Eyes rescan complete**\nScanned: **${scan.total}**\n` +
        `Bot/minigame: **${scan.botInteraction}**\nTrap suspects: **${scan.traps}**`
      );
    }

    if (interaction.customId === "inf_lock") {
      await interaction.deferReply({ ephemeral: true });
      const count = await lockdownGuild(guild, cfg);
      await sendLog(guild, cfg, "Domain Lockdown", `<@${interaction.user.id}> locked **${count}** text channels.`, "danger");
      return interaction.editReply(`🌀 **DOMAIN EXPANSION: SERVER LOCKDOWN**\nLocked **${count}** text channels.`);
    }

    if (interaction.customId === "inf_unlock") {
      await interaction.deferReply({ ephemeral: true });
      const count = await unlockGuild(guild, cfg);
      await sendLog(guild, cfg, "Domain released", `<@${interaction.user.id}> restored **${count}** text channels.`);
      return interaction.editReply(`🔓 Domain released. Restored **${count}** channel permission states.`);
    }

    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "auto-setup") {
    if (!requireAdmin(interaction)) return;
    await interaction.deferReply({ ephemeral: true });

    const preset = interaction.options.getString("preset") || "balanced";
    const mode = interaction.options.getString("mode") || "alert";
    const verification = interaction.options.getBoolean("verification");

    let result;
    try {
      result = await runInstantAutoSetup(guild, {
        preset,
        mode,
        verification
      });
    } catch (error) {
      console.error("Instant Auto-Setup failed:", error);
      return interaction.editReply(
        `❌ **Auto-Setup hit an error.**\n` +
        `Infinity kept the server running, but setup could not finish.\n` +
        `Check my role permissions and \`#bot-logs\`.\n\n` +
        `Error: \`${String(error?.message || error).slice(0, 600)}\``
      );
    }

    const { cfg: configured, setup, backup, selfGuard, health, score } = result;
    const issues = (health.issues || []).slice(0, 5);
    const issueText = issues.length
      ? issues.map(item => `• ${item.severity === "critical" ? "🚨" : "⚠️"} ${item.text}`).join("\n")
      : "✅ No critical setup problems detected.";

    const embed = new EmbedBuilder()
      .setTitle("∞ INFINITY INSTANT AUTO-SETUP")
      .setDescription(
        `**${auraStatusLine(configured)}**\n\n` +
        `One command. Full Domain deployment.`
      )
      .setColor(health.critical ? 0xffa500 : 0x7dd3fc)
      .addFields(
        { name: "🛡️ Security", value: `${configured.securityPreset.toUpperCase()} • ${configured.mode.toUpperCase()}`, inline: true },
        { name: "💯 Score", value: `${score.score}/100`, inline: true },
        { name: "📜 Bot Logs", value: setup.logChannel ? `${setup.logChannel}` : "⚠️ Missing", inline: true },
        { name: "👁️ Channel Scan", value: `${setup.scan?.total || 0} scanned\n${setup.scan?.traps || 0} trap suspect(s)\n${setup.scan?.botInteraction || 0} bot/minigame`, inline: true },
        { name: "🎙️ Voice Domain", value: configured.voiceDomain.enabled ? "✅ READY" : "OFF", inline: true },
        { name: "✅ Verification", value: configured.verification.enabled ? "✅ ON" : "⚪ OFF", inline: true },
        { name: "🧠 AI Guard", value: GEMINI_API_KEY ? "✅ Gemini + local" : "⚪ Local security only", inline: true },
        { name: "💾 Recovery", value: backup ? `✅ ${backup.id}` : "⚠️ Backup failed", inline: true },
        { name: "🛡️ Self-Guard", value: selfGuard ? protectionSummary(selfGuard) : "⚪ UNKNOWN", inline: true },
        { name: "🩺 Health Check", value: issueText.slice(0, 1024), inline: false }
      )
      .setFooter({ text: "Infinity Security v13.1 • Auto-Setup complete" })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  if (interaction.commandName === "setup") {
    if (!requireAdmin(interaction)) return;
    await interaction.deferReply({ ephemeral: true });

    const { logChannel, scan } = await autoSetupGuild(guild, true);

    if (!logChannel) {
      return interaction.editReply(
        "❌ I couldn't create/find `#bot-logs`. Check permissions."
      );
    }

    return interaction.editReply(
      `✅ **Infinity Security v11 Aegis auto-setup complete.**\n` +
      `👁️ Scanned: **${scan.total} channels**\n` +
      `🤖 Bot/minigame channels: **${scan.botInteraction}**\n` +
      `🍯 Honeypot/trap suspects: **${scan.traps}**\n` +
      `🤝 AI dispute mediation: **ON**\n` +
      `🔗 Scam/Link Shield: **ON**\n` +
      `👻 Ghost-Ping + Edit/Delete Logs: **ON**\n` +
      `🎙️ Voice Guard + Voice Raid Shield: **ON**\n` +
      `👁️ Join-to-Create Voice Domains: **${cfg.voiceDomain.enabled ? "ON" : "OFF"}**\n` +
      `📩 Appeals + Owner Review: **ON**\n` +
      `🛡️ Permission Guard: **${cfg.permissionGuard.enabled ? "ON" : "OFF"}**\n` +
      `✅ Verification Gate: **${cfg.verification.enabled ? "ON" : "OPTIONAL/OFF"}**\n` +
      `💾 Recovery Backups: **READY**\n` +
      `🚨 Emergency Mode: **READY**\n` +
      `📜 Logs: ${logChannel}\n` +
      `⏱️ Punishment policy: **TIMEOUT ONLY**\n` +
      `📩 Owner: **DM on timeouts, appeals and dispute cases**`
    );
  }

  if (interaction.commandName === "boss") {
    return handleServerBossCommand(interaction);
  }

  if (interaction.commandName === "cursedrealms") {
    return openCursedRealms(interaction);
  }

  if (interaction.commandName === "cursedduel") {
    const opponent = interaction.options.getUser("opponent", true);
    return challengeCursedDuel(interaction, opponent);
  }

  if (interaction.commandName === "rescan") {
    if (!requireAdmin(interaction)) return;
    await interaction.deferReply({ ephemeral: true });
    const scan = await scanGuildChannels(guild, cfg);
    return interaction.editReply(
      `🔎 **Six Eyes channel scan complete**\nTotal: **${scan.total}**\n` +
      `Bot/minigame: **${scan.botInteraction}**\nTrap suspects: **${scan.traps}**`
    );
  }

  if (interaction.commandName === "status") {
    return interaction.reply({ embeds: [statusEmbed(guild, cfg)], ephemeral: true });
  }

  if (interaction.commandName === "panel") {
    if (!requireAdmin(interaction)) return;
    await interaction.deferReply({ ephemeral:true });
    const panel = await commandCenterEmbed(guild, cfg);
    return interaction.editReply({ embeds:[panel], components:controlRows(cfg) });
  }

  if (interaction.commandName === "security") {
    if (!requireAdmin(interaction)) return;
    cfg.mode = interaction.options.getString("mode", true);
    commit();
    return interaction.reply({
      content:
        cfg.mode === "enforce"
          ? `🌀 **ENFORCE ACTIVE**\n**${auraEventLine("emergency", cfg)}**\n\nConfirmed violations receive **timeouts only**.\n**DOMAIN PRESSURE**  ${auraMeter("high")}`
          : `👁️ **ALERT ACTIVE**\n**${auraStatusLine(cfg)}**\n\nSix Eyes watches and logs without automatic timeouts.\n**DOMAIN PRESSURE**  ${auraMeter("guarded")}`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "ai") {
    if (!requireAdmin(interaction)) return;
    cfg.aiGuard.mode = interaction.options.getString("mode", true);
    commit();
    return interaction.reply({
      content:
        `🤖 AI Guard: **${cfg.aiGuard.mode.toUpperCase()}**` +
        (!GEMINI_API_KEY && cfg.aiGuard.mode !== "off"
          ? "\n⚠️ No Gemini key set; local detection remains active."
          : "") +
        "\nBot/minigame interactions stay exempt from repetition/rate spam logic.",
      ephemeral: true
    });
  }

  if (interaction.commandName === "aura") {
    if (!requireAdmin(interaction)) return;

    const clips = interaction.options.getBoolean("clips");
    const publicReplies = interaction.options.getBoolean("public_replies");
    const offenderDms = interaction.options.getBoolean("offender_dms");
    const auraIntensity = interaction.options.getString("intensity");

    if (clips !== null) cfg.aura.clips = clips;
    if (publicReplies !== null) cfg.aura.publicReplies = publicReplies;
    if (offenderDms !== null) cfg.aura.offenderDms = offenderDms;
    if (auraIntensity) cfg.aura.intensity = auraIntensity;
    commit();

    return interaction.reply({
      content:
        `✨ **Aura updated**\nClips: **${cfg.aura.clips ? "ON" : "OFF"}**\n` +
        `Public catches: **${cfg.aura.publicReplies ? "ON" : "OFF"}**\n` +
        `Caught-user DMs: **${cfg.aura.offenderDms ? "ON" : "OFF"}**\n` +
        `Intensity: **${String(cfg.aura.intensity || "overdrive").toUpperCase()}** ✨\n` +
        `Owner dispute reports: **ALWAYS ON**\n\n` +
        `**${auraStatusLine(cfg)}**`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "edit") {
    if (!requireAdmin(interaction)) return;
    const sub = interaction.options.getSubcommand();
    cfg.reactionClips ||= { enabled: true, chance: 0.65, criticalBoost: 0.15, cooldownMs: 18000, disabledClipIds: [], categoryOverrides: {} };
    cfg.reactionClips.disabledClipIds ||= [];
    cfg.reactionClips.categoryOverrides ||= {};

    if (sub === "list") {
      const rows = clipSummary(cfg).map(clip =>
        `${clip.enabled ? "✅" : "❌"} ${clip.emoji} **${clip.label}** \`${clip.id}\`\n` +
        `↳ ${clip.effectiveTags.join(" • ")}`
      ).join("\n\n");
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle("🎬 Infinity Edit Library")
          .setDescription(`${rows}\n\n**Autoplay:** ${cfg.reactionClips.enabled !== false ? "ON" : "OFF"}\n**Frequency:** ${Math.round(Number(cfg.reactionClips.chance ?? 0.65) * 100)}%\n**Critical boost:** +${Math.round(Number(cfg.reactionClips.criticalBoost ?? 0.15) * 100)}%\n\nAll bundled edits are MP4 files with audio.`)
          .setColor(0x7c3aed)
          .setFooter({ text: "Infinity Security • Edit Engine" })],
        ephemeral: true
      });
    }
    if (sub === "test") {
      const clipId = interaction.options.getString("clip", true);
      await interaction.deferReply({ ephemeral: true });
      const sent = await sendReactionClip(interaction.channel, "general", cfg, { force: true, clipId, caption: `🎬 **INFINITY EDIT TEST • ${clipId.toUpperCase().replaceAll("_", " ")}**` });
      return interaction.editReply(sent ? "✅ Edit posted with its audio track." : "❌ I could not post that edit here. Check Attach Files / Send Messages permissions.");
    }
    if (sub === "frequency") { const percent = interaction.options.getInteger("percent", true); cfg.reactionClips.chance = percent / 100; commit(); return interaction.reply({ content: `🎬 Automatic edit frequency: **${percent}%**. Critical catches can still receive the configured bonus chance.`, ephemeral: true }); }
    if (sub === "autoplay") { const enabled = interaction.options.getBoolean("enabled", true); cfg.reactionClips.enabled = enabled; commit(); return interaction.reply({ content: `🎬 Reaction edits: **${enabled ? "ON" : "OFF"}**.`, ephemeral: true }); }
    if (sub === "clip") { const clipId = interaction.options.getString("clip", true); const enabled = interaction.options.getBoolean("enabled", true); cfg.reactionClips.disabledClipIds = cfg.reactionClips.disabledClipIds.filter(id => id !== clipId); if (!enabled) cfg.reactionClips.disabledClipIds.push(clipId); commit(); return interaction.reply({ content: `${enabled ? "✅" : "❌"} \`${clipId}\` is now **${enabled ? "ENABLED" : "DISABLED"}**.`, ephemeral: true }); }
    if (sub === "category") { const clipId = interaction.options.getString("clip", true); const category = interaction.options.getString("category", true); cfg.reactionClips.categoryOverrides[clipId] = category; commit(); return interaction.reply({ content: `🗂️ \`${clipId}\` now strongly prefers **${category}** events. Its original fallback tags stay available.`, ephemeral: true }); }
    if (sub === "sort") { cfg.reactionClips.categoryOverrides = {}; cfg.reactionClips.disabledClipIds = []; cfg.reactionClips.enabled = true; cfg.reactionClips.chance = 0.65; commit(); return interaction.reply({ content: "🧠 **Smart Edit Sorting restored.** Raid Convoy → raid/anti-nuke, purple edits → critical/timeout/scam, calm Gojo → general/mediation.", ephemeral: true }); }
  }

  if (interaction.commandName === "botinteraction") {
    if (!requireAdmin(interaction)) return;
    const sub = interaction.options.getSubcommand();

    if (sub === "addbot" || sub === "removebot") {
      const user = interaction.options.getUser("bot", true);
      if (!user.bot) {
        return interaction.reply({ content: "❌ That account is not a Discord bot.", ephemeral: true });
      }

      if (sub === "addbot") {
        if (!cfg.botInteractions.trustedBotIds.includes(user.id)) cfg.botInteractions.trustedBotIds.push(user.id);
        commit();
        return interaction.reply({ content: `🤖 ${user} is now trusted as an interaction/minigame bot.`, ephemeral: true });
      }

      cfg.botInteractions.trustedBotIds = cfg.botInteractions.trustedBotIds.filter(id => id !== user.id);
      commit();
      return interaction.reply({ content: `👁️ ${user} removed from the explicit interaction-bot list.`, ephemeral: true });
    }

    if (sub === "addchannel" || sub === "removechannel") {
      const channel = interaction.options.getChannel("channel", true);

      if (sub === "addchannel") {
        if (!cfg.botInteractions.trustedChannelIds.includes(channel.id)) cfg.botInteractions.trustedChannelIds.push(channel.id);
        setManualChannelPolicy(cfg, channel.id, "bot_interaction", "Manually trusted bot/minigame channel");
        return interaction.reply({
          content: `🎮 ${channel} is now a **bot/minigame channel**. Rapid/repeated bot commands are allowed.`,
          ephemeral: true
        });
      }

      cfg.botInteractions.trustedChannelIds = cfg.botInteractions.trustedChannelIds.filter(id => id !== channel.id);
      setManualChannelPolicy(cfg, channel.id, "normal", "Returned to normal monitoring");
      return interaction.reply({ content: `✅ ${channel} returned to normal monitoring.`, ephemeral: true });
    }

    const counts = channelPolicyCounts(cfg);
    const trustedBots = cfg.botInteractions.trustedBotIds.length
      ? cfg.botInteractions.trustedBotIds.map(id => `<@${id}>`).join(", ")
      : "None";

    return interaction.reply({
      content:
        `🤖 **Bot Interaction Shield**\nAuto-detected bot/minigame channels: **${counts.botInteraction}**\n` +
        `Explicit trusted bots: ${trustedBots}\nKnown text prefixes: **${cfg.botInteractions.prefixes.join(", ")}**`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "channelpolicy") {
    if (!requireAdmin(interaction)) return;
    const channel = interaction.options.getChannel("channel", true);
    const policy = interaction.options.getString("policy", true);

    setManualChannelPolicy(cfg, channel.id, policy, `Manual override by ${interaction.user.tag}`);

    if (policy === "bot_interaction" && !cfg.botInteractions.trustedChannelIds.includes(channel.id)) {
      cfg.botInteractions.trustedChannelIds.push(channel.id);
    }
    if (policy !== "bot_interaction") {
      cfg.botInteractions.trustedChannelIds = cfg.botInteractions.trustedChannelIds.filter(id => id !== channel.id);
    }
    commit();

    return interaction.reply({
      content:
        policy === "trap"
          ? `🍯 ${channel} marked **HONEYPOT/TRAP**. Infinity stays silent there.`
          : policy === "bot_interaction"
            ? `🎮 ${channel} marked **BOT/MINIGAME**. Rapid bot interaction is allowed.`
            : `✅ ${channel} marked **NORMAL**.`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "whitelist") {
    if (!requireAdmin(interaction)) return;
    const sub = interaction.options.getSubcommand();

    if (sub === "list") {
      return interaction.reply({
        content:
          `🛡️ **Trusted users**\n` +
          (cfg.whitelist.length ? cfg.whitelist.map(id => `<@${id}>`).join("\n") : "None"),
        ephemeral: true
      });
    }

    const user = interaction.options.getUser("user", true);

    if (sub === "add") {
      if (!cfg.whitelist.includes(user.id)) cfg.whitelist.push(user.id);
      commit();
      return interaction.reply({ content: `✅ ${user} is now trusted by the Six Eyes.`, ephemeral: true });
    }

    if (user.id === guild.ownerId) {
      return interaction.reply({ content: "❌ The server owner stays trusted.", ephemeral: true });
    }

    cfg.whitelist = cfg.whitelist.filter(id => id !== user.id);
    commit();
    return interaction.reply({ content: `👁️ ${user} is visible to security again.`, ephemeral: true });
  }

  if (interaction.commandName === "trustedrole") {
    if (!requireAdmin(interaction)) return;
    const sub = interaction.options.getSubcommand();
    if (sub === "list") {
      const roles = cfg.trustedRoleIds?.filter(id => guild.roles.cache.has(id)) || [];
      return interaction.reply({
        content: `🛡️ **Trusted roles**\n${roles.length ? roles.map(id => `<@&${id}>`).join("\n") : "None"}`,
        ephemeral: true
      });
    }
    const role = interaction.options.getRole("role", true);
    if (role.id === guild.roles.everyone.id) {
      return interaction.reply({ content: "❌ `@everyone` cannot be a trusted security role.", ephemeral: true });
    }
    if (sub === "add") {
      if (!cfg.trustedRoleIds.includes(role.id)) cfg.trustedRoleIds.push(role.id);
      commit();
      return interaction.reply({ content: `✅ ${role} is now trusted by Six Eyes.`, ephemeral: true });
    }
    cfg.trustedRoleIds = cfg.trustedRoleIds.filter(id => id !== role.id);
    commit();
    return interaction.reply({ content: `👁️ ${role} is no longer trusted.`, ephemeral: true });
  }

  if (interaction.commandName === "mediation") {
    if (!requireAdmin(interaction)) return;
    const sub = interaction.options.getSubcommand();

    if (sub === "case") {
      const id = interaction.options.getString("id", true).toUpperCase();
      const item = getCase(id);
      if (!item || item.guildId !== guild.id) {
        return interaction.reply({ content: "❌ Mediation case not found on this server.", ephemeral: true });
      }

      const state = item.mediatorState || {};
      const stats = mediationEvidenceStats(item);
      const claims = (state.claims || []).slice(0, 6).map(claim =>
        `• <@${claim.claimantUserId}> **${claim.status}** — ${claim.statement}`
      ).join("\n") || "No structured claims yet.";
      const questions = (state.openQuestions || []).slice(0, 5).map(q => `• ${q}`).join("\n") || "None";
      const contradictions = (state.contradictions || []).slice(0, 5).map(c => `• ${c.description}`).join("\n") || "None";

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`🤝 AI Mediation • ${item.id}`)
            .setDescription(
              `<@${item.users[0]}> ↔ <@${item.users[1]}>\n` +
              `**Status:** ${item.status}\n**Phase:** ${state.phase || "intake"}\n` +
              `**Verified Discord evidence:** ${stats.verifiedDiscord}\n` +
              `**Evidence findings:** ${stats.total}\n**Contradictions:** ${stats.contradictions}\n` +
              `**Open questions:** ${stats.openQuestions}\n` +
              `${item.finalJuryConsensus ? `**Final jury:** ${item.finalJuryConsensus}\n` : ""}`
            )
            .addFields(
              { name: "Claims", value: claims.slice(0, 1000) },
              { name: "Open questions", value: questions.slice(0, 1000) },
              { name: "Contradictions", value: contradictions.slice(0, 1000) }
            )
            .setColor(0x7dd3fc)
            .setTimestamp()
        ],
        ephemeral: true
      });
    }

    const active = activeCasesForGuild(guild.id).slice(-10).reverse();
    const body = active.length
      ? active.map(item => {
          const phase = item.mediatorState?.phase || "intake";
          const verified = mediationEvidenceStats(item).verifiedDiscord;
          return `\`${item.id}\` • **${item.status}** • ${phase} • ✅${verified} • <@${item.users[0]}> ↔ <@${item.users[1]}>`;
        }).join("\n")
      : "No active mediation cases.";

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🤝 Infinity AI Mediation Cases")
          .setDescription(body)
          .setFooter({ text: "Use /mediation case id:<ID> for claims, evidence and contradictions" })
          .setColor(0x7dd3fc)
          .setTimestamp()
      ],
      ephemeral: true
    });
  }

if (interaction.commandName === "voice") {
  const sub=interaction.options.getSubcommand();
  const member=await guild.members.fetch(interaction.user.id).catch(()=>null);
  if(sub==="stats"){const target=interaction.options.getUser("user")||interaction.user,st=getVoiceStats(guild.id,target.id),x=voiceXpFromMs(st.totalMs,cfg);return interaction.reply({embeds:[new EmbedBuilder().setTitle(`🎙️ Voice Stats • ${target.username}`).setDescription(`**XP:** ${x.xp}\n**Level:** ${x.level}\n**Total:** ${formatDuration(st.totalMs)}\n**Sessions:** ${st.sessions||0}\n**Longest:** ${formatDuration(st.longestMs||0)}\n**Current:** ${st.active?formatDuration(st.currentSessionMs):"Not in voice"}`).setColor(0x7dd3fc).setFooter({text:"No audio is recorded"})],ephemeral:true});}
  if(sub==="leaderboard"){const b=getVoiceLeaderboard(guild.id,10),body=b.length?b.map((x,n)=>{const r=voiceXpFromMs(x.totalMs,cfg);return `**${n+1}.** <@${x.userId}> • Lv.${r.level} • ${r.xp} XP • ${formatDuration(x.totalMs)}`}).join("\n"):"No Voice XP yet.";return interaction.reply({embeds:[new EmbedBuilder().setTitle("🏆 Infinity Voice Leaderboard").setDescription(body).setColor(0x7dd3fc)]});}
  if(sub==="knock"||sub==="queue"){const target=interaction.options.getChannel("channel",true);if(sub==="knock"){const r=await requestKnock(guild,target,interaction.user,cfg);if(!r.ok)return interaction.reply({content:r.reason==="blocked"?"🚫 Blocked from that Domain.":r.reason==="open"?"🔓 Room is already open.":"❌ Knock failed.",ephemeral:true});const room=getRoom(guild.id,target.id);const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`vknock_allow_${target.id}_${interaction.user.id}`).setLabel("Allow").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`vknock_deny_${target.id}_${interaction.user.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger));await target.send({content:`🚪 <@${room.ownerId}> — <@${interaction.user.id}> is knocking. **${voiceLine("knock")}**`,components:[row]}).catch(()=>{});if(r.repeated)await sendLog(guild,cfg,"Voice Intruder Alert",`<@${interaction.user.id}> knocked on ${target} **${r.count} times in one minute**. No automatic punishment was applied.`,`warn`);return interaction.reply({content:"🚪 Knock sent.",ephemeral:true});}const q=await joinQueue(guild,target,interaction.user.id);return interaction.reply({content:q.ok?`⏳ Queue position: **#${q.position}**.`:q.reason==="space"?"✅ There is space — join now.":"❌ Queue failed.",ephemeral:true});}
  if(!member?.voice?.channel)return interaction.reply({content:"🎙️ Join voice first.",ephemeral:true});
  const channel=member.voice.channel,room=getRoom(guild.id,channel.id);
  if(["teams","match","tournament"].includes(sub)){const currentManaged=getRoom(guild.id,channel.id);const canOrganize=currentManaged?hasRoomControl(guild.id,channel.id,interaction.user.id):Boolean(interaction.memberPermissions?.has(PermissionsBitField.Flags.MoveMembers));if(!canOrganize)return interaction.reply({content:"🛡️ Only the Voice Domain owner/Co-Owner or a moderator with **Move Members** can reorganize a whole VC.",ephemeral:true});await interaction.deferReply({ephemeral:true});let r;if(sub==="teams")r=await createTeamRooms(guild,channel,interaction.options.getInteger("count",true),cfg,client.user?.id,"Team");else if(sub==="match")r=await createMatchRooms(guild,channel,interaction.options.getString("mode",true),cfg,client.user?.id);else r=await createTeamRooms(guild,channel,interaction.options.getInteger("teams",true),cfg,client.user?.id,"Tournament");return interaction.editReply(r.ok?`⚔️ **${voiceLine("team")}** Created ${r.channels.length} team rooms.`:"❌ Not enough people / room creation failed.");}
  if(!room)return interaction.reply({content:"This is not an Infinity temporary Voice Domain.",ephemeral:true});
  if(sub==="claim"){const r=await claimRoom(guild,channel,interaction.user.id);return interaction.reply({content:r.ok?"👑 Domain claimed.":r.reason==="owner_present"?"❌ Owner is still here.":"❌ Cannot claim.",ephemeral:true});}
  if(sub==="scan"){const risk=[];if(room.ownerId&&!channel.members.has(room.ownerId))risk.push("Owner absent");if(room.panic)risk.push("Panic mode");if(room.queue.length)risk.push(`${room.queue.length} queued`);if(Object.keys(room.pendingKnocks||{}).length)risk.push("Pending knocks");return interaction.reply({embeds:[new EmbedBuilder().setTitle("👁️ Six Eyes Voice Scan").setDescription(`Members: **${channel.members.size}**\nLocked: **${room.locked?"YES":"NO"}**\nHidden: **${room.hidden?"YES":"NO"}**\nPreset: **${room.preset}**\nQueue: **${room.queue.length}**\nBlocked: **${room.blocklist.length}**\n\n${risk.length?"⚠️ "+risk.join("\n⚠️ "):"✅ No obvious problems."}`).setColor(risk.length?0xffa500:0x57f287)] ,ephemeral:true});}
  if(!hasRoomControl(guild.id,channel.id,interaction.user.id))return interaction.reply({content:"👁️ Only owner/Co-Owner can control this Domain.",ephemeral:true});
  if(sub==="panel")return interaction.reply({embeds:[new EmbedBuilder().setTitle("👁️ Voice Domain Control").setDescription(`Owner: <@${room.ownerId}>\nCo-Owners: ${(room.coOwners||[]).map(id=>`<@${id}>`).join(", ")||"None"}\nLocked: **${room.locked?"YES":"NO"}**\nHidden: **${room.hidden?"YES":"NO"}**\nPanic: **${room.panic?"YES":"NO"}**\nLimit: **${channel.userLimit||"∞"}**\nPreset: **${room.preset}**\nQueue: **${room.queue.length}**`).setColor(0x7dd3fc)],components:roomControls(channel.id),ephemeral:true});
  if(sub==="name")return interaction.reply({content:await renameRoom(guild,channel,interaction.user.id,interaction.options.getString("name",true))?"✏️ Renamed.":"❌ Failed.",ephemeral:true});
  if(sub==="limit")return interaction.reply({content:await setRoomLimit(guild,channel,interaction.user.id,interaction.options.getInteger("amount",true))?"👥 Limit updated.":"❌ Failed.",ephemeral:true});
  if(sub==="permit"||sub==="revoke"){const u=interaction.options.getUser("user",true);return interaction.reply({content:await permitUser(guild,channel,interaction.user.id,u.id,sub==="permit")?"✅ Access updated.":"❌ Failed.",ephemeral:true});}
  if(sub==="coowneradd"||sub==="coownerremove"){if(room.ownerId!==interaction.user.id)return interaction.reply({content:"👑 Only main owner can manage Co-Owners.",ephemeral:true});const u=interaction.options.getUser("user",true);return interaction.reply({content:await addCoOwner(guild,channel,interaction.user.id,u.id,sub==="coowneradd")?"👑 Co-Owner updated.":"❌ Failed.",ephemeral:true});}
  if(sub==="transfer"){if(room.ownerId!==interaction.user.id)return interaction.reply({content:"👑 Only main owner can transfer.",ephemeral:true});const u=interaction.options.getUser("user",true);return interaction.reply({content:await transferOwnership(guild,channel,interaction.user.id,u.id)?`👑 Ownership transferred to ${u}.`:"❌ Failed.",ephemeral:true});}
  if(sub==="block"||sub==="unblock"){const u=interaction.options.getUser("user",true);return interaction.reply({content:await blockUser(guild,channel,interaction.user.id,u.id,sub==="block")?(sub==="block"?`🚫 ${u} blocked.`:`✅ ${u} unblocked.`):"❌ Failed.",ephemeral:true});}
  if(sub==="preset")return interaction.reply({content:await applyPreset(guild,channel,interaction.user.id,interaction.options.getString("preset",true))?"✨ Preset applied.":"❌ Failed.",ephemeral:true});
  if(sub==="panic")return interaction.reply({content:await panicRoom(guild,channel,interaction.user.id)?`🌀 **${voiceLine("panic")}**`:"❌ Failed.",ephemeral:true});
  if(sub==="autoprivate")return interaction.reply({content:setAutoPrivate(guild.id,channel.id,interaction.user.id,interaction.options.getBoolean("enabled",true))?"🔐 Auto Private updated.":"❌ Failed.",ephemeral:true});
  if(sub==="invite"){const u=interaction.options.getUser("user",true);await channel.permissionOverwrites.edit(u.id,{ViewChannel:true,Connect:true}).catch(()=>{});const sent=await u.send(`👁️ <@${interaction.user.id}> invited you to **${channel.name}** on **${guild.name}**. ${voiceLine("allow")}\nhttps://discord.com/channels/${guild.id}/${channel.id}`).then(()=>true).catch(()=>false);return interaction.reply({content:sent?"📩 Invite sent.":"⚠️ Access granted; DM closed.",ephemeral:true});}
}

if (interaction.commandName === "party") {
  const sub=interaction.options.getSubcommand();
  if(sub==="list"){const p=listParties(guild.id).map(x=>({...x,channel:guild.channels.cache.get(x.channelId)})).filter(x=>x.channel);return interaction.reply({embeds:[new EmbedBuilder().setTitle("🎮 Infinity Party Finder").setDescription(p.length?p.slice(0,10).map(x=>`🎮 **${x.game}** • ${x.channel} • <@${x.ownerId}> • ${x.channel.members.size}/${x.maxPlayers}`).join("\n"):"No open parties.").setColor(0x7dd3fc)]});}
  const member=await guild.members.fetch(interaction.user.id).catch(()=>null);if(!member)return interaction.reply({content:"Could not load member.",ephemeral:true});
  if(sub==="create"){await interaction.deferReply({ephemeral:true});const room=await createParty(guild,member,interaction.options.getString("game",true),interaction.options.getInteger("players",true),cfg,client.user?.id);if(!room)return interaction.editReply("❌ Party creation failed.");await interaction.channel.send({embeds:[new EmbedBuilder().setTitle("🎮 Infinity Party Finder").setDescription(`<@${interaction.user.id}> created ${room}. **${voiceLine("open")}**`).setColor(0x7dd3fc)]}).catch(()=>{});return interaction.editReply(`✅ Party created: ${room}`);}
  const owned=listParties(guild.id).find(x=>x.ownerId===interaction.user.id);if(!owned)return interaction.reply({content:"❌ You do not own an open party.",ephemeral:true});const ch=guild.channels.cache.get(owned.channelId);if(ch)await ch.delete("Party closed").catch(()=>{});return interaction.reply({content:"🧹 Party closed.",ephemeral:true});
}

if (interaction.commandName === "voicehub") {
  if (!requireAdmin(interaction)) return;
  const sub = interaction.options.getSubcommand();

  if (sub === "enable") {
    cfg.voiceDomain.enabled = true;
    cfg.voiceDomain.autoCreateHub = true;
    const hub = await ensureVoiceHub(guild, cfg, client.user?.id);
    commit();
    return interaction.reply({
      content: hub ? `👁️ Voice Domain enabled: ${hub}` : "⚠️ Enabled, but I could not create the hub. Check Manage Channels + Move Members.",
      ephemeral: true
    });
  }

  if (sub === "disable") {
    cfg.voiceDomain.enabled = false;
    commit();
    return interaction.reply({
      content: "🎙️ New temporary Voice Domains are disabled. Existing rooms are left untouched until empty.",
      ephemeral: true
    });
  }

  const hub = await ensureVoiceHub(guild, cfg, client.user?.id);
  commit();
  return interaction.reply({
    content: hub
      ? `✅ **Voice Domain hub ready:** ${hub}\nJoin it to create a temporary personal voice room.`
      : "❌ I could not create the Voice Domain hub. Check **Manage Channels** and **Move Members** permissions.",
    ephemeral: true
  });
}

  if (interaction.commandName === "verification") {
    if (!requireAdmin(interaction)) return;
    const sub=interaction.options.getSubcommand();
    if (sub==="status") return interaction.reply({content:`✅ Verification: **${cfg.verification.enabled?"ON":"OFF"}**\nChannel: ${cfg.verification.channelId?`<#${cfg.verification.channelId}>`:"not set"}\nRole: ${cfg.verification.unverifiedRoleId?`<@&${cfg.verification.unverifiedRoleId}>`:"not set"}`,ephemeral:true});
    await interaction.deferReply({ephemeral:true});
    if (sub==="disable") { cfg.verification.enabled=false; commit(); return interaction.editReply("⚪ Verification disabled for future joins. Existing role permissions are left intact so nothing breaks unexpectedly."); }
    cfg.verification.enabled=true;
    const setup=await ensureVerificationSetup(guild,cfg,client.user?.id);
    const restricted=setup.role&&setup.channel ? await applyRestrictionsGuild(guild,cfg) : 0;
    commit();
    return interaction.editReply(setup.role&&setup.channel ? `✅ Verification **enabled**.\nPanel: ${setup.channel}\nRestricted channel permission sets: **${restricted}**\nNew members receive <@&${setup.role.id}> until they solve the code challenge.` : "❌ Setup failed. Check Manage Roles and Manage Channels permissions.");
  }

  if (interaction.commandName === "emergency") {
    if (!requireOwner(interaction,guild)) return;
    const sub=interaction.options.getSubcommand();
    if (sub==="status") return interaction.reply({content:cfg.emergency.active?`🌀 **INNER DOMAIN ACTIVE** since <t:${Math.floor(cfg.emergency.startedAt/1000)}:R>.\n**${auraEventLine("emergency", cfg)}**\n**DOMAIN PRESSURE**  ${auraMeter("critical")}`:`👁️ **Emergency barrier standing by.**\n${auraStatusLine(cfg)}`,ephemeral:true});
    await interaction.deferReply({ephemeral:true});
    if (sub==="on") { const r=await activateEmergency(guild,cfg,interaction.user.id); await sendLog(guild,cfg,"EMERGENCY MODE",`🚨 Activated by <@${interaction.user.id}>. Text locked: **${r.textLocked}**, voice locked: **${r.voiceLocked}**.`,`danger`); return interaction.editReply(r.already?"🌀 **The inner Domain is already active.**":`🌀 **DOMAIN EXPANSION: AEGIS EMERGENCY**\n**${auraEventLine("emergency", cfg)}**\n\nEnforce mode forced ON, public aura silenced, **${r.textLocked}** text and **${r.voiceLocked}** voice channels protected.\n\n**DOMAIN PRESSURE**  ${auraMeter("critical")}`); }
    const r=await deactivateEmergency(guild,cfg); await sendLog(guild,cfg,"Emergency cleared",`Cleared by <@${interaction.user.id}>. Restored text: **${r.textUnlocked}**, voice: **${r.voiceUnlocked}**.`); return interaction.editReply(r.already?"👁️ Emergency barrier was already standing by.":`🔓 **INNER DOMAIN RELEASED**\nBarrier pressure normalized. Restored **${r.textUnlocked}** text and **${r.voiceUnlocked}** voice permission states.\n\n**DOMAIN PRESSURE**  ${auraMeter("guarded")}`);
  }

  if (interaction.commandName === "backup") {
    if (!requireAdmin(interaction)) return;
    const sub = interaction.options.getSubcommand();

    if (sub === "list") {
      const items = listBackups(guild.id).slice(0, 10);
      return interaction.reply({
        content: items.length
          ? `💾 **Recovery backups**
${items.map(b => {
              const v = verifyBackup(b);
              const state = !v.ok ? "❌ corrupt" : v.legacy ? "⚪ legacy" : "✅ verified";
              return `\`${b.id}\` • <t:${Math.floor(b.createdAt / 1000)}:R> • ${b.roles.length} roles / ${b.channels.length} channels • ${state}`;
            }).join("\n")}`
          : "No backups yet. Use `/backup create`.",
        ephemeral: true
      });
    }

    if (sub === "create") {
      await interaction.deferReply({ ephemeral: true });
      const b = await createBackup(guild, cfg.backups.maxBackups);
      cfg.backups.lastBackupAt = b.createdAt;
      commit();
      await sendLog(guild, cfg, "Recovery backup created", `Backup \`${b.id}\` • **${b.roles.length} roles**, **${b.channels.length} channels** • SHA-256 integrity sealed.`);
      return interaction.editReply(`💾 Backup created: \`${b.id}\`
Roles: **${b.roles.length}** • Channels: **${b.channels.length}**
Integrity: **SHA-256 sealed**`);
    }

    const id = interaction.options.getString("id", true).trim().toUpperCase();
    const b = getBackup(guild.id, id);
    if (!b) return interaction.reply({ content: "Backup not found.", ephemeral: true });

    if (sub === "verify") {
      const v = verifyBackup(b);
      return interaction.reply({
        content: v.ok
          ? `✅ Backup \`${b.id}\` integrity: **${v.legacy ? "LEGACY / no digest" : "VERIFIED"}**`
          : `❌ Backup \`${b.id}\` failed SHA-256 integrity verification. Restore is blocked.`,
        ephemeral: true
      });
    }

    if (!requireOwner(interaction, guild)) return;
    const integrity = verifyBackup(b);
    if (!integrity.ok) {
      return interaction.reply({ content: `❌ Backup \`${b.id}\` failed integrity verification. Infinity refuses to restore a modified/corrupt snapshot.`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const r = await restoreBackup(guild, b);
    if (r.integrityError) return interaction.editReply("❌ Restore blocked: backup integrity failed.");
    await sendLog(
      guild, cfg, "Recovery restore",
      `Owner restored \`${b.id}\`. Integrity: **${r.integrity?.legacy ? "legacy" : "verified"}**. Roles updated/created: **${r.rolesUpdated}/${r.rolesCreated}**. Channels updated/created: **${r.channelsUpdated}/${r.channelsCreated}**. Failed operations: **${r.failed}**.`,
      "warn"
    );
    return interaction.editReply(`💾 **Restore complete** from \`${b.id}\`
Integrity: **${r.integrity?.legacy ? "legacy" : "verified"}**
Roles: ${r.rolesUpdated} updated, ${r.rolesCreated} recreated
Channels: ${r.channelsUpdated} updated, ${r.channelsCreated} recreated
Failed/skipped: ${r.failed}`);
  }

  if (interaction.commandName === "reports") {
    if (!requireAdmin(interaction)) return;
    const sub=interaction.options.getSubcommand();
    if (sub==="daily") { cfg.reports.dailyEnabled=interaction.options.getBoolean("enabled",true); commit(); return interaction.reply({content:`📊 Automatic 24h reports: **${cfg.reports.dailyEnabled?"ON":"OFF"}**`,ephemeral:true}); }
    const hours=Number(interaction.options.getString("period",true)); const r=reportForGuild(guild.id,hours);
    return interaction.reply({embeds:[new EmbedBuilder().setTitle(`📊 Infinity Security Report • ${hours===24?"24h":hours===168?"7d":"30d"}`).setDescription(`**Incidents:** ${r.incidents.length}\n**Timeout actions:** ${r.timeouts}\n**Pending appeals:** ${r.pendingAppeals}\n**Active mediations:** ${r.activeMediations}`).addFields({name:"By category",value:compactCounts(r.byCategory)},{name:"Actions",value:compactCounts(r.byAction)}).setColor(0x7dd3fc).setTimestamp()],ephemeral:true});
  }

  if (interaction.commandName === "quarantine") {
    if (!requireAdmin(interaction)) return;
    const user=interaction.options.getUser("user",true); const minutes=interaction.options.getInteger("minutes")||cfg.quarantine.defaultMinutes; const reason=interaction.options.getString("reason",true);
    if (isWhitelisted(guild,user.id)) return interaction.reply({content:"❌ Trusted/owner users cannot be quarantined by Infinity automation.",ephemeral:true});
    await interaction.deferReply({ephemeral:true}); const r=await applyQuarantine(guild,user,cfg,minutes,reason,interaction.user.id); return interaction.editReply(r.ok?`⏱️ ${user} received **${r.actionText}**. Incident: \`${r.incident.id}\``:`❌ Timeout failed. Check bot role position / Moderate Members. Incident: \`${r.incident.id}\``);
  }

  if (interaction.commandName === "release") {
    if (!requireAdmin(interaction)) return;
    const user=interaction.options.getUser("user",true); await interaction.deferReply({ephemeral:true}); const ok=await releaseQuarantine(guild,user,cfg,interaction.user.id); return interaction.editReply(ok?`✅ Timeout removed from ${user}.`:`❌ Could not remove timeout.`);
  }

  if (interaction.commandName === "health") {
    if (!requireAdmin(interaction)) return;
    await interaction.deferReply({ ephemeral:true });
    const health = await auditGuildHealth(guild, cfg);
    const issues = health.issues.length
      ? health.issues.map(i => `${i.severity === "critical" ? "🔴" : "🟡"} **${i.code}** — ${i.text}`).join("\n").slice(0, 3500)
      : "✅ No runtime permission/infrastructure problems detected.";
    return interaction.editReply({ embeds:[new EmbedBuilder()
      .setTitle(`🛡️ Infinity Aegis Health • ${health.critical ? "CRITICAL" : health.healthy ? "HEALTHY" : "WARNING"}`)
      .setDescription(issues)
      .setColor(health.critical ? 0xed4245 : health.healthy ? 0x57f287 : 0xfee75c)
      .setFooter({text:"Health checks detect operational gaps; they do not guarantee attack prevention."})
      .setTimestamp()] });
  }

  if (interaction.commandName === "threats") {
    if (!requireAdmin(interaction)) return;
    const target = interaction.options.getUser("user");
    const threats = topThreatsForGuild(guild.id, cfg.threatCorrelation, 10).filter(t => !target || t.userId === target.id);
    const body = threats.length ? threats.map(t =>
      `<@${t.userId}> • **${t.level.toUpperCase()} ${t.score}** • ${t.count} action(s)\n↳ ${t.types.join(", ")}`
    ).join("\n\n").slice(0, 3900) : "No correlated audit-log threats are active in the current window.";
    return interaction.reply({ embeds:[new EmbedBuilder().setTitle("👁️ Aegis Threat Correlation").setDescription(body).setColor(0x7dd3fc).setFooter({text:`Window: ${Math.round(cfg.threatCorrelation.windowMs/1000)}s • action threshold: ${cfg.threatCorrelation.actionScore}`}).setTimestamp()], ephemeral:true });
  }

  if (interaction.commandName === "selfprotect") {
    if (!requireAdmin(interaction)) return;
    const sub = interaction.options.getSubcommand();

    if (sub === "harden") {
      if (!requireOwner(interaction, guild)) return;
      await interaction.deferReply({ ephemeral:true });
      await autoSetupGuild(guild, false);
      const backup = cfg.backups?.enabled
        ? await createBackup(guild, cfg.backups.maxBackups).catch(() => null)
        : null;
      if (backup) cfg.backups.lastBackupAt = Date.now();
      const self = await assessSelfProtection(guild, { fetchMembers:true });
      rememberSelfProtection(cfg, guild, self);
      commit();

      const exposed = self.dangerousMembers.length
        ? self.dangerousMembers.slice(0,10).map(m => `<@${m.id}> via <@&${m.highestRoleId}>`).join(", ")
        : "None";

      return interaction.editReply(
        `🛡️ **SELF-GUARD HARDENING COMPLETE**\n` +
        `Status: **${self.status}**\n` +
        `Roles above Infinity with Admin/Kick/Ban: ${exposed}\n` +
        `Recovery backup: **${backup ? `\`${backup.id}\`` : "not created"}**\n\n` +
        (self.protectedFromStaff
          ? `✅ Infinity's role hierarchy currently blocks normal staff roles from removing it. The server owner still has ultimate Discord authority.`
          : `⚠️ Move Infinity's highest role above the listed roles. A bot cannot move itself above roles it does not control.`)
      );
    }

    const self = await assessSelfProtection(guild, { fetchMembers:true });
    rememberSelfProtection(cfg, guild, self);
    commit();
    const exposed = self.dangerousMembers.length
      ? self.dangerousMembers.slice(0,10).map(m => `<@${m.id}> via <@&${m.highestRoleId}> • ${[m.administrator?"ADMIN":null,m.kick?"KICK":null,m.ban?"BAN":null].filter(Boolean).join("/")}`).join("\n")
      : "✅ No non-owner member above Infinity currently has combined Administrator/Kick/Ban.";
    return interaction.reply({
      embeds:[new EmbedBuilder()
        .setTitle(`🛡️ Infinity Self-Guard • ${self.status}`)
        .setDescription(`${self.text}\n\n**Infinity role:** <@&${self.botRoleId}> • position ${self.botRolePosition}\n\n${exposed}\n\nThe Discord server owner can always remove bots/apps. Self-Guard minimizes non-owner removal exposure and keeps a recovery route.`)
        .setColor(self.protectedFromStaff ? 0x57f287 : 0xffa500)
        .setTimestamp()],
      components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Recovery Invite").setEmoji("🔗").setStyle(ButtonStyle.Link).setURL(buildReinviteUrl(CLIENT_ID)))],
      ephemeral:true
    });
  }

  if (interaction.commandName === "preset") {
    if (!requireAdmin(interaction)) return;
    const level = interaction.options.getString("level", true);
    if (!applySecurityPreset(cfg, level)) return interaction.reply({content:"Unknown preset.",ephemeral:true});
    commit();
    await sendLog(guild,cfg,"Security preset changed",`<@${interaction.user.id}> changed Infinity to **${level.toUpperCase()}** preset.\nThreat thresholds: high **${cfg.threatCorrelation.highScore}**, action **${cfg.threatCorrelation.actionScore}**, critical **${cfg.threatCorrelation.criticalScore}**.`,"warn");
    return interaction.reply({content:`🛡️ Infinity preset: **${level.toUpperCase()}**.\nThreat correlation: ${cfg.threatCorrelation.highScore}/${cfg.threatCorrelation.actionScore}/${cfg.threatCorrelation.criticalScore} • Anti-Raid joins: ${cfg.antiRaid.maxJoins} • Spam threshold: ${cfg.antiSpam.maxMessages}`,ephemeral:true});
  }

  if (interaction.commandName === "config") {
    if (!requireAdmin(interaction)) return;
    const sub=interaction.options.getSubcommand();
    const modules={antiSpam:cfg.antiSpam.enabled,antiRaid:cfg.antiRaid.enabled,antiNuke:cfg.antiNuke.enabled,aiGuard:cfg.aiGuard.mode!=="off",mediation:cfg.mediation.enabled,linkScanner:cfg.linkScanner.enabled,messageLogs:cfg.messageLogs.enabled,voiceSecurity:cfg.voiceSecurity.enabled,voiceDomain:cfg.voiceDomain.enabled,verification:cfg.verification.enabled,permissionGuard:cfg.permissionGuard.enabled,threatCorrelation:cfg.threatCorrelation.enabled,healthGuard:cfg.healthGuard.enabled,selfProtection:cfg.selfProtection.enabled,reports:cfg.reports.enabled};
    if(sub==="overview") return interaction.reply({content:`⚙️ **Infinity Modules**\n${Object.entries(modules).map(([k,v])=>`${v?"✅":"❌"} **${k}**`).join("\n")}`,ephemeral:true});
    const name=interaction.options.getString("name",true); const enabled=interaction.options.getBoolean("enabled",true);
    if(name==="aiGuard") cfg.aiGuard.mode=enabled?"smart":"off"; else if(cfg[name]&&typeof cfg[name]==="object"&&"enabled" in cfg[name]) cfg[name].enabled=enabled; else return interaction.reply({content:"Unknown module.",ephemeral:true});
    if(name==="verification"&&enabled){ await ensureVerificationSetup(guild,cfg,client.user?.id); await applyRestrictionsGuild(guild,cfg); }
    if(name==="voiceDomain"&&enabled) await ensureVoiceHub(guild,cfg,client.user?.id);
    commit(); return interaction.reply({content:`⚙️ **${name}** is now **${enabled?"ON":"OFF"}**.`,ephemeral:true});
  }

  if (interaction.commandName === "securityscore") {
    if (!requireAdmin(interaction)) return;
    await interaction.deferReply({ ephemeral: true });

    const result = await calculateSecurityScore(guild, cfg, client, {
      aiConfigured: Boolean(GEMINI_API_KEY)
    });

    const good = result.checks.filter(item => item.ok);
    const bad = result.checks.filter(item => !item.ok);
    const grade = result.score >= 90 ? "S" : result.score >= 80 ? "A" : result.score >= 70 ? "B" : result.score >= 60 ? "C" : "D";

    const embed = new EmbedBuilder()
      .setTitle(`👁️ Infinity Security Score • ${result.score}/100 (${grade})`)
      .setDescription(
        result.score >= 90
          ? "The domain is heavily protected. Six Eyes approve."
          : result.score >= 75
            ? "Strong setup. A few gaps can still be tightened."
            : "Infinity found important setup gaps worth fixing."
      )
      .setColor(result.score >= 80 ? 0x57f287 : result.score >= 60 ? 0xfee75c : 0xed4245)
      .addFields(
        {
          name: `✅ Passing checks (${good.length})`,
          value: good.length ? good.slice(0, 10).map(item => `• ${item.label}`).join("\n").slice(0, 1000) : "None"
        },
        {
          name: `⚠️ Improvements (${bad.length})`,
          value: bad.length ? bad.slice(0, 10).map(item => `• **-${item.penalty}** ${item.label}: ${item.detail}`).join("\n").slice(0, 1000) : "No major gaps detected."
        }
      )
      .setFooter({ text: "Score is a configuration audit, not a guarantee against attacks." })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  if (interaction.commandName === "review") {
    if (!requireOwner(interaction, guild)) return;

    const sub = interaction.options.getSubcommand();

    if (sub === "overview") {
      const appeals = pendingForGuild(guild.id, 8);
      const incidents = recentForGuild(guild.id, 8);
      const mediations = activeCasesForGuild(guild.id).slice(-8).reverse();

      const embed = new EmbedBuilder()
        .setTitle("👑 Infinity Owner Review Center")
        .setDescription("Appeals, recent security actions and active disputes — one place, no chaos.")
        .addFields(
          {
            name: `📩 Pending appeals (${appeals.length})`,
            value: appeals.length
              ? appeals.map(item => `\`${item.id}\` • <@${item.userId}> • incident \`${item.incidentId}\``).join("\n").slice(0, 1000)
              : "None"
          },
          {
            name: `🤝 Active disputes (${mediations.length})`,
            value: mediations.length
              ? mediations.map(item => `\`${item.id}\` • <@${item.users[0]}> ↔ <@${item.users[1]}> • ${item.status}`).join("\n").slice(0, 1000)
              : "None"
          },
          {
            name: "👁️ Recent incidents",
            value: incidents.length
              ? incidents.map(item => `\`${item.id}\` • ${item.category} • ${item.action}`).join("\n").slice(0, 1000)
              : "None"
          }
        )
        .setColor(0x7dd3fc)
        .setFooter({ text: "Use /review appeal or /review incident with an ID for details." })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === "appeal") {
      const id = interaction.options.getString("id", true).trim().toUpperCase();
      const appeal = getAppeal(id);
      if (!appeal || appeal.guildId !== guild.id) {
        return interaction.reply({ content: "Appeal not found on this server.", ephemeral: true });
      }

      const incident = getIncident(appeal.incidentId);
      const embed = new EmbedBuilder()
        .setTitle(`📩 Appeal Review • ${appeal.id}`)
        .setDescription(
          `**User:** <@${appeal.userId}>\n` +
          `**Status:** ${appeal.status}\n` +
          `**Incident:** \`${appeal.incidentId}\`\n\n` +
          `**Appeal message:**\n${previewText(appeal.reason, 1000)}`
        )
        .addFields(incident ? incidentEvidenceFields(incident) : [])
        .setColor(0x7dd3fc)
        .setTimestamp(appeal.createdAt);

      return interaction.reply({
        embeds: [embed],
        components: appealReviewButtons(appeal.id, appeal.status !== "pending"),
        ephemeral: true
      });
    }

    if (sub === "incident") {
      const id = interaction.options.getString("id", true).trim().toUpperCase();
      const incident = getIncident(id);
      if (!incident || incident.guildId !== guild.id) {
        return interaction.reply({ content: "Incident not found on this server.", ephemeral: true });
      }

      return interaction.reply({
        embeds: [incidentReviewEmbed(incident)],
        components: incidentReviewButtons(incident.id, Boolean(incident.metadata?.reviewClosed)),
        ephemeral: true
      });
    }
  }

  if (interaction.commandName === "incidents") {
    if (!requireAdmin(interaction)) return;

    const incidents = recentForGuild(guild.id, 8);
    const body = incidents.length
      ? incidents.map(incident =>
          `\`${incident.id}\` • **${incident.category}** • ` +
          `<@${incident.userId || guild.ownerId}> • ${incident.action}`
        ).join("\n")
      : "No incidents yet. Clean domain 😎";

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("∞ Recent Incidents")
          .setDescription(body)
          .setColor(0x7dd3fc)
          .setTimestamp()
      ],
      ephemeral: true
    });
  }

  if (interaction.commandName === "lockdown" || interaction.commandName === "unlock") {
    if (!requireAdmin(interaction)) return;
    await interaction.deferReply({ ephemeral: true });

    if (interaction.commandName === "lockdown") {
      const count = await lockdownGuild(guild, cfg);
      await sendLog(guild, cfg, "Domain Lockdown", `<@${interaction.user.id}> locked **${count}** channels.`, "danger");
      return interaction.editReply(`🌀 **DOMAIN EXPANSION: SERVER LOCKDOWN**\nLocked **${count}** text channels.`);
    }

    const count = await unlockGuild(guild, cfg);
    await sendLog(guild, cfg, "Domain released", `<@${interaction.user.id}> restored **${count}** channels.`);
    return interaction.editReply(`🔓 Domain released. Restored **${count}** channel states.`);
  }
});

client.on("messageCreate", async message => {
  if (!message.guild) return;
  if (!message.author.bot) snapshotMessage(message);
  if (message.author.bot) return;

  const cfg = getConfig(message.guild.id);
  if (!cfg.enabled) return;

  // Messages inside a private mediation channel are handled by the mediator,
  // not by spam/security logic or the public server-boss activity counter.
  const mediationCase = findByChannel(message.channel.id);
  if (mediationCase) {
    await handleMediationMessage(message, mediationCase, cfg);
    return;
  }

  const policy = getChannelPolicy(cfg, message.channel.id);
  const botContext = await detectBotInteraction(message, cfg);

  // Server Boss is a general Discord event, separate from Cursed Realms and security punishment.
  // Staff activity can count too, so this happens before the security whitelist return.
  await recordServerBossMessage(message, {
    policyType: policy.type,
    isBotInteraction: botContext.isBotInteraction
  }).catch(() => {});

  if (isWhitelisted(message.guild, message.author.id)) return;
  const linkScan = cfg.linkScanner.enabled
    ? analyzeMessageLinks(message.content || "")
    : { hasLinks: false, maxRisk: 0, totalRisk: 0, critical: false, reasons: [], results: [] };
  const memberRisk = accountRisk(message.member, {
    hasSuspiciousLink: linkScan.maxRisk >= cfg.linkScanner.logRisk,
    massMentions: message.mentions.users.size + message.mentions.roles.size >= 4 || message.mentions.everyone
  });

  if (linkScan.hasLinks && linkScan.critical) {
    const incident = createIncident({
      guildId: message.guild.id,
      userId: message.author.id,
      category: "scam",
      severity: "critical",
      reason: `Link Shield found a high-risk URL pattern: ${linkScan.reasons.slice(0, 4).join(", ") || "suspicious link"}`,
      action: cfg.mode === "enforce" ? "pending timeout" : "logged",
      metadata: {
        channelId: message.channel.id,
        contentPreview: message.content.slice(0, 500),
        linkReasons: linkScan.reasons,
        linkHosts: linkScan.results.map(item => item.host).filter(Boolean).slice(0, 6),
        linkRisk: linkScan.maxRisk,
        accountRisk: memberRisk
      }
    });

    if (cfg.mode === "enforce") {
      const result = await enforceMessageIncident(message, incident, cfg);
      if (result.acted && canPostPublicly(cfg, message.channel)) {
        await sendAuraCatch(message.channel, message.author.id, incident, cfg);
      }
    } else {
      await sendLog(
        message.guild,
        cfg,
        "Link Shield • high risk",
        `<@${message.author.id}> posted a high-risk link pattern.\n${linkScan.reasons.join(" • ").slice(0, 700)}\nIncident: \`${incident.id}\``,
        "danger"
      );
    }
    return;
  }

  if (
    linkScan.hasLinks &&
    linkScan.maxRisk >= cfg.linkScanner.logRisk &&
    (cfg.aiGuard.mode === "off" || !GEMINI_API_KEY)
  ) {
    await sendLog(
      message.guild,
      cfg,
      "Link Shield watch",
      `<@${message.author.id}> posted a suspicious-looking link, but it did not meet the automatic timeout threshold.\n` +
      `${linkScan.reasons.join(" • ").slice(0, 700)}`,
      "warn"
    );
  }

  // Conflict / insult layer comes before ordinary AI Guard so mutual disputes
  // do not cause both participants to be blindly punished as "harassment".
  if (
    cfg.mediation.enabled &&
    !isTrapChannel(cfg, message.channel.id) &&
    (cfg.mediation.detectInBotChannels || !botContext.isBotInteraction)
  ) {
    const candidate = await observeConflictMessage(message, cfg);

    if (candidate.kind !== "none") {
      // Buffer hostile context before acting. This lets Infinity distinguish a
      // one-sided attack from a dispute that becomes mutual a few messages later.
      await queueConflictReview(message, candidate, cfg);
      return;
    }
  }

  const local = analyzeLocal(message, {
    isBotInteraction: botContext.isBotInteraction,
    botInteractionReason: botContext.reason,
    channelPolicy: policy.type
  });
  local.accountRisk = memberRisk;
  local.linkSafety = {
    hasLinks: linkScan.hasLinks,
    maxRisk: linkScan.maxRisk,
    reasons: linkScan.reasons
  };

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();

  if (!botContext.isBotInteraction) {
    const recentSpam = (spamTracker.get(key) || [])
      .filter(timestamp => now - timestamp < cfg.antiSpam.windowMs);

    recentSpam.push(now);
    spamTracker.set(key, recentSpam);

    if (cfg.antiSpam.enabled && recentSpam.length >= cfg.antiSpam.maxMessages) {
      spamTracker.set(key, []);

      const incident = createIncident({
        guildId: message.guild.id,
        userId: message.author.id,
        category: "spam",
        severity: "high",
        reason: `${recentSpam.length} messages in ${Math.round(cfg.antiSpam.windowMs / 1000)} seconds outside bot/minigame interaction`,
        action: cfg.mode === "enforce" ? "pending timeout" : "logged",
        metadata: {
          channelId: message.channel.id,
          contentPreview: message.content.slice(0, 500),
          channelPolicy: policy.type
        }
      });

      if (cfg.mode === "enforce") {
        const result = await enforceMessageIncident(message, incident, cfg);
        if (result.acted && canPostPublicly(cfg, message.channel)) {
          await sendAuraCatch(message.channel, message.author.id, incident, cfg);
        }
      } else {
        await sendLog(
          message.guild,
          cfg,
          "Spam burst detected",
          `<@${message.author.id}> • ${incident.reason}\nIncident: \`${incident.id}\``,
          "warn"
        );
      }
      return;
    }
  }

  if (cfg.aiGuard.mode === "off" || !GEMINI_API_KEY) return;

  const shouldAi = botContext.isBotInteraction
    ? (local.score >= 3 || linkScan.maxRisk >= 4)
    : cfg.aiGuard.mode === "all" ||
      (cfg.aiGuard.mode === "smart" && (local.score >= 1 || linkScan.maxRisk >= 2));

  if (!shouldAi) return;

  const ai = await classify({
    message,
    local,
    apiKey: GEMINI_API_KEY,
    model: GEMINI_MODEL
  });

  if (!ai) return;
  if (ai.classification === "safe" || ai.classification === "bot_interaction") return;
  if (ai.confidence < cfg.aiGuard.logConfidence) return;

  const incident = createIncident({
    guildId: message.guild.id,
    userId: message.author.id,
    category: ai.classification,
    severity: ai.confidence >= cfg.aiGuard.actionConfidence ? "high" : "medium",
    reason: ai.reason,
    confidence: ai.confidence,
    action: "logged",
    metadata: {
      channelId: message.channel.id,
      contentPreview: message.content.slice(0, 500),
      localScore: local.score,
      localReasons: local.reasons,
      botInteraction: botContext.isBotInteraction,
      botInteractionReason: botContext.reason,
      channelPolicy: policy.type,
      linkReasons: linkScan.reasons,
      linkRisk: linkScan.maxRisk,
      accountRisk: memberRisk
    }
  });

  await sendLog(
    message.guild,
    cfg,
    "AI Guard detection",
    `<@${message.author.id}> • **${ai.classification.toUpperCase()}**\n${ai.reason}\nIncident: \`${incident.id}\``,
    ai.confidence >= cfg.aiGuard.actionConfidence ? "danger" : "warn",
    [
      { name: "Confidence", value: `${Math.round(ai.confidence * 100)}%`, inline: true },
      { name: "Local score", value: String(local.score), inline: true },
      { name: "Bot interaction", value: botContext.isBotInteraction ? "✅ Yes" : "No", inline: true }
    ]
  );

  if (ai.confidence >= cfg.aiGuard.actionConfidence && cfg.mode === "enforce") {
    const result = await enforceMessageIncident(message, incident, cfg);
    if (result.acted && canPostPublicly(cfg, message.channel)) {
      await sendAuraCatch(message.channel, message.author.id, incident, cfg);
    }
  }
});


client.on("messageDelete", async message => {
  const storedSnapshot = removeSnapshot(message.id);
  const snapshot = storedSnapshot || (message.guild && message.author ? {
    at: message.createdTimestamp || Date.now(),
    guildId: message.guild.id,
    channelId: message.channelId,
    userId: message.author.id,
    bot: Boolean(message.author.bot),
    content: String(message.content || "").slice(0, 1800),
    userMentions: [...(message.mentions?.users?.keys?.() || [])],
    roleMentions: [...(message.mentions?.roles?.keys?.() || [])],
    everyone: Boolean(message.mentions?.everyone),
    attachments: []
  } : null);

  if (wasSecurityDelete(message.id)) return;

  const guild = message.guild || (snapshot?.guildId ? client.guilds.cache.get(snapshot.guildId) : null);
  if (!guild || !snapshot || snapshot.bot) return;

  const cfg = getConfig(guild.id);
  if (!cfg.enabled) return;

  const policy = getChannelPolicy(cfg, snapshot.channelId);
  const skipContentLog = ["logs", "mediation"].includes(policy.type);

  // If an audit-log entry exists for this author's deleted message, a moderator/bot
  // likely deleted it. That is not treated as a self-created ghost ping.
  const deleteExecutor = await fetchMessageDeleteExecutor(guild, snapshot.userId, snapshot.channelId);
  const moderatorDeleted = Boolean(deleteExecutor && deleteExecutor.id !== snapshot.userId);

  if (cfg.messageLogs.enabled && !skipContentLog) {
    await sendLog(
      guild,
      cfg,
      moderatorDeleted ? "Message deleted by moderator" : "Message deleted",
      `**Author:** <@${snapshot.userId}>\n` +
      `**Channel:** <#${snapshot.channelId}>\n` +
      (moderatorDeleted ? `**Deleted by:** <@${deleteExecutor.id}>\n` : "") +
      `**Content:** ${previewText(snapshot.content, 900)}`,
      "info"
    );
  }

  if (!cfg.messageLogs.ghostPingEnabled || moderatorDeleted) return;
  if (isWhitelisted(guild, snapshot.userId)) return;

  const mentionCount =
    snapshot.userMentions.length +
    snapshot.roleMentions.length +
    (snapshot.everyone ? 3 : 0);

  if (mentionCount <= 0) return;

  const repeated = recordGhostPing(
    guild.id,
    snapshot.userId,
    cfg.messageLogs.ghostPingRepeatWindowMs
  );

  const shouldAct = mentionCount >= 3 || repeated >= 2;
  const incident = createIncident({
    guildId: guild.id,
    userId: snapshot.userId,
    category: "ghost_ping",
    severity: shouldAct ? "high" : "medium",
    reason: `Deleted a message containing ${mentionCount} ping-weight (${repeated} ghost-ping event(s) in the review window)`,
    action: shouldAct && cfg.mode === "enforce" ? "pending timeout" : "logged",
    metadata: {
      channelId: snapshot.channelId,
      contentPreview: snapshot.content,
      mentionCount,
      repeated
    }
  });

  if (shouldAct && cfg.mode === "enforce") {
    const user = await client.users.fetch(snapshot.userId).catch(() => null);
    if (user) await punishExecutor(guild, user, incident, cfg, 5);
  } else {
    await sendLog(
      guild,
      cfg,
      "Ghost Ping watch",
      `<@${snapshot.userId}> removed a message with pings.\nIncident: \`${incident.id}\``,
      shouldAct ? "warn" : "info"
    );
  }
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;

  const cfg = getConfig(newMessage.guild.id);
  if (!cfg.enabled) return;

  const snapshot = getSnapshot(newMessage.id);
  const oldContent = snapshot?.content ?? oldMessage.content ?? "";
  const newContent = newMessage.content || "";
  const policy = getChannelPolicy(cfg, newMessage.channel.id);
  const skipContentLog = ["logs", "mediation"].includes(policy.type);

  if (
    cfg.messageLogs.enabled &&
    !skipContentLog &&
    oldContent !== newContent
  ) {
    await sendLog(
      newMessage.guild,
      cfg,
      "Message edited",
      `**Author:** <@${newMessage.author.id}>\n` +
      `**Channel:** <#${newMessage.channel.id}>\n` +
      `**Before:** ${previewText(oldContent, 700)}\n` +
      `**After:** ${previewText(newContent, 700)}`,
      "info"
    );
  }

  if (
    cfg.messageLogs.ghostPingEnabled &&
    snapshot &&
    !isWhitelisted(newMessage.guild, newMessage.author.id)
  ) {
    const newUsers = new Set([...newMessage.mentions.users.keys()]);
    const newRoles = new Set([...newMessage.mentions.roles.keys()]);
    const removedUsers = snapshot.userMentions.filter(id => !newUsers.has(id)).length;
    const removedRoles = snapshot.roleMentions.filter(id => !newRoles.has(id)).length;
    const removedEveryone = snapshot.everyone && !newMessage.mentions.everyone ? 3 : 0;
    const removedPingWeight = removedUsers + removedRoles + removedEveryone;

    if (removedPingWeight > 0 && Date.now() - snapshot.at < 120000) {
      const repeated = recordGhostPing(
        newMessage.guild.id,
        newMessage.author.id,
        cfg.messageLogs.ghostPingRepeatWindowMs
      );
      const shouldAct = removedPingWeight >= 3 || repeated >= 2;

      const incident = createIncident({
        guildId: newMessage.guild.id,
        userId: newMessage.author.id,
        category: "ghost_ping",
        severity: shouldAct ? "high" : "medium",
        reason: `Edited away ${removedPingWeight} ping-weight (${repeated} ghost-ping event(s) in the review window)`,
        action: shouldAct && cfg.mode === "enforce" ? "pending timeout" : "logged",
        metadata: {
          channelId: newMessage.channel.id,
          contentPreview: oldContent,
          editedContentPreview: newContent,
          removedPingWeight,
          repeated
        }
      });

      if (shouldAct && cfg.mode === "enforce") {
        await punishExecutor(newMessage.guild, newMessage.author, incident, cfg, 5);
      } else {
        await sendLog(
          newMessage.guild,
          cfg,
          "Ghost Ping edit watch",
          `<@${newMessage.author.id}> edited pings out of a message.\nIncident: \`${incident.id}\``,
          "warn"
        );
      }
    }
  }

  snapshotMessage(newMessage);
});

client.on("guildMemberAdd", async member => {
  const guild = member.guild;
  const cfg = getConfig(guild.id);

  if (!cfg.enabled) return;

  if (!member.user.bot && cfg.verification.enabled) {
    await markNewMemberUnverified(member, cfg);
  }

  if (!member.user.bot) {
    const joinRisk = accountRisk(member);
    if (joinRisk.ageDays < 3) {
      await sendLog(
        guild,
        cfg,
        "New-account watch",
        `<@${member.id}> joined with an account about **${joinRisk.ageDays} day(s)** old.\n` +
        `This is **only a risk signal** — no punishment was applied.`,
        "info",
        [
          { name: "Risk level", value: joinRisk.level.toUpperCase(), inline: true },
          { name: "Rule", value: "Never punish by account age alone", inline: true }
        ]
      );
    }
  }

  if (member.user.bot && cfg.antiNuke.enabled && cfg.antiNuke.protectBotAdds) {
    const executor = await fetchExecutor(guild, AuditLogEvent.BotAdd, member.id);

    if (executor && !isWhitelisted(guild, executor.id)) {
      const incident = createIncident({
        guildId: guild.id,
        userId: executor.id,
        category: "anti-nuke",
        severity: "critical",
        reason: `Unauthorized bot added: ${member.user.tag}`,
        action: "logged",
        metadata: { botId: member.id }
      });

      await sendLog(
        guild,
        cfg,
        "Unauthorized bot add",
        `<@${executor.id}> added **${member.user.tag}**.\n` +
        `Infinity Security will **not kick/ban** automatically.\nIncident: \`${incident.id}\``,
        "danger"
      );

      if (cfg.mode === "enforce") {
        const result = await punishExecutor(guild, executor, incident, cfg, 60);

        if (
          result.acted &&
          guild.systemChannel?.isTextBased() &&
          canPostPublicly(cfg, guild.systemChannel)
        ) {
          await sendAuraCatch(guild.systemChannel, executor.id, incident, cfg);
        }
      }
      return;
    }
  }

  if (!cfg.antiRaid.enabled) return;

  const now = Date.now();
  const recent = (raidTracker.get(guild.id) || [])
    .filter(timestamp => now - timestamp < cfg.antiRaid.windowMs);

  recent.push(now);
  raidTracker.set(guild.id, recent);

  if (recent.length === cfg.antiRaid.maxJoins) {
    const incident = createIncident({
      guildId: guild.id,
      category: "raid",
      severity: "critical",
      reason: `${recent.length} joins in ${Math.round(cfg.antiRaid.windowMs / 1000)} seconds`,
      action: "logged"
    });

    await sendLog(
      guild,
      cfg,
      "Possible raid",
      `${incident.reason}\nIncident: \`${incident.id}\``,
      "danger"
    );

    if (cfg.mode === "enforce" && cfg.antiRaid.autoLockdown) {
      const changed = await lockdownGuild(guild, cfg);
      await sendLog(
        guild,
        cfg,
        "Automatic raid lockdown",
        `Locked **${changed}** text channels.\nIncident: \`${incident.id}\``,
        "danger"
      );
    }

    // Server-wide raid catches get a much higher chance of one of the bundled
    // MP4 edits (with audio), while still respecting channel safety/cooldown.
    if (guild.systemChannel?.isTextBased()) {
      await sendReactionClip(guild.systemChannel, incident, cfg, { chance: 0.85 }).catch(() => {});
    }
  }
});


client.on("voiceStateUpdate", async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  const member = newState.member || oldState.member;
  if (!guild || !member || member.user.bot) return;

  const cfg = getConfig(guild.id);
  if (!cfg.enabled) return;

  const channelChanged = oldState.channelId !== newState.channelId;

  // ---------- Voice Domain / fun-quality layer ----------
  if (channelChanged) {
    trackVoiceSession(oldState, newState);

    // Joining the Create Voice hub opens a personal temporary room.
    if (
      cfg.voiceDomain.enabled &&
      cfg.voiceDomain.hubChannelId &&
      newState.channelId === cfg.voiceDomain.hubChannelId
    ) {
      const room = await createTempRoom(guild, member, cfg, client.user?.id);

      if (room) {
        await sendLog(
          guild,
          cfg,
          "Voice Domain opened",
          `<@${member.id}> created temporary voice room ${room}.`
        );
      }

      return;
    }

    // Empty temporary rooms self-destruct after a short grace period.
    if (oldState.channelId && isTempRoom(guild.id, oldState.channelId)) {
      const oldChannel = guild.channels.cache.get(oldState.channelId);
      if (oldChannel?.members.size === 0) {
        scheduleEmptyDelete(
          guild,
          oldState.channelId,
          cfg.voiceDomain.deleteEmptyAfterMs
        );
      }
    }

    if (newState.channelId && isTempRoom(guild.id, newState.channelId)) {
      cancelEmptyDelete(newState.channelId);
      const r=getRoom(guild.id,newState.channelId);
      if(r?.blocklist?.includes(member.id)){await newState.channel.permissionOverwrites.edit(member.id,{Connect:false,ViewChannel:false}).catch(()=>{});await sendLog(guild,cfg,"Voice Intruder Alert",`<@${member.id}> attempted to enter a Domain blocklist-protected room.`,`warn`);}
      await maybeAutoPrivate(guild,newState.channelId).catch(()=>{});
      await refreshRoomPanel(guild,newState.channelId).catch(()=>{});
    }
    if (oldState.channelId && isTempRoom(guild.id, oldState.channelId)) { await processRoomQueue(guild,oldState.channelId).catch(()=>{}); await refreshRoomPanel(guild,oldState.channelId).catch(()=>{}); }

    // Voice Raid Shield watches many joins into the SAME voice channel.
    if (
      cfg.voiceSecurity.enabled &&
      newState.channel &&
      newState.channelId !== cfg.voiceDomain.hubChannelId
    ) {
      const joinCount = trackChannelJoin(
        guild.id,
        newState.channelId,
        cfg.voiceSecurity.channelRaidWindowMs
      );

      if (joinCount === cfg.voiceSecurity.channelRaidThreshold) {
        const locked = await applyVoiceRaidLock(
          guild,
          newState.channel,
          cfg.voiceSecurity.channelRaidLockMs
        );

        if (locked) {
          const incident = createIncident({
            guildId: guild.id,
            category: "voice_raid",
            severity: "high",
            reason: `${joinCount} users joined ${newState.channel.name} within ${Math.round(cfg.voiceSecurity.channelRaidWindowMs / 1000)} seconds`,
            action: "temporary voice-channel lock",
            metadata: {
              channelId: newState.channelId,
              joinCount,
              lockMs: cfg.voiceSecurity.channelRaidLockMs
            }
          });

          await sendLog(
            guild,
            cfg,
            "Voice Raid Shield",
            `🌀 ${newState.channel} was temporarily locked for new connections after **${joinCount} rapid joins**.\n` +
            `Existing users remain connected.\nIncident: \`${incident.id}\``,
            "warn"
          );

          await newState.channel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("👁️ Voice Raid Shield")
                .setDescription(
                  `**${voiceLine("raid")}**\n\n` +
                  `New connections are paused for **${Math.round(cfg.voiceSecurity.channelRaidLockMs / 1000)} seconds**. ` +
                  `Nobody already inside was kicked.`
                )
                .setColor(0x7dd3fc)
            ]
          }).catch(() => {});
        }
      }
    }
  }

  // ---------- Security enforcement layer ----------
  if (!cfg.voiceSecurity.enabled || isWhitelisted(guild, member.id)) return;

  if (channelChanged) {
    const auditType = oldState.channelId && !newState.channelId
      ? AuditLogEvent.MemberDisconnect
      : (oldState.channelId && newState.channelId ? AuditLogEvent.MemberMove : null);

    let moveExecutor = null;
    if (auditType) {
      const relevantChannelId = newState.channelId || oldState.channelId;
      moveExecutor = await fetchVoiceAuditExecutor(guild, auditType, relevantChannelId);
    }

    // Only count changes as the MEMBER'S own spam when there is no recent audit-log
    // evidence that a bot/moderator moved or disconnected them.
    const externallyMoved = Boolean(moveExecutor && moveExecutor.id !== member.id);

    if (!externallyMoved) {
      const count = trackSelfVoiceChange(
        guild.id,
        member.id,
        cfg.voiceSecurity.selfJoinLeaveWindowMs
      );

      if (count === cfg.voiceSecurity.selfJoinLeaveThreshold) {
        const incident = createIncident({
          guildId: guild.id,
          userId: member.id,
          category: "voice_spam",
          severity: "high",
          reason: `${count} user-driven voice joins/leaves/moves in ${Math.round(cfg.voiceSecurity.selfJoinLeaveWindowMs / 1000)} seconds`,
          action: cfg.mode === "enforce" ? "pending timeout" : "logged",
          metadata: { oldChannelId: oldState.channelId, newChannelId: newState.channelId, count }
        });

        if (cfg.mode === "enforce") {
          await punishExecutor(guild, member.user, incident, cfg, 5);
        } else {
          await sendLog(
            guild,
            cfg,
            "Voice spam detected",
            `<@${member.id}> rapidly changed voice state **${count}** times by themselves.
Incident: \`${incident.id}\``,
            "warn"
          );
        }
      }
    }

    if (externallyMoved && !isWhitelisted(guild, moveExecutor.id)) {
      const moveCount = trackExecutorMove(
        guild.id,
        moveExecutor.id,
        cfg.voiceSecurity.moderatorWindowMs
      );

      if (moveCount === cfg.voiceSecurity.massMoveThreshold) {
        const incident = createIncident({
          guildId: guild.id,
          userId: moveExecutor.id,
          category: "voice_abuse",
          severity: "critical",
          reason: `${moveCount} moderator-driven voice moves/disconnects in ${Math.round(cfg.voiceSecurity.moderatorWindowMs / 1000)} seconds`,
          action: cfg.mode === "enforce" ? "pending timeout" : "logged",
          metadata: { targetUserId: member.id, moveCount }
        });

        if (cfg.mode === "enforce") {
          await punishExecutor(guild, moveExecutor, incident, cfg, 30);
        } else {
          await sendLog(
            guild,
            cfg,
            "Voice moderation burst",
            `<@${moveExecutor.id}> rapidly moved/disconnected members.
Incident: \`${incident.id}\``,
            "danger"
          );
        }
      }
    }
  }

  const moderationChanged =
    oldState.serverMute !== newState.serverMute ||
    oldState.serverDeaf !== newState.serverDeaf;

  if (moderationChanged) {
    const executor = await fetchExecutor(guild, AuditLogEvent.MemberUpdate, member.id);

    if (executor && executor.id !== member.id && !isWhitelisted(guild, executor.id)) {
      const count = trackExecutorModeration(
        guild.id,
        executor.id,
        cfg.voiceSecurity.moderatorWindowMs
      );

      if (count === cfg.voiceSecurity.massMoveThreshold) {
        const incident = createIncident({
          guildId: guild.id,
          userId: executor.id,
          category: "voice_abuse",
          severity: "critical",
          reason: `${count} rapid server mute/deafen actions detected`,
          action: cfg.mode === "enforce" ? "pending timeout" : "logged",
          metadata: { targetUserId: member.id, count }
        });

        if (cfg.mode === "enforce") {
          await punishExecutor(guild, executor, incident, cfg, 30);
        } else {
          await sendLog(
            guild,
            cfg,
            "Voice mute/deafen burst",
            `<@${executor.id}> triggered a rapid voice moderation pattern.\nIncident: \`${incident.id}\``,
            "danger"
          );
        }
      }
    }
  }
});

async function handleDestructiveEvent(guild, type, targetId, label, auditType) {
  const cfg = getConfig(guild.id);
  if (!cfg.enabled || !cfg.antiNuke.enabled) return;

  const executor = await fetchExecutor(guild, auditType, targetId);
  if (!executor || isWhitelisted(guild, executor.id)) return;

  const count = destructiveBurst(guild.id, executor.id, "mixed_destructive", cfg.antiNuke.windowMs);
  const typeCount = destructiveBurst(guild.id, executor.id, type, cfg.antiNuke.windowMs);

  const incident = createIncident({
    guildId: guild.id,
    userId: executor.id,
    category: "anti-nuke",
    severity: count >= cfg.antiNuke.destructiveThreshold ? "critical" : "medium",
    reason: `${label} (${count}/${cfg.antiNuke.destructiveThreshold} in burst window)`,
    action: "logged",
    metadata: { type, targetId, count, typeCount }
  });

  await sendLog(
    guild,
    cfg,
    "Anti-Nuke watch",
    `<@${executor.id}> • ${incident.reason}\nIncident: \`${incident.id}\``,
    count >= cfg.antiNuke.destructiveThreshold ? "danger" : "warn"
  );

  if (count >= cfg.antiNuke.destructiveThreshold && cfg.mode === "enforce") {
    const result = await punishExecutor(guild, executor, incident, cfg, 120);

    if (
      result.acted &&
      guild.systemChannel?.isTextBased() &&
      canPostPublicly(cfg, guild.systemChannel)
    ) {
      await sendAuraCatch(guild.systemChannel, executor.id, incident, cfg);
    }
  }
}


const roleGuardReverts = new Set();

client.on("roleUpdate", async (oldRole, newRole) => {
  const guild = newRole.guild;
  const cfg = getConfig(guild.id);
  if (!cfg.enabled || !cfg.permissionGuard.enabled || roleGuardReverts.has(newRole.id)) return;

  const added = dangerousAdded(oldRole.permissions, newRole.permissions);
  if (!added.length) return;

  const executor = await fetchExecutor(guild, AuditLogEvent.RoleUpdate, newRole.id);
  if (!executor || isWhitelisted(guild, executor.id)) return;

  const incident = createIncident({
    guildId: guild.id,
    userId: executor.id,
    category: "permission_escalation",
    severity: "critical",
    reason: `Dangerous permissions added to role ${newRole.name}: ${added.join(", ")}`,
    action: "logged",
    metadata: { roleId: newRole.id, permissions: added }
  });

  let reverted = false;
  if (cfg.permissionGuard.revertDangerousChanges && newRole.editable) {
    roleGuardReverts.add(newRole.id);
    reverted = await newRole
      .setPermissions(oldRole.permissions.bitfield, `Infinity Security ${incident.id}: permission escalation rollback`)
      .then(() => true)
      .catch(() => false);
    setTimeout(() => roleGuardReverts.delete(newRole.id), 1500).unref?.();
  }

  updateIncident(incident.id, {
    metadata: { ...incident.metadata, rollbackSucceeded: reverted }
  });

  await sendLog(
    guild,
    cfg,
    "Permission escalation blocked",
    `<@${executor.id}> added **${added.join(", ")}** to <@&${newRole.id}>. ` +
      `Rollback: **${reverted ? "SUCCESS" : (cfg.permissionGuard.revertDangerousChanges ? "FAILED / LOG ONLY" : "DISABLED")}**.\n` +
      `Incident: \`${incident.id}\``,
    "danger"
  );

  if (cfg.mode === "enforce") {
    await punishExecutor(guild, executor, incident, cfg, cfg.permissionGuard.timeoutMinutes);
  }
});

client.on("roleCreate", async role => {
  const guild = role.guild;
  const cfg = getConfig(guild.id);
  if (!cfg.enabled) return;

  const executor = await fetchExecutor(guild, AuditLogEvent.RoleCreate, role.id);
  if (!executor || isWhitelisted(guild, executor.id)) return;

  if (cfg.antiNuke?.enabled) {
    const count = destructiveBurst(guild.id, executor.id, "role_create_burst", cfg.antiNuke.windowMs);
    if (count >= Number(cfg.antiNuke.createThreshold || 5)) {
      const incident = createIncident({ guildId:guild.id, userId:executor.id, category:"anti-nuke", severity:"high",
        reason:`Mass role creation detected: ${count} roles in ${Math.round(cfg.antiNuke.windowMs/1000)} seconds`, action:"logged",
        metadata:{ roleId:role.id, count } });
      await sendLog(guild,cfg,"Mass role creation",`<@${executor.id}> created **${count} roles** in a short burst.\nIncident: \`${incident.id}\``,"danger");
      if (cfg.mode === "enforce") await punishExecutor(guild,executor,incident,cfg,60);
    }
  }

  if (!cfg.permissionGuard.enabled) return;
  const dangerous = dangerousPermissions(role);
  if (!dangerous.length) return;

  const incident=createIncident({guildId:guild.id,userId:executor.id,category:"permission_escalation",severity:"critical",reason:`Created dangerous role ${role.name}: ${dangerous.join(", ")}`,action:"logged",metadata:{roleId:role.id,permissions:dangerous}});
  let reverted=false;
  if(cfg.permissionGuard.revertDangerousChanges&&role.editable){
    roleGuardReverts.add(role.id);
    reverted = await role.setPermissions(stripDangerous(role.permissions.bitfield),`Infinity Security ${incident.id}: strip dangerous permissions`).then(()=>true).catch(()=>false);
    setTimeout(()=>roleGuardReverts.delete(role.id),1500).unref?.();
  }
  await sendLog(guild,cfg,"Dangerous role creation",`<@${executor.id}> created <@&${role.id}> with **${dangerous.join(", ")}**. Rollback: **${reverted?"SUCCESS":"FAILED / LOG ONLY"}**.\nIncident: \`${incident.id}\``,"danger");
  if(cfg.mode==="enforce") await punishExecutor(guild,executor,incident,cfg,cfg.permissionGuard.timeoutMinutes);
});
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const guild = newMember.guild;
  const cfg = getConfig(guild.id);
  if (!cfg.enabled || !cfg.permissionGuard.enabled) return;

  const added = [...newMember.roles.cache.values()].filter(role => !oldMember.roles.cache.has(role.id));
  const risky = added.filter(role => dangerousPermissions(role).length);
  if (!risky.length) return;

  const executor = await fetchExecutor(guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
  if (!executor || isWhitelisted(guild, executor.id)) return;

  const names = risky.map(role => `${role.name} (${dangerousPermissions(role).join(", ")})`).join("; ");
  const incident = createIncident({
    guildId: guild.id,
    userId: executor.id,
    category: "permission_escalation",
    severity: "critical",
    reason: `Granted dangerous role(s) to ${newMember.user.tag}: ${names}`,
    action: "logged",
    metadata: { targetUserId: newMember.id, roleIds: risky.map(role => role.id) }
  });

  let rollbackCount = 0;
  if (cfg.permissionGuard.revertDangerousChanges) {
    for (const role of risky) {
      const removed = await newMember.roles
        .remove(role, `Infinity Security ${incident.id}: rollback dangerous role grant`)
        .then(() => true)
        .catch(() => false);
      if (removed) rollbackCount += 1;
    }
  }

  const rollbackStatus = !cfg.permissionGuard.revertDangerousChanges
    ? "DISABLED"
    : rollbackCount === risky.length
      ? "SUCCESS"
      : rollbackCount > 0
        ? `PARTIAL (${rollbackCount}/${risky.length})`
        : "FAILED / LOG ONLY";

  updateIncident(incident.id, {
    metadata: { ...incident.metadata, rollbackCount, rollbackTotal: risky.length }
  });

  await sendLog(
    guild,
    cfg,
    "Dangerous role grant",
    `<@${executor.id}> gave dangerous role access to <@${newMember.id}>. ` +
      `Rollback: **${rollbackStatus}**.\nIncident: \`${incident.id}\``,
    "danger"
  );

  if (cfg.mode === "enforce") {
    await punishExecutor(guild, executor, incident, cfg, cfg.permissionGuard.timeoutMinutes);
  }
});

client.on("roleDelete", async role => {
  const guild = role.guild;
  const cfg = getConfig(guild.id);
  cfg.trustedRoleIds = (cfg.trustedRoleIds || []).filter(id => id !== role.id);
  const wasVerificationRole = cfg.verification?.unverifiedRoleId === role.id;
  if (wasVerificationRole) cfg.verification.unverifiedRoleId = null;
  commit();

  await handleDestructiveEvent(
    guild,
    "role_delete",
    role.id,
    `Deleted role ${role.name}`,
    AuditLogEvent.RoleDelete
  );

  if (wasVerificationRole && cfg.verification?.enabled) {
    await ensureVerificationSetup(guild, cfg, client.user?.id).catch(() => null);
    await applyRestrictionsGuild(guild, cfg).catch(() => {});
  }
});

client.on("guildBanAdd", ban => {
  handleDestructiveEvent(
    ban.guild,
    "member_ban",
    ban.user.id,
    `Banned ${ban.user.tag}`,
    AuditLogEvent.MemberBanAdd
  );
});

client.on("webhooksUpdate", async channel => {
  const guild = channel.guild;
  const cfg = getConfig(guild.id);
  if (!cfg.enabled || !cfg.antiNuke.enabled || !cfg.antiNuke.protectWebhooks) return;

  const audit = await fetchRecentWebhookExecutor(guild, channel.id);
  const executor = audit?.executor;
  if (!executor || isWhitelisted(guild, executor.id)) return;

  const count = destructiveBurst(guild.id, executor.id, "webhook_any", cfg.antiNuke.windowMs);
  const actionName = audit.action === AuditLogEvent.WebhookDelete
    ? "deleted"
    : audit.action === AuditLogEvent.WebhookUpdate
      ? "updated"
      : "created";

  const incident = createIncident({
    guildId: guild.id,
    userId: executor.id,
    category: "anti-nuke",
    severity: count >= 2 ? "high" : "medium",
    reason: `Webhook ${actionName} in #${channel.name} (${count} recent webhook action(s))`,
    action: "logged",
    metadata: { channelId: channel.id, count, webhookAction: actionName, webhookId: audit.targetId }
  });

  await sendLog(
    guild,
    cfg,
    "Webhook watch",
    `<@${executor.id}> **${actionName}** webhook activity in ${channel}.\nIncident: \`${incident.id}\``,
    count >= 2 ? "danger" : "warn"
  );

  if (count >= 2 && cfg.mode === "enforce") {
    await punishExecutor(guild, executor, incident, cfg, 60);
  }
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

registerCommands()
  .then(() => client.login(TOKEN))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
