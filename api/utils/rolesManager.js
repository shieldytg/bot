const {genUserList, bold, isString, anonymizeAdmins, LGHUserName, loadChatUserId, isAdminOfChat} = require("./utils.js");
const GH = require("../../GHbot.js");
const TelegramBot = require("node-telegram-bot-api");
l = global.LGHLangs;

//Roles with string name is intended as a pre-made role
//pre-made roles chat.roles[role] will contain only "users" array, data about the role are stored on global.roles[role]
//TODO: add admin role that's the role given automaticallywith custom permissions based on telegram permissions bindings
//So a function to convert telegram permissions to our GH.LGHPerms object

/** 
 * @typedef {Object} userStatus
 * @property {GH.LGHPerms} perms - GH.LGHPerms object for all user-specific permissions
 * @property {Array<String|Number>} roles - array user roles, string for pre-made roles, number for custom roles (user-made)
 * @property {GH.LGHPerms} adminPerms - GH.LGHPerms object for user permissions if admin
 * @property {String} title - user administrator title
 */

/** 
 * @typedef {Object} GHRole
 * @property {String} name - role name
 * @property {GH.LGHPerms} perms - GH.LGHPerms object applyed at lowest priority on any user in this role
 * @property {Array<Number|String>} users - array of userId in this role
 */

/**
 * @typedef {Object<string, GHRole>} GHRoles
 * @description Object representing a list of roles, the numeral keys means custom role, the named keys means pre-made role
 */

/**
 * 
 * @return {GH.LGHPerms}
 *      Get a default GH.LGHPerms object
 */
function newPerms(commands, immune, flood, link, tgLink, forward, quote, porn, night, media, alphabets, words, length, roles, settings)
{
    commands = commands || [];
    immune = immune || 0;
    flood = flood || 0;
    link = link || 0;
    tgLink = tgLink || 0;
    forward = forward || 0;
    quote = quote || 0;
    porn = porn || 0;
    night = night || 0;
    media = media || 0;
    alphabets = alphabets || 0;
    words = words || 0;
    length = length || 0;
    roles = roles || 0;
    settings = settings || 0;
    
    immune = (immune === false) ? -1 : immune;
    flood = (flood === false) ? -1 : flood;
    link = (link === false) ? -1 : link;
    tgLink = (tgLink === false) ? -1 : tgLink;
    forward = (forward === false) ? -1 : forward;
    quote = (quote === false) ? -1 : quote;
    porn = (porn === false) ? -1 : porn;
    night = (night === false) ? -1 : night;
    media = (media === false) ? -1 : media;
    alphabets = (alphabets === false) ? -1 : alphabets;
    words = (words === false) ? -1 : words;
    length = (length === false) ? -1 : length;
    roles = (roles === false) ? -1 : roles;
    settings = (settings === false) ? -1 : settings;


    var defaultPermissions = {
        commands: commands,
        immune: immune,
        flood: flood,
        link: link,
        tgLink: tgLink,
        forward: forward,
        quote: quote,
        porn: porn,
        night : night,
        media: media,
        alphabets: alphabets,
        words: words,
        length: length,
        roles : roles,
        settings: settings,
    }
    
    return defaultPermissions;
}

/**
 * 
 * @return {GHRole}
 *      Get a default GHRole object
 */
function newRole(name, emoji, level, perms, users)
{
    name = name || "role";
    (emoji === false) ? "👤" : emoji; emoji = emoji || "👤";
    (level === false) ? 0 : level; level = level || 0;
    perms = perms || newPerms();
    users = users || [];

    var defualtRole = {
        name: name,
        emoji: emoji,
        level: level,
        perms: perms,
        users: users,
    }

    return defualtRole;
}

/**
 * 
 * @return {GHRoles}
 *      Get a GHRoles object for pre-made roles that's already set (on global.roles)
 *      if you get it, only roles[role].users should be useful, perms and name data should be took from global role
 */
