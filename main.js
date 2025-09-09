const LGHelpTemplate = require("./GHbot.js");
const {parseCommand} = require( __dirname + "/api/utils/utils.js" );
const EventEmitter = require("node:events");
const getDatabase = require( "./api/database.js" );
const RM = require("./api/utils/rolesManager.js");
const TR = require("./api/tg/tagResolver.js");
const TelegramBot = require('node-telegram-bot-api');
const GHCommand = require("./api/tg/LGHCommand.js");
const {tag, getOwner, keysArrayToObj, isChatAllowed, getUnixTime, unsetWaitReply } = require("./api/utils/utils.js");
  

async function main(config) {

    config.chatWhitelist = keysArrayToObj(config.chatWhitelist);
    config.chatBlacklist = keysArrayToObj(config.chatBlacklist);
    


    const GroupHelpBot = new EventEmitter();
    GroupHelpBot.setMaxListeners(100);
    
    

    console.log("Starting a bot...")
    
    var TGbot = new TelegramBot(config.botToken, {polling: true});
    await TGbot.setWebHook("",{allowed_updates: JSON.stringify(["message", "edited_message", "edited_channel_post", "callback_query", "message_reaction", "message_reaction_count", "chat_member"])})
    const bot = await TGbot.getMe();
    TGbot.me = bot;


    // assign a per-bot database namespace so each bot has isolated data
    if (!config.dbNamespace) config.dbNamespace = String(bot.id);

    //load database
    var db = getDatabase(config);
    console.log("log db path");
    console.log(db.dir)

    const GHbot = new LGHelpTemplate({GHbot: GroupHelpBot, TGbot, db, config});

    // Ensure command registry is isolated per bot instance
    try { GHCommand.setInstanceId(bot.id); } catch(e) { /* older versions may not support; ignore */ }

    //load tagResolver
    TR.load(config);

    //some simplified variables
    l = global.LGHLangs;

    /**
     * @typedef {Object} handleMessageReturn
     * @param {LGHelpTemplate.LGHMessage} msg
     * @param {LGHelpTemplate.LGHChat} chat
     * @param {LGHelpTemplate.LGHUser} user
     */
    /**
     * @param {TelegramBot.Message} msg 
     * @param {TelegramBot.Metadata} metadata 
     * @description
     * handles telegram raw messages and return various
     * ready to use Shieldy objects
     * @returns {handleMessageReturn}
     */
    async function handleMessage(msg, metadata){ try {

        if(!isChatAllowed(config, msg.chat.id)) return;
        
        TR.logMsg(msg)

        var from = msg.from;
        var chat = msg.chat;
        var isGroup =  (chat.type == "supergroup" || chat.type == "group");
        chat.isGroup = isGroup;

        //configuring user
        if ( !db.users.exhist( from.id ) )
            db.users.add( from );
        var user = Object.assign( {},  db.users.get( from.id ), msg.from );

        //handle new chats
        if(isGroup && (config.overwriteChatDataIfReAddedToGroup || !db.chats.exhist( chat.id )))
        {    
            console.log( "Adding new group to database" );

            //configure group lang
            chat.lang = config.reserveLang;
            var isAdderUserKnown = msg.hasOwnProperty("new_chat_member") && msg.new_chat_members.some(user=>{user.id==bot.id});
            if(isAdderUserKnown)//If possible inherit lang from who added the bot
                chat.lang = user.lang;
            console.log( "Group lang: " + chat.lang )

            db.chats.add(chat);
            chat = db.chats.get(chat.id)

            //add admins
            var adminList = await TR.getAdmins(TGbot, chat.id, db);
            chat = RM.reloadAdmins(chat, adminList);
            db.chats.update(chat);

            var creator = getOwner(adminList);
            var newGroupText = l[chat.lang].NEW_GROUP;
            newGroupText = (creator && !creator.is_anonymous) ?
                newGroupText.replace("{owner}",tag(".",creator.user.id)) :
                newGroupText.replace("{owner}",".");
            
            await GHbot.sendMessage(user.id, chat.id, newGroupText,{parse_mode:"HTML",
                reply_markup :{inline_keyboard:[[{text: l[chat.lang].ADV_JOIN_CHANNEL, url: "https://t.me/+HO7_J_tp-GRiNTZi"}]]}
            })
            GHbot.sendMessage(user.id, chat.id, l[chat.lang].SETUP_GUIDE,{parse_mode:"HTML",
                reply_markup :{inline_keyboard :[[
                            {text: l[chat.lang].LANGS_BUTTON2, callback_data: "LANGS_BUTTON:"+chat.id},
                            {text: l[chat.lang].SETTINGS_BUTTON, callback_data: "SETTINGS_SELECT:"+chat.id}]]}
            })
        
        }
        chat = Object.assign( {}, ((chat.isGroup ? db.chats.get( chat.id ) : {})), chat );
        msg.chat = chat;
        
        //add any new chat user
        if(chat.users && !chat.users.hasOwnProperty(user.id))
        {
            chat = RM.addUser(chat, msg.from);
            db.chats.update(chat);
        }


        //configuring msg.command
        var command = parseCommand(msg.text || "");
        msg.command = command;
        
        //configuring msg.target
        msg.target = false;
        msg.target = await TR.getMessageTarget(msg, chat, TGbot, db);

        
        //configuring msg.waitingReply and selected chat (the incoming msg request chat object is kept on msg.chat)
        msg.waitingReply = false;
        var privateWR = msg.chat.type == "private" && user.waitingReply;
        var groupPrivateWR = privateWR && user.waitingReply.includes(":");
        if(isGroup)
        {
            msg.waitingReply = RM.getUser(chat, user.id).waitingReply;
            if(msg.waitingReply && msg.waitingReply.includes(":"))
            {
                var selectedChatId = msg.waitingReply.split(":")[1].split("?")[0];
                chat = db.chats.get(selectedChatId);
            }
            if(msg.waitingReply)
                console.log("user "+user.id+" sent to group "+msg.chat.id+" a WR: ["+chat.id+"] "+msg.waitingReply);
        }
        else if( groupPrivateWR )
        {
            var selectedChatId = user.waitingReply.split(":")[1].split("?")[0];
            var selectedChat = db.chats.get(selectedChatId);
            chat = selectedChat;
            msg.waitingReply = user.waitingReply;
            console.log("user "+user.id+" sent a private message for a group WR: ["+selectedChatId+"] "+ msg.waitingReply);
        }
        else if(privateWR)
        {
            msg.waitingReply = user.waitingReply;
            console.log("user "+user.id+" sent a private message for private waitingReply: "+ msg.waitingReply);
        }
        
        //configure user.perms and the selected chat if avaiable 
        if( chat.isGroup ) user.perms = RM.sumUserPerms(chat, user.id);

        //configuring msg.waitingReplyTarget
        msg.waitingReplyTarget = false;
        if( msg.waitingReply && msg.waitingReply.includes("?") )
        {
            var WRTargetId = msg.waitingReply.split("?")[1];
            msg.waitingReplyTarget = RM.userIdToTarget(TGbot, chat, WRTargetId, db);
        }


        //Final checks
        if(!user.lang)
        {
            console.log("somehow user.lang is not avaiable, logging message to futher debug");
            console.log(msg);
            return;
        }
        if(msg.waitingReply && msg.waitingReply.includes(":") && !chat.isGroup)
        {
            console.log("invalid message waitingReply group detected, logging message to futher debug");
            console.log(msg);
            return;
        }
        if(chat.id == user.id) chat.lang = user.lang;
        return {msg, chat, user}
    } catch (err) {
        console.log("Error trying to handle GroupHelpBot Message, i will log error there \"msg\"");
        console.log(err);
        console.log(msg);
    }}

    TGbot.on( "message", async (msg, metadata) => { try {

        var {msg, chat, user} = await handleMessage(msg, metadata);
        GroupHelpBot.emit( "message", msg, chat, user );

        if(msg.waitingReply == false && !(msg.reply_to_message && msg.isGroup && msg.reply_to_message.text && String(msg.reply_to_message.text).startsWith("#Support")))
            GHCommand.messageEvent(msg, chat, user, bot.id);

        if ( chat.type == "private" ) GroupHelpBot.emit( "private", msg, chat, user );

    } catch (err) {
        console.log("Error after emitting an handled GroupHelpBot \"message\", i will log error then \"msg\", \"chat\", \"user\" ")
        console.log(err);
        console.log(msg);
        console.log(chat);
        console.log(user);
    } } );

    TGbot.on( "edited_message", async (msg) => { try {
        var {msg, chat, user} = await handleMessage(msg);
        GroupHelpBot.emit( "edited_message", msg, chat, user );
    } catch (err) {
        console.log("Error after emitting an handled GroupHelpBot \"edited_message\", i will log error then \"msg\", \"chat\", \"user\" ")
        console.log(err);
        console.log(msg);
        console.log(chat);
        console.log(user);
    } } )

    TGbot.on( "edited_message_text", async (msg) => { try {
        var {msg, chat, user} = await handleMessage(msg);
        GroupHelpBot.emit( "edited_message_text", msg, chat, user );
    } catch (err) {
        console.log("Error after emitting an handled GroupHelpBot \"edited_message_text\", i will log error then \"msg\", \"chat\", \"user\" ")
        console.log(err);
        console.log(msg);
        console.log(chat);
        console.log(user);
    } } )



    TGbot.on( "callback_query", async (cb) => { try {

        if(!isChatAllowed(config, cb.message.chat.id)) return;

        TR.logCb(cb);

        console.log("Callback data: " + cb.data)

        var msg = cb.message;
        var from = cb.from;
        var chat = msg.chat;
        chat.isGroup = (chat.type == "group" || chat.type == "supergroup");
        var chat = Object.assign( {}, ((chat.isGroup ? db.chats.get( chat.id ) : {})), chat );
        if(chat.isGroup && !db.chats.exhist( chat.id )) return; //drop callbacks from unknown groups
        cb.chat = chat;
        var user = Object.assign( {},  db.users.get( from.id ), from );


        if ( !db.users.exhist( from.id ) )
            db.users.add( from );
        
        //drop too old callbacks, prevent incompatible calls
        if(getUnixTime() - cb.message.date > config.maxCallbackAge) //86400 = 1 day
        {
            GHbot.answerCallbackQuery(user.id, cb.id, {text:l[user.lang].BUTTON_TOO_OLD, show_alert:true})
            return;
        }

        //configure user.perms and the selected chat if avaiable (the incoming cb request chat object is kept on cb.chat)
        if(chat.isGroup || cb.data.includes(":"))
        {
            chat = chat.isGroup ? chat : db.chats.get(cb.data.split(":")[1].split("?")[0]);
            user.perms = RM.sumUserPerms(chat, user.id);
        }

        //disable waitingReply on a chat if user clicks a button there
        var privateWR = msg.chat.type == "private" && user.waitingReply;
        var groupPrivateWR = privateWR && user.waitingReply.includes(":");
        var isActiveGroupPrivateWR = groupPrivateWR && user.waitingReply.split(":")[1].split("?")[0] == chat.id
        if( privateWR || (chat.isGroup && RM.getUserWR(chat, user.id)) )
            unsetWaitReply(db, user, chat, msg.chat.isGroup);

        //configure cb.target
        if(cb.data.includes("?"))
        {
            var targetId = cb.data.split("?")[1];
            cb.target = RM.userIdToTarget(TGbot, chat, targetId, db);
        }

        if(!user.lang)
        {
            console.log("somehow user.lang is not avaiable, logging message to futher debug");
            console.log(msg);
            return;
        }
        if(chat.id == user.id) chat.lang = user.lang;

        //emit event
        try {
            GroupHelpBot.emit( "callback_query", cb, chat, user );
        } catch (err) {
            console.log("Error after emitting a valid GroupHelpBot \"callback_query\", i will log error then \"cb\", \"chat\", \"user\" ")
            console.log(err);
            console.log(cb);
            console.log(chat);
            console.log(user);
        }
        
        if( cb.data == "NOT_IMPLEMENTED" )
            GHbot.answerCallbackQuery(user.id, cb.id, {text:l[lang].NOT_IMPLEMENTED,show_alert:true});
    } catch (err) {
        console.log("Error in main.js on callback_query event, i will log the error and then the received callback");
        console.log(err);
        console.log(cb);
    } } )

    // handleMessage is not used here because im not sure is supported by the function
    TGbot.on( "left_chat_member", (msg) => {

        if(!isChatAllowed(config, msg.chat.id)) return;

        var chat = msg.chat;
        var from = msg.from;

        var leftMember = msg.left_chat_member;
        if ( leftMember.id == bot.id && config.deleteChatDataAfterBotRemove == true){

            console.log("Bot kicked from chat and config.deleteChatDataAfterBotRemove == true, deleting chat data of group");
            db.chats.delete( chat.id );

        }

    } )

    TGbot.on( "polling_error", (err) => {
        if(err.code == "ETELEGRAM")
        {
            var errDescription = err.response.body.description;
            if(errDescription.includes("Bad Gateway")) console.log("P ETELEGRAM: Bad gateway");
        }
        else if(err.code == "EFATAL")
        {
            console.log("P EFATAL");
        }
        else {console.log(err) + "P OBJ: " + JSON.stringify(err)}
    } )

    TGbot.on( "webhook_error", (err) => {
        if(err.code == "ETELEGRAM")
        {
            var errDescription = err.response.body.description;
            if(errDescription.includes("Forbidden: bot was kicked from the supergroup chat")) console.log("WB ETELEGRAM: "+errDescription);
        }
        else {console.log(err) + "WB OBJ: " + JSON.stringify(err)}
    } )

    return { GHbot: GroupHelpBot, TGbot, db };

}

module.exports = main;
