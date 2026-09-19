# Infinity Security v14.2 — Full Bot

> GitHub-ready build. Start with [`START_HERE.md`](START_HERE.md), then deploy and run `/auto-setup`.

# ∞ Infinity Security v12 — Command Center + Self-Guard

Infinity Security v12 combines the existing Aegis correlated defense, AI moderation, mediation, appeals, backups, emergency mode and Voice Domains with a new **Command Center** and **Self-Guard**.

## Important Discord limitation

Discord does not provide an API feature that makes a bot absolutely unkickable or unbannable. The server owner always retains authority over installed apps, and a sufficiently high non-owner member with Kick/Ban/Administrator can remove a lower bot. v12 therefore uses the strongest practical design:

- detects exactly which non-owner members are above Infinity and have combined Administrator/Kick/Ban permissions
- warns the owner when removal exposure changes
- monitors changes to Infinity's own roles and permissions
- watches Audit Log removal actions when they are delivered before disconnect
- attempts an owner DM through `guildDelete` after removal
- includes a prebuilt recovery/reinvite URL
- repairs Infinity infrastructure and creates a recovery backup from the panel
- never grants itself Kick/Ban permissions just for Self-Guard

For strongest protection, place Infinity's highest role above every non-owner moderation role that can kick, ban or administer the server. The owner can still remove it; that cannot be bypassed by a Discord bot.

## ∞ Command Center

`/panel` now opens a compact control center with live buttons for:

- 👁️ Status
- 🩺 Health
- ⚠️ Live Threats
- 💯 Security Score
- 🔎 Channel Rescan
- 🌀 Lockdown / Unlock
- 🚨 Emergency Mode
- 💾 Recovery Backup
- 🛠️ Infrastructure Repair
- 👑 Owner Review
- 📊 24h Report
- ✨ Aura cycling
- 🛡️ Self-Guard

Use `/selfprotect status` for a detailed removal-exposure scan and `/selfprotect harden` for owner-only hardening, infrastructure repair and a recovery backup.

---

## Core rule: automatic punishment is TIMEOUT ONLY

Infinity Security does not automatically kick or ban users. When Enforce mode decides action is necessary, the user is timed out. The server owner receives a DM after successful timeout actions.

## Major v6 systems

### 📩 Timeout Appeals
After a successful timeout, the affected user receives a DM with **Appeal Timeout**.

The user can submit a short explanation through a Discord modal. Infinity then:
- creates an appeal ID such as `APP-A1B2C3`
- sends the appeal to the server owner
- includes the original incident, reason, AI confidence and available message evidence
- adds **Approve • Remove Timeout** and **Deny • Close Appeal** buttons

Approve attempts to remove the timeout immediately. Deny closes the appeal and leaves the timeout unchanged.

### 👑 Owner Review Center
Use:
- `/review overview`
- `/review appeal id:<APP-ID>`
- `/review incident id:<INF-ID>`

The review center shows pending appeals, active mediation cases and recent incidents. Incident review includes available AI confidence, message preview, link-scanner evidence and mediation references.

For incident review the owner can use:
- **Remove Timeout**
- **Close Review**

The main `/panel` also has direct **Owner Review** and **Security Score** buttons.

### 🔗 Scam / Link Shield
Infinity analyzes URL structure without visiting the destination.

Signals include:
- fake Discord / Roblox / Steam lookalike domains
- punycode / IDN domains
- direct IP links
- URL shorteners
- suspicious login / verify / gift / Nitro / Robux wording
- embedded URL credentials

Official domains are allowlisted to avoid obvious false positives. Shorteners and young accounts are only risk signals; they are not enough by themselves for punishment.

High-confidence deterministic phishing patterns can trigger the normal timeout-only enforcement path. Medium-risk links are logged or sent to AI Guard for context.

### 👤 Account Risk Context
Infinity can consider account age and how recently a member joined, especially when combined with suspicious links or mass mentions.

**Account age alone never causes punishment.** Very new accounts may be noted in `#bot-logs` for awareness only.

### 👻 Ghost Ping Detection
Infinity caches recent message metadata and watches deleted/edited messages.

