const { getUnixTime, secondsToHumanTime, bold, handleTelegramGroupError, getUserWarns, unwarnUser, warnUser, clearWarns } = require("./utils");
const { getPunishmentTracker } = require("./punishmentTracker");

/**
 * Format duration in seconds to a human-readable string
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration string
 */
function formatDuration(seconds) {
    if (seconds < 60) return `${seconds} seconds`;
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
    
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'}`;
}

l = global.LGHLangs;
var year = 31536000;
var unrestrictOpts = {can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,
    can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true,
    can_change_info:true,can_invite_users:true,can_pin_messages:true,can_manage_topics:true}

function clearExpiredUserWarns(chat, targetId)
{
    var now = getUnixTime();

    if(chat.warns.timed.hasOwnProperty(targetId))
    {
        chat.warns.timed[targetId].forEach((endTime, index)=>{
            if((now - endTime) >= 0)
            {
                chat.warns.timed[targetId].splice(index, 1);
                chat = unwarnUser(chat, targetId);
                updateChat = true;
            }
        })
    }

    return chat;
}


function newPunishObj()
{
    return {punishment:0, PTime:0, delete:false};
}

/**
 * 
 * @param {import("../../GHbot").LGHPunish} a - operand 1
 * @param {import("../../GHbot").LGHPunish} b - operand 2
 * @returns {import("../../GHbot").LGHPunish}
 */
function sumPunishObj(a, b)
{
    var result = {punishment:0, PTime:0, delete:false};
    result.punishment = (b.punishment > a.punishment) ? b.punishment : a.punishment;
    result.PTime = (b.PTime > a.PTime) ? b.PTime : a.PTime;
    result.delete = b.delete || a.delete;
    return result;
}

/**
 * @param {import("../../GHbot").LGHPunish} a - the supposed greater punish
 * @param {import("../../GHbot").LGHPunish} b - the supposed smaller punish
 * @returns {import("../../GHbot").LGHPunish}
 */
function isPunishGreater(a, b)
{
    if(a.punishment > b.punishment) return true
    if(a.punishment < b.punishment) return false
    if(a.PTime > b.PTime) return true
    if(a.PTime < b.PTime) return false
}

