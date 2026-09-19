const voiceChanges = new Map();
const executorMoves = new Map();
const executorModeration = new Map();

function track(map, key, windowMs) {
  const now = Date.now();
  const list = (map.get(key) || []).filter(ts => now - ts < windowMs);
  list.push(now);
  map.set(key, list);
  return list.length;
}

function trackSelfVoiceChange(guildId, userId, windowMs = 30000) {
  return track(voiceChanges, `${guildId}:${userId}`, windowMs);
}

function trackExecutorMove(guildId, userId, windowMs = 12000) {
  return track(executorMoves, `${guildId}:${userId}`, windowMs);
}

function trackExecutorModeration(guildId, userId, windowMs = 12000) {
  return track(executorModeration, `${guildId}:${userId}`, windowMs);
}

module.exports = { trackSelfVoiceChange, trackExecutorMove, trackExecutorModeration };
