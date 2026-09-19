const fs = require("fs");
const path = require("path");
const { loadJson, saveJson } = require("./security/jsonStore");

const DATA_DIR = path.join(__dirname, "..", "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, "{}");
}

ensureData();

let allConfig = loadJson(CONFIG_PATH, {});

function defaultGuildConfig() {
  return {
    enabled: true,
    mode: "alert",
    logChannelId: null,
    whitelist: [],
    trustedRoleIds: [],
    securityPreset: "balanced",
    threatCorrelation: {
      enabled: true,
      windowMs: 20000,
      highScore: 8,
      actionScore: 12,
      criticalScore: 18,
      escalationCooldownMs: 15000,
      timeoutMinutes: 240,
      autoEmergencyOnCritical: false,
      weights: {}
    },
    healthGuard: {
      enabled: true,
      checkIntervalMinutes: 10,
      logCooldownMinutes: 30,
      lastSignature: null,
      lastLoggedAt: null
    },
    selfProtection: {
      enabled: true,
      alertOnRemoval: true,
      monitorRoleHierarchy: true,
      lastStatus: null,
      lastSeenAt: null,
      ownerId: null,
      guildName: null,
      lastBotRoleId: null,
      lastBotRolePosition: null,
      lastDangerousRoleIds: [],
      lastPermissionSnapshot: null
    },
    protectedMembers: {
      enabled: true,
      userIds: ["1296954480318873652"],
      recoveryInvites: {},
      dmOnKick: true,
      ownerFallback: true
    },
    antiSpam: {
      enabled: true,
      maxMessages: 6,
      windowMs: 7000
    },
    antiRaid: {
      enabled: true,
      maxJoins: 8,
      windowMs: 10000,
      autoLockdown: true
    },
    antiNuke: {
      enabled: true,
      destructiveThreshold: 3,
      createThreshold: 5,
      windowMs: 12000,
      protectBotAdds: true,
      protectWebhooks: true
    },
    aiGuard: {
      mode: "smart",
      logConfidence: 0.78,
      actionConfidence: 0.93
    },
    aura: {
      publicReplies: true,
      clips: true,
      offenderDms: true,
      clipChance: 0.25,
      intensity: "overdrive",
      rareChance: 0.05,
      signatureBars: true
    },
    reactionClips: {
      enabled: true,
      chance: 0.65,
      criticalBoost: 0.15,
      cooldownMs: 18000,
      disabledClipIds: [],
      categoryOverrides: {}
    },
    punishment: {
      strikeWindowHours: 24,
      actionDedupMs: 10000
    },
    appeals: {
      enabled: true
    },
    linkScanner: {
      enabled: true,
      logRisk: 3,
      actionRisk: 7
    },
    messageLogs: {
      enabled: true,
      ghostPingEnabled: true,
      ghostPingRepeatWindowMs: 300000
    },
    voiceSecurity: {
      enabled: true,
      selfJoinLeaveThreshold: 8,
      selfJoinLeaveWindowMs: 30000,
      massMoveThreshold: 5,
      moderatorWindowMs: 12000,
      channelRaidThreshold: 7,
      channelRaidWindowMs: 10000,
      channelRaidLockMs: 60000
    },
    voiceDomain: {
      enabled: true,
      autoCreateHub: true,
      hubChannelId: null,
      categoryId: null,
      defaultUserLimit: 0,
      deleteEmptyAfterMs: 8000,
      roomNameTemplate: "👁️ {name}'s Domain",
      domainEventChance: 0.15,
      xpMinutesPerPoint: 5,
      afkWarnMinutes: 20,
      afkMoveMinutes: 30,
      autoPrivateDefault: false,
      knockAlertThreshold: 3
    },
    startup: {
      logOnlineMessage: true
    },
    verification: {
      enabled: false,
      channelId: null,
      unverifiedRoleId: null,
      challengeMinutes: 10,
      warnAccountAgeDays: 7
    },
    permissionGuard: {
      enabled: true,
      revertDangerousChanges: true,
      timeoutMinutes: 120
    },
    backups: {
      enabled: true,
      autoEnabled: true,
      autoIntervalHours: 12,
      maxBackups: 10,
      lastBackupAt: null
    },
    reports: {
      enabled: true,
      dailyEnabled: false,
      lastSentAt: null
    },
    emergency: {
      active: false,
      startedAt: null,
      startedBy: null,
      previousMode: null,
      previousAuraPublic: null,
      previousVoiceDomainEnabled: null,
      lockdownWasAlreadyActive: false,
      voiceSnapshot: {}
    },
    quarantine: {
      defaultMinutes: 1440
    },
    mediation: {
      enabled: true,
      mutualWindowMs: 180000,
      contextReviewMs: 10000,
      contextReviewMaxMs: 25000,
      friendlyWarningCooldownMs: 120000,
      inviteNoTimeoutMinutes: 1440,
      resolutionTimeoutMinutes: 10,
      requireBothResolve: true,
      minimumMessagesPerSide: 2,
      detectInBotChannels: false,
      verifiedMessageLinks: true,
      maxVerifiedLinksPerMessage: 4,
      maxOpenQuestionsForResolve: 1,
      finalJuryEnabled: true,
      finalJuryMinConfidence: 0.92
    },
    botInteractions: {
      enabled: true,
      prefixes: ["owo"],
      trustedBotIds: [],
      trustedChannelIds: []
    },
    channelSafety: {
      autoScan: true,
      policies: {},
      lastScanAt: null
    },
    lockdown: {
      active: false,
      snapshot: {}
    }
  };
}

