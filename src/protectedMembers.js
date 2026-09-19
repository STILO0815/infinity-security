function isProtectedMember(cfg, userId) {
  return Boolean(
    cfg?.protectedMembers?.enabled &&
    Array.isArray(cfg.protectedMembers.userIds) &&
    cfg.protectedMembers.userIds.includes(String(userId))
  );
}

function cachedRecoveryInvite(cfg, userId) {
  return cfg?.protectedMembers?.recoveryInvites?.[String(userId)]?.url || null;
}

function candidateInviteChannels(guild) {
  const me = guild.members?.me;
  const list = [...(guild.channels?.cache?.values?.() || [])]
    .filter(channel => channel && typeof channel.isTextBased === "function" && channel.isTextBased())
    .filter(channel => {
      try {
        const perms = channel.permissionsFor?.(me);
        return !perms || perms.has?.("CreateInstantInvite");
      } catch {
        return false;
      }
    });

  const system = guild.systemChannel;
  if (system && list.some(channel => channel.id === system.id)) {
    return [system, ...list.filter(channel => channel.id !== system.id)];
  }

  return list;
}

async function createRecoveryInvite(guild, cfg, userId, reason = "Infinity protected-member recovery") {
  if (!guild?.invites?.create) return null;

  const channel = candidateInviteChannels(guild)[0];
  if (!channel) return null;

  const invite = await guild.invites.create(channel.id, {
    maxAge: 0,
    maxUses: 0,
    temporary: false,
    unique: true,
    reason
  }).catch(() => null);

  if (!invite?.url) return null;

  cfg.protectedMembers ||= {};
  cfg.protectedMembers.recoveryInvites ||= {};
  cfg.protectedMembers.recoveryInvites[String(userId)] = {
    url: invite.url,
    code: invite.code || null,
    channelId: channel.id,
    createdAt: Date.now()
  };

  return invite.url;
}

async function ensureProtectedRecoveryInvites(guild, cfg) {
  if (!cfg?.protectedMembers?.enabled) return [];
  const results = [];

  for (const userId of cfg.protectedMembers.userIds || []) {
    let url = cachedRecoveryInvite(cfg, userId);
    if (!url) {
      url = await createRecoveryInvite(
        guild,
        cfg,
        userId,
        `Infinity pre-created recovery invite for protected member ${userId}`
      );
    }
    results.push({ userId, url });
  }

  return results;
}

async function sendProtectedKickDm(user, guildName, inviteUrl) {
  if (!user?.send || !inviteUrl) return false;

  return user.send({
    content:
      `👁️ **INFINITY PROTECTED MEMBER GUARD**\n` +
      `You were kicked from **${guildName}**. Six Eyes detected the removal and opened a recovery route immediately.\n\n` +
      `🔗 **Rejoin:** ${inviteUrl}\n\n` +
      `🌀 *You got removed from the Domain. Infinity left the door open.*`
  }).then(() => true).catch(() => false);
}

async function sendOwnerProtectedKickFallback(guild, userId, executorId, inviteUrl, dmDelivered) {
  const owner = await guild.fetchOwner?.().catch(() => null);
  if (!owner?.send) return false;

  return owner.send({
    content:
      `🚨 **PROTECTED MEMBER KICK DETECTED**\n` +
      `<@${userId}> was kicked from **${guild.name}**.\n` +
      `Executor: ${executorId ? `<@${executorId}>` : "Unknown"}\n` +
      `Protected-user DM: **${dmDelivered ? "SENT" : "FAILED / DMs CLOSED"}**\n\n` +
      `Recovery invite: ${inviteUrl || "Could not create one — check Create Invite permission."}`
  }).then(() => true).catch(() => false);
}

module.exports = {
  isProtectedMember,
  cachedRecoveryInvite,
  createRecoveryInvite,
  ensureProtectedRecoveryInvites,
  sendProtectedKickDm,
  sendOwnerProtectedKickFallback
};
