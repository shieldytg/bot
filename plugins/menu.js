var LGHelpTemplate = require("../GHbot.js");
const GHCommand = require("../api/tg/LGHCommand.js");
const { waitReplyPrivate, unsetWaitReply } = require("../api/utils/utils.js");
const botsRegistry = require("../api/botsRegistry.js");
const TelegramBot = require('node-telegram-bot-api');

function main(args)
{

    const GHbot = new LGHelpTemplate(args);
    const {TGbot, db, config} = GHbot;

    l = global.LGHLangs; //importing langs object

    GHCommand.registerCommands(["COMMAND_START"], (msg, chat, user, private, lang, key, keyLang) => {
        if(msg.chat.type != "private") return;
        GHbot.sendMessage(user.id, user.id, l[user.lang].PRESENTATION.replace("{name}",user.first_name+" "+(user.last_name||"")),{
            parse_mode : "HTML",
            link_preview_options : JSON.stringify({is_disabled : true}),
            reply_markup :{inline_keyboard :[
                [{text: l[user.lang].ADD_ME_TO_A_GROUP_BUTTON, url: "tg://resolve?domain=" + TGbot.me.username + "&startgroup&admin=change_info+delete_messages+restrict_members+invite_users+pin_messages+promote_members+manage_video_chats+manage_chat"}],
                [{text: l[user.lang].GROUP_BUTTON, url: "https://t.me/+HO7_J_tp-GRiNTZi" }, {text: l[user.lang].CHANNEL_BUTTON, url: "https://t.me/+HO7_J_tp-GRiNTZi"}],
                [{text: l[user.lang].SUPPORT_BUTTON, callback_data: "SUPPORT_BUTTON"}, {text: l[user.lang].INFO_BUTTON, callback_data: "INFO_BUTTON"}],
                [{text: l[user.lang].CREATE_CLONE_BUTTON, callback_data: "CREATE_CLONE"}],
                [{text: l[user.lang].LANGS_BUTTON, callback_data: "LANGS_BUTTON"}]
        ]}})
    })

    GHbot.onCallback( async (cb, chat, user) =>  {

        var lang = user.lang;
        var msg = cb.message;

        if(chat.isGroup) return;

        if( cb.data == "MENU" )
        {

            GHbot.editMessageText( user.id, l[lang].PRESENTATION.replace("{name}",user.first_name+" "+(user.last_name||"")),{
                message_id : msg.message_id,
                chat_id : chat.id,
                parse_mode : "HTML",
                link_preview_options : JSON.stringify({is_disabled : true}),
                reply_markup :{inline_keyboard:[
                        [{text: l[lang].ADD_ME_TO_A_GROUP_BUTTON, url: "https://t.me/" + TGbot.me.username + "?startgroup=true&admin=change_info+delete_messages+restrict_members+invite_users+pin_messages+promote_members+manage_video_chats+manage_chat"}],
                        [{text: l[lang].GROUP_BUTTON, url: "https://t.me/+HO7_J_tp-GRiNTZi" }, {text: l[lang].CHANNEL_BUTTON, url: "https://t.me/+HO7_J_tp-GRiNTZi"}],
                        [{text: l[lang].SUPPORT_BUTTON, callback_data: "SUPPORT_BUTTON"}, {text: l[lang].INFO_BUTTON, callback_data: "INFO_BUTTON"}],
                        [{text: l[lang].CREATE_CLONE_BUTTON, callback_data: "CREATE_CLONE"}],
                        [{text: l[lang].LANGS_BUTTON, callback_data: "LANGS_BUTTON"}]
            ]}})
            GHbot.answerCallbackQuery(user.id, cb.id);

        }

        if (cb.data == "CREATE_CLONE") {
            // Ask for token in private
            if (msg.chat.type !== "private") {
                GHbot.answerCallbackQuery(user.id, cb.id, {text: l[lang].CLONE_OPEN_PRIVATE_FIRST, show_alert: true});
                return;
            }
            GHbot.answerCallbackQuery(user.id, cb.id);
            await GHbot.sendMessage(user.id, user.id, l[lang].CLONE_SEND_TOKEN);
            waitReplyPrivate(db, "CLONE_BOT", user);
            return;
        }

        if( cb.data == "INFO_BUTTON" )
        {

            GHbot.editMessageText( user.id, l[lang].INFO.replace("{LGHVersion}",global.LGHVersion), 
            {
                message_id : msg.message_id,
                chat_id : chat.id,
                parse_mode : "HTML",
                reply_markup:{inline_keyboard :[
                        [{text: l[lang].SUPPORT_ABOUT_BUTTON, callback_data: "SUPPORT_BUTTON"}],
                        [{text: l[lang].COMMANDS_BUTTON, url: "https://t.me/+HO7_J_tp-GRiNTZi"}],
                        [{text: l[lang].BACK_BUTTON, callback_data: "MENU"}]]}
            })
            GHbot.answerCallbackQuery(user.id, cb.id);

        }

    })

    // Handle waiting reply for clone token in private
    GHbot.onMessage(async (msg, chat, user) => {
        try {
            if (chat.type !== "private") return;
            if (user.waitingReply !== "CLONE_BOT") return;
            const token = (msg.text || "").trim();
            if (!token || token.length < 20) {
                await GHbot.sendMessage(user.id, user.id, l[user.lang].CLONE_INVALID_TOKEN);
                return;
            }

            // quick validate token by calling getMe
            let testBot = null;
            try {
                testBot = new TelegramBot(token, {polling: false});
                const me = await testBot.getMe();
                if (!me || !me.id) throw new Error("Invalid bot");
            } catch (e) {
                await GHbot.sendMessage(user.id, user.id, l[user.lang].CLONE_VALIDATE_FAIL);
                return;
            } finally {
                testBot = null;
            }

            // persist and start bot
            botsRegistry.addToken(token);
            unsetWaitReply(db, user, chat, false);

            const started = global.startShieldyBot ? await global.startShieldyBot(token) : false;
            if (started) {
                await GHbot.sendMessage(user.id, user.id, l[user.lang].CLONE_STARTED_OK);
            } else {
                await GHbot.sendMessage(user.id, user.id, l[user.lang].CLONE_STARTED_FAIL);
            }
        } catch (err) {
            console.log("Clone flow error", err);
        }
    });

}

module.exports = main;
