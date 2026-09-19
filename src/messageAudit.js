const snapshots = new Map();
const securityDeletes = new Map();
const ghostPingTracker = new Map();

function cleanupMap(map, maxAgeMs) {
  const now = Date.now();
  for (const [key, value] of map.entries()) {
    const at = typeof value === "number" ? value : value?.at;
    if (!at || now - at > maxAgeMs) map.delete(key);
  }
}

function snapshotMessage(message) {
  if (!message?.id || !message.guild) return;
  snapshots.set(message.id, {
    at: Date.now(),
    guildId: message.guild.id,
    channelId: message.channel.id,
    userId: message.author?.id || null,
    bot: Boolean(message.author?.bot),
    content: String(message.content || "").slice(0, 1800),
    userMentions: [...(message.mentions?.users?.keys?.() || [])],
    roleMentions: [...(message.mentions?.roles?.keys?.() || [])],
    everyone: Boolean(message.mentions?.everyone),
    attachments: [...(message.attachments?.values?.() || [])].map(a => ({
      name: a.name,
      contentType: a.contentType || null,
      url: a.url
    })).slice(0, 5)
  });

  if (snapshots.size > 8000) {
    const oldest = [...snapshots.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 1000);
    for (const [id] of oldest) snapshots.delete(id);
  }
}

function getSnapshot(messageId) {
  return snapshots.get(messageId) || null;
}

function removeSnapshot(messageId) {
  const item = snapshots.get(messageId) || null;
  snapshots.delete(messageId);
  return item;
}

function markSecurityDelete(messageId) {
  securityDeletes.set(messageId, Date.now());
  cleanupMap(securityDeletes, 5 * 60 * 1000);
}

function wasSecurityDelete(messageId) {
  cleanupMap(securityDeletes, 5 * 60 * 1000);
  const found = securityDeletes.has(messageId);
  securityDeletes.delete(messageId);
  return found;
}

function recordGhostPing(guildId, userId, windowMs = 5 * 60 * 1000) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const list = (ghostPingTracker.get(key) || []).filter(ts => now - ts < windowMs);
  list.push(now);
  ghostPingTracker.set(key, list);
  return list.length;
}

module.exports = {
  snapshotMessage,
  getSnapshot,
  removeSnapshot,
  markSecurityDelete,
  wasSecurityDelete,
  recordGhostPing
};
