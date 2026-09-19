const { PermissionsBitField } = require('discord.js');

const RECOMMENDED = [
  PermissionsBitField.Flags.ViewAuditLog,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.ManageRoles,
  PermissionsBitField.Flags.ModerateMembers,
  PermissionsBitField.Flags.ManageMessages,
  PermissionsBitField.Flags.ManageWebhooks,
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.EmbedLinks,
  PermissionsBitField.Flags.ReadMessageHistory,
  PermissionsBitField.Flags.MoveMembers
];

function buildReinviteUrl(clientId) {
  const permissions = new PermissionsBitField(RECOMMENDED).bitfield.toString();
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&scope=bot%20applications.commands&permissions=${permissions}`;
}

function roleCanRemoveBot(role) {
  return (
    role.permissions.has(PermissionsBitField.Flags.Administrator) ||
    role.permissions.has(PermissionsBitField.Flags.KickMembers) ||
    role.permissions.has(PermissionsBitField.Flags.BanMembers)
  );
}

async function assessSelfProtection(guild, options = {}) {
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me) {
    return {
      status: 'UNKNOWN',
      protectedFromStaff: false,
      dangerousRoles: [],
      missingPermissions: ['BOT_MEMBER_MISSING'],
      text: 'Infinity could not load its own guild member.'
    };
  }

  const highest = me.roles.highest;

  let fetchedMembers = false;
  if (options.fetchMembers && guild.memberCount <= Number(options.maxFetchMembers || 5000)) {
    fetchedMembers = Boolean(await guild.members.fetch().then(() => true).catch(() => false));
  }

  // Removal ability is member-based, not just role-based: a member may have a high hierarchy
  // role plus Kick/Ban inherited from a different lower role. Evaluate combined member permissions.
  const dangerousMembers = [...guild.members.cache.values()]
    .filter(member => member.id !== me.id && member.id !== guild.ownerId)
    .filter(member => member.roles.highest.position > highest.position)
    .filter(member =>
      member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      member.permissions.has(PermissionsBitField.Flags.KickMembers) ||
      member.permissions.has(PermissionsBitField.Flags.BanMembers)
    )
    .sort((a, b) => b.roles.highest.position - a.roles.highest.position)
    .map(member => ({
      id: member.id,
      tag: member.user?.tag || member.user?.username || member.id,
      highestRoleId: member.roles.highest.id,
      highestRoleName: member.roles.highest.name,
      highestRolePosition: member.roles.highest.position,
      administrator: member.permissions.has(PermissionsBitField.Flags.Administrator),
      kick: member.permissions.has(PermissionsBitField.Flags.KickMembers),
      ban: member.permissions.has(PermissionsBitField.Flags.BanMembers)
    }));

  const dangerousRoleMap = new Map();
  for (const member of dangerousMembers) {
    if (!dangerousRoleMap.has(member.highestRoleId)) {
      dangerousRoleMap.set(member.highestRoleId, {
        id: member.highestRoleId,
        name: member.highestRoleName,
        position: member.highestRolePosition,
        administrator: false,
        kick: false,
        ban: false
      });
    }
    const role = dangerousRoleMap.get(member.highestRoleId);
    role.administrator ||= member.administrator;
    role.kick ||= member.kick;
    role.ban ||= member.ban;
  }
  const dangerousRoles = [...dangerousRoleMap.values()].sort((a,b) => b.position - a.position);

  const missingPermissions = RECOMMENDED
    .filter(flag => !me.permissions.has(flag))
    .map(flag => flag.toString());

  const protectedFromStaff = dangerousMembers.length === 0;
  const status = protectedFromStaff ? 'OWNER_ONLY' : 'EXPOSED';

  return {
    status,
    protectedFromStaff,
    dangerousRoles,
    dangerousMembers,
    memberScanComplete: fetchedMembers || guild.members.cache.size >= guild.memberCount,
    cachedMemberCount: guild.members.cache.size,
    guildMemberCount: guild.memberCount,
    missingPermissions,
    botRoleId: highest.id,
    botRoleName: highest.name,
    botRolePosition: highest.position,
    ownerId: guild.ownerId,
    guildId: guild.id,
    guildName: guild.name,
    text: protectedFromStaff
      ? 'No cached/fetched non-owner member above Infinity currently has combined Administrator/Kick/Ban permissions. Normal staff should not be able to remove the bot through role hierarchy.'
      : `${dangerousMembers.length} non-owner member(s) above Infinity have combined Administrator/Kick/Ban permissions and may be able to remove it.`
  };
}

function rememberSelfProtection(cfg, guild, assessment) {
  cfg.selfProtection ||= {};
  cfg.selfProtection.ownerId = guild.ownerId;
  cfg.selfProtection.guildName = guild.name;
  cfg.selfProtection.lastSeenAt = Date.now();
  cfg.selfProtection.lastStatus = assessment.status;
  cfg.selfProtection.lastBotRoleId = assessment.botRoleId || null;
  cfg.selfProtection.lastBotRolePosition = assessment.botRolePosition ?? null;
  cfg.selfProtection.lastDangerousRoleIds = (assessment.dangerousRoles || []).map(r => r.id);
  cfg.selfProtection.lastPermissionSnapshot = guild.members.me?.permissions?.bitfield?.toString?.() || null;
}

function protectionSummary(assessment) {
  if (!assessment) return '⚪ Unknown';
  if (assessment.status === 'OWNER_ONLY') return '🛡️ OWNER-ONLY EXPOSURE';
  if (assessment.status === 'EXPOSED') return `⚠️ EXPOSED • ${assessment.dangerousRoles.length} role(s)`;
  return '⚪ UNKNOWN';
}

async function notifyOwnerAfterRemoval(client, guild, cfg, clientId) {
  const ownerId = guild?.ownerId || cfg?.selfProtection?.ownerId;
  if (!ownerId) return false;

  const owner = await client.users.fetch(ownerId).catch(() => null);
  if (!owner) return false;

  const guildName = guild?.name || cfg?.selfProtection?.guildName || 'your server';
  const invite = buildReinviteUrl(clientId);

  return owner.send({
    content:
      `🚨 **INFINITY SELF-GUARD ALERT**\n` +
      `Infinity Security was removed from **${guildName}** or the guild became unavailable to the bot.\n\n` +
      `Discord does not provide bots with a way to cancel their own kick/ban before it happens. ` +
      `If this removal was accidental or unauthorized, check the Audit Log. If Infinity was banned, unban it first, then re-add it:\n${invite}\n\n` +
      `👁️ *The Domain fell. Six Eyes left a recovery route.*`
  }).then(() => true).catch(() => false);
}

module.exports = {
  RECOMMENDED,
  buildReinviteUrl,
  assessSelfProtection,
  rememberSelfProtection,
  protectionSummary,
  notifyOwnerAfterRemoval
};
