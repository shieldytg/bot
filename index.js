process.env.NTBA_FIX_319 = 1;
process.env.NTBA_FIX_350 = 0;
global.LGHVersion = "0.2.9.2";
global.directory = __dirname; //used from /api/database.js
const fs = require("fs");
const TR = require("./api/tg/tagResolver.js");
const cp = require("./api/external/cryptoPrices.js");
const config = JSON.parse( fs.readFileSync( __dirname + "/config.json" ) );
const botsRegistry = require("./api/botsRegistry.js");

console.log("Starting...")
console.log( "Shieldy current version: " + global.LGHVersion )

function print(text)
{
    console.log( "[index.js] " + text )
}

async function main()
{

    console.log( "Loading languages..." )
    var l = {}//Object that store all languages
    var rLang = config.reserveLang;
    l[rLang] = JSON.parse( fs.readFileSync( __dirname + "/langs/" + rLang + ".json") ); //default language to fix others uncompleted langs
    console.log( "-loaded principal language: \"" + l[rLang].LANG_NAME + "\" " + rLang )

    var langs = fs.readdirSync( __dirname + "/langs" );
    langs.splice( langs.indexOf(rLang + ".json"), 1 );

    var defaultLangObjects = Object.keys(l[rLang])
    langs.forEach( (langFile) => {

        var fileName = langFile.replaceAll( ".json", "" );
        l[fileName] = JSON.parse( fs.readFileSync( __dirname + "/langs/" + langFile ) );
        console.log("-loaded language: \"" + l[fileName].LANG_NAME + "\" " + fileName);

        defaultLangObjects.forEach( (object) => { //detect and fill phrases from incompleted languages with default language (config.reserveLang)

            if( !l[fileName].hasOwnProperty( object ) )
            {

                console.log( "  identified missing paramenter " + object + ", replacing from " + rLang );
                l[fileName][object] = l[rLang][object];

            };

        } )
        
    } );

    global.LGHLangs = l; //add global reference

    
    //load external api if allowed
    if(config.allowExternalApi)
    {
        await cp.load();
    }


    // function to load all plugins for a bot instance
    function loadPlugins(ctx) {
        console.log( "Loading modules..." )
        var directory = fs.readdirSync( __dirname + "/plugins/" );
        directory.forEach( (fileName) => {
            var func = require( __dirname + "/plugins/" + fileName );
            try {
                func(ctx)
            } catch (error) {
                console.log("The plugin " + fileName + " is crashed, i will turn it off and log here the error");
                console.log(error);
            }
            console.log( "\tloaded " + fileName)
        } )
    }

    // helper to start one bot instance
    var LGHelpBot = require( "./main.js" );
    global.startShieldyBot = async function startShieldyBot(botToken) {
        try {
            const cloneConfig = JSON.parse(JSON.stringify(config));
            cloneConfig.botToken = botToken;
            // dbNamespace will be set in main.js using bot id
            const {GHbot, TGbot, db} = await LGHelpBot(cloneConfig);
            loadPlugins({GHbot, TGbot, db, config: cloneConfig});
            console.log(`[index.js] Started bot instance @${TGbot.me.username} (${TGbot.me.id})`);
            return true;
        } catch (err) {
            console.log("Failed to start bot instance with provided token:");
            console.log(err);
            return false;
        }
    }

    // start primary bot
    await global.startShieldyBot(config.botToken);

    // start clones from registry (avoid starting primary twice)
    const extraTokens = botsRegistry.getAllTokens().filter(t => t && t !== config.botToken);
    for (const token of extraTokens) {
        await global.startShieldyBot(token);
    }


    
    //unload management
    var quitFunc = ()=>{
        // best-effort save; main database unload is per instance via plugin contexts
        TR.save();
        process.exit(0);
    }
    process.on('SIGINT', quitFunc);  // CTRL+C
    process.on('SIGQUIT', quitFunc); // Keyboard quit
    process.on('SIGTERM', quitFunc); // `kill` command


    console.log("#Shieldy started#")



}
main();