function newPremadeRolesObject()
{
    var roles = {};
    var rolesList = getPremadeRoles();

    rolesList.forEach((role)=>{
        roles[role] = {users: []};
    })

    return roles;
}

/**
 * 
 * @return {userStatus}
 *      Get a default userStatus object
 */
function newUser(user, perms, adminPerms, roles, title)
{   
    perms = perms || newPerms();
    adminPerms = adminPerms || newPerms();
    roles = roles || [];
    title = title || "";

    var userData = {
        firstJoin: false,
        perms: perms,
        adminPerms: adminPerms,
        roles: roles,
        title: title,
        waitingReply : false,
    }

    return userData
}

/**
 * @returns {GH.userStatus}
 */
function getUser(chat, userId)
{
    if(!chat.users) return undefined;
    return chat.users[userId];
}

function getUserRoles(chat, userId)
{
    if(!chat.users || !chat.users[userId]) return [];
    return chat.users[userId].roles;
}

function getRoleUsers(chat, role)
{
    return chat.roles[role].users;
}

/**
 * @returns {GH.LGHPerms}
 */
function getUserPerms(chat, userId)
{
    if(!chat.users || !chat.users[userId]) return newPerms();
    return chat.users[userId].perms;
}

/**
 * @returns {GH.LGHPerms}
 */
function getAdminPerms(chat, userId)
{
    if(!chat.users || !chat.users[userId]) return newPerms();
    return chat.users[userId].adminPerms;
}

function getUserLevel(chat, userId)
{
    if(!chat.users || !chat.users.hasOwnProperty(userId)) return 0;
    var roles = chat.users[userId].roles

    var level = 0;
    roles.forEach(role=>{
        var roleLevel = getRoleLevel(role, chat);
        if(roleLevel > level)
            level = roleLevel;
    })

    return level;
}

function getUserWR(chat, userId)
{
    if(!chat.users.hasOwnProperty(userId)) return false;
    return chat.users[userId].waitingReply;
}

/**
 * @returns {GH.LGHPerms}
 */
function getRolePerms(role, chat) //Chat required only if role is number (custom role)
{
    if(isString(role))
        return global.roles[role].perms
    return chat.roles[role].perms
}

function getRoleName(role, lang, chat) //Chat required only if role is number (custom role)
{
    if(isString(role))
        return l[lang][global.roles[role].name]
    return chat.roles[role].name
}

function getRoleEmoji(role, chat) //Chat required only if role is number (custom role)
{
    if(isString(role))
        return global.roles[role].emoji
    return chat.roles[role].emoji
}

function getRoleLevel(role, chat)  //Chat required only if role is number (custom role)
{
    if(isString(role))
        return global.roles[role].level
    return chat.roles[role].level
}

function getPremadeRoles()
{
    return Object.keys(global.roles);
}

function getChatRoles(chat)
{
    return Object.keys(chat.roles);
}

function getFullRoleName(role, lang, chat)
{
    return getRoleEmoji(role, chat)+" "+getRoleName(role, lang, chat);
}


/**
 * @param {String} commandKey 
 */
function getCommandKeyPerms(commandKey)
{
    var private = commandKey.startsWith("*");
    var group = commandKey.startsWith("@");

    var prefix = false;
    if(private) prefix = "*";
    if(group) prefix = "@";

    if(!prefix)
    {
        private = true;
        group = true;
    }

    return {private, group, prefix};
}

/**
 * @param {Array<string>} commands 
 * @param {String} commandKey 
 */
function checkCommandPerms(commands, commandKey)
{
    var key = commands.find(key => key.includes(commandKey))
    if(!key) return {private: false, group: false, prefix: false};
    return getCommandKeyPerms(key); 
}


//Delete every role reference
function deleteRole(chat, role)
{
    delete chat.roles[role];

    var users = Object.keys(chat.users)
    users.forEach((userId)=>{
        chat.users[userId].roles = chat.users[userId].roles.filter(value=>value!=role);
    })

    return chat;
}

