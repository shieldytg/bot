# 🛡️ Shieldy

An open-source re-creation of **Telegram Group Manager — Group Help**, built with **Node.js** and powered by [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api).

🔹 Official instance: [@shieldy\_robot](https://t.me/shieldy_robot)

---

## 🚀 Features

* Automatic Telegram group management
* Anti-spam & moderation tools
* Flexible configuration via a config file
* Easy deployment across platforms

---

## ⚙️ Requirements

* **Node.js 20.x** (⚠️ only this version is supported)
* **npm** (comes with Node.js)
* Python 3, `make`, `g++`, `node-gyp` (depending on OS)
* **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** – required for the video download feature
* **[ffmpeg](https://ffmpeg.org)** *(optional)* – required for 1080p quality on YouTube; without it the bot falls back to 720p combined streams

Check your Node.js version:

```bash
node -v
```

---

## 📥 Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/shieldytg/bot.git
   cd bot
   ```

2. Install required build tools depending on your OS:

   **Windows** (requires [Chocolatey](https://chocolatey.org/install#individual)):

   ```bash
   choco install python visualstudio2022-workload-vctools -y
   ```

   **Ubuntu/Debian**:

   ```bash
   apt update
   apt install -y python3 make g++
   npm install -g node-gyp
   ```

   **macOS**:

   ```bash
   brew install python
   xcode-select --install
   npm install -g node-gyp
   ```

3. Install Node.js dependencies:

   ```bash
   npm install
   ```

4. Rename the example configuration file and fill in your data:

   ```bash
   cp config.json.example config.json
   ```
   Or rename config.json.example to config.json

   Then open `config.json` and insert your **bot token** and other required settings.
   See [configuration documentation](https://sp3rick.github.io/GroupHelp/wiki/configuration/) for details.

5. Enable inline mode and inline feedback in [@BotFather](https://t.me/BotFather) to allow users to download videos from any chat using `@YourBot <url>`:

   - Send `/setinline` → select your bot → enter a placeholder text (e.g. `Paste a video link`)
   - Open your bot in WEB UI → select your bot → Open settings and set inline feedback to `100%`

   Without these steps the inline feature will not work.

6. Fill in the settings inside `config.json`. Below is a description of all required fields:

- **botToken** – Your bot token from @BotFather.  
- **botStaff** – Your Telegram ID (use @GetMyChatID_Bot).  
- **deleteChatDataAfterBotRemove** – Whether to remove chat data from the database after the bot is removed from the group.  
- **overwriteChatDataIfReAddedToGroup** – Whether to reset all chat data if the bot is added again.  
- **allowExternalApi** – Allow or deny access to third-party APIs.  
- **geminiApiKey** – Gemini API key used for voice recognition.  
  **If you want to disable audio recognition, leave the default value.**  
  Get your key here: https://aistudio.google.com/app/api-keys  
- **geminiModel** – Gemini model to be used.  
- **reserveLang** – Reserve language.  
- **saveDatabaseSeconds** – How often the database should be saved (in seconds).  
- **saveTagResolverSeconds** – How often the bot should refresh the user’s username.  
- **maxCallbackAge** – Maximum allowed callback age.  
- **preventSetUselessRoles** – Prevent assigning unnecessary roles.  
- **chatWhitelist** – List of allowed chats (used only if `privateWhitelist` is enabled).  
- **privateWhitelist** – Restrict bot usage only to the chats listed in `chatWhitelist`.  
- **chatBlacklist** – List of prohibited chats.  
- **ANTIFLOOD_msgMin** – Minimum number of messages after which the system considers it flooding.  
- **ANTIFLOOD_msgMax** – Maximum number of messages allowed during flood detection.  
- **ANTIFLOOD_timeMin** – Minimum flood time window.  
- **ANTIFLOOD_timeMax** – Maximum flood time window.  
- **minWarns** – Minimum number of warnings.  
- **maxWarns** – Maximum number of warnings.
- **inlineDumpChatId** *(optional)* – Chat ID of a private channel or group used by the inline video download feature.  
  When a user requests a video via inline mode (`@bot <url>`), the bot must upload the file somewhere to obtain a Telegram `file_id` before it can deliver the result inline. This field specifies where those uploads go.  
  **How to set it up:**
  1. Create a private Telegram channel (e.g. *My Bot Dump*).
  2. Add your bot as an administrator with permission to post messages.
  3. Forward any message from that channel to [@GetMyChatID_Bot](https://t.me/GetMyChatID_Bot) to get its chat ID (it will be a negative number like `-1001234567890`).
  4. Set `"inlineDumpChatId": -1001234567890` in `config.json`.

  If left as `null`, the bot will attempt to upload to the requesting user's private chat instead, which requires that user to have started the bot with `/start` beforehand.


---

## ▶️ Run the bot

```bash
node index.js
```

---

Original - https://github.com/Sp3rick/GroupHelp

## 📖 Useful Links

* [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)
* [Configuration Docs](https://sp3rick.github.io/GroupHelp/wiki/configuration/)
