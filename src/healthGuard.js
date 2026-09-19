const { PermissionsBitField } = require('discord.js');

const REQUIRED = [
  [PermissionsBitField.Flags.ViewAuditLog, 'View Audit Log', true],
  [PermissionsBitField.Flags.ModerateMembers, 'Moderate Members', true],
  [PermissionsBitField.Flags.ManageMessages, 'Manage Messages', false],
  [PermissionsBitField.Flags.ManageChannels, 'Manage Channels', false],
  [PermissionsBitField.Flags.ManageRoles, 'Manage Roles', false],
  [PermissionsBitField.Flags.ManageWebhooks, 'Manage Webhooks', false],
  [PermissionsBitField.Flags.SendMessages, 'Send Messages', true],
  [PermissionsBitField.Flags.EmbedLinks, 'Embed Links', false],
  [PermissionsBitField.Flags.ReadMessageHistory, 'Read Message History', false]
];

async function auditGuildHealth(guild, cfg) {
  const me = guild.members.me || await guild.members.fetchMe().catch(()=>null);
  const issues=[]; const ok=[];
  if (!me) return { healthy:false, critical:true, issues:[{code:'BOT_MEMBER_MISSING',severity:'critical',text:'Bot member could not be loaded.'}], ok };

  for (const [flag,label,critical] of REQUIRED) {
    if (me.permissions.has(flag)) ok.push(label);
    else issues.push({ code:`MISSING_${label.toUpperCase().replace(/\s+/g,'_')}`, severity:critical?'critical':'warn', text:`Missing ${label} permission.` });
  }

  const logChannel = cfg.logChannelId ? guild.channels.cache.get(cfg.logChannelId) : null;
  if (!logChannel?.isTextBased()) issues.push({code:'LOG_CHANNEL_MISSING',severity:'critical',text:'Private #bot-logs channel is missing or unusable.'});
  else {
    const perms=logChannel.permissionsFor(me);
    if (!perms?.has(PermissionsBitField.Flags.ViewChannel) || !perms?.has(PermissionsBitField.Flags.SendMessages)) {
      issues.push({code:'LOG_CHANNEL_BLOCKED',severity:'critical',text:'Infinity cannot view/send in the configured bot log channel.'});
    }
  }

  const dangerousAbove = guild.roles.cache.filter(role => role.id!==guild.id && !role.managed && role.position>=me.roles.highest.position && (
    role.permissions.has(PermissionsBitField.Flags.Administrator) ||
    role.permissions.has(PermissionsBitField.Flags.ManageRoles) ||
    role.permissions.has(PermissionsBitField.Flags.ManageGuild)
  )).map(role=>role.id);
  if (dangerousAbove.length) issues.push({code:'ROLE_HIERARCHY_RISK',severity:'warn',text:`${dangerousAbove.length} powerful role(s) are at/above Infinity's highest role, so some rollbacks/timeouts may fail.`,roleIds:dangerousAbove.slice(0,10)});

  if (cfg.mode==='enforce' && !me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) issues.push({code:'ENFORCE_WITHOUT_TIMEOUT_PERMISSION',severity:'critical',text:'Enforce mode is active but Infinity cannot timeout members.'});
  const critical=issues.some(i=>i.severity==='critical');
  return { healthy:issues.length===0, critical, issues, ok };
}
function healthSignature(result){ return result.issues.map(i=>i.code).sort().join('|') || 'healthy'; }
module.exports={auditGuildHealth,healthSignature};