function deleteUser(chat, userId)
{
    delete chat.users[userId];

    var roles = Object.keys(chat.roles)
    roles.forEach((role)=>{
        chat.roles[role].users = chat.roles[role].users.filter(value=>value!=userId);
    })

    return chat;
}

function forgotUser(chat, userId)
{
    getChatRoles(chat).forEach((role)=>{
        if(getRoleUsers(chat, role).includes(userId)) unsetRole(chat, userId, role);
    })

    Object.keys(chat.users).forEach((curUserId)=>{if(curUserId == userId) delete chat.users[userId]});
    chat.admins.forEach((admin, index)=>{if(admin.user.id == userId) delete chat.admins[index]});

    var WJIndex = chat.welcome.joinList.indexOf(Number(userId));
    if(WJIndex == -1) chat.welcome.joinList.indexOf(String(userId));
    chat.welcome.joinList.splice(WJIndex, 1);

    return chat;
}

function renameRole(role, chat, newName) //Premade roles can't be renamed
{

}

function changeRoleEmoji(role, chat, newName) //Premade roles can't change emoji
{

}

//Set role to user
function setRole(chat, userId, role)
{

    if(!chat.roles.hasOwnProperty(role)) //this if should run only if it is a pre-made role
        chat.roles[role] = {users:[]};

    if(!chat.users.hasOwnProperty(userId))
        chat.users[userId] = newUser();

    if(!chat.users[userId].roles.includes(role))
        chat.users[userId].roles.push(role);

    if(!chat.roles[role].users.includes(userId))
        chat.roles[role].users.push(userId);

    return chat;
}

//Remove role from user
function unsetRole(chat, userId, role)
{
    var roleIndex = chat.users[userId].roles.indexOf(role);
    chat.users[userId].roles.splice(roleIndex, 1);

    var userIndex = chat.roles[role].users.indexOf(userId);
    chat.roles[role].users.splice(userIndex, 1);

    return chat;
}

//add user to the chat
function addUser(chat, user)
{
    chat.users[user.id] = newUser(user);

    //restore roles that user may already have
    var userRoles = [];
    getChatRoles(chat).forEach((role)=>{
        var roleUsers = getRoleUsers(chat, role);     
        if(roleUsers.includes(user.id))
            userRoles.push(role);   
    })
    chat.users[user.id].roles = userRoles;

    return chat;
}

//admin translation management
/**
 * @returns {GH.LGHPerms}
 */
function adminToPerms(admin)
{
    //NOTE: other permissions may be avaiable for every admin on chat.adminPerms
    var perms = newPerms();
    var restrictCommands = ["COMMAND_WARN","COMMAND_UNWARN","COMMAND_KICK","COMMAND_MUTE","COMMAND_UNMUTE","COMMAND_BAN","COMMAND_UNBAN"]
    var promoteCommands = ["COMMAND_FREE", "COMMAND_HELPER", "COMMAND_ADMINISTRATOR", "COMMAND_UNFREE", "COMMAND_UNHELPER", "COMMAND_UNADMINISTRATOR"]
    var promoteAndRestrictCommands = ["COMMAND_MUTER", "COMMAND_MODERATOR", "COMMAND_UNMUTER", "COMMAND_UNMODERATOR"]
    var promoteAndDeleteCommands = ["COMMAND_CLEANER", "COMMAND_UNCLEANER"]

    if(admin.status != "administrator")return perms;

    if(admin.can_manage_chat)
        perms = newPerms(["@COMMAND_ME", "COMMAND_RULES", "COMMAND_INFO", "COMMAND_PIN", "COMMAND_GETURL"],1,1,1,1,1,1,1,1,1,1,1,1,0,0);
    if(admin.can_delete_messages)
        perms.commands.push("COMMAND_DELETE");
    if(admin.can_restrict_members)
        restrictCommands.forEach(c=>perms.commands.push(c));
    if(admin.can_promote_members)
        {perms.roles = 1; promoteCommands.forEach(c=>perms.commands.push(c));}
    if(admin.can_change_info)
        {perms.commands.push("COMMAND_SETTINGS");perms.settings=1};
    if(admin.can_pin_messages)
        perms.commands.push("COMMAND_PIN");

    if(admin.can_promote_members && admin.can_restrict_members)
        promoteAndRestrictCommands.forEach(c=>perms.commands.push(c));

    if(admin.can_promote_members && admin.can_delete_messages)
        promoteAndDeleteCommands.forEach(c=>perms.commands.push(c));
    
    return perms;

}
/**
 * 
 * @param {GH.LGHChat} chat 
 * @param {GH.LGHAdminList} admins 
 * @returns {GH.LGHChat}
 */