//punish related functions//
function genRevokePunishButton(lang, targetId, punishment)
{
    //warn
    if(punishment == 1)
        return [{text: l[lang].CANCEL_BUTTON, callback_data: "PUNISH_REVOKE_WARN?"+targetId}];

    //mute
    if(punishment == 3)
        return [{text: l[lang].UNMUTE_BUTTON, callback_data: "PUNISH_REVOKE_MUTE?"+targetId}];

    //ban
    if(punishment == 4)
        return [{text: l[lang].UNBAN_BUTTON, callback_data: "PUNISH_REVOKE_BAN?"+targetId}];
}
function genPunishText(lang, chat, targetUser, punishment, time, reason, db)
{
    time = time || -1;
    reason = reason || false;
    var validTime = time != -1 && time >= 30 && time < year+1;
    var targetId = targetUser.id;
    var text = targetUser.name;

    //warn
    if(punishment == 1)
        text+=l[lang].HAS_BEEN_WARNED.replace("{emoji}","❕")+" ("+getUserWarns(chat, targetId)+" "+l[lang].OF+" "+chat.warns.limit+")";

    //kick
    if(punishment == 2)
        text+=l[lang].HAS_BEEN_KICKED.replace("{emoji}","❗️");

    //mute
    if(punishment == 3)
        text+=l[lang].HAS_BEEN_MUTED.replace("{emoji}","🔇");

    //ban
    if(punishment == 4)
        text+=l[lang].HAS_BEEN_BANNED.replace("{emoji}","🚷");

    if(validTime) text+=" "+l[lang].FOR_HOW_MUCH+" "+secondsToHumanTime(lang, time);
    text+=".";

    if(reason)
        text+="\n"+bold(l[lang].REASON+": ")+reason+".";

    return text;
}
//resolves in the applyed punishment number
async function silentPunish(GHbot, userId, chat, targetId, punishment, time)
{return new Promise(async (resolve, reject)=>{try{

    time = time || -1;
    const now = getUnixTime();
    var options = {};

    //warn
    if(punishment == 1)
    {

        chat = clearExpiredUserWarns(chat, targetId);

        //apply warn
        chat = warnUser(chat, targetId);
        if(time != -1)  
        {
            if(!chat.warns.timed.hasOwnProperty(targetId))
                chat.warns.timed[targetId] = [];
            chat.warns.timed[targetId].push(now + time);
        }

        //re-punish if limit is hit
        if(getUserWarns(chat, targetId) >= chat.warns.limit)
        {
            punishment = await silentPunish(GHbot, userId, chat, targetId, chat.warns.punishment, chat.warns.PTime);
            chat = clearWarns(chat, targetId);
            if(chat.warns.timed.hasOwnProperty(targetId));
                delete chat.warns.timed[targetId];
            resolve(punishment);
            return;
        }

    }

    //kick
    if(punishment == 2)
        await GHbot.unbanChatMember(userId, chat.id, targetId);

    //mute
    if(punishment == 3) {
        options.can_send_messages = false;
        
        // Convert time to seconds if it's a string with units (e.g., '31s', '1h', '2d')
        let timeInSeconds = time;
        if (typeof time === 'string') {
            const match = time.match(/^(\d+)([smhd])?$/i);
            if (match) {
                const value = parseInt(match[1]);
                const unit = match[2] ? match[2].toLowerCase() : 's';
                
                switch(unit) {
                    case 's': timeInSeconds = value; break;
                    case 'm': timeInSeconds = value * 60; break;
                    case 'h': timeInSeconds = value * 60 * 60; break;
                    case 'd': timeInSeconds = value * 60 * 60 * 24; break;
                    default: timeInSeconds = value;
                }
            } else {
                timeInSeconds = parseInt(time) || -1;
            }
        }
        
        const isPermanent = timeInSeconds === -1 || timeInSeconds < 30;
        
        if (!isPermanent) {
            const until = now + timeInSeconds;
            options.until_date = until;
            
            // Track the timed mute
            const tracker = getPunishmentTracker();
            if (tracker) {
                tracker.addPunishment(chat.id, targetId, until, 'mute');
                console.log(`[Punishment] Added timed mute for user ${targetId} in chat ${chat.id} until ${new Date(until * 1000).toISOString()}`);
            }
            
            const durationText = formatDuration(timeInSeconds);
            console.log(`[Punishment] Muting user ${targetId} in chat ${chat.id} for ${durationText} (until ${new Date(until * 1000).toISOString()})`);
        } else {
            console.log(`[Punishment] Permanently muting user ${targetId} in chat ${chat.id}`);
        }
        
        await GHbot.restrictChatMember(userId, chat.id, targetId, options);
    }

    //ban
    if(punishment == 4) {
        // Convert time to seconds if it's a string with units (e.g., '31s', '1h', '2d')
        let timeInSeconds = time;
        if (typeof time === 'string') {
            const match = time.match(/^(\d+)([smhd])?$/i);
            if (match) {
                const value = parseInt(match[1]);
                const unit = match[2] ? match[2].toLowerCase() : 's';
                
                switch(unit) {
                    case 's': timeInSeconds = value; break;
                    case 'm': timeInSeconds = value * 60; break;
                    case 'h': timeInSeconds = value * 60 * 60; break;
                    case 'd': timeInSeconds = value * 60 * 60 * 24; break;
                    default: timeInSeconds = value;
                }
            } else {
                timeInSeconds = parseInt(time) || -1;
            }
        }
        
        const isPermanent = timeInSeconds === -1 || timeInSeconds < 30;
        
        if (!isPermanent) {
            const until = now + timeInSeconds;
            options.until_date = until;
            
            // Track the timed ban
            const tracker = getPunishmentTracker();
            if (tracker) {
                tracker.addPunishment(chat.id, targetId, until, 'ban');
                console.log(`[Punishment] Added timed ban for user ${targetId} in chat ${chat.id} until ${new Date(until * 1000).toISOString()}`);
            }
            
            const durationText = formatDuration(timeInSeconds);
            console.log(`[Punishment] Banning user ${targetId} in chat ${chat.id} for ${durationText} (until ${new Date(until * 1000).toISOString()})`);
        } else {
            console.log(`[Punishment] Permanently banning user ${targetId} in chat ${chat.id}`);
        }
        
        await GHbot.banChatMember(userId, chat.id, targetId, options);
    }

    resolve(punishment);

}catch(error){reject(error);}})
}
async function punishUser(GHbot, userId, chat, targetUser, punishment, time, reason)
{

    console.log("Punishing user " + punishment)

    var lang = chat.lang;
    var targetId = targetUser.id;
    time = time || -1;
    reason = reason || false;

    if(punishment == 0) return;

    try {
        //warn
        if(punishment == 1)
        {

            //check if has been applyed a repunish
            punishment = await silentPunish(GHbot, userId, chat, targetId, punishment);
            if(punishment != 1)
            {
                var repunishReason = reason || "";repunishReason+=" ("+l[lang].REACHED_WARN_LIMIT+")";
                var text = genPunishText(lang, chat, targetUser, punishment, time, repunishReason);
                var buttons = [genRevokePunishButton(lang, targetId, punishment)];
                var options = {parse_mode: "HTML", reply_markup: {inline_keyboard: buttons}};
                GHbot.sendMessage(userId, chat.id, text, options);
                return;
            }

        }

        //kick
        if(punishment == 2)
            await silentPunish(GHbot, userId, chat, targetId, punishment, time);

        //mute
        if(punishment == 3) {
            console.log(`[PunishUser] Applying mute to user ${targetId} for ${time} seconds`);
            await silentPunish(GHbot, userId, chat, targetId, punishment, time);
        }

        //ban
        if(punishment == 4) {
            console.log(`[PunishUser] Applying ban to user ${targetId} for ${time} seconds`);
            await silentPunish(GHbot, userId, chat, targetId, punishment, time);
        }

        var text = genPunishText(lang, chat, targetUser, punishment, time, reason);
        var buttons = [genRevokePunishButton(lang, targetId, punishment)];
        var options = {parse_mode: "HTML", reply_markup: {inline_keyboard: buttons}};
        GHbot.sendMessage(userId, chat.id, text, options);
    } catch (error) {
        handleTelegramGroupError(GHbot, userId, chat.id, lang, error);
    }

}


