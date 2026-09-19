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