function reloadAdmins(chat, admins)
{
    //clear adminPerms for every user
    var emptyPerms = newPerms();
    var chatUsers = Object.keys(chat.users);
    chatUsers.forEach(userId=>{chat.users[userId].adminPerms = emptyPerms});

    //acutally loads admins
    admins.forEach(member=>{

        var userId = member.user.id
        if(!chat.users.hasOwnProperty(userId)){
            chat.users[userId] = newUser(member.user);
}
        if(member.status == "creator")
            chat = setRole(chat, userId, "founder");
        if(member.status == "administrator")
            chat.users[userId].adminPerms = adminToPerms(member);

        if(member.custom_title)
            chat.users[userId].title = member.custom_title;
        else if(chat.users[userId].hasOwnProperty("title"))
            delete chat.users[userId].title;

    })

    //store basic object
    var anonAdminList = anonymizeAdmins(admins)
    chat.admins = anonAdminList;

    return chat;
}

/**
 * @param {GH.LGHPerms} perms1 - higest priority permission
 * @param {GH.LGHPerms} perms2 - lower priority permission
 * @return {GH.LGHPerms}
 *      Sum two permissions object to get a single permission result
 */
function sumPermsPriority(perms1, perms2)
{

    var commands = [];
    perms1.commands.forEach(command => {commands.push(command)});
    perms2.commands.forEach(command => {commands.push(command)});
    commands = commands.filter((item,pos)=>{return commands.indexOf(item)==pos}) //remove duplicates

    var immune, flood, link, tgLink, forward, quote, porn, night, media, alphabets, words, length, roles, settings;

    immune = (perms1.immune == 0) ? perms2.immune : perms1.immune; //if perms1 is neutral inherit from second
    flood = (perms1.flood == 0) ? perms2.flood : perms1.flood;
    link = (perms1.link == 0) ? perms2.link : perms1.link;
    tgLink = (perms1.tgLink == 0) ? perms2.tgLink : perms1.tgLink;
    forward = (perms1.forward == 0) ? perms2.forward : perms1.forward;
    quote = (perms1.quote == 0) ? perms2.quote : perms1.quote;
    porn = (perms1.porn == 0) ? perms2.porn : perms1.porn;
    night = (perms1.night == 0) ? perms2.night : perms1.night;
    media = (perms1.media == 0) ? perms2.media : perms1.media;
    alphabets = (perms1.alphabets == 0) ? perms2.alphabets : perms1.alphabets;
    words = (perms1.words == 0) ? perms2.words : perms1.words;
    length = (perms1.length == 0) ? perms2.length : perms1.length;
    roles = (perms1.roles == 0) ? perms2.roles : perms1.roles;
    settings = (perms1.settings == 0) ? perms2.settings : perms1.settings;

    return newPerms(commands, immune, flood, link, tgLink, forward, quote, porn, night, media, alphabets, words, length, roles, settings)

}
function orderRolesByPriority(roles, chat) //Chat required only if role is number (custom role)
{
    chat = chat || 0;

    //.concat() to prevent shallow copy
    //order from smaller role level to bigger
    var newRoles = roles.concat().sort((role1, role2) => {
        var role1Level = getRoleLevel(role1, chat);
        var role2Level = getRoleLevel(role2, chat);
        return role1Level - role2Level;
    })

    return newRoles;
}
/**
 * @return {GH.LGHPerms}
 *      Get complete object of effective user permissions counting her roles
 */
