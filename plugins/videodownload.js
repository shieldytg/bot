const LGHelpTemplate = require("../GHbot.js");
const { bold } = require("../api/utils/utils.js");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const SITES = {
    youtube:   { label: "YouTube",   hosts: ["youtube.com", "youtu.be"] },
    tiktok:    { label: "TikTok",    hosts: ["tiktok.com", "vm.tiktok.com"] },
    instagram: { label: "Instagram", hosts: ["instagram.com"] },
    facebook:  { label: "Facebook",  hosts: ["facebook.com", "fb.com", "fb.watch"] },
    twitter:   { label: "Twitter/X", hosts: ["twitter.com", "x.com", "t.co"] },
    vimeo:     { label: "Vimeo",     hosts: ["vimeo.com"] },
    twitch:    { label: "Twitch",    hosts: ["twitch.tv"] },
    reddit:    { label: "Reddit",    hosts: ["reddit.com", "redd.it"] },
};

const DEFAULT_SITES = {
    youtube: true, tiktok: true, instagram: true, facebook: true,
    twitter: false, vimeo: false, twitch: false, reddit: false,
};

const MAX_FILE_BYTES = 49 * 1024 * 1024;
const LONG_VIDEO_MINUTES = 60;
const HIGH_QUALITY_THRESHOLD_MINUTES = 25;

function ensureSettings(chat) {
    if (!chat.videodownload) {
        chat.videodownload = { state: true, sites: Object.assign({}, DEFAULT_SITES) };
    }
    if (!chat.videodownload.sites) {
        chat.videodownload.sites = Object.assign({}, DEFAULT_SITES);
    }
    return chat;
}

