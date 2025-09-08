const GHCommand = require("../api/tg/LGHCommand.js");
const { sendCommandReply } = require("../api/utils/utils.js");
const cp = require("../api/external/cryptoPrices");

// Top 20 popular cryptocurrencies
const POPULAR_CRYPTOS = [
    'BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'XRP', 'USDC', 'DOGE', 'TON', 'ADA', 
    'SHIB', 'AVAX', 'DOT', 'LINK', 'MATIC', 'TRX', 'BCH', 'LTC', 'ICP', 'ATOM'
];

function formatPrice(price) {
    if (!price) return 'N/A';
    const num = parseFloat(price);
    return num > 1 ? num.toFixed(2) : num.toFixed(6);
}

function formatNumber(num) {
    if (!num) return 'N/A';
    const n = parseFloat(num);
    if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n/1e3).toFixed(2)}K`;
    return `$${n.toFixed(2)}`;
}

function formatPerc(change) {
    if (change === null || change === undefined) return 'N/A';
    const c = parseFloat(change);
    return `${c > 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(2)}%`;
}

module.exports = function(GHbot) {
    const { TGbot } = GHbot;

    GHCommand.registerCommands(["COMMAND_CRYPTO"], (msg, chat, user, private, lang, key, keyLang) => {
        // Default to BTC if no symbol provided
        let symbol = 'BTC';
        if (msg.command.args && msg.command.args.trim()) {
            const args = msg.command.args.trim().split(/\s+/);
            symbol = args[0]?.toUpperCase();
        }
        
        // If still no symbol (shouldn't happen with default above, but just in case)
        if (!symbol) {
            return sendCommandReply(true, lang, GHbot, msg.from.id, msg.chat.id, (sendId) => {
                return TGbot.sendMessage(sendId, 
                    `${lang["CRYPTO_USAGE"]}\n\nSupported cryptocurrencies: ${POPULAR_CRYPTOS.join(', ')}`, 
                    { parse_mode: 'HTML' }
                );
            });
        }

        if (!POPULAR_CRYPTOS.includes(symbol)) {
            return sendCommandReply(true, lang, GHbot, msg.from.id, msg.chat.id, (sendId) => {
                return TGbot.sendMessage(sendId, 
                    `❌ Unknown cryptocurrency. Supported: ${POPULAR_CRYPTOS.join(', ')}`,
                    { parse_mode: 'HTML' }
                );
            });
        }

        const crypto = cp.getCoin(symbol);
        if (!crypto) {
            return sendCommandReply(true, lang, GHbot, msg.from.id, msg.chat.id, (sendId) => {
                return TGbot.sendMessage(sendId, 
                    "❌ Could not fetch cryptocurrency data. Please try again later.",
                    { parse_mode: 'HTML' }
                );
            });
        }

        const change = crypto.changePercent24Hr ? parseFloat(crypto.changePercent24Hr) : null;
        const emoji = change > 0 ? '📈' : '📉';
        
        const message = `
<b>${crypto.name} (${crypto.symbol}) ${emoji}</b>

` +
`💵 Price: <b>$${formatPrice(crypto.priceUsd)}</b>
` +
`📊 24h: <b>${formatPerc(change)}</b>
` +
`🏦 Market Cap: <b>${formatNumber(crypto.marketCapUsd)}</b> (#${crypto.rank || 'N/A'})
` +
`💱 24h Vol: <b>${formatNumber(crypto.volumeUsd24Hr)}</b>
`;

        return sendCommandReply(private, lang, GHbot, msg.from.id, msg.chat.id, (sendId) => {
            return TGbot.sendMessage(sendId, message, { 
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        });
    });

    // Load crypto prices on startup
    cp.load();
};
