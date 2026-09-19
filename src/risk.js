const recentContent = new Map();

function rememberMessage(message) {
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const normalized = (message.content || "").trim().toLowerCase();
  const list = recentContent.get(key) || [];
  const recent = list.filter(x => now - x.ts < 20000);
  const duplicateCount = normalized ? recent.filter(x => x.text === normalized).length : 0;
  recent.push({ ts: now, text: normalized });
  recentContent.set(key, recent.slice(-20));
  return { recentCount: recent.length, duplicateCount };
}

function statsFor(message) {
  const content = message.content || "";
  const urls = content.match(/https?:\/\/\S+/gi) || [];
  const invites = content.match(/(?:discord\.gg|discord\.com\/invite)\/\S+/gi) || [];
  const mentions = message.mentions.users.size + message.mentions.roles.size;
  const letters = content.replace(/[^a-zA-ZÄÖÜäöüß]/g, "");
  const caps = (letters.match(/[A-ZÄÖÜ]/g) || []).length;
  const emojiCount = (content.match(/<a?:\w+:\d+>|\p{Extended_Pictographic}/gu) || []).length;

  return {
    urls: urls.length,
    invites: invites.length,
    mentions,
    capsRatio: letters.length >= 8 ? Number((caps / letters.length).toFixed(2)) : 0,
    emojiCount,
    repeatedChars: /(.)\1{7,}/i.test(content),
    repeatedWords: /\b(\w{2,})\b(?:\s+\1\b){3,}/i.test(content),
    suspiciousTerms: /\b(free\s*nitro|steam\s*gift|claim\s*now|airdrop|crypto\s*giveaway|verify\s*here|limited\s*time|click\s*here|free\s*robux|scan\s*this\s*qr|login\s*here)\b/i.test(content)
  };
}

function analyzeLocal(message, context = {}) {
  const history = rememberMessage(message);
  const stats = statsFor(message);
  const botInteraction = Boolean(context.isBotInteraction);

  let score = 0;
  const reasons = [];
  let category = "spam";

  // Security-sensitive signals still matter even in minigame/bot channels.
  if (stats.mentions >= 7) {
    score += 6;
    reasons.push("mass mentions");
    category = "mass_mention";
  } else if (stats.mentions >= 4) {
    score += 3;
    reasons.push("many mentions");
    category = "mass_mention";
  }

  if (stats.suspiciousTerms) {
    score += 4;
    reasons.push("possible scam wording");
    category = "scam";
  }

  if (stats.urls >= 3) {
    score += 3;
    reasons.push("many links");
  } else if (stats.urls >= 1 && stats.suspiciousTerms) {
    score += 1;
  }

  if (stats.invites >= 2) {
    score += 3;
    reasons.push("repeated Discord invites");
  }

  // Bot/minigame interaction is explicitly allowed to be repetitive and fast.
  if (!botInteraction) {
    if (stats.capsRatio >= 0.86 && message.content.length >= 16) {
      score += 1;
      reasons.push("heavy caps");
    }

    if (stats.emojiCount >= 18) {
      score += 2;
      reasons.push("emoji flood");
    }

    if (stats.repeatedChars || stats.repeatedWords) {
      score += 2;
      reasons.push("repetitive content");
    }

    if (history.duplicateCount >= 2) {
      score += 5;
      reasons.push("duplicate message flooding");
    } else if (history.duplicateCount === 1) {
      score += 2;
      reasons.push("repeated message");
    }

    if (history.recentCount >= 7) {
      score += 3;
      reasons.push("rapid message rate");
    }
  }

  return {
    score,
    reasons,
    stats,
    history,
    category,
    botInteraction,
    botInteractionReason: context.botInteractionReason || null,
    channelPolicy: context.channelPolicy || "normal"
  };
}

module.exports = { analyzeLocal };