function sumUserPerms(chat, userId)
{

    //calculating user permissions//
    var perms = chat.basePerms;
    if(isAdminOfChat(chat, userId))
    {
        var baseAdminPerms = chat.adminPerms;
        perms = sumPermsPriority(baseAdminPerms, perms);
    }

    if(!chat.users || !chat.users.hasOwnProperty(userId))
        return perms;
    var roles = orderRolesByPriority(chat.users[userId].roles, chat);
    roles.forEach((role)=>{
        var rolePerms = getRolePerms(role);
        perms = sumPermsPriority(rolePerms, perms);
    })

    var adminPerms = getAdminPerms(chat, userId);
    perms = sumPermsPriority(adminPerms, perms);

    //higher priority calculation
    var userPerms = getUserPerms(chat, userId);
    perms = sumPermsPriority(userPerms, perms);


    //additional permissions//
    //add warn permission if correlated to punishment
    if(!perms.commands.includes("COMMAND_WARN"))
    {
        if(chat.warns.punishment == 2 && perms.commands.includes("COMMAND_KICK"))
            perms.commands.push("COMMAND_WARN")
        if(chat.warns.punishment == 3 && perms.commands.includes("COMMAND_MUTE"))
            perms.commands.push("COMMAND_WARN")
        if(chat.warns.punishment == 4 && perms.commands.includes("COMMAND_BAN"))
            perms.commands.push("COMMAND_WARN")
    }
    if(!perms.commands.includes("COMMAND_UNWARN"))
    {
        if(chat.warns.punishment == 3 && perms.commands.includes("COMMAND_UNMUTE"))
            perms.commands.push("COMMAND_UNWARN")
        if(chat.warns.punishment == 4 && perms.commands.includes("COMMAND_UNBAN"))
            perms.commands.push("COMMAND_UNWARN")
    }

    //add mixed commands
    if(perms.commands.includes("COMMAND_DELETE"))
    {
        if(perms.commands.includes("COMMAND_WARN"))
            perms.commands.push("COMMAND_DELWARN")
        if(perms.commands.includes("COMMAND_KICK"))
            perms.commands.push("COMMAND_DELKICK")
        if(perms.commands.includes("COMMAND_MUTE"))
            perms.commands.push("COMMAND_DELMUTE")
        if(perms.commands.includes("COMMAND_BAN"))
            perms.commands.push("COMMAND_DELBAN")
    }

    return perms;

}

////////////////////

/**
 * 
 * @param {Array<string>} commands 
 * @param {string} commandKey 
 * @returns {Array<string>}
 */
function addPermsCommand(commands, commandKey)
{
    var {private, group, prefix} = getCommandKeyPerms(commandKey)

    if(prefix) commandKey = commandKey.replace(prefix, "");
    else prefix = "";

    
    var key = commands.find(key => key.includes(commandKey))
    if(!key)
    {
        commands.push(prefix+commandKey)
        return commands;
    }

    //handle already exhisting case
    var cmdPerms = getCommandKeyPerms(key);
    var exhistPrivate = cmdPerms.private;
    var exhistGroup = cmdPerms.group;
    
    var setBoth = private && exhistGroup || group && exhistPrivate;
    if(setBoth)
    {
        commands = delPermsCommand(commands, key)
        commands.push(commandKey) //no prefix means both
    } 

    return commands;
}

/**
 * 
 * @param {Array<string>} commands 
 * @param {string} commandKey 
 * @returns {Array<string>}
 */
