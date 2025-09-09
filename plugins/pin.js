var LGHelpTemplate = require("../GHbot.js")
const { telegramErrorToText, sendCommandReply } = require( "../api/utils/utils.js" );
const GHCommand = require("../api/tg/LGHCommand.js");

function main(args)
{

    const GHbot = new LGHelpTemplate(args);
    const {TGbot, db, config} = GHbot;

    l = global.LGHLangs; //importing langs object
    
    GHCommand.registerCommands(["COMMAND_PIN"], async (msg, chat, user, private, lang, key, keyLang) => {
        if(!msg.chat.isGroup) return;
        // Require the command to be a reply to the message that should be pinned
        if(!msg.reply_to_message)
        {
            const hint = l[lang].CMDDESC_PIN || "Reply to a message with /pin to pin it.";
            // reply in the same context (private/group) where the command was issued
            const options = { reply_parameters: {chat_id: msg.chat.id, message_id: msg.message_id, allow_sending_without_reply:true} };
            sendCommandReply(private, lang, GHbot, user.id, msg.chat.id, (id)=>GHbot.sendMessage(user.id, id, hint, options));
            return;
        }

        var data = chat.id+","+msg.reply_to_message.message_id;
        var buttons = [
            [{text:l[lang].NOT_NOTIFY,callback_data:"PIN_SILENT_"+data+":"+chat.id}, {text:l[lang].YES_NOTIFY,callback_data:"PIN_NOTIFY_"+data+":"+chat.id}],
            [{text:l[lang].CANCEL_BUTTON,callback_data:"PIN_CANCEL:"+chat.id}]
        ]

        var options = {
            parse_mode : "HTML",
            reply_parameters: {chat_id:chat.id, message_id: msg.message_id, allow_sending_without_reply:true},
            reply_markup: {inline_keyboard:buttons}
        }
        var text = l[lang].ASK_PIN_NOTIFY
        var func = (id) => {return GHbot.sendMessage(user.id, id, text, options)};
        sendCommandReply(private, lang, GHbot, user.id, msg.chat.id, func);
    })

    GHbot.onCallback( async (cb, chat, user) => {

        var msg = cb.message;
        var lang = user.lang;

        //security guards for settings
        if(!chat.isGroup) return;
        if( !cb.data.startsWith("PIN_") ) return;
        if( !(user.perms && user.perms.commands.includes("COMMAND_PIN") || user.perms.commands.includes("@COMMAND_PIN")) ) return;
        if( cb.chat.isGroup && chat.id != cb.chat.id) return;

        if(cb.data.startsWith("PIN_CANCEL"))
        {
            TGbot.deleteMessages(cb.chat.id, [msg.message_id]);
            return;
        }

        if(cb.data.startsWith("PIN_"))
        {
            var notify = (cb.data.split("PIN_")[1].split("_")[0] == "SILENT");
            
            var options = {};
            if(notify) options.disable_notification = true;
            
            var data = cb.data.split("PIN_")[1].split("_")[1].split(":")[0];
            var pinChatId = data.split(",")[0];
            var pinMsgId = data.split(",")[1];

            try {
                await TGbot.pinChatMessage(pinChatId, pinMsgId, options);
                TGbot.deleteMessages(cb.chat.id, [msg.message_id]);
            } catch (error) {
                var errText = telegramErrorToText(lang, error);
                GHbot.answerCallbackQuery(user.id, cb.id, {text:errText, show_alert:true});
            }

        }

    })


}

module.exports = main;
