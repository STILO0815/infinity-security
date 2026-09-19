function accountRisk(member, context = {}) {
  if (!member?.user) return { score: 0, level: "unknown", reasons: [] };

  const now = Date.now();
  const ageDays = Math.max(0, (now - member.user.createdTimestamp) / 86400000);
  const joinedMinutes = member.joinedTimestamp
    ? Math.max(0, (now - member.joinedTimestamp) / 60000)
    : null;

  let score = 0;
  const reasons = [];

  if (ageDays < 1) {
    score += 3;
    reasons.push("account younger than 1 day");
  } else if (ageDays < 7) {
    score += 2;
    reasons.push("account younger than 7 days");
  } else if (ageDays < 30) {
    score += 1;
    reasons.push("account younger than 30 days");
  }

  if (joinedMinutes !== null && joinedMinutes < 10) {
    score += 2;
    reasons.push("just joined the server");
  }

  // These only enrich an already suspicious event. Age alone must never punish.
  if (context.hasSuspiciousLink) {
    score += 2;
    reasons.push("new-account signal combined with suspicious link");
  }

  if (context.massMentions) {
    score += 1;
    reasons.push("new-account signal combined with mass mentions");
  }

  return {
    score,
    level: score >= 6 ? "high" : score >= 3 ? "elevated" : "low",
    ageDays: Number(ageDays.toFixed(1)),
    joinedMinutes: joinedMinutes === null ? null : Number(joinedMinutes.toFixed(1)),
    reasons
  };
}

module.exports = { accountRisk };
