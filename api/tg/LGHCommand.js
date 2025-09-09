const GH = require("../../GHbot.js");
const { checkCommandPerms } = require("../utils/rolesManager.js");
l = global.LGHLangs;

/**
 * @typedef {Object} resolveCommandKeyReturn
 * @property {string} key - Command permission key
 * @property {string} lang - Identified command lang
 */
/**
 * @param {string} name 
 * @returns {resolveCommandKeyReturn|false}
 */
function resolveCommandKey(name)
{
    var langKeys = Object.keys(l);
    for(var i = 0; i < langKeys.length; i++)
    {
        var lang = l[langKeys[i]];
        if(lang.hasOwnProperty("/"+name))
            return {key: lang["/"+name], lang:langKeys[i]};
            
    }
    return false;
}

///////////

// Maintain per-instance command tables to avoid cross-bot leakage
// instanceId is typically TGbot.me.id
var currentInstanceId = null;
var runTables = {}; // { [instanceId]: { COMMAND_KEY: handler } }

function ensureTable(instanceId) {
    if (!runTables[instanceId]) runTables[instanceId] = {};
    return runTables[instanceId];
}

function setInstanceId(instanceId) {
    currentInstanceId = String(instanceId);
    ensureTable(currentInstanceId);
}

/**
 * Registers a list of commands with various specified key permission to a function.
 *
 * @param {Array<string>} keys - A list of keys that an user permissions should meet to run the command
 * @param {(msg: GH.LGHMessage, chat: GH.LGHChat, user: GH.LGHUser, private: boolean, lang: string, key: string, keyLang: string ) => void} func - The function to be executed if any key is identified
 * func.msg, func.chat and func.user contains the GHbot.onMessage event parameters
 * func.private is true if user permissions allows private only command reply
 * func.lang contains the lang of the chat where message should be sent
 * func.key contain the trigghered key
 * func.keyLang contain in what language the key has been found in
 * @param {string} [instanceId] - The instance ID for the command registry
 * @example
 * registerCommand(['COMMAND_RULES'], function(msg, chat, user, key, lang, private) {
 *      console.log(key) //COMMAND_RULES
 * });
 */
function registerCommands(keys, func, instanceId)
{
    const id = String(instanceId || currentInstanceId || "default");
    const table = ensureTable(id);
    keys.forEach((key)=>{
        table[key] = func;
    });
};

/**
 * Run eventual registered commands that user has permission to run
 * @param {GH.LGHMessage} msg 
 * @param {GH.LGHChat} chat 
 * @param {GH.LGHUser} user 
 * @param {string} [instanceId] - The instance ID for the command registry
 */
function messageEvent(msg, chat, user, instanceId)
{
    if(msg.waitingReply) return;

    var command = msg.command;
    if(!command) return;

    var forcesPrivate = command.name.startsWith("*");
    if(forcesPrivate) command.name = command.name.replace("*","");

    var commandInfo = resolveCommandKey(command.name);
    if(!commandInfo) return; //unknown command in any language
    var key = commandInfo.key;
    var keyLang = commandInfo.lang;

    const id = String(instanceId || currentInstanceId || "default");
    const table = ensureTable(id);

    if(chat.isGroup){
        var check = checkCommandPerms(user.perms.commands, key);
        var hasGroupPermission = check.group;
        var hasPrivatePermission = check.private;

        // run related one command
        if( table[key] && !forcesPrivate && hasGroupPermission)
            table[key](msg, chat, user, false, chat.lang, key, keyLang);
        if( table[key] && (!hasGroupPermission || forcesPrivate) && hasPrivatePermission )
            table[key](msg, chat, user, true, user.lang, key, keyLang);

        if( forcesPrivate && hasGroupPermission && !hasPrivatePermission )
        {
            console.log("LGHCommand.js: let know the user that he can use the command only on group chat, he used \"*\" command prefix");
        }

        if( !hasGroupPermission && !hasPrivatePermission )
        {
            console.log("LGHCommand.js: let know the user that he have not enough permissions to run the command");
        }
    }
    else{
        if (table[key]) table[key](msg, chat, user, true, user.lang, key, keyLang);
    }
}

module.exports = {
    setInstanceId,
    registerCommands,
    messageEvent
}