function normalizeGuildConfig(cfg = {}) {
  const d = defaultGuildConfig();

  // v3 compatibility
  if (cfg.aura?.dms !== undefined && cfg.aura?.offenderDms === undefined) {
    cfg.aura.offenderDms = cfg.aura.dms;
  }

  return {
    ...d,
    ...cfg,
    whitelist: Array.isArray(cfg.whitelist) ? cfg.whitelist : [],
    trustedRoleIds: Array.isArray(cfg.trustedRoleIds) ? cfg.trustedRoleIds : [],
    securityPreset: ["relaxed","balanced","strict","maximum"].includes(cfg.securityPreset) ? cfg.securityPreset : d.securityPreset,
    threatCorrelation: { ...d.threatCorrelation, ...(cfg.threatCorrelation || {}), weights: cfg.threatCorrelation?.weights || {} },
    healthGuard: { ...d.healthGuard, ...(cfg.healthGuard || {}) },
    selfProtection: {
      ...d.selfProtection,
      ...(cfg.selfProtection || {}),
      lastDangerousRoleIds: Array.isArray(cfg.selfProtection?.lastDangerousRoleIds) ? cfg.selfProtection.lastDangerousRoleIds : []
    },
    protectedMembers: {
      ...d.protectedMembers,
      ...(cfg.protectedMembers || {}),
      userIds: Array.isArray(cfg.protectedMembers?.userIds) ? cfg.protectedMembers.userIds : d.protectedMembers.userIds,
      recoveryInvites: cfg.protectedMembers?.recoveryInvites || {}
    },
    antiSpam: { ...d.antiSpam, ...(cfg.antiSpam || {}) },
    antiRaid: { ...d.antiRaid, ...(cfg.antiRaid || {}) },
    antiNuke: { ...d.antiNuke, ...(cfg.antiNuke || {}) },
    aiGuard: { ...d.aiGuard, ...(cfg.aiGuard || {}) },
    aura: { ...d.aura, ...(cfg.aura || {}) },
    reactionClips: {
      ...d.reactionClips,
      ...(cfg.reactionClips || {}),
      disabledClipIds: Array.isArray(cfg.reactionClips?.disabledClipIds) ? cfg.reactionClips.disabledClipIds : [],
      categoryOverrides: cfg.reactionClips?.categoryOverrides || {}
    },
    punishment: { ...d.punishment, ...(cfg.punishment || {}) },
    appeals: { ...d.appeals, ...(cfg.appeals || {}) },
    linkScanner: { ...d.linkScanner, ...(cfg.linkScanner || {}) },
    messageLogs: { ...d.messageLogs, ...(cfg.messageLogs || {}) },
    voiceSecurity: { ...d.voiceSecurity, ...(cfg.voiceSecurity || {}) },
    voiceDomain: { ...d.voiceDomain, ...(cfg.voiceDomain || {}) },
    startup: { ...d.startup, ...(cfg.startup || {}) },
    verification: { ...d.verification, ...(cfg.verification || {}) },
    permissionGuard: { ...d.permissionGuard, ...(cfg.permissionGuard || {}) },
    backups: { ...d.backups, ...(cfg.backups || {}) },
    reports: { ...d.reports, ...(cfg.reports || {}) },
    emergency: { ...d.emergency, ...(cfg.emergency || {}), voiceSnapshot: cfg.emergency?.voiceSnapshot || {} },
    quarantine: { ...d.quarantine, ...(cfg.quarantine || {}) },
    mediation: { ...d.mediation, ...(cfg.mediation || {}) },
    botInteractions: {
      ...d.botInteractions,
      ...(cfg.botInteractions || {}),
      prefixes: Array.isArray(cfg.botInteractions?.prefixes) ? cfg.botInteractions.prefixes : d.botInteractions.prefixes,
      trustedBotIds: Array.isArray(cfg.botInteractions?.trustedBotIds) ? cfg.botInteractions.trustedBotIds : [],
      trustedChannelIds: Array.isArray(cfg.botInteractions?.trustedChannelIds) ? cfg.botInteractions.trustedChannelIds : []
    },
    channelSafety: {
      ...d.channelSafety,
      ...(cfg.channelSafety || {}),
      policies: cfg.channelSafety?.policies || {}
    },
    lockdown: {
      ...d.lockdown,
      ...(cfg.lockdown || {}),
      snapshot: cfg.lockdown?.snapshot || {}
    }
  };
}

function saveAllConfig() { saveJson(CONFIG_PATH, allConfig); }

function getConfig(guildId) {
  allConfig[guildId] = normalizeGuildConfig(allConfig[guildId]);
  return allConfig[guildId];
}

function commit() {
  saveAllConfig();
}

module.exports = { getConfig, commit, defaultGuildConfig };