It can detect:
- a ping message deleted shortly afterward
- pings edited out of a message
- repeated ghost-ping behavior
- `@everyone` / role / multi-user ping removal

It checks Discord audit logs so a moderator deleting somebody else's message is not treated as the author's self-created ghost ping.

One ordinary removed ping is normally logged only. Multiple pings at once or repeated ghost-ping behavior can trigger a timeout in Enforce mode.

### 📝 Message Edit / Delete Logs
Normal user message edits and deletions can be logged to private `#bot-logs` with before/after previews.

Infinity avoids mirroring private mediation-room content into ordinary edit/delete logs.

### 🎙️ Voice Security
Infinity monitors:
- rapid join / leave / channel-switch spam
- moderator-driven mass moves
- mass disconnect behavior
- rapid server mute / deafen patterns

Moderator actions use Discord audit logs and a short matching window before Infinity treats them as a security pattern. Automatic punishment remains timeout-only.

### 💯 Security Score
Use `/securityscore` or the button in `/panel`.

Infinity checks things such as:
- View Audit Log
- Moderate Members
- Manage Messages
- Manage Channels
- Manage Roles
- Manage Webhooks
- log-channel setup
- Message Content intent
- Anti-Raid / Anti-Nuke status
- channel scan state
- Bot Interaction Shield
- AI availability
- Alert vs Enforce mode

The score is a setup audit, not a guarantee that a server cannot be attacked.

### 🤖 Better False-Positive Handling
AI Guard is explicitly told to distinguish security abuse from:
- Owo-like bot commands
- economy/minigame grinding
- replies to bots
- repeated legitimate bot input
- gaming slang
- friendly trash-talk
- quoted text
- sarcasm
- ordinary disagreements

Bot/minigame interaction does not increment the normal spam burst counter.

### 🤝 AI Dispute Mediation
The existing AI mediation system remains included.

If Infinity sees a likely two-person argument, both users receive a Yes / No mediation choice.

- **Both Yes:** private channel for the two participants + Infinity
- **No:** Owner Review escalation; in Enforce mode the user selecting No receives the configured 24-hour review timeout
- AI answers briefly after participant messages
- users are encouraged to supply screenshots, links, timestamps and transaction proof
- AI does not declare a winner
- a final automatic timeout requires strong evidence of a clear conduct violation

### 🎮 Owo / Bot Interaction Shield
Rapid legitimate interaction with bots is exempt from ordinary message-rate spam detection.

Manage it with:
- `/botinteraction addbot`
- `/botinteraction removebot`
- `/botinteraction addchannel`
- `/botinteraction removechannel`
- `/botinteraction list`

### 🍯 Honeypot / Anti-Catch Safety
Auto-setup scans channel names, topics and categories for trap-like patterns such as honeypot, anti-catch, do-not-type and kick-on-message channels.

Public Infinity personality messages are allowed only in channels classified as **normal**. Infinity stays publicly silent in trap, bot/minigame, mediation and log channels.

Admins can override detection with `/channelpolicy`.

### 🌀 Startup / Aura
On startup Infinity logs a professional status event in `#bot-logs`, for example:

> Six Eyes online. The domain is secured.

Existing Gojo-inspired catch messages, reaction clips, Domain Lockdown, Anti-Raid and Anti-Nuke remain included.

## Commands

- `/setup`
- `/rescan`
- `/status`
- `/panel`
- `/securityscore`
- `/security mode:alert|enforce`
- `/ai mode:smart|all|off`
- `/aura ...`
- `/review overview`
- `/review appeal id:...`
- `/review incident id:...`
- `/botinteraction ...`
- `/channelpolicy ...`
- `/whitelist ...`
- `/mediation status`
- `/incidents`
- `/lockdown`
- `/unlock`

## Installation

Current discord.js 14.27 requires a modern Node.js release. This project declares:

```text
Node.js >= 24.17.0
```

