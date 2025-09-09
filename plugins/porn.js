var LGHelpTemplate = require("../GHbot.js");
const { bold, punishmentToText, genPunishmentTimeSetButton, punishmentToFullText, genPunishButtons, handlePunishmentCallback, textToPunishment } = require("../api/utils/utils.js");
const { newPunishObj, sumPunishObj } = require("../api/utils/punishment.js");
const ST = require("../api/editors/setTime.js");

function main(args) {
    const GHbot = new LGHelpTemplate(args);
    const { db } = GHbot;

    GHbot.onCallback(async (cb, chat, user) => {
        // guards
        if (!chat.isGroup) return;
        if (!(user.perms && user.perms.settings)) return;
        if (!cb.data.startsWith("S_PORN_BUTTON")) return;
        if (cb.chat.isGroup && chat.id != cb.chat.id) return;

        const lang = chat.lang;
        const l = global.LGHLangs;
        const msg = cb.message;

        // ensure structure
        chat.media = chat.media || {};
        const exhistObj = chat.media.hasOwnProperty("nsfw");

        // actions
        if (cb.data.includes("#") || cb.data.includes("_")) {
            // INFO popup
            if (cb.data.includes("#INFO")) {
                const infoText = l[lang].MEDIA_INFO.replace("{type}", l[lang]["MEDIA:nsfw"]);
                GHbot.answerCallbackQuery(user.id, cb.id, { show_alert: true, text: infoText });
                return;
            }

            // Handle punishment change via shared helper
            chat.media.nsfw = chat.media.nsfw || newPunishObj();
            const oldPun = chat.media.nsfw.punishment;
            const newPun = handlePunishmentCallback(GHbot, cb, user.id, oldPun);
            if (newPun !== oldPun && newPun !== -1) chat.media.nsfw.punishment = newPun;
            // If turned OFF and deletion disabled, remove object for cleanliness
            if (chat.media.nsfw.punishment === 0 && !chat.media.nsfw.delete) {
                delete chat.media.nsfw;
            }

            // Off switch is represented as punishment 0 via OFF button
            if (cb.data.includes("_PTIME")) {
                const returnButtons = [[{ text: l[lang].BACK_BUTTON, callback_data: "S_PORN_BUTTON:" + chat.id }]];
                const cb_prefix = "S_PORN_BUTTON";
                const title = l[lang].SEND_PUNISHMENT_DURATION.replace("{punishment}", punishmentToText(lang, chat.media.nsfw.punishment));
                const time = ST.callbackEvent(GHbot, db, chat.media.nsfw.PTime, cb, chat, user, cb_prefix, returnButtons, title);
                if (time !== -1 && time !== chat.media.nsfw.PTime) chat.media.nsfw.PTime = time;
                db.chats.update(chat);
                return;
            }

            if (cb.data.includes("_DELETION")) {
                chat.media.nsfw = chat.media.nsfw || newPunishObj();
                chat.media.nsfw.delete = !chat.media.nsfw.delete;
                if (!chat.media.nsfw.delete && chat.media.nsfw.punishment === 0) delete chat.media.nsfw;
            }

            db.chats.update(chat);
        }

        // main view
        const isActive = chat.media.hasOwnProperty("nsfw");
        const current = isActive ? punishmentToFullText(lang, chat.media.nsfw.punishment, chat.media.nsfw.PTime, chat.media.nsfw.delete) : l[lang].OFF;
        const header = bold(l[lang]["MEDIA:nsfw"]) + "\n" + l[lang].MEDIA_INFO.replace("{type}", l[lang]["MEDIA:nsfw"]);
        const title = header + "\n\n" + current;

        // Use shared generator for consistent layout
        const buttons = genPunishButtons(lang, chat.media.nsfw ? chat.media.nsfw.punishment : 0, "S_PORN_BUTTON", chat.id, true, chat.media.nsfw ? !!chat.media.nsfw.delete : false);
        buttons.unshift([{ text: "ℹ️", callback_data: "S_PORN_BUTTON#INFO:" + chat.id }]);
        buttons.push([{ text: l[lang].BACK_BUTTON, callback_data: "SETTINGS_HERE:" + chat.id }]);

        const options = {
            chat_id: cb.chat.id,
            message_id: msg.message_id,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: buttons }
        };
        GHbot.editMessageText(user.id, title, options);
        GHbot.answerCallbackQuery(user.id, cb.id);
    });

    GHbot.onMessage(async (msg, chat, user) => {
        if (!(msg.waitingReply && msg.waitingReply.startsWith("S_PORN_BUTTON"))) return;
        if (msg.chat.isGroup && chat.id != msg.chat.id) return;
        if (!(user.perms && user.perms.settings)) return;

        chat.media = chat.media || {};
        if (!chat.media.hasOwnProperty("nsfw")) chat.media.nsfw = newPunishObj();

        if (msg.waitingReply.includes("STIME")) {
            const returnButtons = [[{ text: l[chat.lang].BACK_BUTTON, callback_data: "S_PORN_BUTTON:" + chat.id }]];
            const cb_prefix = "S_PORN_BUTTON#";
            const title = l[chat.lang].SEND_PUNISHMENT_DURATION.replace("{punishment}", punishmentToText(chat.lang, chat.media.nsfw.punishment));
            const time = ST.messageEvent(GHbot, chat.media.nsfw.PTime, msg, chat, user, cb_prefix, returnButtons, title);
            if (time !== -1 && time !== chat.media.nsfw.PTime) {
                chat.media.nsfw.PTime = time;
                db.chats.update(chat);
            }
        }
    });
}

module.exports = main;
