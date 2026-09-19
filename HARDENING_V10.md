# Infinity Security v10 — Hardening Report

This release was built around reproducible bugs and regression tests rather than feature count alone.

## Fixed / hardened

- Reported speech and quotes no longer count as direct hostility by the sender.
- Obfuscated insults are normalized before local conflict review.
- Busy group chats no longer guess a random target for ambiguous "du ..." insults.
- Conflict review debounce waits for new context without waiting forever.
- Distress language blocks the friendly-banter downgrade.
- Serious scam/threat/dox/bullying signals stay in the serious dispute flow.
- Timeout actions are deduplicated and never shorten an existing longer timeout.
- Approved/removed timeout incidents no longer inflate future strike counts.
- Mixed destructive actions share one anti-nuke burst counter.
- Rapid role/channel creation is also monitored as nuke behavior.
- Webhook create/update/delete events are covered.
- Permission Guard reports real rollback success/partial/failure states.
- Trusted staff roles are supported.
- Link Shield recognizes scheme-less links, typosquats, punycode/unicode risk and scam bait + shortener combinations.
- JSON stores use atomic saves and .bak recovery.
- Backup restore preserves more role/channel ordering and overwrites.
- Emergency Mode covers channels created/edited during the emergency.
- Infinity infrastructure self-heals after deletion.
- Ghost-ping audit matching is tied to the correct channel/time window.
- Moderator/bot-driven voice moves do not count as self-spam for the moved user.
- Voice sessions reconcile after restart so downtime does not become Voice XP.

## Regression checks

Run `npm run audit`.

The test suite covers quote protection, obfuscated insults, the original scam dispute, friendly banter, distress, busy-channel target safety, repeated harassment fallback, Link Shield, offline scam bait + shortener handling, and JSON recovery.

Automatic security punishment remains timeout-only. The source contains no automatic `.kick()` or `.ban()` calls.