1. Run `npm install`.
2. Rename `.env.example` to `.env`.
3. Add `DISCORD_TOKEN`.
4. Add `CLIENT_ID`.
5. Add `GEMINI_API_KEY` for full AI Guard and AI mediation.
6. Optional: add `GUILD_ID` during development for faster slash-command updates.
7. Run `npm start`.
8. Use `/setup` in the Discord server.
9. Test in Alert mode first.
10. When satisfied, switch to `/security mode:enforce`.

## Discord Developer Portal intents

Enable:
- Server Members Intent
- Message Content Intent

The code also uses Guild Voice States for voice-security events.

## Recommended permissions

- View Audit Log
- Manage Channels
- Manage Roles
- Moderate Members
- Manage Messages
- Manage Webhooks
- View Channels
- Send Messages
- Embed Links
- Attach Files
- Read Message History

**Kick Members and Ban Members are not required by the automatic punishment system.**

The Infinity Security role must be above members it needs to timeout.

## Railway

Environment variables:
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID` optional
- `GEMINI_API_KEY` optional but recommended
- `GEMINI_MODEL=gemini-3.8-flash`

Use persistent storage for the `data/` folder if you want configuration, incidents, mediations and appeals to survive redeploys.

## AI / privacy note

When Gemini features are enabled, selected message text and mediation evidence may be sent to the configured Gemini API for classification or mediation. Mediation screenshots may also be supplied to Gemini. Configure and disclose this appropriately for your Discord community.


---

# 🎙️ New in v7: Infinity Voice Domain

## ➕ Join to Create
During auto-setup, Infinity can create:

- category: `∞ VOICE DOMAIN`
- voice hub: `➕ Create Voice`

When a user joins the hub, Infinity creates a temporary personal room such as:

`👁️ Alex's Domain`

The user is moved into it automatically.

## 👁️ Voice Domain controls
Temporary room owners can use:

- `/voice panel`
- `/voice name`
- `/voice limit`
- `/voice permit`
- `/voice revoke`
- `/voice claim`
- `/voice stats`

The room chat also receives owner-control buttons:

- 🔒 Lock / Unlock
- 👁️ Hide / Show
- 5️⃣ Limit 5
- ♾️ Unlimited

If the original owner leaves but other people remain, another person inside can use
`/voice claim`. Empty temporary rooms are deleted automatically after a short grace period.

## 🌀 Voice Raid Shield
Infinity monitors bursts of users joining the **same** voice channel.

Default behavior:
- 7 joins into one voice channel within 10 seconds
- temporarily denies **new** connections for 60 seconds
- users already inside are not kicked
- writes the event to `#bot-logs`
- creates an incident ID
- posts a short Six Eyes warning in the voice channel's text chat

The lock state is persisted so Infinity can recover cleanly after a restart.

## 📊 Voice Stats
`/voice stats` tracks:
- recorded total voice time
- sessions
- joins
- channel moves
- longest session
- current session time

Infinity does **not** record, transcribe or listen to voice audio.

## 🛡️ Existing Voice Guard
The existing security layer is still active:
- repeated join/leave/move spam
- suspicious mass member moves/disconnects
- rapid server mute/deafen moderation
- timeout-only automatic punishment

## ⚙️ Voice Hub admin
Admins can use:
- `/voicehub setup`
- `/voicehub enable`
- `/voicehub disable`

The bot needs **Manage Channels** and **Move Members** for Join-to-Create to work.


---

# 🛡️ New in v8: Complete Security Suite

## ✅ Human verification / anti-alt gate
`/verification setup|enable|disable|status` creates an **∞ Unverified** role and `#verify` panel. New human members can be restricted until they solve a short in-Discord code challenge. There are **no external verification websites**. New account age is only a warning/risk signal and never a punishment by itself. Verification defaults to OFF so installing Infinity does not unexpectedly lock an existing server.

## 🧬 Permission Guard
Infinity watches dangerous role permission escalations: Administrator, Manage Server/Roles/Channels/Webhooks, Ban Members and Kick Members. Untrusted dangerous role edits/grants are logged, rolled back where possible, and in Enforce mode the responsible executor receives a **timeout only**.

## 💾 Recovery backups
`/backup create`, `/backup list`, `/backup restore id:...` stores server role/channel structure in `data/backups/`. Restore is owner-only and can repair/recreate ordinary categories, text channels, voice channels and non-managed roles. It does not restore message history or deleted member data.

