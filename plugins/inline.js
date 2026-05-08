const LGHelpTemplate = require("../GHbot.js");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Sites supported in inline mode ───────────────────────────────────────
const SITES = {
    youtube: { hosts: ["youtube.com", "youtu.be", "music.youtube.com"] },
    tiktok:  { hosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"] },
};

const SHARD_RE   = /\.f\d+\.[a-z0-9]+$/i;
const VIDEO_EXTS = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".ts"];
const AUDIO_EXTS = [".mp3", ".m4a", ".aac", ".opus", ".ogg", ".flac", ".wav"];
const MAX_FILE_BYTES             = 49 * 1024 * 1024;
const LONG_VIDEO_MINUTES         = 60;
const HIGH_QUALITY_THRESHOLD_MIN = 25;
const CACHE_TTL                  = 3600 * 1000;

// ── URL helpers ───────────────────────────────────────────────────────────
function extractUrlsFromText(text) {
    const found = [];
    const re = /(?:https?:\/\/)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/[^\s<>"'\]]*|\?[^\s<>"'\]]*)?/gi;
    let m;
    while ((m = re.exec(text)) !== null) found.push(m[0]);
    return found;
}

function findSupportedUrl(urls) {
    for (const raw of urls) {
        try {
            const withProto = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
            const host = new URL(withProto).hostname.toLowerCase().replace(/^www\./, "");
            for (const info of Object.values(SITES)) {
                for (const h of info.hosts) {
                    if (host === h || host.endsWith("." + h)) return withProto;
                }
            }
        } catch (_) {}
    }
    return null;
}

// ── yt-dlp helpers ────────────────────────────────────────────────────────
function ytDlpInfo(url) {
    return new Promise((resolve, reject) => {
        let stdout = "";
        const p = spawn("yt-dlp", ["--dump-json", "--no-playlist", url]);
        p.stdout.on("data", d => { stdout += d; });
        p.on("close", code => {
            if (code !== 0) return reject(new Error("yt-dlp info exit " + code));
            try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
        });
        p.on("error", reject);
    });
}

function ytDlpRun(url, outTemplate, extraArgs) {
    return new Promise((resolve, reject) => {
        const p = spawn("yt-dlp", ["--no-playlist", ...extraArgs, "-o", outTemplate, url]);
        p.on("close", code => { if (code !== 0) reject(new Error("yt-dlp exit " + code)); else resolve(); });
        p.on("error", reject);
    });
}

function firstFileIn(dir) {
    try {
        const skip = [".part", ".ytdl", ".jpg", ".jpeg", ".png", ".webp", ".json", ".description"];
        const all = fs.readdirSync(dir).filter(f => !skip.some(e => f.endsWith(e)));
        if (!all.length) return null;
        const nonShards = all.filter(f => !SHARD_RE.test(f));
        const candidates = nonShards.length ? nonShards : all;
        const video = candidates.find(f => VIDEO_EXTS.some(e => f.endsWith(e)));
        return path.join(dir, video || candidates[0]);
    } catch (_) { return null; }
}

function rmDir(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ── Cache & dedup ─────────────────────────────────────────────────────────
const resultCache    = new Map(); // url -> {fileId, isAudio, title, ts}
const pendingByUrl   = new Map(); // url -> Promise<result>  (dedup concurrent requests)

function getCached(url) {
    const e = resultCache.get(url);
    if (!e || Date.now() - e.ts > CACHE_TTL) { resultCache.delete(url); return null; }
    return e;
}
function setCache(url, data) {
    resultCache.set(url, { ...data, ts: Date.now() });
}

// Clear entire cache every 2 hours
setInterval(() => {
    resultCache.clear();
    console.log("[inline] cache cleared");
}, 2 * 3600 * 1000);

// ── Download → upload → return {fileId, isAudio, title} ──────────────────
async function downloadAndUpload(TGbot, url, uploadChatId) {
    const tmpDir = path.join(os.tmpdir(), "shieldy_inl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8));
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
        const info = await ytDlpInfo(url);
        const durationMin = (info.duration || 0) / 60;
        if (durationMin > LONG_VIDEO_MINUTES) throw new Error("too_long");

        const maxH = durationMin < HIGH_QUALITY_THRESHOLD_MIN ? 1080 : 720;
        const fmtMerge    = `bestvideo[height<=${maxH}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${maxH}]+bestaudio`;
        const fmtCombined = `best[height<=${maxH}][ext=mp4]/best[height<=${maxH}]/best[ext=mp4]/best`;

        await ytDlpRun(url, path.join(tmpDir, "output.%(ext)s"), ["-f", fmtMerge, "--merge-output-format", "mp4"]);

        const tmpFiles = fs.readdirSync(tmpDir).filter(f => ![".part", ".ytdl"].some(e => f.endsWith(e)));
        if (!tmpFiles.some(f => !SHARD_RE.test(f)) && tmpFiles.length > 0) {
            tmpFiles.forEach(f => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch(_){} });
            await ytDlpRun(url, path.join(tmpDir, "output.%(ext)s"), ["-f", fmtCombined]);
        }

        const actualPath = firstFileIn(tmpDir);
        if (!actualPath) throw new Error("not_found");
        if (fs.statSync(actualPath).size > MAX_FILE_BYTES) throw new Error("too_large");

        const ext     = path.extname(actualPath).toLowerCase();
        const isAudio = AUDIO_EXTS.includes(ext);

        let fileId;
        if (isAudio) {
            const sent = await TGbot.sendAudio(uploadChatId, fs.createReadStream(actualPath), {
                title:    (info.title    || "").slice(0, 300),
                performer:(info.uploader || "").slice(0, 300),
                duration: info.duration  || undefined,
                disable_notification: true,
            }, { filename: path.basename(actualPath) });
            fileId = sent.audio.file_id;
        } else {
            const sent = await TGbot.sendVideo(uploadChatId, fs.createReadStream(actualPath), {
                duration: info.duration || undefined,
                width:    info.width    || undefined,
                height:   info.height   || undefined,
                supports_streaming: true,
                disable_notification: true,
            }, { filename: path.basename(actualPath), contentType: "video/mp4" });
            fileId = sent.video.file_id;
        }

        return { fileId, isAudio, title: info.title || "Video" };
    } finally {
        rmDir(tmpDir);
    }
}

// ── Plugin ────────────────────────────────────────────────────────────────
function main(args) {
    const GHbot = new LGHelpTemplate(args);
    const { TGbot, db, config } = GHbot;
    const l = global.LGHLangs;
    const dumpChatId = config.inlineDumpChatId || null;

    function userLang(userId) {
        try { return (db.users.get(userId) || {}).lang || config.reserveLang; } catch(_) { return config.reserveLang; }
    }

    // ── inline_query: validate URL, answer instantly with "Send" button ───
    TGbot.on("inline_query", async (query) => {
        const text    = (query.query || "").trim();
        const queryId = query.id;
        const userId  = query.from.id;

        const empty = (opts = {}) => TGbot.answerInlineQuery(queryId, [], { cache_time: 0, ...opts }).catch(() => {});

        if (!text) { await empty(); return; }

        const targetUrl = findSupportedUrl(extractUrlsFromText(text));
        if (!targetUrl) { await empty(); return; }

        // If already cached — answer with real video immediately
        const cached = getCached(targetUrl);
        if (cached) {
            console.log("[inline] inline_query cache hit:", targetUrl);
            const results = cached.isAudio
                ? [{ type: "audio", id: "1", audio_file_id: cached.fileId, title: cached.title || "Audio" }]
                : [{ type: "video", id: "1", video_file_id: cached.fileId, title: cached.title || "Video" }];
            await TGbot.answerInlineQuery(queryId, results, { cache_time: 3600 }).catch(() => {});
            return;
        }

        // Kick off background download so it'll be ready on retry or for chosen_inline_result
        const uploadChatId = dumpChatId || userId;
        if (!pendingByUrl.has(targetUrl)) {
            console.log("[inline] starting background download:", targetUrl);
            const p = downloadAndUpload(TGbot, targetUrl, uploadChatId)
                .then(r => { setCache(targetUrl, r); console.log("[inline] background download cached:", targetUrl); return r; })
                .finally(() => pendingByUrl.delete(targetUrl));
            // Log errors without swallowing — p itself still rejects for chosen_inline_result to catch
            p.catch(e => console.log("[inline] background download failed:", e.message));
            pendingByUrl.set(targetUrl, p);
        }

        const lang = userLang(userId);
        let domain;
        try { domain = new URL(targetUrl).hostname.replace(/^www\./, ""); } catch(_) { domain = ""; }

        const thumbUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
        const downloadingText = (l[lang] && l[lang].VIDEODL_DOWNLOADING) || "⏳ Downloading...";

        await TGbot.answerInlineQuery(queryId, [{
            type:  "article",
            id:    "dl",
            title: "📥 Send video",
            description: domain,
            thumbnail_url: thumbUrl,
            thumbnail_width:  64,
            thumbnail_height: 64,
            input_message_content: { message_text: downloadingText },
            // reply_markup is required for Telegram to include inline_message_id in chosen_inline_result
            reply_markup: { inline_keyboard: [[{ text: "⏳", callback_data: "inline_loading" }]] },
        }], { cache_time: 0, is_personal: true }).catch(() => {});
    });

    // ── chosen_inline_result: download, then edit the sent message ────────
    TGbot.on("chosen_inline_result", async (chosen) => {
        console.log("[inline] chosen_inline_result fired, inline_message_id:", chosen.inline_message_id, "query:", chosen.query);

        const inlineMsgId = chosen.inline_message_id;
        const userId      = chosen.from.id;
        const query       = chosen.query || "";

        if (!inlineMsgId) {
            console.log("[inline] ERROR: no inline_message_id — go to @BotFather → /setinlinefeedback → set 100%");
            return;
        }

        const lang = userLang(userId);
        const txt  = (key) => (l[lang] && l[lang][key]) ? l[lang][key] : key;

        const editText = (text) => TGbot.editMessageText(text, {
            inline_message_id: inlineMsgId,
            parse_mode: "HTML",
        }).then(() => console.log("[inline] editMessageText OK"))
          .catch(err => console.log("[inline] editMessageText ERROR:", err.response?.body?.description || err.message));

        const editMedia = ({ fileId, isAudio, title }) => {
            const media = isAudio
                ? { type: "audio", media: fileId, title: title.slice(0, 300) }
                : { type: "video", media: fileId, caption: title.slice(0, 1024), supports_streaming: true };
            console.log("[inline] calling editMessageMedia, isAudio:", isAudio, "fileId:", fileId.slice(0, 20) + "...");
            return TGbot.editMessageMedia(media, { inline_message_id: inlineMsgId })
                .then(() => console.log("[inline] editMessageMedia OK"))
                .catch(err => console.log("[inline] editMessageMedia ERROR:", err.response?.body?.description || err.message));
        };

        const targetUrl = findSupportedUrl(extractUrlsFromText(query));
        if (!targetUrl) { console.log("[inline] no URL in query"); await editText("❌"); return; }

        console.log("[inline] downloading for", targetUrl);

        const cached = getCached(targetUrl);
        if (cached) { console.log("[inline] cache hit"); await editMedia(cached); return; }

        const uploadChatId = dumpChatId || userId;
        if (!pendingByUrl.has(targetUrl)) {
            const p = downloadAndUpload(TGbot, targetUrl, uploadChatId)
                .then(r => { setCache(targetUrl, r); return r; })
                .finally(() => pendingByUrl.delete(targetUrl));
            pendingByUrl.set(targetUrl, p);
        }

        try {
            const result = await pendingByUrl.get(targetUrl);
            await editMedia(result);
        } catch (err) {
            console.log("[inline] download failed:", err.message);
            const msg = err.message === "too_long"  ? txt("VIDEODL_TOO_LONG")  :
                        err.message === "too_large" ? txt("VIDEODL_TOO_LARGE") :
                        txt("VIDEODL_ERROR");
            await editText(msg);
        }
    });
}

module.exports = main;
