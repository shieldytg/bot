/**NOTE:
 * to be sure that api is going to give you valid values without errors check if isAvaiable() returns true
 */

const https = require('https');
const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const COINGECKO_RETRY_DELAY = 5000; // 5 seconds delay between retries
let lastRequestTime = 0;

let isLoaded = false;
let topCrypto = {}; // symbol : {object}
let topCryptoArray = [];
let fiatRates = {}; // currency_code : rate

async function bodyGet(url, retries = 3) {
    return new Promise((resolve, reject) => {
        const makeRequest = async (attempt = 1) => {
            // Add delay if needed to respect rate limits
            const now = Date.now();
            const timeSinceLastRequest = now - lastRequestTime;
            if (timeSinceLastRequest < 1000) { // 1 second between requests
                await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastRequest));
            }
            lastRequestTime = Date.now();

            const req = https.get(url, { headers: { 'User-Agent': 'ShieldyBot/1.0' } }, res => {
                let data = [];
                
                // Check if response is JSON
                const contentType = res.headers['content-type'] || '';
                if (!contentType.includes('application/json')) {
                    if (attempt < retries) {
                        console.warn(`[CryptoPrices] Received non-JSON response (${contentType}), retrying... (${attempt}/${retries})`);
                        setTimeout(() => makeRequest(attempt + 1), COINGECKO_RETRY_DELAY * attempt);
                        return;
                    }
                    reject(new Error(`Expected JSON but got ${contentType}`));
                    return;
                }

                res.on('data', chunk => data.push(chunk));

                res.on('end', () => {
                    try {
                        const response = Buffer.concat(data).toString();
                        // Basic check if response looks like HTML (error page)
                        if (response.trim().startsWith('<!DOCTYPE') || response.trim().startsWith('<html>')) {
                            throw new Error('Received HTML error page instead of JSON');
                        }
                        resolve(JSON.parse(response));
                    } catch (error) {
                        if (attempt < retries) {
                            console.warn(`[CryptoPrices] Error parsing JSON (attempt ${attempt}/${retries}):`, error.message);
                            setTimeout(() => makeRequest(attempt + 1), COINGECKO_RETRY_DELAY * attempt);
                        } else {
                            reject(error);
                        }
                    }
                });
            });

            req.on('error', error => {
                if (attempt < retries) {
                    console.warn(`[CryptoPrices] Request error (attempt ${attempt}/${retries}):`, error.message);
                    setTimeout(() => makeRequest(attempt + 1), COINGECKO_RETRY_DELAY * attempt);
                } else {
                    reject(error);
                }
            });

            // Set a timeout for the request
            req.setTimeout(10000, () => {
                req.destroy();
                if (attempt < retries) {
                    console.warn(`[CryptoPrices] Request timeout (attempt ${attempt}/${retries})`);
                    setTimeout(() => makeRequest(attempt + 1), COINGECKO_RETRY_DELAY * attempt);
                } else {
                    reject(new Error('Request timeout'));
                }
            });
        };

        makeRequest();
    });
}

async function updatePrices() {
    try {
        // Fetch top 250 cryptocurrencies by market cap
        const coinsData = await bodyGet(
            `${COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`
        );
        
        if (!coinsData || !Array.isArray(coinsData)) {
            console.error('[CryptoPrices] Invalid or empty response from CoinGecko API');
            return false;
        }
        
        // Map CoinGecko data to match the expected format
        topCryptoArray = coinsData.map(coin => ({
            id: coin.id,
            symbol: coin.symbol.toUpperCase(),
            name: coin.name,
            priceUsd: coin.current_price ? coin.current_price.toString() : null,
            marketCapUsd: coin.market_cap ? coin.market_cap.toString() : null,
            volumeUsd24Hr: coin.total_volume ? coin.total_volume.toString() : null,
            supply: coin.circulating_supply ? coin.circulating_supply.toString() : null,
            maxSupply: coin.max_supply ? coin.max_supply.toString() : null,
            changePercent24Hr: coin.price_change_percentage_24h ? 
                coin.price_change_percentage_24h.toString() : null,
            vwap24Hr: coin.high_24h && coin.low_24h ? 
                ((coin.high_24h + coin.low_24h) / 2).toString() : null,
            explorer: `https://www.coingecko.com/en/coins/${coin.id}`
        }));
        
        if (topCryptoArray.length === 0) return;

        // Update the lookup object
        topCrypto = {};
        topCryptoArray.forEach(crypto => {
            topCrypto[crypto.symbol] = crypto;
        });

        // Fetch fiat exchange rates
        const ratesData = await bodyGet(`${COINGECKO_API}/exchange_rates`);
        if (!ratesData || !ratesData.rates) return;

        // Convert CoinGecko rates to the expected format
        fiatRates = {};
        Object.entries(ratesData.rates).forEach(([currency, data]) => {
            if (data.type === 'fiat') {
                // Convert from BTC value to USD value
                fiatRates[currency.toUpperCase()] = 1 / data.value;
            }
        });

        // Ensure USD is always available with rate 1
        fiatRates['USD'] = 1;

        if (!isLoaded) isLoaded = true;
    } catch (error) {
        console.error("Error in cryptoPrices.js/updatePrices():", error);
    }
}