## 🚨 Emergency Mode
`/emergency on` (owner-only) forces Enforce mode, silences public aura chatter, disables new Voice Domains and locks new text/voice participation while preserving permission snapshots. `/emergency off` restores the pre-emergency state.

## 📊 Security Reports
`/reports now period:...` generates 24h / 7d / 30d reports. `/reports daily enabled:true` enables automatic rolling 24-hour summaries in `#bot-logs`.

## ⏱️ Manual Quarantine
`/quarantine` is a manual **timeout-only** containment command with incident IDs, owner DMs and appeal-capable offender DMs. `/release` removes the timeout. No automatic kick/ban path was added.

## ⚙️ Module Config
`/config overview` shows all major protection modules and `/config module` toggles them without editing JSON by hand.


---
# 🎙️ Voice Overdrive v9
New voice systems: Knock Allow/Deny, Co-Owners, ownership transfer, waiting queue, Panic Domain, Gaming/Private/Party/Study/Tournament presets, Party Finder, random teams, 1v1/2v2, tournament rooms, Voice XP + leaderboard, Smart AFK, DM invites, personal room blocklist, Auto Private, Six Eyes Voice Scan and Gojo-inspired text callouts.

Infinity does not record or transcribe voice audio. Automatic server moderation remains timeout-only; room controls only change room access/permissions and team placement.


---

# v9.1 — Context-Buffered Conflict Fix

Infinity no longer reacts to an insult in isolation. The dispute layer buffers the surrounding exchange for about **10 seconds** before deciding what happened.

- One-sided hostility that stays one-sided → timeout in Enforce mode.
- Hostility that becomes mutual during the review window → mediation prompt instead of blindly timing out the first speaker.
- Neutral responses such as “bro, what did I do to you?” are kept as context.
- The detector can retroactively connect an initially untargeted “du …” insult to the person who responds.
- German slang/insult coverage now includes variants such as `hund`, `hs`, `huso`, `behinderter`, `fick dich`, `missgeburt`, and more.
- The AI dispute classifier is explicitly told to judge the **whole buffered exchange**, not only the newest message.

## v9.2 — Friendly Trash-Talk Aura Warning

Infinity now distinguishes playful mutual trash-talk from a real dispute after the context-review window.

If both users insult each other but the surrounding messages strongly show friendly banter or de-escalation, Infinity:
- does **not** timeout anyone
- creates **no strike**
- does **not** open mediation
- sends a short Six-Eyes / Gojo-style warning in the channel
- uses a cooldown so the warning itself cannot become spam

Serious dispute signals such as scam accusations, threats, doxxing/leak language, or similar evidence-related claims prevent this downgrade and continue into the normal dispute/mediation flow.

---

# 🛡️ v10 — Hardening & Bug-Fix Release

This release focuses on **correctness, false-positive reduction and recovery**, not just adding more buttons.

## Conflict engine hardening
- quoted/reported insults no longer count as the sender attacking somebody
- obfuscated insults such as `h.u.r.e.n.s.o.h.n` and common leetspeak are normalized
- busy group chats no longer assign an implicit “du idiot” to an arbitrary recent speaker
- the conflict review window is debounced as new context arrives, with a maximum cap
- distress/“stop” messages block the friendly-banter downgrade
- serious scam, threat, leak/dox and targeted bullying signals stay in the real dispute flow

## Punishment safety
- automatic security punishment remains **timeout-only**
- a new short timeout can never shorten an already longer timeout
- detector actions are deduplicated so two modules cannot punish the same user twice at once
- successful appeals / removed timeouts do not count as future strikes

## Anti-Nuke / Permission Guard
- destructive Channel Delete + Role Delete + Ban events share one mixed burst counter
- rapid channel/role creation is monitored as a nuke pattern too
- webhook create/update/delete activity is all covered
- Permission Guard reports whether rollback actually succeeded, partially succeeded, failed or was disabled
- trusted staff roles can be configured separately from individual whitelisted users

