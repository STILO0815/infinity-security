const { domainToASCII } = require("url");

const OFFICIAL_DOMAINS = [
  "discord.com", "discord.gg", "discord.gift", "discordapp.com", "discordapp.net",
  "roblox.com", "www.roblox.com", "steamcommunity.com", "steampowered.com",
  "github.com", "youtube.com", "youtu.be", "google.com", "microsoft.com"
];
const SHORTENERS = new Set(["bit.ly", "tinyurl.com", "cutt.ly", "rb.gy", "shorturl.at", "t.co", "is.gd", "tiny.cc"]);
const BRANDS = [
  { brand:"discord", official:["discord.com","discord.gg","discord.gift","discordapp.com","discordapp.net"] },
  { brand:"roblox", official:["roblox.com"] },
  { brand:"steam", official:["steamcommunity.com","steampowered.com"] }
];

function unique(list) { return [...new Set(list)]; }

function extractUrls(content = "") {
  const text = String(content);
  const explicit = text.match(/https?:\/\/[^\s<>()]+/gi) || [];
  const schemeless = text.match(/(?<![@\w])(?:www\.)?(?:[a-z0-9\u0080-\uffff-]+\.)+[a-z\u0080-\uffff]{2,}(?:\/[^^\s<>()]*)?/gi) || [];
  const normalized = [...explicit];
  for (const raw of schemeless) {
    if (explicit.some(x => x.toLowerCase().includes(raw.toLowerCase()))) continue;
    normalized.push(raw);
  }
  return unique(normalized).slice(0, 12);
}

function hostIsOfficial(host) { return OFFICIAL_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`)); }
function looksLikeIp(host) {
  const parts = host.split(".");
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function levenshtein(a,b) {
  const m=a.length,n=b.length, row=Array.from({length:n+1},(_,i)=>i);
  for(let i=1;i<=m;i++){
    let prev=row[0]; row[0]=i;
    for(let j=1;j<=n;j++){
      const old=row[j];
      row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));
      prev=old;
    }
  }
  return row[n];
}

function brandTypo(host) {
  const labels = host.split(".").filter(Boolean);
  const candidates = labels.flatMap(label => [label, ...label.split(/[-_]+/)]).filter(Boolean);
  for (const rule of BRANDS) {
    const valid = rule.official.some(domain => host === domain || host.endsWith(`.${domain}`));
    if (valid) continue;
    for (const label of candidates) {
      const compact = label.replace(/[^a-z0-9]/g, "").replace(/0/g,"o").replace(/1/g,"i");
      if (compact.includes(rule.brand)) return rule.brand;
      if (compact.length >= Math.max(4, rule.brand.length - 2) && levenshtein(compact, rule.brand) <= 2) return rule.brand;
    }
  }
  return null;
}

function analyzeUrl(raw) {
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try { url = new URL(candidate); }
  catch { return { url:raw, risk:1, reasons:["malformed URL"], critical:false }; }

  const originalHost = url.hostname.toLowerCase();
  const asciiHost = domainToASCII(originalHost) || originalHost;
  const joined = `${asciiHost}${url.pathname}${url.search}`.toLowerCase();
  let risk=0; const reasons=[];

  if (hostIsOfficial(asciiHost)) return { url:raw, host:asciiHost, risk:0, reasons:["known official domain"], critical:false };

  if (url.username || url.password) { risk+=5; reasons.push("URL contains embedded credentials/user-info"); }
  if (/[^\x00-\x7F]/.test(originalHost) || asciiHost.includes("xn--")) { risk+=4; reasons.push("unicode/punycode hostname can hide lookalike characters"); }
  if (looksLikeIp(asciiHost)) { risk+=2; reasons.push("direct IP address link"); }
  if (SHORTENERS.has(asciiHost)) { risk+=2; reasons.push("URL shortener hides destination"); }

  const typo = brandTypo(asciiHost);
  if (typo) { risk+=5; reasons.push(`possible ${typo} impersonation/typosquat domain`); }

  const phishingKeyword = /\b(nitro|free[-_ ]?robux|gift|claim|verify|verification|login|signin|wallet|airdrop|reward|redeem|password|2fa|qr)\b/i.test(joined);
  if (phishingKeyword) { risk+=2; reasons.push("phishing/giveaway keywords in URL"); }

  if (/\.(zip|mov|top|click|xyz|shop|live|info|lol|icu)$/i.test(asciiHost)) { risk+=1; reasons.push("higher-risk generic TLD"); }
  if ((asciiHost.match(/-/g)||[]).length >= 3) { risk+=1; reasons.push("heavily hyphenated hostname"); }
  if (asciiHost.length > 45) { risk+=1; reasons.push("unusually long hostname"); }

  const critical = risk >= 7 || (risk >= 6 && phishingKeyword) || (Boolean(typo) && phishingKeyword);
  return { url:raw, host:asciiHost, risk, reasons, critical };
}

function analyzeMessageLinks(content = "") {
  const urls=extractUrls(content);
  const results=urls.map(analyzeUrl);
  const contextPhishing = /\b(free\s*nitro|free\s*robux|claim\s*(now|here)?|verify\s*(here|account)?|login\s*(here|now)?|scan\s*(this\s*)?qr|steam\s*gift|airdrop|wallet|password|2fa\s*code)\b/i.test(String(content));

  // Combine suspicious message bait with an already-obscured/non-official link.
  if (contextPhishing) {
    for (const item of results) {
      if (item.risk > 0) {
        item.risk += 3;
        item.reasons = unique([...item.reasons, "scam/phishing bait in surrounding message"]);
        if (item.risk >= 7 || item.reasons.some(r => /shortener|impersonation|punycode/i.test(r))) item.critical = true;
      }
    }
  }

  const totalRisk=results.reduce((sum,item)=>sum+item.risk,0);
  const maxRisk=results.reduce((max,item)=>Math.max(max,item.risk),0);
  const critical=results.some(item=>item.critical);
  const reasons=unique(results.flatMap(item=>item.reasons).filter(r=>r!=="known official domain"));
  return { hasLinks:urls.length>0, urls, results, totalRisk, maxRisk, critical, reasons, contextPhishing };
}

module.exports = { analyzeMessageLinks, _test: { extractUrls, analyzeUrl, levenshtein, brandTypo } };