function extractUrls(msg) {
    const text = msg.text || msg.caption || "";
    const found = [];

    const re = /https?:\/\/[^\s<>"'\]]+/gi;
    let m;
    while ((m = re.exec(text)) !== null) found.push(m[0]);

    const entities = (msg.entities || []).concat(msg.caption_entities || []);
    for (const e of entities) {
        if (e.type === "text_link" && e.url) found.push(e.url);
    }

    return found.filter((v, i, a) => a.indexOf(v) === i);
}

function findSupportedUrl(urls, sites) {
    for (const raw of urls) {
        try {
            const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
            for (const [key, info] of Object.entries(SITES)) {
                if (!sites[key]) continue;
                for (const h of info.hosts) {
                    if (host === h || host.endsWith("." + h)) return raw;
                }
            }
        } catch (_) {}
    }
    return null;
}

function ytDlpInfo(url) {
    return new Promise((resolve, reject) => {
        let stdout = "";
        const p = spawn("yt-dlp", ["--dump-json", "--no-playlist", url]);
        p.stdout.on("data", d => { stdout += d; });
        p.on("close", code => {
            if (code !== 0) return reject(new Error("yt-dlp info exit code " + code));
            try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
        });
        p.on("error", reject);
    });
}

function ytDlpRun(url, outTemplate, extraArgs) {
    return new Promise((resolve, reject) => {
        const p = spawn("yt-dlp", ["--no-playlist", ...extraArgs, "-o", outTemplate, url]);
        p.on("close", code => {
            if (code !== 0) reject(new Error("yt-dlp exit code " + code));
            else resolve();
        });
        p.on("error", reject);
    });
}

function firstFileIn(dir) {
    try {
        const skip = [".part", ".ytdl", ".jpg", ".jpeg", ".png", ".webp", ".json", ".description"];
        const files = fs.readdirSync(dir).filter(f => !skip.some(ext => f.endsWith(ext)));
        return files.length ? path.join(dir, files[0]) : null;
    } catch (_) { return null; }
}

function rmDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function main(args) {
    const GHbot = new LGHelpTemplate(args);
    const { TGbot, db } = GHbot;
    const l = global.LGHLangs;

    // ── Message handler ──────────────────────────────────────────────────────
    GHbot.onMessage(async (msg, chat, user) => {
        if (!chat || !chat.isGroup) return;

        chat = ensureSettings(chat);
        if (!chat.videodownload.state) return;

        const urls = extractUrls(msg);
        if (!urls.length) return;

        const targetUrl = findSupportedUrl(urls, chat.videodownload.sites);
        if (!targetUrl) return;

        const lang = chat.lang;

        let loadingMsg;
        try {
            loadingMsg = await GHbot.sendMessage(user.id, msg.chat.id, l[lang].VIDEODL_DOWNLOADING, {
                parse_mode: "HTML",
                reply_parameters: { chat_id: msg.chat.id, message_id: msg.message_id, allow_sending_without_reply: true },
            });
        } catch (_) { return; }

        const editStatus = (text) => GHbot.editMessageText(user.id, text, {
            chat_id: loadingMsg.chat.id, message_id: loadingMsg.message_id,
            parse_mode: "HTML", reply_markup: { inline_keyboard: [] },
        });

        const tmpDir = path.join(os.tmpdir(), "shieldy_vdl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8));
        fs.mkdirSync(tmpDir, { recursive: true });

        try {
            const info = await ytDlpInfo(targetUrl);
            const durationSec = info.duration || 0;
            const durationMin = durationSec / 60;
            const isAudioOnly = !info.vcodec || info.vcodec === "none";

            if (durationMin > LONG_VIDEO_MINUTES) {
                await editStatus(l[lang].VIDEODL_TOO_LONG);
                rmDir(tmpDir);
                return;
            }

            if (isAudioOnly) {
                await ytDlpRun(targetUrl, path.join(tmpDir, "output.%(ext)s"), [
                    "-x", "--audio-format", "mp3", "--audio-quality", "0",
                ]);

                const filePath = path.join(tmpDir, "output.mp3");
                const actualPath = fs.existsSync(filePath) ? filePath : firstFileIn(tmpDir);
                if (!actualPath) throw new Error("audio file not found");

                if (fs.statSync(actualPath).size > MAX_FILE_BYTES) {
                    await editStatus(l[lang].VIDEODL_TOO_LARGE);
                    rmDir(tmpDir);
                    return;
                }

                await TGbot.sendAudio(msg.chat.id, fs.createReadStream(actualPath), {
                    caption: (info.title || "").slice(0, 1024),
                    duration: info.duration || undefined,
                    performer: (info.uploader || info.artist || "").slice(0, 300),
                    title: (info.title || "").slice(0, 300),
                    reply_parameters: { chat_id: msg.chat.id, message_id: msg.message_id, allow_sending_without_reply: true },
                }, { filename: path.basename(actualPath), contentType: "audio/mpeg" });

            } else {
                const maxHeight = durationMin < HIGH_QUALITY_THRESHOLD_MINUTES ? 1080 : 720;
                const fmt = `bestvideo[height<=${maxHeight}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]/best`;

                await ytDlpRun(targetUrl, path.join(tmpDir, "output.mp4"), [
                    "-f", fmt, "--merge-output-format", "mp4",
                ]);

                const filePath = path.join(tmpDir, "output.mp4");
                const actualPath = fs.existsSync(filePath) ? filePath : firstFileIn(tmpDir);
                if (!actualPath) throw new Error("video file not found");

                if (fs.statSync(actualPath).size > MAX_FILE_BYTES) {
                    await editStatus(l[lang].VIDEODL_TOO_LARGE);
                    rmDir(tmpDir);
                    return;
                }

                await TGbot.sendVideo(msg.chat.id, fs.createReadStream(actualPath), {
                    caption: (info.title || "").slice(0, 1024),
                    duration: info.duration || undefined,
                    width: info.width || undefined,
                    height: info.height || undefined,
                    supports_streaming: true,
                    reply_parameters: { chat_id: msg.chat.id, message_id: msg.message_id, allow_sending_without_reply: true },
                }, { filename: path.basename(actualPath), contentType: "video/mp4" });
            }

            try { await TGbot.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id); } catch (_) {}

        } catch (err) {
            console.log("[videodownload] error:", err.message || err);
            try { await editStatus(l[lang].VIDEODL_ERROR); } catch (_) {}
        } finally {
            rmDir(tmpDir);
        }
    });

    // ── Settings callbacks ───────────────────────────────────────────────────
    GHbot.onCallback(async (cb, chat, user) => {
        if (!cb.data.startsWith("S_VIDEODL")) return;
        if (!chat || !chat.isGroup) return;
        if (!(user.perms && user.perms.settings == 1)) return;

        chat = ensureSettings(chat);
        const msg = cb.message;
        const lang = chat.lang;

        const mainText = () =>
            bold(l[lang].VIDEODL_TITLE) + "\n\n" +
            l[lang].VIDEODL_DESCRIPTION.replace("{status}", chat.videodownload.state ? l[lang].ON : l[lang].OFF);

        const mainButtons = () => [
            [
                { text: l[lang].TURN_ON_BUTTON, callback_data: `S_VIDEODL_ON:${chat.id}` },
                { text: l[lang].TURN_OFF_BUTTON, callback_data: `S_VIDEODL_OFF:${chat.id}` },
            ],
            [{ text: l[lang].VIDEODL_SITES_BUTTON, callback_data: `S_VIDEODL_SITES:${chat.id}` }],
            [{ text: l[lang].BACK2_BUTTON, callback_data: `SETTINGS_PAGE2:${chat.id}` }],
        ];

        const sitesButtons = () => {
            const btns = Object.entries(SITES).map(([key, info]) => ({
                text: (chat.videodownload.sites[key] ? "✅" : "❌") + " " + info.label,
                callback_data: `S_VIDEODL_TOGGLE_${key}:${chat.id}`,
            }));
            const rows = [];
            for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
            rows.push([{ text: l[lang].BACK2_BUTTON, callback_data: `S_VIDEODL_BUTTON:${chat.id}` }]);
            return rows;
        };

        if (cb.data.startsWith("S_VIDEODL_BUTTON")) {
            GHbot.editMessageText(user.id, mainText(), {
                chat_id: cb.chat.id, message_id: msg.message_id,
                parse_mode: "HTML", reply_markup: { inline_keyboard: mainButtons() },
            });
            GHbot.answerCallbackQuery(user.id, cb.id);
            return;
        }

        if (cb.data.startsWith("S_VIDEODL_ON:")) {
            chat.videodownload.state = true;
            db.chats.update(chat);
            GHbot.answerCallbackQuery(user.id, cb.id);
            GHbot.GHbot.emit("callback_query", { ...cb, data: `S_VIDEODL_BUTTON:${chat.id}`, message: msg }, chat, user);
            return;
        }

        if (cb.data.startsWith("S_VIDEODL_OFF:")) {
            chat.videodownload.state = false;
            db.chats.update(chat);
            GHbot.answerCallbackQuery(user.id, cb.id);
            GHbot.GHbot.emit("callback_query", { ...cb, data: `S_VIDEODL_BUTTON:${chat.id}`, message: msg }, chat, user);
            return;
        }

        if (cb.data.startsWith("S_VIDEODL_TOGGLE_")) {
            const siteKey = cb.data.split("S_VIDEODL_TOGGLE_")[1].split(":")[0];
            if (Object.prototype.hasOwnProperty.call(SITES, siteKey)) {
                chat.videodownload.sites[siteKey] = !chat.videodownload.sites[siteKey];
                db.chats.update(chat);
            }
            GHbot.answerCallbackQuery(user.id, cb.id);
            GHbot.editMessageText(user.id, bold(l[lang].VIDEODL_SITES_TITLE), {
                chat_id: cb.chat.id, message_id: msg.message_id,
                parse_mode: "HTML", reply_markup: { inline_keyboard: sitesButtons() },
            });
            return;
        }

        if (cb.data.startsWith("S_VIDEODL_SITES:")) {
            GHbot.editMessageText(user.id, bold(l[lang].VIDEODL_SITES_TITLE), {
                chat_id: cb.chat.id, message_id: msg.message_id,
                parse_mode: "HTML", reply_markup: { inline_keyboard: sitesButtons() },
            });
            GHbot.answerCallbackQuery(user.id, cb.id);
            return;
        }
    });
}

module.exports = main;