## Link Shield v10
- catches scheme-less links, punycode/unicode tricks and common brand typosquats
- combines suspicious message bait with shortener/link risk even when Gemini is disabled
- does not open untrusted external pages

## Recovery / persistence
- config, incidents, appeals, mediations, voice data and backups use atomic JSON writes with `.bak` recovery
- server backup restore now preserves more role/channel positioning and permission overwrites
- Emergency Mode re-applies restrictions to channels created/edited while emergency is active
- self-healing recreates Infinity-owned infrastructure such as `#bot-logs`, Voice Hub and verification components when removed
- optional automatic recovery backups are created on a rolling interval

## Audit / Voice correctness
- ghost-ping moderator-deletion checks are bound to the correct channel and a tighter audit window
- bot/mod-driven voice moves no longer count as self join/leave spam for the moved user
- voice session state is reconciled after restart so bot downtime is not awarded as Voice XP

Run:
- `npm run check` for syntax checks
- `npm test` for security regressions
- `npm run audit` for both

---

# 🛡️ v11 Aegis — Correlated Defense

v11 changes Infinity from a collection of independent detectors into a **correlated security system**.

## 👁️ Aegis Threat Correlation

Infinity listens to Discord audit-log activity and combines different actions by the same executor inside a short risk window.

Examples of correlated signals include:
- guild/server setting changes
- channel create/update/delete
- channel permission overwrite changes
- role create/update/delete
- kicks, bans, unbans and prunes
- dangerous role grants
- bot additions
- webhook changes
- invite activity
- bulk message deletion
- AutoMod rule create/update/delete
- application-command permission changes
- voice member moves/disconnects
- integration changes

A single normal admin action can stay below the threshold. Mixed attack behavior accumulates a score and can progress through:
- `NORMAL`
- `HIGH`
- `ACTION`
- `CRITICAL`

In Enforce mode, an `ACTION`-level correlated threat can receive Infinity's normal **timeout-only** response. `MAXIMUM` preset can additionally trigger Emergency Mode at `CRITICAL`.

Commands:
- `/threats`
- `/threats user:@user`

## 🎚️ Security presets

`/preset` provides tuned profiles:
- `Relaxed`
- `Balanced`
- `Strict`
- `Maximum`

The presets adjust anti-spam, anti-raid, Anti-Nuke, link risk, AI confidence and Aegis correlation thresholds together instead of changing one isolated value.

## 🩺 Aegis Health Guard

`/health` checks whether Infinity can actually do its job:
- View Audit Log
- Moderate Members
- message/channel/role/webhook permissions
- bot log channel access
- dangerous roles above Infinity's role
- Enforce mode without timeout capability

The periodic integrity sweep also reports new health failures and recovery without endlessly spamming the log channel.

## 💾 Backup integrity sealing

New recovery snapshots receive a SHA-256 integrity digest.

- `/backup verify id:...` verifies a snapshot
- `/backup list` shows `verified`, `legacy` or `corrupt`
- corrupted/modified signed backups are refused before restore
- older v10 backups remain usable as `legacy` snapshots

## 🧠 False-positive philosophy

v11 keeps the earlier protections:
- bot/minigame interaction exemptions
- context-aware conflict review
- friendly trash-talk aura warnings rather than punishment
- quote/reported-speech protection
- evidence-aware mediation
- no punishment based only on account age
- no automatic kick/ban path
- existing longer timeouts are never shortened
- duplicate detector actions are deduplicated

## 🧪 Regression suite

Run:

```bash
npm run audit
```

It checks syntax plus regression tests for:
- quote handling
- obfuscated insults
- mutual disputes
- friendly banter
- distress/harassment
- busy-channel target safety
- local no-AI harassment fallback
- phishing/link variants
- JSON backup recovery
- single-action correlation safety
- mixed cross-vector attacks
- critical compromise scoring
- preset tuning
- timeout-only enforcement invariants

Infinity Security is still a moderation/security aid, not a guarantee that a Discord server cannot be compromised. Use least-privilege roles, Discord account security, and human owner review for high-impact decisions.



---

# ✨ v11.5 — AURA OVERDRIVE

