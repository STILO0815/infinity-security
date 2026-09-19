# Infinity Security v12 — Self-Guard / Command Center Hardening

## Added
- Live 3-row `/panel` command center.
- Self-Guard role-hierarchy exposure analysis.
- Member-level permission analysis (combined permissions + highest-role hierarchy).
- Owner DM when Self-Guard exposure appears or Infinity's own roles/permissions change.
- Audit-log warning for `MemberKick` / `MemberBanAdd` targeting Infinity when Discord delivers the event before removal.
- `guildDelete` owner recovery DM with a prebuilt reinvite URL.
- `/selfprotect status` and `/selfprotect harden`.
- Recovery backup + infrastructure repair directly from the panel.
- Security Score now includes Self-Guard state.

## Deliberate limitation
No Discord bot can cancel its own kick/ban or override the server owner. The design reduces non-owner removal exposure through role hierarchy and provides immediate detection/recovery.

## Invariants
- Automatic punishment remains timeout-only.
- Self-Guard recovery permissions intentionally exclude Kick Members and Ban Members.
- Existing Aegis, moderation, mediation, appeals, backups, Voice and aura systems remain enabled.
