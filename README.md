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

   **Windows** (requires [Chocolatey](https://chocolatey.org/)):

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

5. Fill in the settings inside `config.json`. Below is a description of all required fields:

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
