const DEFAULT_WEIGHTS = Object.freeze({
  guild_update: 4,
  channel_create: 2,
  channel_update: 2,
  channel_delete: 6,
  channel_overwrite: 3,
  role_create: 3,
  role_update: 3,
  role_delete: 6,
  member_kick: 6,
  member_ban: 5,
  member_unban: 2,
  member_prune: 10,
  member_role_update: 4,
  bot_add: 7,
  webhook: 4,
  invite: 1,
  bulk_delete: 4,
  automod_create: 3,
  automod_update: 5,
  automod_delete: 8,
  command_permissions: 5,
  member_move: 2,
  member_disconnect: 3,
  integration_update: 4
});

const signals = new Map();
const escalationCooldowns = new Map();

function key(guildId, userId) { return `${guildId}:${userId}`; }
function cleanup(items, now, windowMs) { return items.filter(item => now - item.at <= windowMs); }
function levelFor(score, cfg) {
  const high = Number(cfg.highScore || 8);
  const action = Number(cfg.actionScore || 12);
  const critical = Number(cfg.criticalScore || 18);
  if (score >= critical) return 'critical';
  if (score >= action) return 'action';
  if (score >= high) return 'high';
  return 'normal';
}

function recordThreatSignal(guildId, userId, type, cfg = {}, metadata = {}) {
  const now = Date.now();
  const windowMs = Math.max(5000, Number(cfg.windowMs || 20000));
  const k = key(guildId, userId);
  const items = cleanup(signals.get(k) || [], now, windowMs);
  const weight = Number((cfg.weights && cfg.weights[type]) ?? DEFAULT_WEIGHTS[type] ?? 1);
  items.push({ at: now, type, weight, metadata });
  signals.set(k, items);

  const score = items.reduce((sum, item) => sum + item.weight, 0);
  const level = levelFor(score, cfg);
  const types = [...new Set(items.map(item => item.type))];
  const cooldownMs = Math.max(5000, Number(cfg.escalationCooldownMs || 15000));
  const last = escalationCooldowns.get(k) || 0;
  const escalationReady = level !== 'normal' && now - last >= cooldownMs;
  if (escalationReady) escalationCooldowns.set(k, now);

  return {
    score, level, types, count: items.length, items: items.slice(), escalationReady,
    shouldAct: score >= Number(cfg.actionScore || 12),
    critical: score >= Number(cfg.criticalScore || 18)
  };
}

function getThreatSnapshot(guildId, userId, cfg = {}) {
  const now = Date.now();
  const windowMs = Math.max(5000, Number(cfg.windowMs || 20000));
  const k = key(guildId, userId);
  const items = cleanup(signals.get(k) || [], now, windowMs);
  if (!items.length) {
    signals.delete(k);
    return { score: 0, level: 'normal', types: [], count: 0, items: [] };
  }
  signals.set(k, items);
  const score = items.reduce((sum, item) => sum + item.weight, 0);
  return { score, level: levelFor(score, cfg), types: [...new Set(items.map(i=>i.type))], count: items.length, items: items.slice() };
}

function topThreatsForGuild(guildId, cfg = {}, limit = 10) {
  const prefix = `${guildId}:`;
  const out = [];
  for (const k of signals.keys()) {
    if (!k.startsWith(prefix)) continue;
    const userId = k.slice(prefix.length);
    const snap = getThreatSnapshot(guildId, userId, cfg);
    if (snap.score > 0) out.push({ userId, ...snap });
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,limit);
}

function clearThreat(guildId, userId) {
  const k = key(guildId, userId);
  signals.delete(k);
  escalationCooldowns.delete(k);
}

module.exports = { DEFAULT_WEIGHTS, recordThreatSignal, getThreatSnapshot, topThreatsForGuild, clearThreat };