function cutPrice(number)
{
    var result = Number(number).toFixed(10).slice(0,12);
    result = Number(result);
    if(result > 9)
        result = result.toFixed(2);
    return Number(result);
}

function convert(price, currency) {
    const rate = getCurrencyPrice(currency);
    if (!rate) return price; // If currency not found, return original price
    return price * rate; // rate is already in terms of USD per unit of currency
}

function humanPrice(number)
{
    let numberString = number.toString();
    
    let parts = numberString.split(".");
    let integerPart = parts[0];
    let decimalPart = parts[1] ? "." + parts[1] : "";

    integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    return integerPart + decimalPart;
}

function priceToNumber(textNum)
{
    return Number(textNum.replaceAll(",","").replaceAll(".",""));
}

function supplyToBlock(currentSupply) {

    // Initial reward per block
    const initialRewardPerBlock = 50; // In Bitcoin

    // Calculate the number of halvings occurred since the beginning of the Bitcoin blockchain
    let halvings = 0;
    let totalBlocks = 0;
    let supply = 0;
    while (supply < currentSupply) {
        supply += initialRewardPerBlock * Math.pow(0.5, halvings) * 210000;
        totalBlocks += 210000;
        halvings++;
    }

    // Calculate the current block
    const remainingSupply = supply - currentSupply;
    const remainingBlocks = remainingSupply / (initialRewardPerBlock * Math.pow(0.5, halvings - 1));
    const currentBlock = totalBlocks - remainingBlocks;

    return currentBlock;
}

/////////////////

async function load()
{
    await updatePrices();
    setInterval( ()=>{
    updatePrices();
    }, 600000 ); //10 minutes
}

function isAvaiable()
{
    return isLoaded;
}

/**
 * Returns an object representing a cryptocurrency.
 * @typedef {Object} coingeckoCrypto representing a cryptocurrency.
 * @property {string} id - Cryptocurrency ID.
 * @property {string} rank - Cryptocurrency rank.
 * @property {string} symbol - Cryptocurrency symbol.
 * @property {string} name - Full name of the cryptocurrency.
 * @property {?string} supply - Circulating supply of the cryptocurrency.
 * @property {?string} maxSupply - Maximum supply of the cryptocurrency.
 * @property {?string} marketCapUsd - Market capitalization in USD of the cryptocurrency (can be null).
 * @property {?string} volumeUsd24Hr - 24-hour trading volume in USD (can be null).
 * @property {?string} priceUsd - Price in USD of the cryptocurrency (can be null).
 * @property {?string} changePercent24Hr - Percentage change in the last 24 hours (can be null).
 * @property {?string} vwap24Hr - 24-hour volume-weighted average price (can be null).
 * @property {string} explorer - Cryptocurrency explorer URL.
 */


/**
 * @param {string} symbol 
 * @return {coingeckoCrypto}
 */
function getTop(height)
{
    return topCryptoArray[height-1];
}

/**
 * @param {string} symbol 
 * @return {coingeckoCrypto}
 */
function getCoin(symbol) {
    // Try exact match first
    if (topCrypto[symbol]) return topCrypto[symbol];
    
    // Try case-insensitive search
    const upperSymbol = symbol.toUpperCase();
    for (const [key, value] of Object.entries(topCrypto)) {
        if (key.toUpperCase() === upperSymbol) {
            return value;
        }
    }
    
    return false;
}

function getCurrencyPrice(currency)
{
    return Number(fiatRates[currency]);
}

function getCoinPrice(symbol, currency) {
    currency = (currency || 'USD').toUpperCase();
    const coin = getCoin(symbol);
    if (!coin || coin.priceUsd === null) return 'N/A';
    
    let price = Number(coin.priceUsd);
    if (currency !== 'USD') {
        price = convert(price, currency);
    }
    
    return humanPrice(cutPrice(price));
}

function getCoinCap(symbol, currency)
{
    currency = currency || "USD";
    
    var cap = Number(getCoin(symbol).marketCapUsd);
    cap = convert(cap, currency).toFixed(0);

    return humanPrice(cap);
}

function getCoinVol(symbol, currency)
{
    currency = currency || "USD";
    
    var vol = Number(getCoin(symbol).volumeUsd24Hr);
    vol = convert(vol, currency).toFixed(0);

    return humanPrice(vol);
}

function getCoinSupply(symbol)
{    
    var supply = Number(getCoin(symbol).supply);
    supply = cutPrice(supply);

    return humanPrice(supply);
}

function getCoinMaxSupply(symbol, currency)
{
    currency = currency || "USD";
    
    var maxSupply = Number(getCoin(symbol).maxSupply);
    if(maxSupply == null) return "∞";
    supply = cutPrice(maxSupply);

    return humanPrice(maxSupply);
}

function getCoinList()
{
    return Object.keys(topCrypto);
}

//it's not accurate due to api bitcoin supply imprecision
function halvingLeftBlocks()
{
    var curBlock = supplyToBlock(priceToNumber(getCoinSupply("BTC")));
   
    var halvings = Math.trunc(curBlock / 210000);
    var leftBlocks = 210000 - (curBlock - (halvings * 210000));

    return leftBlocks
}


module.exports = {
    load, isAvaiable,
    getTop, 
    getCoin, getCoinPrice, getCoinCap, getCoinVol, getCoinSupply, getCoinMaxSupply,
    getCoinList,
}