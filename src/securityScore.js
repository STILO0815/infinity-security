const { PermissionsBitField, GatewayIntentBits } = require("discord.js");

async function calculateSecurityScore(guild, cfg, client, options = {}) {
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  let score = 100;
  const checks = [];

  function add(ok, label, penalty, detail) {
    if (!ok) score -= penalty;
    checks.push({ ok, label, detail, penalty: ok ? 0 : penalty });
  }

  if (!me) {
    return { score: 0, checks: [{ ok: false, label: "Bot member unavailable", detail: "Could not inspect permissions", penalty: 100 }] };
  }

  const permissions = [
    [PermissionsBitField.Flags.ViewAuditLog, "View Audit Log", 10],
    [PermissionsBitField.Flags.ModerateMembers, "Moderate Members", 15],
    [PermissionsBitField.Flags.ManageMessages, "Manage Messages", 8],
    [PermissionsBitField.Flags.ManageChannels, "Manage Channels", 8],
    [PermissionsBitField.Flags.ManageRoles, "Manage Roles", 6],
    [PermissionsBitField.Flags.ManageWebhooks, "Manage Webhooks", 5],
    [PermissionsBitField.Flags.SendMessages, "Send Messages", 4],
    [PermissionsBitField.Flags.EmbedLinks, "Embed Links", 3],
    [PermissionsBitField.Flags.ReadMessageHistory, "Read Message History", 3]
  ];

  for (const [flag, label, penalty] of permissions) {
    const ok = me.permissions.has(flag);
    add(ok, label, penalty, ok ? "Permission available" : "Missing permission");
  }

  const logChannel = cfg.logChannelId ? guild.channels.cache.get(cfg.logChannelId) : null;
  add(Boolean(logChannel?.isTextBased()), "Private bot logs", 8, logChannel ? "#bot-logs configured" : "No usable bot log channel");

  add(cfg.channelSafety?.lastScanAt != null, "Channel safety scan", 5, cfg.channelSafety?.lastScanAt ? "Channel policies scanned" : "Run /setup or /rescan");
  add(cfg.botInteractions?.enabled === true, "Bot/minigame false-positive shield", 5, cfg.botInteractions?.enabled ? "Enabled" : "Disabled");
  add(cfg.antiNuke?.enabled === true, "Anti-Nuke", 6, cfg.antiNuke?.enabled ? "Enabled" : "Disabled");
  add(cfg.antiRaid?.enabled === true, "Anti-Raid", 5, cfg.antiRaid?.enabled ? "Enabled" : "Disabled");
  add(cfg.mediation?.enabled === true, "AI dispute mediation", 2, cfg.mediation?.enabled ? "Enabled" : "Disabled");
  add(cfg.permissionGuard?.enabled === true, "Permission Guard", 6, cfg.permissionGuard?.enabled ? "Dangerous role escalation watched" : "Disabled");
  add(cfg.threatCorrelation?.enabled === true, "Aegis threat correlation", 8, cfg.threatCorrelation?.enabled ? "Cross-event audit-log correlation enabled" : "Disabled");
  add(cfg.healthGuard?.enabled === true, "Aegis health guard", 4, cfg.healthGuard?.enabled ? "Runtime permission/infrastructure checks enabled" : "Disabled");
  add(cfg.selfProtection?.enabled === true, "Self-Guard", 4, cfg.selfProtection?.enabled ? "Bot-removal exposure monitoring and recovery path enabled" : "Disabled");
  if (cfg.selfProtection?.enabled && cfg.selfProtection?.lastStatus === "EXPOSED") {
    score -= 6;
    checks.push({ ok:false, label:"Self-Guard hierarchy exposure", detail:"One or more non-owner members may be able to remove Infinity through role hierarchy.", penalty:6 });
  } else if (cfg.selfProtection?.enabled && cfg.selfProtection?.lastStatus === "OWNER_ONLY") {
    checks.push({ ok:true, label:"Self-Guard hierarchy exposure", detail:"No known non-owner removal exposure detected.", penalty:0 });
  }
  add(cfg.backups?.lastBackupAt != null, "Recovery backup", 5, cfg.backups?.lastBackupAt ? "Backup exists" : "Create one with /backup create");
  add(cfg.voiceSecurity?.enabled === true, "Voice Guard", 3, cfg.voiceSecurity?.enabled ? "Enabled" : "Disabled");
  if (cfg.verification?.enabled) checks.push({ ok:true, label:"Verification gate", detail:"Enabled", penalty:0 });

  const hasMessageContent = client.options.intents.has(GatewayIntentBits.MessageContent);
  add(hasMessageContent, "Message Content intent", 8, hasMessageContent ? "Configured in code" : "Missing from client intents");

  const aiConfigured = Boolean(options.aiConfigured);
  if (!aiConfigured) {
    score -= 4;
    checks.push({ ok: false, label: "AI Guard key", detail: "Gemini key missing; local protection still works", penalty: 4 });
  } else {
    checks.push({ ok: true, label: "AI Guard key", detail: "AI classification available", penalty: 0 });
  }

  if (cfg.mode !== "enforce") {
    score -= 5;
    checks.push({ ok: false, label: "Enforcement mode", detail: "Alert mode is safer for testing but does not auto-timeout threats", penalty: 5 });
  } else {
    checks.push({ ok: true, label: "Enforcement mode", detail: "Enforce mode active", penalty: 0 });
  }

  score = Math.max(0, Math.min(100, score));
  return { score, checks };
}

module.exports = { calculateSecurityScore };