Infinity now has category-specific Six Eyes personality instead of generic catch text.\n
- Scam/phishing catches use cursed-link callouts.
- Anti-Nuke and raids use high-pressure Aegis/Domain responses.
- Permission escalation, ghost pings, voice abuse, harassment and spam have separate line pools.
- Rare **LIMITLESS RESPONSE** messages appear only occasionally in Overdrive mode.
- Threat embeds show a Domain Pressure meter.
- Timeout DMs, owner reports, mediation reports, startup status and Voice Domains share one visual identity.
- `/aura intensity:subtle|balanced|overdrive` controls personality strength.
- Gojo/JJK clips remain optional and rate-limited by the existing clip chance.
- Most lines are original Gojo-inspired copy; only very short iconic references are used sparingly.

---

# v12.1 — Protected Member Guard

Protected member preconfigured by default:
- `1296954480318873652`

Behavior:
- Infinity pre-creates a non-expiring recovery invite when possible.
- `guildMemberRemove` alone is **not** enough to trigger recovery; Infinity checks the Audit Log for an exact `MemberKick` entry, so voluntary leaves do not receive unwanted DMs.
- After a confirmed kick, Infinity first tries to create a fresh invite and falls back to the cached recovery invite.
- The protected user immediately receives the invite by DM when Discord allows the DM.
- If the DM fails or DMs are closed, the server owner receives the recovery link as fallback.
- `#bot-logs` records who kicked the protected member and whether invite/DM recovery succeeded.

Discord does not provide a cancellable pre-kick event, so this system cannot literally stop a kick before it happens. It makes the protected member able to rejoin immediately instead.

---

# 🤝 v13 — AI Mediation 2.0

Infinity Security now uses an evidence-first mediation engine instead of treating the private chat like a normal chatbot.

## Evidence Ledger
Each case maintains structured:
- factual claims / allegations / opinions
- evidence findings and reliability
- contradictions
- agreements / common ground
- open questions
- current mediation phase

## Verified Discord Evidence
Participants can paste a Discord message link from the same server. If Infinity can access it, the bot fetches the **original Discord message** and stores author, channel, message ID, timestamp and content as verified evidence. This is stronger than a screenshot, while screenshots remain useful but are never treated as automatically authentic or complete.

## Smarter AI turns
The mediator:
- answers in 2–4 short sentences
- asks one precise evidence question at a time
- separates allegations from proven facts
- detects meaningful contradictions
- tracks common ground
- never declares a winner
- refuses to guess when evidence is missing
- ignores prompt-injection attempts inside messages, screenshots, filenames and links

## Resolution Gate
A case cannot become ready just because the AI says so. Infinity also checks that:
- both users had enough turns
- no importance-3 claim is still unsupported
- only a small number of core questions remain

## 3-Reviewer AI Jury
At final resolution, three independent roles review the case:
1. **Evidence Reviewer** — provenance, chronology, corroboration and contradictions
2. **Conduct Reviewer** — whether proven behavior violates server rules
3. **False-Positive Reviewer** — actively looks for missing context and reasons not to punish

Automatic timeout requires at least 2/3 agreement, high confidence, and **no strong skeptical dissent**. The jury never decides who 'won' the argument.

## Owner inspection
- `/mediation status` — active cases + current phase
- `/mediation case id:<CASE>` — claims, evidence count, contradictions and open questions

---

# ⚡ v13.1 — Instant Auto-Setup

Infinity can now deploy its full security stack with one command:

`/auto-setup`

Optional command settings:
- `preset`: Balanced (recommended), Strict, Maximum or Relaxed
- `mode`: Alert (recommended first) or Enforce
- `verification`: optionally enable the human verification gate

The command automatically:
1. enables the core Infinity security modules
2. applies the selected security preset
3. creates/repairs private `#bot-logs`
4. scans every channel for normal, bot/minigame and honeypot/trap behavior
5. creates/repairs the Join-to-Create Voice Domain hub
6. prepares Protected Member recovery invites
7. configures Verification when explicitly requested
8. creates a fresh recovery backup
9. runs Self-Guard role/removal exposure analysis
10. runs the Health Guard permission/infrastructure audit
11. calculates the final Security Score
12. returns one clean setup report in Discord

