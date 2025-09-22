const { getUnixTime } = require("./utils");

class PunishmentTracker {
    constructor(db) {
        this.db = db;
        this.checkInterval = 15 * 1000; // Check every 15 seconds
        this.initialized = false;
        this.activePunishments = new Map();
        this.intervalId = null;
    }

    async init() {
        if (this.initialized) return;
        this.initialized = true;
        
        // Initialize the punishments collection if it doesn't exist
        if (!this.db.punishments) {
            this.db.punishments = {
                data: {},
                save: (id, data) => {
                    if (data === undefined) {
                        delete this.db.punishments.data[id];
                    } else {
                        this.db.punishments.data[id] = data;
                    }
                    
                    if (this.db.chats?.update) {
                        const chatId = data ? data.chatId : id.split(':')[0];
                        const chat = global.DBCHATS[chatId];
                        
                        if (chat) {
                            chat.punishments = chat.punishments || {};
                            
                            if (data) {
                                chat.punishments[id] = data;
                            } else {
                                delete chat.punishments[id];
                            }
                            
                            this.db.chats.update(chat);
                        }
                    }
                },
                get: (id) => {
                    if (this.db.punishments.data[id]) {
                        return this.db.punishments.data[id];
                    }
                    
                    const [chatId, userId] = id.split(':');
                    const chat = global.DBCHATS[chatId];
                    
                    if (chat?.punishments?.[id]) {
                        this.db.punishments.data[id] = chat.punishments[id];
                        return this.db.punishments.data[id];
                    }
                    
                    return null;
                },
                getAll: () => {
                    const allPunishments = [];
                    const seenIds = new Set();
                    
                    // Add in-memory punishments
                    Object.values(this.db.punishments.data).forEach(punishment => {
                        if (punishment) {
                            allPunishments.push(punishment);
                            seenIds.add(punishment.id);
                        }
                    });
                    
                    // Add punishments from chats that aren't in memory
                    Object.values(global.DBCHATS).forEach(chat => {
                        if (chat.punishments) {
                            Object.values(chat.punishments).forEach(punishment => {
                                if (punishment && !seenIds.has(punishment.id)) {
                                    allPunishments.push(punishment);
                                    seenIds.add(punishment.id);
                                }
                            });
                        }
                    });
                    
                    return allPunishments;
                },
                delete: (id) => {
                    delete this.db.punishments.data[id];
                    
                    const [chatId] = id.split(':');
                    const chat = global.DBCHATS[chatId];
                    
                    if (chat?.punishments?.[id]) {
                        delete chat.punishments[id];
                        this.db.chats.update(chat);
                    }
                }
            };
        }

        // Load existing active punishments from the database
        this.loadActivePunishments();
        
        console.log(`[PunishmentTracker] Initialized with ${this.activePunishments.size} active punishments`);
        
        // Start the periodic check
        this.intervalId = setInterval(() => this.checkExpiredPunishments(), this.checkInterval);
        console.log('[PunishmentTracker] Started checking for expired punishments every 15 seconds');
    }

    async loadActivePunishments() {
        try {
            const now = getUnixTime();
            const allPunishments = this.db.punishments.getAll() || [];
            
            const stats = {
                active: 0,
                expired: 0,
                invalid: 0
            };
            
            for (const punishment of allPunishments) {
                if (!this.isValidPunishment(punishment)) {
                    stats.invalid++;
                    continue;
                }
                
                if (punishment.until > now) {
                    this.addPunishmentToCache(punishment);
                    stats.active++;
                } else {
                    this.db.punishments.delete(punishment.id);
                    stats.expired++;
                }
            }
            
            return stats;
        } catch (error) {
            console.error('Error loading punishments:', error);
            return { active: 0, expired: 0, invalid: 0 };
        }
    }
    
    isValidPunishment(punishment) {
        return punishment && 
               punishment.id && 
               punishment.chatId && 
               punishment.userId && 
               punishment.until !== undefined;
    }

    generatePunishmentId(chatId, userId) {
        return `${chatId}:${userId}`;
    }

