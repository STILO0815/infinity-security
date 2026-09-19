# Cursed Realms — Infinity Security v14

Cursed Realms is an optional Jujutsu Kaisen-themed Discord grind RPG that runs alongside Infinity Security.
It stores game progress separately under `data/games/cursedRealms.json` and does not change moderation/security state.

## Start
- `/cursedrealms` — opens the main game panel
- `/cursedduel opponent:@user` — challenges another player to a PvP Cursed Duel

## Core loop
Quest → Fight → XP/Yen → Level → Travel → Better enemies → Technique Mastery → Bosses → Drops → Domains → Server Raids → PvP

## Main panel
Buttons:
- Fight
- Quest
- Boss
- Raid
- Technique Roll
- Technique
- Inventory
- Travel
- Stats
- Recover

## Progression
- Levels: 1 → 2000+
- Grades: Grade 4 → Grade 3 → Grade 2 → Semi Grade 1 → Grade 1 → Special Grade
- Areas:
  - Tokyo School
  - Abandoned Metro
  - Cursed Hospital
  - Shibuya
  - Hidden Temple
  - Culling Zone
  - Prison Realm
  - Limitless Void

## Techniques
Technique rolls use **in-game Yen only**.

Transparent base odds:
- Common: 55%
- Rare: 28%
- Legendary: 13%
- Mythic: 4%

There is a hard Mythic pity at 40 rolls. No real-money roll system is included.

Current techniques include:
- Ratio Technique
- Cursed Speech
- Boogie Woogie
- Blood Manipulation
- Projection Sorcery
- Ten Shadows
- Idle Transfiguration
- Disaster Flames
- Limitless
- Shrine

Mastery is earned by actually using techniques. Domain Expansion unlocks at 150 Mastery on techniques that have a Domain.

## Combat
Combat buttons:
- M1
- Cursed Technique
- Block
- Dodge
- Black Flash
- Domain Expansion
- Run

M1 attacks can open a short Black Flash timing window. Hitting it gives bonus damage and mastery.

## Bosses and loot
Each area has a boss. Bosses can drop:
- Domain Fragments
- Technique Shards
- Slaughter Blade
- Black Rope
- Playful Cloud
- Inverted Spear

Cursed Tools can be equipped from Inventory and increase combat power.

## Server raids
Raid is shared by the entire Discord server.
- 15 minute timer
- shared boss HP
- 5 second attack cooldown per player
- contribution tracking
- XP/Yen rewards based on contribution
- Domain Fragment rewards on clear

## PvP
`/cursedduel @user`

Each round both players secretly choose:
- Strike
- Guard
- Technique

When both choices are locked, the round resolves. Winner receives XP/Yen and PvP stats.

## Security separation
Cursed Realms:
- cannot timeout members
- cannot kick/ban members
- does not modify Aegis threat scores
- does not touch mediation/appeal data
- uses a separate JSON store

Infinity Security continues running normally even if the game module is unused.
