const path = require("path");
const crypto = require("crypto");
const { loadJson, saveJson } = require("./jsonStore");

const FILE = path.join(__dirname, "..", "..", "data", "mediations.json");
let cases = loadJson(FILE, []);

function save() {
  cases = cases.slice(-1000);
  saveJson(FILE, cases);
}

function makeId() {
  return `MED-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function pairKey(userA, userB) {
  return [userA, userB].sort().join(":");
}

function createMediationCase(data) {
  const item = {
    id: makeId(), createdAt: Date.now(), updatedAt: Date.now(),
    guildId: data.guildId, originChannelId: data.originChannelId,
    users: [data.userA, data.userB], pairKey: pairKey(data.userA, data.userB),
    status: "waiting_consent",
    votes: { [data.userA]: null, [data.userB]: null },
    resolutionVotes: { [data.userA]: null, [data.userB]: null },
    invitationMessageId: null, channelId: null, readyPromptSent: false,
    reason: data.reason || "Mutual conflict detected", evidence: data.evidence || [], transcript: [],
    mediatorState: {
      phase: "intake", claims: [], evidenceFindings: [], contradictions: [], agreements: [],
      openQuestions: [], lastSummary: "", lastEvidenceRequest: "", updatedAt: Date.now()
    }
  };
  cases.push(item); save(); return item;
}

function getCase(id) { return cases.find(item => item.id === id) || null; }
function findByChannel(channelId) {
  return cases.find(item => item.channelId === channelId && ["active", "ready_to_resolve"].includes(item.status)) || null;
}
function findActivePair(guildId, userA, userB) {
  const key = pairKey(userA, userB);
  return cases.find(item => item.guildId === guildId && item.pairKey === key && ["waiting_consent", "active", "ready_to_resolve", "owner_review"].includes(item.status)) || null;
}
function updateCase(id, patch) { const item = getCase(id); if (!item) return null; Object.assign(item, patch, { updatedAt: Date.now() }); save(); return item; }
function setVote(id, userId, vote) { const item = getCase(id); if (!item || !item.users.includes(userId)) return null; item.votes[userId] = vote; item.updatedAt = Date.now(); save(); return item; }
function setResolutionVote(id, userId, vote) { const item = getCase(id); if (!item || !item.users.includes(userId)) return null; item.resolutionVotes[userId] = vote; item.updatedAt = Date.now(); save(); return item; }
function addTranscript(id, entry) { const item = getCase(id); if (!item) return null; item.transcript.push({ at: Date.now(), ...entry }); item.transcript = item.transcript.slice(-80); item.updatedAt = Date.now(); save(); return item; }
function activeCasesForGuild(guildId) { return cases.filter(item => item.guildId === guildId && !["closed", "cancelled"].includes(item.status)); }

// ---------- Conflict Engine v10 ----------
// The local layer is intentionally conservative. It should prefer "watch and collect context"
// over punishing a user based on one ambiguous phrase.

const channelHistory = new Map();

const CONFLICT_TERMS = [
  "idiot", "idioten", "dumm", "dumme", "dummer", "dummkopf", "hässlich", "hasslich", "haesslich",
  "fett", "loser", "opfer", "bastard", "arschloch", "hurensohn", "huso", "hs", "missgeburt", "spast",
  "behindert", "behinderter", "behinderte", "fick dich", "verpiss dich", "halt die fresse", "halt dein maul",
  "hund", "köter", "koter", "koeter", "wichser", "fotze", "schlampe", "nutte", "penner", "lappen",
  "shut up", "stupid", "fat", "ugly", "moron", "fuck you", "fck you", "bitch", "asshole", "retard", "kys",
  "scammer", "gescammt", "gescammed", "scammed", "betrüger", "betruger", "betrueger", "lügner", "lugner",
  "luegner", "liar", "verarscht", "geklaut", "stolen", "abgezogen"
];

const STRONG_TERMS = [
  "hurensohn", "huso", "missgeburt", "arschloch", "bastard", "spast", "behindert", "behinderter",
  "fick dich", "halt die fresse", "halt dein maul", "wichser", "fotze", "kys", "fuck you", "fck you", "retard",
  "scammer", "gescammt", "scammed", "betrüger", "betruger", "betrueger"
];

const SERIOUS_DISPUTE_TERMS = [
  "scammer", "gescammt", "gescammed", "scammed", "betrüger", "betruger", "betrueger", "geklaut", "stolen",
  "abgezogen", "bedroht", "drohung", "threat", "ich bring dich um", "ich töte dich", "ich tote dich", "kill you",
  "adresse", "dox", "geleakt", "leak", "report", "anzeige",
  // Bullying/body-shaming should not be auto-downgraded just because people used laughing emojis.
  "fett", "hässlich", "hasslich", "haesslich", "behindert", "behinderter", "retard", "spast"
];

const DISTRESS_TERMS = [
  "hör auf", "hoer auf", "lass mich", "lass das", "warum beleidigst", "was hab ich dir getan", "was habe ich dir getan",
  "was hab ich gemacht", "was habe ich gemacht", "bro was habe ich dir getan", "bro was hab ich dir getan",
  "bitte hör auf", "bitte hoer auf", "please stop", "leave me alone", "what did i do", "what have i done",
  "chill einfach", "beruhig dich", "ich versteh nicht was dein problem ist", "ich verstehe nicht was dein problem ist"
];

const FRIENDLY_EXPLICIT_TERMS = [
  "nur spaß", "nur spass", "war spaß", "war spass", "jk", "just kidding", "alles gut", "alles chillig",
  "komm vc", "komm voice", "bin schon da", "gg", "wir trollen", "nur am trollen"
];

const REPORTING_PATTERNS = [
  /\b(er|sie|der|die|jemand|mein freund|mein bruder|max|bro|[a-z0-9_]{2,20})\s+hat(?:\s+[a-zäöüß0-9_]+){0,4}\s+(gesagt|geschrieben|gemeint)\b/i,
  /\b(er|sie|der|die|jemand|mein freund|mein bruder|max|bro|[a-z0-9_]{2,20})\s+(sagte|schrieb|meinte)\b/i,
  /\b(he|she|they|someone)\s+(said|wrote|called me|told me)\b/i,
  /\b(zitat|quote)\s*:/i,
  /\b(hat zu mir gesagt|hat mir geschrieben|said to me|wrote to me)\b/i
];

function stripCodeAndQuotes(raw = "") {
  let text = String(raw);
  // Discord block quotes / code blocks commonly contain quoted speech or pasted evidence.
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.split(/\r?\n/).filter(line => !/^\s*>/.test(line)).join("\n");
  // German/English paired quotation styles.
  text = text
    .replace(/„[^“]{0,600}“/g, " ")
    .replace(/“[^”]{0,600}”/g, " ")
    .replace(/»[^«]{0,600}«/g, " ")
    .replace(/«[^»]{0,600}»/g, " ")
    .replace(/"[^"\n]{0,600}"/g, " ")
    .replace(/'[^'\n]{2,600}'/g, " ");
  return text;
}

function norm(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[@]/g, "a")
    .replace(/\$/g, "s")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z0-9äöüß\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function squashed(value = "") { return norm(value).replace(/\s+/g, ""); }

function hasTerm(content, term) {
  const n = ` ${norm(content)} `;
  const t = norm(term);
  if (!t) return false;
  if (t.length <= 3 && !t.includes(" ")) return n.includes(` ${t} `);
  if (n.includes(` ${t} `) || n.includes(t)) return true;
  // Detect deliberately split/obfuscated longer insults such as h.u.r.e.n.s.o.h.n.
  const compactTerm = t.replace(/\s+/g, "");
  return compactTerm.length >= 5 && squashed(content).includes(compactTerm);
}

function hasAny(content, terms) { return terms.some(term => hasTerm(content, term)); }
function looksDirectedAtSomeone(content) { return /\b(du|dein|deine|deiner|deinen|dich|dir|you|your|u)\b/.test(norm(content)); }
function hasDistress(content) { return hasAny(content, DISTRESS_TERMS); }
function hasReportingLanguage(content) { return REPORTING_PATTERNS.some(re => re.test(String(content || ""))); }

function directHostilityText(raw = "") {
  const stripped = stripCodeAndQuotes(raw);
  // Reported speech is evidence/context, not automatically the sender's own attack.
  // Conservative rule: if the sentence is framed as somebody else saying/writing it,
  // do not attribute hostile words from that report to the sender. Direct follow-up attacks
  // such as "aber du bist auch ein idiot" still count.
  if (hasReportingLanguage(raw)) {
    const n = norm(stripped);
    const directAfter = /\b(aber|und)\s+du\s+(bist|hast|machst)|\bich\s+(finde|nenne)\s+dich\b/.test(n);
    if (!directAfter) return "";
  }
  return stripped;
}

function hasLaughMarker(content) {
  const raw = String(content || "");
  const text = norm(raw);
  return /😂|🤣|😭|😹|😆|😅/.test(raw) || /\b(ha){2,}\b|\bhaha+\b|\blol+\b|\blmao+\b|\brofl\b|\bxd\b/i.test(text);
}

function friendlyMarkerScore(content) {
  let score = 0;
  if (hasLaughMarker(content)) score += 2;
  if (hasAny(content, FRIENDLY_EXPLICIT_TERMS)) score += 3;
  // "bro" alone is weak evidence and must never neutralize distress/harassment by itself.
  if (/\b(bro|digga|digger|bruder)\b/.test(norm(content))) score += 0.5;
  return score;
}

function friendlyBanterAnalysis(pairMessages) {
  if (!pairMessages.length) return { friendly: false, score: 0, reasons: [] };
  if (pairMessages.some(item => item.serious)) return { friendly: false, score: 0, reasons: ["serious dispute/bullying language present"] };
  if (pairMessages.some(item => item.distress)) return { friendly: false, score: 0, reasons: ["one participant showed distress/de-escalation"] };

  const hostile = pairMessages.filter(item => item.hostile);
  if (hostile.length < 2) return { friendly: false, score: 0, reasons: [] };
  const hostileUsers = new Set(hostile.map(item => item.userId));
  if (hostileUsers.size < 2) return { friendly: false, score: 0, reasons: [] };

  const lastHostileAt = Math.max(...hostile.map(item => item.at));
  const after = pairMessages.filter(item => item.at > lastHostileAt);
  const afterUsers = new Set(after.map(item => item.userId));
  let score = 0; const reasons = [];

  const markerScore = pairMessages.reduce((sum, item) => sum + friendlyMarkerScore(item.content), 0);
  if (markerScore >= 4) { score += 3; reasons.push("strong laughter/friendly markers"); }
  else if (markerScore >= 2) { score += 1; reasons.push("some friendly markers"); }

  if (after.length >= 2 && afterUsers.size >= 2 && after.every(item => !item.hostile && !item.distress)) {
    score += 4; reasons.push("both users continued normally after the insults");
  } else if (after.length >= 2 && after.every(item => !item.hostile && !item.distress)) {
    score += 2; reasons.push("conversation de-escalated after the insults");
  }

  const tail = pairMessages.slice(-3);
  if (tail.length >= 2 && tail.filter(item => !item.hostile && !item.distress).length >= 2) {
    score += 2; reasons.push("recent messages are non-hostile");
  }

  return { friendly: score >= 5, score, reasons };
}

async function inferTarget(message, recent) {
  const mentioned = [...message.mentions.users.values()].find(user => !user.bot && user.id !== message.author.id);
  if (mentioned) return mentioned.id;

  if (message.reference?.messageId) {
    const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (ref && !ref.author.bot && ref.author.id !== message.author.id) return ref.author.id;
  }

  if (!looksDirectedAtSomeone(directHostilityText(message.content || message.content))) return null;

  // Busy-channel safety: only infer an implicit target when the recent turn-taking points
  // to exactly one other human. This avoids assigning "du idiot" to a random last speaker.
  const cutoff = Date.now() - 30000;
  const turns = recent.filter(item => item.at >= cutoff).slice(-6);
  const otherIds = [...new Set(turns.filter(item => item.userId !== message.author.id).map(item => item.userId))];
  if (otherIds.length !== 1) return null;

  return otherIds[0];
}

function hostileBelongsToPair(item, authorId, otherId, pairMessages) {
  if (!item.hostile || item.userId !== authorId) return false;
  if (item.targetId) return item.targetId === otherId;
  if (!item.directed) return false;

  // Retroactive binding for an opening insult with no explicit mention/reply: only bind it
  // if the other user responds soon afterward, keeping first-message examples working.
  return pairMessages.some(next =>
    next.userId === otherId &&
    next.at >= item.at &&
    next.at - item.at <= 30000 &&
    (next.targetId === authorId || next.distress || looksDirectedAtSomeone(next.content))
  );
}

function pairSnapshot(recent, userA, userB) {
  const pairMessages = recent.filter(item => item.userId === userA || item.userId === userB);
  const aHostile = pairMessages.filter(item => hostileBelongsToPair(item, userA, userB, pairMessages));
  const bHostile = pairMessages.filter(item => hostileBelongsToPair(item, userB, userA, pairMessages));
  const aStrong = aHostile.filter(item => item.strong);
  const bStrong = bHostile.filter(item => item.strong);
  const friendlyBanter = friendlyBanterAnalysis(pairMessages);

  let kind = "none"; let aggressorId = null; let targetId = null;
  if (aHostile.length && bHostile.length) kind = friendlyBanter.friendly ? "friendly_banter_candidate" : "mutual_candidate";
  else if (aHostile.length || bHostile.length) {
    kind = "unilateral_candidate";
    aggressorId = aHostile.length ? userA : userB;
    targetId = aggressorId === userA ? userB : userA;
  }

  const evidence = pairMessages.slice(-12).map(item => ({
    messageId: item.messageId, userId: item.userId, content: item.content,
    hostile: item.hostile, strong: item.strong, serious: item.serious,
    distress: item.distress, quotedOrReported: item.quotedOrReported, targetId: item.targetId
  }));
  const aggressorMessages = aggressorId ? (aggressorId === userA ? aHostile : bHostile) : [];

  return {
    kind,
    userA: kind === "unilateral_candidate" ? aggressorId : userA,
    userB: kind === "unilateral_candidate" ? targetId : userB,
    aggressorId, targetId,
    strong: kind === "mutual_candidate" ? Boolean(aStrong.length || bStrong.length) : Boolean(aggressorMessages.some(item => item.strong)),
    hostileCounts: { [userA]: aHostile.length, [userB]: bHostile.length },
    strongCounts: { [userA]: aStrong.length, [userB]: bStrong.length },
    friendlyBanter, evidence, recent: pairMessages,
    lastHostileMessageId: aggressorMessages.at(-1)?.messageId || null,
    contentPreview: aggressorMessages.at(-1)?.content || ""
  };
}

function chooseLikelyCounterpart(recent, seedUserId) {
  const seedHostile = recent.find(item => item.userId === seedUserId && item.hostile && item.directed);
  if (!seedHostile) return null;
  const candidates = recent.filter(item => item.userId !== seedUserId && item.at >= seedHostile.at && item.at - seedHostile.at <= 30000);
  const ids = [...new Set(candidates.map(item => item.userId))];
  if (ids.length !== 1) return null;
  return ids[0];
}

async function observeConflictMessage(message, cfg) {
  const channelKey = `${message.guild.id}:${message.channel.id}`;
  const now = Date.now();
  const recent = (channelHistory.get(channelKey) || []).filter(item => now - item.at < cfg.mediation.mutualWindowMs);

  const raw = message.content || "";
  const directText = directHostilityText(raw);
  const hostile = hasAny(directText, CONFLICT_TERMS);
  const strong = hostile && hasAny(directText, STRONG_TERMS);
  const serious = hostile && hasAny(directText, SERIOUS_DISPUTE_TERMS);
  const distress = hasDistress(raw);
  const quotedOrReported = Boolean(raw !== directText || hasReportingLanguage(raw));
  const targetId = await inferTarget(message, recent);

  const entry = {
    at: now, messageId: message.id, userId: message.author.id,
    content: raw.slice(0, 500), directText: directText.slice(0, 500), hostile, strong, serious, distress,
    quotedOrReported, directed: Boolean(targetId || looksDirectedAtSomeone(directText)), targetId
  };

  recent.push(entry);
  channelHistory.set(channelKey, recent.slice(-60));

  if (channelHistory.size > 2000) {
    const cutoff = now - Math.max(10 * 60 * 1000, cfg.mediation.mutualWindowMs * 2);
    for (const [key, items] of channelHistory) {
      const lastAt = items.at(-1)?.at || 0;
      if (lastAt < cutoff) channelHistory.delete(key);
    }
  }

  if (!hostile) return { kind: "none", recent };
  if (!targetId) {
    return {
      kind: "unresolved_hostility", userA: message.author.id, userB: null, strong,
      evidence: [{ messageId: message.id, userId: message.author.id, content: entry.content, quotedOrReported }], recent
    };
  }
  return pairSnapshot(recent, message.author.id, targetId);
}

function getConflictReviewSnapshot({ guildId, channelId, userA, userB = null, cfg }) {
  const channelKey = `${guildId}:${channelId}`;
  const now = Date.now();
  const recent = (channelHistory.get(channelKey) || []).filter(item => now - item.at < cfg.mediation.mutualWindowMs);
  let counterpart = userB || chooseLikelyCounterpart(recent, userA);

  if (!counterpart) {
    const hostile = recent.filter(item => item.userId === userA && item.hostile && item.directed && !item.quotedOrReported);
    if (!hostile.length) return { kind: "none", recent };
    return {
      kind: "unilateral_candidate", userA, userB: null, aggressorId: userA, targetId: null,
      strong: hostile.some(item => item.strong), hostileCounts: { [userA]: hostile.length },
      strongCounts: { [userA]: hostile.filter(item => item.strong).length },
      evidence: hostile.slice(-8).map(item => ({
        messageId: item.messageId, userId: item.userId, content: item.content, hostile: true,
        strong: item.strong, serious: item.serious, distress: item.distress, targetId: item.targetId
      })),
      recent: recent.filter(item => item.userId === userA),
      lastHostileMessageId: hostile.at(-1)?.messageId || null,
      contentPreview: hostile.at(-1)?.content || ""
    };
  }
  return pairSnapshot(recent, userA, counterpart);
}

// Test helper: clears only ephemeral context, never persistent mediation cases.
function _resetConflictState() { channelHistory.clear(); }

module.exports = {
  createMediationCase, getCase, findByChannel, findActivePair, updateCase, setVote, setResolutionVote,
  addTranscript, activeCasesForGuild, observeConflictMessage, getConflictReviewSnapshot,
  _test: { norm, stripCodeAndQuotes, directHostilityText, hasAny, friendlyBanterAnalysis, _resetConflictState }
};
