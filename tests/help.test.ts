/*
 * GemBot: Help Command & Documentation Test Suite
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

function runTests() {
    console.log('Running Help Command & Regex Tests...');

    // 1. Test Regex Matcher
    const helpRegex = /^!(?:gembot\s+)?help$/i;

    const validTriggers = [
        '!help',
        '!HELP',
        '!Help',
        '!gembot help',
        '!GEMBOT HELP',
        '!gembot HELP',
        '!gembot   help',
    ];

    for (const trigger of validTriggers) {
        assert.ok(
            helpRegex.test(trigger),
            `Regex should match valid trigger "${trigger}"`
        );
    }

    const invalidTriggers = [
        '!helper',
        '!gembot helper',
        'help',
        '!gembot',
        '!gembot on',
        '!helpful',
        'what is !help',
    ];

    for (const trigger of invalidTriggers) {
        assert.ok(
            !helpRegex.test(trigger),
            `Regex should NOT match invalid trigger "${trigger}"`
        );
    }
    console.log('✓ Trigger regex matching tests passed');

    // 2. Read src/listeners/commands.ts and extract helpText
    const commandsFilePath = path.join(__dirname, '../src/listeners/commands.ts');
    const fileContent = fs.readFileSync(commandsFilePath, 'utf-8');

    // Verify regex is used in commands.ts
    assert.ok(
        fileContent.includes('/^!(?:gembot\\s+)?help$/i'),
        'commands.ts should use /^!(?:gembot\\s+)?help$/i trigger'
    );

    // Extract helpText block from commands.ts inside the help listener
    const helpHandlerIndex = fileContent.indexOf('app.message(/^!(?:gembot\\s+)?help$/i');
    assert.ok(helpHandlerIndex !== -1, 'commands.ts must contain help listener');

    const helpTextStart = fileContent.indexOf('const helpText = `', helpHandlerIndex);
    assert.ok(helpTextStart !== -1, 'helpText definition should exist');
    const templateStart = helpTextStart + 'const helpText = `'.length;

    const templateEnd = fileContent.indexOf('`;\n        await say({text: helpText', templateStart);
    assert.ok(templateEnd !== -1, 'helpText closing backtick should exist');

    const helpText = fileContent.substring(templateStart, templateEnd);

    // 3. Section Headers
    const expectedSections = [
        '*AI & Fun*',
        '*RPG Mode*',
        '*Stocks & Crypto*',
        '*Watchlist*',
        '*Usage Tracking*',
    ];

    for (const section of expectedSections) {
        assert.ok(
            helpText.includes(section),
            `helpText should contain section: "${section}"`
        );
    }

    // Verify Tidbits of the Day is NOT a standalone section header
    assert.ok(
        !helpText.includes('*Tidbits of the Day*'),
        'helpText must not contain standalone "*Tidbits of the Day*" section header'
    );

    // 4. Verify AI & Fun Commands
    const aiAndFunIndex = helpText.indexOf('*AI & Fun*');
    const rpgModeIndex = helpText.indexOf('*RPG Mode*');
    assert.ok(
        aiAndFunIndex !== -1 && rpgModeIndex !== -1 && aiAndFunIndex < rpgModeIndex,
        '*AI & Fun* section should precede *RPG Mode*'
    );

    const aiAndFunSection = helpText.substring(aiAndFunIndex, rpgModeIndex);

    const requiredAiFunCommands = [
        '@<BotName> <prompt>',
        '@<BotName> feature request',
        '!image <prompt>',
        '!meme list',
        '!meme search <term>',
        '!meme <template> <text1> [| text2 ...]',
        'gis [flags][#] <term>',
        '!w <search term>',
        '!ud <term>',
        '!urban <term>',
        '!dict <word>',
        '!dictionary <word>',
        '!dp <word>',
        '!pollen <zip_code>',
        '!tidbit subscribe <n>',
        '!tidbit unsubscribe',
        '!gembot on',
        '!gembot off',
        '!gembot channel on',
        '!gembot channel off',
    ];

    for (const cmd of requiredAiFunCommands) {
        assert.ok(
            aiAndFunSection.includes(cmd),
            `AI & Fun section should contain: "${cmd}"`
        );
    }

    // 5. Verify RPG Mode Commands
    const stocksIndex = helpText.indexOf('*Stocks & Crypto*');
    const rpgSection = helpText.substring(rpgModeIndex, stocksIndex);

    const requiredRpgCommands = [
        '!gembot rpg <gm|player|off|status>',
        '!roll <dice>',
        '!rpgstats [character_name]',
    ];

    for (const cmd of requiredRpgCommands) {
        assert.ok(
            rpgSection.includes(cmd),
            `RPG section should contain: "${cmd}"`
        );
    }

    // 6. Verify Stocks & Crypto Commands and Corrections
    const watchlistIndex = helpText.indexOf('*Watchlist*');
    const stocksSection = helpText.substring(stocksIndex, watchlistIndex);

    const requiredStockCommands = [
        '!q <TICKER...>',
        '!cq <TICKER...>',
        '!chart <TICKER> [range] [-c COMPARE_TICKER]',
        '!cchart <TICKER> [range]',
        '!stats <TICKER...>',
        '!cstats <TICKER...>',
        '!earnings <TICKER>',
        '!news [general|crypto]',
    ];

    for (const cmd of requiredStockCommands) {
        assert.ok(
            stocksSection.includes(cmd),
            `Stocks & Crypto section should contain: "${cmd}"`
        );
    }

    // Verify outdated !stocknews and !cryptonews are removed
    assert.ok(
        !stocksSection.includes('!stocknews'),
        '!stocknews should be replaced with !news [general|crypto]'
    );
    assert.ok(
        !stocksSection.includes('!cryptonews'),
        '!cryptonews should be replaced with !news [general|crypto]'
    );

    // 7. Verify Watchlist Commands
    const usageIndex = helpText.indexOf('*Usage Tracking*');
    const watchlistSection = helpText.substring(watchlistIndex, usageIndex);

    const requiredWatchlistCommands = [
        '!watchlist',
        '!watch <TICKER> [date] [price] [shares]',
        '!unwatch <TICKER>',
    ];

    for (const cmd of requiredWatchlistCommands) {
        assert.ok(
            watchlistSection.includes(cmd),
            `Watchlist section should contain: "${cmd}"`
        );
    }

    // 8. Verify Usage Tracking
    const usageSection = helpText.substring(usageIndex);
    const requiredUsageCommands = [
        '!usage',
        '!usage YYYY-MM-DD',
        '!usage all',
        '!usage total',
        '!usage @user',
        '!usage @user YYYY-MM-DD',
    ];

    for (const cmd of requiredUsageCommands) {
        assert.ok(
            usageSection.includes(cmd),
            `Usage section should contain: "${cmd}"`
        );
    }

    console.log('✓ All help content assertions passed successfully');
    console.log('\nAll Help tests passed!');
}

runTests();
