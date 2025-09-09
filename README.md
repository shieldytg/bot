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
   git clone https://github.com/<your-repo>/shieldy.git
   cd shieldy
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

   Then open `config.json` and insert your **bot token** and other required settings.
   See [configuration documentation](https://sp3rick.github.io/GroupHelp/wiki/configuration/) for details.

---

## ▶️ Run the bot

```bash
node index.js
```

---

## 📖 Useful Links

* [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)
* [Configuration Docs](https://sp3rick.github.io/GroupHelp/wiki/configuration/)
