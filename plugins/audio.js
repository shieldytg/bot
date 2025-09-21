var LGHelpTemplate = require("../GHbot.js");
const axios = require("axios");
const path = require("path");
const { bold, code, unsetWaitReply, cleanHTML } = require("../api/utils/utils.js");

function ensureChatAudioSettings(chat, defaultModel) {
    if (!chat.audio) {
        chat.audio = {
            state: true,
            provider: "gemini",
            model: defaultModel || "gemini-pro", // default from config if provided
            prompts: {} // { [lang]: string }
        };
    }
    return chat;
}

async function fetchTelegramFileAsBase64(TGbot, fileId) {
    const fileLink = await TGbot.getFileLink(fileId);
    const res = await axios.get(fileLink, { responseType: "arraybuffer" });
    const base64 = Buffer.from(res.data).toString("base64");
    // Try to infer mime by link extension
    let mime = "application/octet-stream";
    const ext = String(fileLink).split(".").pop().toLowerCase();
    if (ext === "oga" || ext === "ogg") mime = "audio/ogg";
    else if (ext === "mp3") mime = "audio/mpeg";
    else if (ext === "wav") mime = "audio/wav";
    else if (ext === "m4a") mime = "audio/mp4";
    else if (ext === "webm") mime = "audio/webm";
    return { base64, mime };
}

function buildGeminiRequest(prompt, base64, mime) {
    return {
        contents: [
            {
                role: "user",
                parts: [
                    { text: prompt || "What is said in this audio?" },
                    {
                        inline_data: {
                            mime_type: mime || "audio/ogg",
                            data: base64,
                        },
                    },
                ],
            },
        ],
    };
}