//unpunish related functions//
function genUnpunishButtons(lang, chat, targetId, punishment)
{
    if(punishment == 1)
    {
        if(getUserWarns(chat, targetId) == 0)
            return [[{text: "+1", callback_data: "PUNISH_WARN_INC?"+targetId}]];

        if(getUserWarns(chat, targetId) > 0)
            return [
                [{text: "-1", callback_data: "PUNISH_WARN_DEC?"+targetId}, {text: "+1", callback_data: "PUNISH_WARN_INC?"+targetId}],
                [{text: l[lang].RESET_WARNS_BUTTON, callback_data: "PUNISH_WARN_ZERO?"+targetId}],
            ];
    }
    return [];
}
function genUnpunishText(lang, chat, targetUser, punishment, reason, db)
{
    var text = targetUser.name;
    var targetId = targetUser.id;

    //unwarn
    if(punishment == 1)
    {
        if(getUserWarns(chat, targetId) == 0)
            text+=l[lang].NO_MORE_WARNS;
        if(getUserWarns(chat, targetId) > 0)
            text+=l[lang].HAS_WARNS_OF.replaceAll("{number}",getUserWarns(chat, targetId)).replaceAll("{max}",chat.warns.limit);
    }

    //unmute
    if(punishment == 3)
        text+=l[lang].UNMUTED;

    //unban
    if(punishment == 4)
        text+=l[lang].UNBANNED;

    text+=".";

    if(reason)
        text+="\n"+bold(l[lang].REASON+": ")+reason+".";

}
//resolves true on success
async function silentUnpunish(GHbot, userId, chat, targetId, punishment)
{
    return new Promise(async (resolve, reject) => {
    try{
    var options = {}
    const now = getUnixTime();
    const timestamp = new Date(now * 1000).toISOString();

    //unwarn
    if(punishment == 1)
    {
        console.log(`[${timestamp}] [Punishment] Removing warning for user ${targetId} in chat ${chat.id}`);
        chat = unwarnUser(chat, targetId);
        chat = clearExpiredUserWarns(chat, targetId);
        console.log(`[${timestamp}] [Punishment] Successfully removed warning for user ${targetId} in chat ${chat.id}`);
    }

    //unmute
    if(punishment == 3)
    {
        console.log(`[${timestamp}] [Punishment] Unmuting user ${targetId} in chat ${chat.id}`);
        
        // Remove from tracker if exists
        const tracker = getPunishmentTracker();
        if (tracker) {
            const removed = tracker.removePunishment(chat.id, targetId);
            if (removed) {
                console.log(`[${timestamp}] [Punishment] Removed mute tracking for user ${targetId} in chat ${chat.id}`);
            }
        }
        
        options = unrestrictOpts;
        await GHbot.restrictChatMember(userId, chat.id, targetId, options);
        console.log(`[${timestamp}] [Punishment] Successfully unmuted user ${targetId} in chat ${chat.id}`);
    }

    //unban
    if(punishment == 4)
    {
        console.log(`[${timestamp}] [Punishment] Unbanning user ${targetId} in chat ${chat.id}`);
        
        // Remove from tracker if exists
        const tracker = getPunishmentTracker();
        if (tracker) {
            const removed = tracker.removePunishment(chat.id, targetId);
            if (removed) {
                console.log(`[${timestamp}] [Punishment] Removed ban tracking for user ${targetId} in chat ${chat.id}`);
            }
        }
        
        options.only_if_banned = true;
        await GHbot.unbanChatMember(userId, chat.id, targetId, options);
        console.log(`[${timestamp}] [Punishment] Successfully unbanned user ${targetId} in chat ${chat.id}`);
    }

    resolve(true);

}catch(error){
    console.error(`[${new Date().toISOString()}] [Punishment] Error in silentUnpunish for user ${targetId} in chat ${chat?.id || 'unknown'}:`, error);
    reject(error);
}})
}
async function unpunishUser(GHbot, userId, chat, targetUser, punishment, reason)
{

    console.log("Unpunishing user " + punishment)

    var lang = chat.lang;
    var targetId = targetUser.id;
    reason = reason || false;

    if(punishment == 0) return;

    var options = {};

    try {
        //unwarn
        if(punishment == 1)
            await silentUnpunish(GHbot, userId, chat, targetId, punishment);

        //unmute
        if(punishment == 3)
            await silentUnpunish(GHbot, userId, chat, targetId, punishment);

        //unban
        if(punishment == 4)
            await silentUnpunish(GHbot, userId, chat, targetId, punishment);

        var text = genUnpunishText(lang, chat, targetUser, punishment, reason);
        var buttons = genUnpunishButtons(lang, chat, targetUser.id, punishment);
        options.reply_markup = {inline_keyboard:buttons};
        options.parse_mode = "HTML";
        GHbot.sendMessage(userId, chat.id, text, options);
    } catch (error) {
        handleTelegramGroupError(GHbot, userId, chat.id, lang, error);
    }

}


