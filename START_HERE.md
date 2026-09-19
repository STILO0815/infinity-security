# Infinity Security — GitHub Setup

This ZIP is already arranged as a GitHub repository. Do **not** upload the outer ZIP itself to GitHub; extract it first, then upload the files/folders inside.

## 1. Create the Discord bot

In the Discord Developer Portal:
1. Create an application and bot.
2. Enable **Server Members Intent** and **Message Content Intent**.
3. Copy the bot token and Application ID.
4. Invite the bot with the permissions described in `README.md`.
5. Put the Infinity bot role high enough to moderate the members/roles it must protect.

## 2. Put this project on GitHub

Create a new GitHub repository and upload **everything in this folder**, including:

- `src/`
- `assets/`
- `data/`
- `tests/`
- `package.json`
- `.env.example`
- `.gitignore`
- `railway.json`

Never upload your real `.env` file or Discord/Gemini tokens.

## 3. Railway variables

Create a Railway project from the GitHub repository and add these variables:

```text
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_id
GUILD_ID=your_test_server_id_optional
GEMINI_API_KEY=your_gemini_key_optional
GEMINI_MODEL=gemini-3.8-flash
```

`GUILD_ID` is optional but useful while testing because slash commands update faster in one server.

## 4. Deploy

Railway will run:

```text
npm start
```

The repository also contains `railway.json`, so no custom start command should normally be needed.

## 5. First Discord command

After the bot is online, use:

```text
/auto-setup
```

Safe default: Balanced + Alert + Verification off.

For stronger protection after testing:

```text
/auto-setup preset:Maximum mode:Enforce verification:true
```

## Useful checks

```text
npm run check
npm test
npm run audit
```

## Important

- The security bot uses automatic **timeouts**, not automatic user kicks/bans.
- Runtime JSON databases are intentionally ignored by Git so deploy-generated state is not committed accidentally.
- The reaction MP4 files in `assets/reactions/` are required for the Edit Engine.
- If hosting on an ephemeral filesystem, use persistent storage for `data/` if you want settings/game progress to survive redeploys.