function delPermsCommand(commands, commandKey)
{
    var obj = getCommandKeyPerms(commandKey)
    var delPrivate = obj.private;
    var delGroup = obj.group;
    var prefix = obj.prefix;

    var delBoth = delPrivate && delGroup;

    if(prefix) commandKey = commandKey.replace(prefix,"");
    else prefix = "";

    var exhistingKey = commands.find(key => key.includes(commandKey))
    if(!exhistingKey) return commands;

    var exhistingObj = checkCommandPerms(commands, commandKey);
    var exhistPrivate = exhistingObj.private;
    var exhistGroup = exhistingObj.group;
    var exhistBoth = exhistPrivate && exhistGroup;

    var change = exhistBoth && !delBoth;
    var changeToGroup = change && prefix == "*";
    var changeToPrivate = change && prefix == "@";

    if(delBoth || change)
        commands.splice(commands.indexOf(exhistingKey), 1)
    else if(!changeToPrivate || !changeToGroup) 
    {
        //when only 1 permission (private or group) is going to be deleted, without changes (both to single)
        var delIndex = commands.indexOf(prefix+commandKey);
        if(delIndex != -1) commands.splice(delIndex, 1);
    }

    if(changeToPrivate)
        commands.push("*"+commandKey);
    else if(changeToGroup)
        commands.push("@"+commandKey);
    

    return commands;
}

////////////////////

/**
 * @param {string} lang 
 * @param {GH.LGHChat} chat 
 * @param {GH.LGHDatabase} db 
 * @returns {string}
 */
function genStaffListMessage(lang, chat, db)
{

    var text = bold(l[lang].GROUP_STAFF.toUpperCase())+"\n\n";

    var rolesList = orderRolesByPriority(getChatRoles(chat), chat).reverse();
    rolesList.forEach(roleKey=>{

        if(getRoleUsers(chat, roleKey).length == 0) return;

        text += bold(getFullRoleName(roleKey, lang, chat));

        text+="\n";

        var userIds = getRoleUsers(chat, roleKey);
        text += genUserList(userIds, chat, db);

        text+="\n";
        
    })

    var adminIds = [];
    chat.admins.forEach(admin=>{
        if(admin.status == "creator") return;
        if(admin.is_anonymous) return;
        adminIds.push(admin.user.id);
    })
    if(adminIds.length != 0)
    {
        text+="👮🏼"+bold(l[lang].ADMINISTRATOR)+"\n";
        text += genUserList(adminIds, chat, db);
    }

    return text;

}

/**
 * @param {GH.LGHChat} chat 
 * @param {GH.LGHUser} user 
 * @returns {GH.TargetUser}
 */
function userToTarget(chat, user)
{
    var id = user.id;
    var name = LGHUserName(user);
    var perms = sumUserPerms(chat, user.id)

    return {id, name, perms, user};
}

/**
 * @param {TelegramBot} TGbot 
 * @param {GH.LGHChat} chat 
 * @param {TelegramBot.ChatId} userId 
 * @param {GH.LGHDatabase} db 
 * @returns {GH.TargetUser}
 */
function userIdToTarget(TGbot, chat, userId, db)
{  
    var tookUser = db.users.get(userId);
    if(!tookUser) tookUser = loadChatUserId(TGbot, chat.id, userId, db);
    if(!tookUser) tookUser = {id:userId};

    targetName = LGHUserName(tookUser);
    var targetPerms = sumUserPerms(chat, userId);

    return {id:userId, name: targetName, perms: targetPerms, user: tookUser};
}

module.exports = {
    newPerms, newRole, newUser, newPremadeRolesObject,
    getUser, getUserRoles, getRoleUsers, getUserPerms, getAdminPerms, getUserLevel, getUserWR,
    getRolePerms, getRoleName, getRoleEmoji, getRoleLevel, getPremadeRoles, getChatRoles, getFullRoleName, getCommandKeyPerms, checkCommandPerms,
    deleteRole, deleteUser, forgotUser, renameRole, changeRoleEmoji,
    setRole, unsetRole, addUser,
    adminToPerms, reloadAdmins, sumPermsPriority, orderRolesByPriority, sumUserPerms,
    addPermsCommand, delPermsCommand,
    genStaffListMessage, userToTarget, userIdToTarget
}