    addPunishment(chatId, userId, until, type = 'mute') {
        try {
            const id = this.generatePunishmentId(chatId, userId);
            const now = getUnixTime();
            
            // If until is not provided or invalid, default to 1 year
            const expiryTime = (until && until > now) ? parseInt(until) : now + (365 * 24 * 60 * 60);
            
            const punishment = {
                id,
                chatId: String(chatId),
                userId: String(userId),
                type,
                until: expiryTime,
                createdAt: now,
                updatedAt: now
            };
            
            this.db.punishments.save(id, punishment);
            this.addPunishmentToCache(punishment);
            
            return punishment;
        } catch (error) {
            console.error(`Error adding ${type} for user ${userId}:`, error.message);
            return null;
        }
    }

    addPunishmentToCache(punishment) {
        if (!this.activePunishments.has(punishment.chatId)) {
            this.activePunishments.set(punishment.chatId, new Map());
        }
        
        const chatPunishments = this.activePunishments.get(punishment.chatId);
        chatPunishments.set(punishment.userId, {
            id: punishment.id,
            until: punishment.until,
            type: punishment.type
        });
    }

    removePunishment(chatId, userId) {
        const id = this.generatePunishmentId(chatId, userId);
        
        // Remove from database
        this.db.punishments.delete(id);
        
        // Remove from cache
        const chatPunishments = this.activePunishments.get(chatId);
        if (chatPunishments && chatPunishments.has(userId)) {
            chatPunishments.delete(userId);
            if (chatPunishments.size === 0) {
                this.activePunishments.delete(chatId);
            }
            console.log(`[PunishmentTracker] Removed punishment for user ${userId} in chat ${chatId}`);
            return true;
        }
        
        return false;
    }

    /**
     * Get the total number of active punishments across all chats
     * @returns {number} Total count of active punishments
     */
    getTotalActivePunishments() {
        let total = 0;
        for (const punishments of this.activePunishments.values()) {
            total += punishments.size;
        }
        return total;
    }
    
    /**
     * Check for and process expired punishments
     * @returns {Promise<{processed: number, errors: number}>} Count of processed and failed operations
     */
    async checkExpiredPunishments() {
        const now = getUnixTime();
        let processed = 0;
        let errors = 0;
        
        // Get all chats with active punishments
        const chatsWithPunishments = Array.from(this.activePunishments.entries())
            .filter(([_, chatPunishments]) => chatPunishments?.size > 0);
        
        for (const [chatId, chatPunishments] of chatsWithPunishments) {
            const punishments = Array.from(chatPunishments.values());
            
            for (const punishment of punishments) {
                const { userId, until, type } = punishment;
                
                if (until <= now) {
                    try {
                        const bot = global.bot;
                        if (!bot) throw new Error('Bot instance not available');
                        
                        if (type === 'mute') {
                            await bot.restrictChatMember(chatId, userId, {
                                can_send_messages: true,
                                can_send_media_messages: true,
                                can_send_other_messages: true,
                                can_add_web_page_previews: true
                            });
                        } else if (type === 'ban') {
                            await bot.unbanChatMember(chatId, userId, { only_if_banned: true });
                        }
                    } catch (error) {
                        errors++;
                        console.error(`Failed to process ${type} for user ${userId}:`, error.message);
                    }
                }
                
                // Always try to remove the punishment from tracking
                try {
                    this.removePunishment(chatId, userId);
                } catch (error) {
                    errors++;
                }
                
                processed++;
            }
        }
        
        return { processed, errors };
    }

    /**
     * Stops the punishment tracker by clearing the interval.
     * This should be called when the bot is shutting down.
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('[PunishmentTracker] Stopped checking for expired punishments');
        } else {
            console.log('[PunishmentTracker] No active interval to stop');
        }
    }
}

// Create a singleton instance
let punishmentTrackerInstance = null;

function getPunishmentTracker(db) {
    if (!punishmentTrackerInstance && db) {
        punishmentTrackerInstance = new PunishmentTracker(db);
    }
    return punishmentTrackerInstance;
}

module.exports = {
    PunishmentTracker,
    getPunishmentTracker
};