//other special functions
function applyChatBasedPunish(GHbot, userId, chat, targetUser, punishments, type, reason, messageId)
{

    reason = reason || "";
    var punish = 0;
    var PTime = false;
    var deletion = false;

    switch (type) {
        case "user":
            reason = reason.replace("{type}", l[chat.lang].USER);
            punish = punishments.users.punishment;
            PTime = punishments.users.PTime;
            deletion = punishments.users.delete;
            break;
        case "bot":
            reason = reason.replace("{type}", l[chat.lang].BOT);
            punish = punishments.bots.punishment;
            PTime = punishments.bots.PTime;
            deletion = punishments.bots.delete;
            break;
        case "group":
            reason = reason.replace("{type}", l[chat.lang].GROUP);
            punish = punishments.groups.punishment;
            PTime = punishments.groups.PTime;
            deletion = punishments.groups.delete;
            break;
        case "channel":
            reason = reason.replace("{type}", l[chat.lang].CHANNEL);
            punish = punishments.channels.punishment;
            PTime = punishments.channels.PTime;
            deletion = punishments.channels.delete;
            break;
    }

    if(deletion && messageId)
        GHbot.deleteMessage(chat.id, messageId);

    if(punish > 0) {
        console.log(`[applyChatBasedPunish] Applying punishment ${punish} to user ${targetUser.id} for ${PTime || 'default'} seconds`);
        punishUser(GHbot, userId, chat, targetUser, punish, PTime, reason);
    }
}

module.exports = {
    newPunishObj, sumPunishObj, isPunishGreater,
    genRevokePunishButton, genPunishText,
    silentPunish, punishUser,
    genUnpunishButtons, genUnpunishText,
    silentUnpunish, unpunishUser,
    applyChatBasedPunish,
}