function main(args) {
    const GHbot = new LGHelpTemplate(args);
    const { TGbot, db, config } = GHbot;

    l = global.LGHLangs;

    // Determine if Gemini API is available and not using the placeholder value
    const hasValidGemini = !!(
        (config && config.geminiApiKey && config.geminiApiKey !== "YOUR_GEMINI_API_KEY") ||
        process.env.GEMINI_API_KEY
    );

    // Settings callbacks
    GHbot.onCallback(async (cb, chat, user) => {
        if (!cb.data.startsWith("S_AUDIOREC")) return;
        // If Gemini is not properly configured, behave as if audio feature doesn't exist
        if (!hasValidGemini) return;
        if (!chat.isGroup) return;
        if (!(user.perms && user.perms.settings == 1)) return;

        const defaultModel = (config && config.geminiModel) || "gemini-2.5-flash";
        chat = ensureChatAudioSettings(chat, defaultModel);
        const msg = cb.message;
        const lang = chat.lang;

        // Open menu
        if (cb.data.startsWith("S_AUDIOREC_BUTTON")) {
            const onOff = chat.audio.state ? l[lang].ON : l[lang].OFF;
            const model = chat.audio.model || "gemini-2.5-flash";
            const prompt = chat.audio.prompts && chat.audio.prompts[lang] ? chat.audio.prompts[lang] : l[lang].AUDIO_PROMPT;

            const text = `${bold(l[lang].AUDIOREC_TITLE)}\n\n${l[lang].AUDIOREC_DESCRIPTION.replace("{status}", onOff).replace("{model}", code(model)).replace("{prompt}", code(prompt))}`;
            const buttons = [
                [
                    { text: l[lang].TURN_ON_BUTTON, callback_data: `S_AUDIOREC_ON:${chat.id}` },
                    { text: l[lang].TURN_OFF_BUTTON, callback_data: `S_AUDIOREC_OFF:${chat.id}` },
                ],
                [
                    { text: l[lang].SET_PROMPT_BUTTON, callback_data: `S_AUDIOREC_PROMPT:${chat.id}` },
                ],
                [
                    { text: l[lang].BACK2_BUTTON, callback_data: `SETTINGS_HERE:${chat.id}` },
                ],
            ];

            GHbot.editMessageText(user.id, text, {
                chat_id: cb.chat.id,
                message_id: msg.message_id,
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: buttons },
            });
            db.chats.update(chat);
            return;
        }

        if (cb.data.startsWith("S_AUDIOREC_ON")) {
            chat.audio.state = true;
            db.chats.update(chat);
            try { db.chats.save(chat.id); } catch(e){}
            console.log(`[audio] Enabled in chat ${chat.id}`);
            GHbot.answerCallbackQuery(user.id, cb.id);
            GHbot.GHbot.emit("callback_query", { ...cb, data: `S_AUDIOREC_BUTTON:${chat.id}`, message: cb.message }, chat, user);
            return;
        }
        if (cb.data.startsWith("S_AUDIOREC_OFF")) {
            chat.audio.state = false;
            db.chats.update(chat);
            try { db.chats.save(chat.id); } catch(e){}
            console.log(`[audio] Disabled in chat ${chat.id}`);
            GHbot.answerCallbackQuery(user.id, cb.id);
            GHbot.GHbot.emit("callback_query", { ...cb, data: `S_AUDIOREC_BUTTON:${chat.id}`, message: cb.message }, chat, user);
            return;
        }

        if (cb.data.startsWith("S_AUDIOREC_PROMPT")) {
            // Ask user to send prompt for the current chat language
            const text = l[lang].AUDIOREC_SEND_PROMPT.replace("{lang}", l[lang].LANG_SHORTNAME);
            GHbot.editMessageText(user.id, text, {
                chat_id: cb.chat.id,
                message_id: msg.message_id,
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [[{ text: l[lang].BACK2_BUTTON, callback_data: `S_AUDIOREC_BUTTON:${chat.id}` }]],
                },
            });
            // set WR for this chat and user
            const WR = `S_AUDIOREC#PR:${chat.id}`;
            if (cb.chat.isGroup) {
                if (!chat.users) chat.users = {};
                if (!chat.users[user.id]) chat.users[user.id] = { perms: {}, waitingReply: false };
                chat.users[user.id].waitingReply = WR;
                db.chats.update(chat);
            } else {
                const u = db.users.get(user.id);
                u.waitingReply = WR;
                db.users.update(u);
            }
            GHbot.answerCallbackQuery(user.id, cb.id);
            return;
        }
    });

    // Handle prompt message
    GHbot.onMessage(async (msg, chat, user) => {
        if (!msg.waitingReply || !String(msg.waitingReply).startsWith("S_AUDIOREC#PR")) return;
        if (msg.chat.isGroup && chat.id != msg.chat.id) return;
        if (!(user.perms && user.perms.settings == 1)) return;

        const defaultModel = (config && config.geminiModel) || "gemini-pro";
        chat = ensureChatAudioSettings(chat, defaultModel);
        const lang = chat.lang;
        const newPrompt = (msg.text || "").trim();
        if (!newPrompt) return;
        if (!chat.audio.prompts) chat.audio.prompts = {};
        chat.audio.prompts[lang] = newPrompt;
        db.chats.update(chat);
        try { db.chats.save(chat.id); } catch(e){}
        console.log(`[audio] Prompt updated for chat ${chat.id} lang ${lang}. Length: ${newPrompt.length}`);
        unsetWaitReply(db, user, chat, msg.chat.isGroup);

        GHbot.sendMessage(user.id, msg.chat.id, l[lang].AUDIOREC_PROMPT_SET, {
            parse_mode: "HTML",
            reply_parameters: { chat_id: msg.chat.id, message_id: msg.message_id, allow_sending_without_reply: true },
            reply_markup: { inline_keyboard: [[{ text: l[lang].BACK2_BUTTON, callback_data: `S_AUDIOREC_BUTTON:${chat.id}` }]] },
        });
    });

    // Voice transcription
    GHbot.onMessage(async (msg, chat, user) => {
        try {
            if (!msg.voice) return;
            // If Gemini is not properly configured, do not react to voice messages at all
            if (!hasValidGemini) return;
            const defaultModel = (config && config.geminiModel) || "gemini-pro";
            chat = ensureChatAudioSettings(chat, defaultModel);
            if (!chat.audio || !chat.audio.state) return;

            const lang = chat.lang;
            const modelInUse = chat.audio.model || defaultModel || "gemini-pro";
            console.log(`[audio] Voice detected. chat=${chat.id} user=${user.id} lang=${lang} model=${modelInUse}`);
            // pre-reply "Please wait..."
            const waitingText = l[lang].AUDIO_PLEASE_WAIT || "Please wait...";
            const replyOpts = { parse_mode: "HTML", reply_parameters: { chat_id: msg.chat.id, message_id: msg.message_id, allow_sending_without_reply: true } };
            const waitingMsg = await GHbot.sendMessage(user.id, msg.chat.id, waitingText, replyOpts);

            // Safety: need API key
            const apiKey = (config && (config.geminiApiKey || config.GEMINI_API_KEY)) || process.env.GEMINI_API_KEY;
            if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY") {
                // Safety: silently stop if key is not configured or is placeholder
                return;
            }

            // Download voice from telegram
            const { base64, mime } = await fetchTelegramFileAsBase64(TGbot, msg.voice.file_id);
            console.log(`[audio] Downloaded voice file. mime=${mime} bytes=${Buffer.byteLength(base64, 'base64')}`);

            // Build prompt by language
            const prompt = (chat.audio.prompts && chat.audio.prompts[lang]) || l[lang].AUDIO_PROMPT || "What is said in this audio?";
            const body = buildGeminiRequest(prompt, base64, mime);
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelInUse}:generateContent?key=${apiKey}`;
            const t0 = Date.now();
            console.log(`[audio] Sending request to Gemini: model=${modelInUse} promptLen=${(prompt||"").length}`);

            let resp;
            try {
                resp = await axios.post(endpoint, body, { headers: { "Content-Type": "application/json" } });
                console.log(`[audio] Gemini responded in ${Date.now() - t0} ms`);
            } catch (apiErr) {
                // Prepare readable error text
                let errText = "";
                try {
                    if (apiErr && apiErr.response && apiErr.response.data) {
                        errText = typeof apiErr.response.data === "string" ? apiErr.response.data : JSON.stringify(apiErr.response.data);
                    } else if (apiErr && apiErr.message) {
                        errText = apiErr.message;
                    } else {
                        errText = String(apiErr);
                    }
                } catch (_) { errText = String(apiErr); }

                // Log the error 10 times on new lines
                for (let i = 0; i < 10; i++) {
                    console.error(errText);
                }

                // Show concise error in Telegram
                await GHbot.editMessageText(user.id, "Error", {
                    chat_id: waitingMsg.chat.id,
                    message_id: waitingMsg.message_id,
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [] },
                });
                return;
            }
            let transcript = "";
            try {
                const cand = resp.data && resp.data.candidates && resp.data.candidates[0];
                const parts = cand && cand.content && cand.content.parts;
                if (parts && parts.length) {
                    transcript = parts.map(p => p.text).filter(Boolean).join("\n").trim();
                }
            } catch (e) {}

            if (!transcript) {
                console.log("[audio] Empty transcript returned");
                transcript = l[lang].AUDIO_EMPTY_TRANSCRIPT || "No text recognized.";
            } else {
                console.log(`[audio] Transcript length=${transcript.length}`);
            }

            const htmlTranscript = `<blockquote expandable="true">${cleanHTML(transcript)}</blockquote>`;
            try {
                await GHbot.editMessageText(user.id, htmlTranscript, {
                    chat_id: waitingMsg.chat.id,
                    message_id: waitingMsg.message_id,
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [[{ text: "🗑️", callback_data: `S_AUDIOREC_DEL:${chat.id}:${waitingMsg.message_id}` }]],
                    },
                });
            } catch (e) {
                const desc = (e && e.response && e.response.body && e.response.body.description) ? e.response.body.description : (e && e.response && e.response.statusText) || String(e || "");
                if (String(desc).toLowerCase().includes("message is too long")) {
                    // Replace with a concise error message as requested
                    await GHbot.editMessageText(user.id, "Error: Message to long for telegram", {
                        chat_id: waitingMsg.chat.id,
                        message_id: waitingMsg.message_id,
                        parse_mode: "HTML",
                        reply_markup: { inline_keyboard: [] },
                    });
                    return;
                }
                throw e;
            }
        } catch (err) {
            try {
                const lang = chat && chat.lang ? chat.lang : (user && user.lang ? user.lang : "en_en");
                const desc = (err && err.response && err.response.body && err.response.body.description) ? err.response.body.description : (err && err.response && err.response.statusText) || String(err || "");
                if (String(desc).toLowerCase().includes("message is too long")) {
                    await GHbot.sendMessage(user.id, msg.chat.id, "Error: Message to long for telegram");
                } else {
                    await GHbot.sendMessage(user.id, msg.chat.id, (l[lang] && l[lang].AUDIO_ERROR) || "Audio recognition error.");
                }
            } catch (e) {}
            console.log("[audio] error:", err && err.response ? err.response.data || err.response.statusText : err);
        }
    });

    // Global delete handler for transcription messages
    GHbot.onCallback(async (cb, chat, user) => {
        if (!cb.data || !cb.data.startsWith("S_AUDIOREC_DEL")) return;
        // allow only settings managers by default
        if (!(user.perms && user.perms.settings == 1)) {
            try { GHbot.answerCallbackQuery(user.id, cb.id, { text: "Not allowed", show_alert: true }); } catch (e) {}
            return;
        }
        try {
            const delChatId = cb.message.chat.id;
            const delMsgId = cb.message.message_id;
            await TGbot.deleteMessage(delChatId, delMsgId);
            try { GHbot.answerCallbackQuery(user.id, cb.id); } catch (e) {}
        } catch (err) {
            console.log("[audio] delete error:", err && err.response ? err.response.body || err.response.statusText : err);
            // Fallback: edit message to a trash icon and remove buttons (works without delete permission)
            try {
                await GHbot.editMessageText(user.id, "🗑️", {
                    chat_id: cb.message.chat.id,
                    message_id: cb.message.message_id,
                    reply_markup: { inline_keyboard: [] },
                });
                GHbot.answerCallbackQuery(user.id, cb.id);
            } catch (e2) {
                try { GHbot.answerCallbackQuery(user.id, cb.id, { text: "Delete failed", show_alert: false }); } catch (e3) {}
            }
        }
    });
}

module.exports = main;