Safe defaults are intentionally used when options are omitted:
- `Balanced` preset
- `Alert` mode
- Verification keeps its current setting (new servers default to off)

This prevents a one-click setup from unexpectedly restricting an existing server or immediately timing out members before the owner has tested the configuration.


---

# 🎮 v14 — Cursed Realms

Infinity now contains an optional **Jujutsu Kaisen-themed grind RPG** inspired by the long-form progression loop of games like Blox Fruits, but built for Discord buttons/panels.

Use `/cursedrealms` to open the game. The RPG has its own persistent data and is isolated from Security/Aegis data.

Highlights:
- Level 1 → 2000+ progression
- Sorcerer Grades
- 8 travel areas
- quests and enemy farming
- Technique Rolls using **in-game Yen only**
- Technique Mastery
- Black Flash timing windows
- Domain Expansions at high Mastery
- area bosses and cursed-tool drops
- server-wide raid boss
- Inventory + Cursed Tools
- PvP via `/cursedduel`

See `CURSED_REALMS_V14.md` for the full game guide.

---

# 👹 v14.1 — Server Boss Event (Discord-wide)

This boss system is **separate from Cursed Realms**. It uses normal Discord server activity.

## `/boss`
Admins can spawn a 24-hour Special Grade server boss:

- `/boss action:spawn difficulty:normal`
- `/boss action:spawn difficulty:hard`
- `/boss action:spawn difficulty:nightmare`
- `/boss action:status`
- `/boss action:cancel`

If an Administrator uses `/boss` with no action while no boss is active, Infinity spawns one automatically.

## Three shared objectives
Every boss randomly receives three objectives from a server-wide pool:

- valid human messages
- combined human voice minutes
- different active text channels
- real Discord reply messages
- unique participating members
- different members contributing at least 3 valid messages

The targets scale with server size and selected difficulty.

Infinity deliberately excludes:

- duplicate spam
- rapid message farming (per-user contribution cooldown)
- bot/minigame interaction such as Owo grinding
- honeypot/trap channels
- bot-log channels
- private mediation rooms
- official AFK voice time

## 24-hour deadline
The boss panel shows live HP calculated from the three objective progress bars.
Infinity refreshes the panel automatically and resolves the event even after a restart because state is stored in `data/serverBosses.json` using Infinity's atomic JSON recovery layer.

## Victory
When all three objectives are complete before the deadline:

- boss is immediately defeated
- contributors can receive `✨ Infinity Boss Slayer` for 24h
- the server receives a 6-hour Blessing
- the next boss is 10% easier

The reward role has **no permissions** and cannot grant moderation power.

## Failure / Server Curse
If the 24 hours expire:

- the server enters a **6-hour Boss Curse**
- another boss cannot be started during that time
- the next boss is **15% harder**
- no destructive Discord action is taken

Infinity does **not** delete channels, remove roles, timeout members, change permissions or otherwise damage the server as a boss-event punishment.

The consequence stays inside the Boss Event system.


---

# 🎬 v14.2 — Infinity Edit Engine (MP4 + Sound)

Infinity now bundles four user-provided MP4 reaction edits with their audio tracks preserved.
They are uploaded directly by the bot.

Default smart sorting:
- 🚓 Raid Convoy → raid, anti-nuke, permission escalation, critical
- 💠 Limitless Burst → timeout, scam, spam, harassment, mass mentions
- 👁️ Six Eyes Calm → general aura, mediation, friendly warnings, verification
- 💜 Purple Finish → anti-nuke, timeout, scam, voice abuse, critical

Automatic edits default to 65% on eligible security catches, plus a critical boost. Raid catches use 85%.
A per-channel cooldown prevents reaction spam.

Admin command `/edit`:
- `/edit list`
- `/edit test clip:...`
- `/edit frequency percent:65`
- `/edit autoplay enabled:true|false`
- `/edit clip clip:... enabled:true|false`
- `/edit category clip:... category:...`
- `/edit sort`
