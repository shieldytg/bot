const LGHelpTemplate = require("../GHbot.js");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Site definitions (same as videodownload.js) ───────────────────────────
const SITES = {
    youtube:   { hosts: ["youtube.com", "youtu.be"] },
    tiktok:    { hosts: ["tiktok.com", "vm.tiktok.com"] },
    instagram: { hosts: ["instagram.com"] },
    facebook:  { hosts: ["facebook.com", "fb.com", "fb.watch"] },
    twitter:   { hosts: ["twitter.com", "x.com", "t.co"] },
    vimeo:     { hosts: ["vimeo.com"] },
    twitch:    { hosts: ["twitch.tv"] },
    reddit:    { hosts: ["reddit.com", "redd.it"] },
};

const SHARD_RE   = /\.f\d+\.[a-z0-9]+$/i;
const VIDEO_EXTS = [".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".ts"];
const AUDIO_EXTS = [".mp3", ".m4a", ".aac", ".opus", ".ogg", ".flac", ".wav"];
const MAX_FILE_BYTES              = 49 * 1024 * 1024;
const LONG_VIDEO_MINUTES          = 60;
const HIGH_QUALITY_THRESHOLD_MIN  = 25;
const INLINE_ANSWER_TIMEOUT_MS    = 9000; // must answer before Telegram's ~10 s window
const CACHE_TTL                   = 3600 * 1000; // 1 hour

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
        let stderr = "";
        const p = spawn("yt-dlp", ["--no-playlist", ...extraArgs, "-o", outTemplate, url]);
        p.stderr.on("data", d => { stderr += d; });
        p.on("close", code => {
            if (code !== 0) reject(new Error("yt-dlp exit " + code));
            else resolve();
        });
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

// ── In-memory cache keyed by URL ──────────────────────────────────────────
const resultCache = new Map();

function getCached(url) {
    const e = resultCache.get(url);
    if (!e || Date.now() - e.ts > CACHE_TTL) { resultCache.delete(url); return null; }
    return e;
}
function setCache(url, data) {
    resultCache.set(url, { ...data, ts: Date.now() });
}

// ── Core download → upload → return file_id ───────────────────────────────
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

        await ytDlpRun(url, path.join(tmpDir, "output.%(ext)s"), [
            "-f", fmtMerge, "--merge-output-format", "mp4",
        ]);

        // Fallback: if only shard files remain, ffmpeg wasn't available
        const tmpFiles = fs.readdirSync(tmpDir).filter(f => ![".part", ".ytdl"].some(e => f.endsWith(e)));
        if (!tmpFiles.some(f => !SHARD_RE.test(f)) && tmpFiles.length > 0) {
            tmpFiles.forEach(f => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch(_){} });
            await ytDlpRun(url, path.join(tmpDir, "output.%(ext)s"), ["-f", fmtCombined]);
        }

        const actualPath = firstFileIn(tmpDir);
        if (!actualPath) throw new Error("file not found");
        if (fs.statSync(actualPath).size > MAX_FILE_BYTES) throw new Error("too_large");

        const ext = path.extname(actualPath).toLowerCase();
        const isAudio = AUDIO_EXTS.includes(ext);

        let fileId;
        if (isAudio) {
            const sent = await TGbot.sendAudio(uploadChatId, fs.createReadStream(actualPath), {
                title: (info.title || "").slice(0, 300),
                performer: (info.uploader || "").slice(0, 300),
                duration: info.duration || undefined,
                disable_notification: true,
            }, { filename: path.basename(actualPath) });
            fileId = sent.audio.file_id;
        } else {
            const sent = await TGbot.sendVideo(uploadChatId, fs.createReadStream(actualPath), {
                duration: info.duration || undefined,
                width: info.width || undefined,
                height: info.height || undefined,
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

// ── Build inline result from cached data ──────────────────────────────────
function buildResults({ fileId, isAudio, title }) {
    return isAudio
        ? [{ type: "audio", id: "1", audio_file_id: fileId, title: title || "Audio" }]
        : [{ type: "video", id: "1", video_file_id: fileId, title: title || "Video" }];
}

// ── Plugin entry point ────────────────────────────────────────────────────
function main(args) {
    const GHbot = new LGHelpTemplate(args);
    const { TGbot, config } = GHbot;

    const dumpChatId = config.inlineDumpChatId || null;

    TGbot.on("inline_query", async (query) => {
        const text    = (query.query || "").trim();
        const queryId = query.id;
        const userId  = query.from.id;

        const answer = (results, opts = {}) =>
            TGbot.answerInlineQuery(queryId, results, opts).catch(() => {});

        // Empty query
        if (!text) { await answer([], { cache_time: 0 }); return; }

        const targetUrl = findSupportedUrl(extractUrlsFromText(text));
        if (!targetUrl) { await answer([], { cache_time: 0 }); return; }

        console.log("[inline] query from", userId, "→", targetUrl);

        // Serve from cache
        const cached = getCached(targetUrl);
        if (cached) {
            console.log("[inline] cache hit");
            await answer(buildResults(cached), { cache_time: 3600 });
            return;
        }

        // Upload target: configured dump chat, else user's own DM (requires /start)
        const uploadChatId = dumpChatId || userId;

        // Race download against Telegram's inline timeout
        const downloadPromise = downloadAndUpload(TGbot, targetUrl, uploadChatId);
        const timeoutPromise  = new Promise((_, rej) =>
            setTimeout(() => rej(new Error("timeout")), INLINE_ANSWER_TIMEOUT_MS));

        try {
            const result = await Promise.race([downloadPromise, timeoutPromise]);
            setCache(targetUrl, result);
            await answer(buildResults(result), { cache_time: 3600 });
        } catch (err) {
            if (err.message === "timeout") {
                // Download continues in background; tell user to try again shortly
                console.log("[inline] timeout — download continues in background for", targetUrl);
                await answer([], {
                    cache_time: 0,
                    switch_pm_text: "⏳ Still downloading — try again in a moment",
                    switch_pm_parameter: "inline_wait",
                });
                downloadPromise
                    .then(r  => { setCache(targetUrl, r); console.log("[inline] background cache ready:", targetUrl); })
                    .catch(e => console.log("[inline] background download failed:", e.message));
            } else {
                console.log("[inline] error:", err.message);
                await answer([], { cache_time: 0 });
            }
        }
    });
}

module.exports = main;
