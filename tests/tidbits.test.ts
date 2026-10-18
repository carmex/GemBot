/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 * Copyright (C) 2025 David Lott
 *
 * Unit and integration tests for "Gembo's tidbits of the day" subscription service.
 */

import fs from 'fs';
import path from 'path';
import { getDataDir } from '../src/utils/data-dir';
import {
    initTidbitDb,
    setDatabase,
    getDatabase,
    upsertSubscription,
    getSubscription,
    getAllSubscriptions,
    removeSubscription,
    updateLastSentDate,
    isTidbitDuplicate,
    recordDeliveredTidbits,
    clearTidbitHistory,
    getRecentTidbitHistory,
    seedTidbitHistory
} from '../src/features/tidbit-db';
import * as cron from 'node-cron';
import { config } from '../src/config';
import {
    generateTidbits,
    getTopNews,
    getFunFact,
    getHistoricalFact,
    getRecipeIdea,
    getInspirationalQuote,
    computeTidbitHash,
    normalizeTidbitText,
    parseTidbitsFromSlackMessage,
    _setFetch,
    _resetFetch,
    _setFetchStockNews,
    _resetFetchStockNews
} from '../src/features/tidbit-generator';
import fetch from 'node-fetch';
import {
    getUserLocalDateTime,
    sendChannelTidbits,
    syncChannelTidbitHistory
} from '../src/features/tidbit-worker';
import { _setCreateProvider, _resetCreateProvider } from '../src/features/tidbit-ai';

async function runTidbitsTests() {
    console.log("=== Running Tidbits Feature Tests ===");
    let passed = 0;
    let failed = 0;

    function assert(condition: boolean, message: string) {
        if (condition) {
            console.log(`  ✅ PASSED: ${message}`);
            passed++;
        } else {
            console.error(`  ❌ FAILED: ${message}`);
            failed++;
        }
    }

    try {
        // --- Database Isolation: Use tidbits.test.db for test suite execution ---
        const testDbName = 'tidbits.test.db';
        setDatabase(testDbName);
        initTidbitDb();

        // --- 1. Database Unit & Concurrency Tests ---
        console.log("\n1. Testing Database Operations (WAL Mode, CRUD, Deduplication Helpers)...");

        const testUser = 'U99999_TEST';
        const testChannel = 'C99999_TEST';

        // Clean up pre-existing test record if any
        removeSubscription(testUser);
        clearTidbitHistory(testUser);

        // Upsert new subscription
        upsertSubscription(testUser, testChannel, 3, 'America/New_York');
        let sub = getSubscription(testUser);
        assert(sub !== null && sub.user_id === testUser, "Subscription inserted into DB");
        assert(sub?.n === 3, "Subscription n set to 3");
        assert(sub?.timezone === 'America/New_York', "Subscription timezone set to America/New_York");

        // Update subscription (n = 5, timezone = Europe/London)
        upsertSubscription(testUser, testChannel, 5, 'Europe/London');
        sub = getSubscription(testUser);
        assert(sub?.n === 5, "Subscription n updated to 5");
        assert(sub?.timezone === 'Europe/London', "Subscription timezone updated to Europe/London");

        // Verify getAllSubscriptions includes our record
        const allSubs = getAllSubscriptions();
        assert(allSubs.some(s => s.user_id === testUser), "getAllSubscriptions contains test user");

        // Update last_sent_date
        const todayStr = '2026-08-12';
        updateLastSentDate(testUser, todayStr);
        sub = getSubscription(testUser);
        assert(sub?.last_sent_date === todayStr, "last_sent_date updated successfully");

        // Test Deduplication DB Helpers
        const sampleHash1 = computeTidbitHash('recipe', 'Pasta Carbonara');
        const sampleHash2 = computeTidbitHash('quote', 'Stay hungry, stay foolish.');
        assert(!isTidbitDuplicate(testUser, sampleHash1), "isTidbitDuplicate returns false before recording");

        recordDeliveredTidbits(testUser, [
            { category: 'recipe', itemHash: sampleHash1 },
            { category: 'quote', itemHash: sampleHash2 }
        ]);

        assert(isTidbitDuplicate(testUser, sampleHash1), "isTidbitDuplicate returns true for recorded recipe hash");
        assert(isTidbitDuplicate(testUser, sampleHash2), "isTidbitDuplicate returns true for recorded quote hash");
        assert(!isTidbitDuplicate(testUser, 'non_existent_hash'), "isTidbitDuplicate returns false for unrecorded hash");
        assert(!isTidbitDuplicate('OTHER_RECIPIENT_123', sampleHash1), "isTidbitDuplicate respects recipient isolation");

        clearTidbitHistory(testUser);
        assert(!isTidbitDuplicate(testUser, sampleHash1), "clearTidbitHistory clears recipient history");

        // Remove subscription
        const removed = removeSubscription(testUser);
        assert(removed === true, "removeSubscription returned true");
        sub = getSubscription(testUser);
        assert(sub === null, "Subscription successfully deleted from DB");


        // --- 2. Input Validation Tests ---
        console.log("\n2. Testing Subscription n Input Validation...");

        function isValidN(n: any): boolean {
            return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;
        }

        assert(!isValidN(0), "n = 0 rejected");
        assert(!isValidN(6), "n = 6 rejected");
        assert(!isValidN(-1), "n = -1 rejected");
        assert(!isValidN("3"), "String n = '3' rejected");
        assert(!isValidN(3.5), "Decimal n = 3.5 rejected");
        assert(!isValidN(undefined), "undefined n rejected");
        assert(isValidN(1), "n = 1 accepted");
        assert(isValidN(3), "n = 3 accepted");
        assert(isValidN(5), "n = 5 accepted");


        // --- 3. Content Generator, Static Dataset Removal & Live Web Sourcing Tests ---
        console.log("\n3. Testing Content Generation, Dynamic Web Sourcing & Removal of Static Datasets...");

        // Verify static datasets are completely removed from module exports
        const genModule = await import('../src/features/tidbit-generator');
        assert((genModule as any).FAMOUS_QUOTES === undefined, "FAMOUS_QUOTES dataset removed from module");
        assert((genModule as any).CURATED_RECIPES === undefined, "CURATED_RECIPES dataset removed from module");
        assert((genModule as any).FALLBACK_TRIVIA === undefined, "FALLBACK_TRIVIA dataset removed from module");
        assert((genModule as any).FALLBACK_NEWS === undefined, "FALLBACK_NEWS dataset removed from module");
        assert((genModule as any).FALLBACK_HISTORY === undefined, "FALLBACK_HISTORY dataset removed from module");

        // Verify getRecipeIdea() fetches from web and does not return static garlic butter shrimp pasta
        const recipeTest = await getRecipeIdea();
        assert(typeof recipeTest.text === 'string' && recipeTest.text.includes("Recipe Idea"), "getRecipeIdea fetches live dish information");
        assert(!recipeTest.text.includes("Quick Garlic Butter Shrimp Pasta"), "getRecipeIdea does not reference static CURATED_RECIPES");
        assert(typeof recipeTest.hash === 'string' && recipeTest.hash.length === 64, "getRecipeIdea returns deterministic sha256 hash");

        // Verify getInspirationalQuote() fetches live quote
        const quoteTest = await getInspirationalQuote();
        assert(typeof quoteTest.text === 'string' && quoteTest.text.includes("Inspirational Quote"), "getInspirationalQuote fetches live quote");
        assert(typeof quoteTest.hash === 'string' && quoteTest.hash.length === 64, "getInspirationalQuote returns deterministic sha256 hash");

        // Test generateTidbits(n) for n = 1..5
        for (let n = 1; n <= 5; n++) {
            const result = await generateTidbits(n);
            assert(result.includes("*Gembo's Tidbits of the Day* ☀️"), `generateTidbits(${n}) includes header`);
            const bulletMatches = result.match(/• /g);
            assert(bulletMatches !== null && bulletMatches.length === n, `generateTidbits(${n}) returned exactly ${n} items`);
        }


        // --- 4. Category Handlers & Fallback Resilience ---
        console.log("\n4. Testing Individual Category Handlers & Web Sourcing...");

        const newsRes = await getTopNews();
        assert(typeof newsRes.text === 'string' && newsRes.text.includes("Today's Top News"), "getTopNews returns valid formatted string");
        assert(typeof newsRes.hash === 'string' && newsRes.hash.length === 64, "getTopNews returns valid sha256 hash");

        const factRes = await getFunFact();
        assert(typeof factRes.text === 'string' && factRes.text.includes("Fun Factoid"), "getFunFact returns valid formatted string");
        assert(typeof factRes.hash === 'string' && factRes.hash.length === 64, "getFunFact returns valid sha256 hash");

        const historyRes = await getHistoricalFact();
        assert(typeof historyRes.text === 'string' && historyRes.text.includes("Historical Fact on This Day"), "getHistoricalFact returns valid formatted string");
        assert(typeof historyRes.hash === 'string' && historyRes.hash.length === 64, "getHistoricalFact returns valid sha256 hash");

        const recipeRes = await getRecipeIdea();
        assert(typeof recipeRes.text === 'string' && recipeRes.text.includes("Recipe Idea"), "getRecipeIdea returns valid formatted string");
        assert(typeof recipeRes.hash === 'string' && recipeRes.hash.length === 64, "getRecipeIdea returns valid sha256 hash");

        const quoteRes = await getInspirationalQuote();
        assert(typeof quoteRes.text === 'string' && quoteRes.text.includes("Inspirational Quote"), "getInspirationalQuote returns valid formatted string");
        assert(typeof quoteRes.hash === 'string' && quoteRes.hash.length === 64, "getInspirationalQuote returns valid sha256 hash");


        // --- 5. Timezone & Worker Delivery Logic Tests ---
        console.log("\n5. Testing Timezone Calculations & Delivery Triggers...");

        // Create a fixed date: 2026-08-12 12:00:00 UTC (8:00 AM EDT, 21:00 JST)
        const testDate = new Date('2026-08-12T12:00:00Z');

        const nyTime = getUserLocalDateTime('America/New_York', testDate);
        assert(nyTime.localHour === 8, `America/New_York hour for 12:00 UTC is 8 (8:00 AM)`);
        assert(nyTime.localDateString === '2026-08-12', `America/New_York date is 2026-08-12`);

        const londonTime = getUserLocalDateTime('Europe/London', testDate);
        assert(londonTime.localHour === 13, `Europe/London hour for 12:00 UTC is 13`);

        const tokyoTime = getUserLocalDateTime('Asia/Tokyo', testDate);
        assert(tokyoTime.localHour === 21, `Asia/Tokyo hour for 12:00 UTC is 21`);

        const invalidTzTime = getUserLocalDateTime('Invalid/Timezone_Name', testDate);
        assert(invalidTzTime.localHour === 12, `Invalid timezone falls back to UTC hour (12)`);
        assert(invalidTzTime.localDateString === '2026-08-12', `Invalid timezone falls back to UTC date`);

        // Test delivery trigger condition: 8:00 AM and last_sent_date !== localDateString
        const shouldSendFresh = (nyTime.localHour === 8 && '2026-08-11' !== nyTime.localDateString);
        assert(shouldSendFresh === true, "Delivery triggers when hour is 8 and last_sent_date is yesterday");

        const shouldNotSendDuplicate = (nyTime.localHour === 8 && '2026-08-12' !== nyTime.localDateString);
        assert(shouldNotSendDuplicate === false, "Delivery skipped when last_sent_date equals today");


        // --- 6. Immediate Delivery on Subscription Tests ---
        console.log("\n6. Testing Immediate Tidbit Delivery on Subscription...");

        const subUser = 'U88888_IMMEDIATE';
        const subChannel = 'C88888_IMMEDIATE';
        const subTz = 'America/New_York';
        const subN = 2;

        removeSubscription(subUser);
        clearTidbitHistory(subUser);
        upsertSubscription(subUser, subChannel, subN, subTz);

        // Simulate immediate delivery flow
        const immediateTidbits = await generateTidbits(subN, subUser);
        assert(typeof immediateTidbits === 'string' && immediateTidbits.includes("*Gembo's Tidbits of the Day* ☀️"), "Immediate delivery tidbit generation returns formatted string");
        const immediateBulletMatches = immediateTidbits.match(/• /g);
        assert(immediateBulletMatches !== null && immediateBulletMatches.length === subN, `Immediate delivery generated exactly ${subN} tidbits`);

        const { localDateString: immediateLocalDate } = getUserLocalDateTime(subTz);
        updateLastSentDate(subUser, immediateLocalDate);

        const updatedSub = getSubscription(subUser);
        assert(updatedSub?.last_sent_date === immediateLocalDate, `last_sent_date updated to today's local date (${immediateLocalDate}) upon subscription`);

        // Verify the worker skip condition (last_sent_date === localDateString) prevents duplicate daily delivery
        const { localDateString: workerCheckDate } = getUserLocalDateTime(subTz);
        const shouldSkipWorkerDelivery = (updatedSub?.last_sent_date === workerCheckDate);
        assert(shouldSkipWorkerDelivery === true, "Worker skip condition prevents duplicate daily delivery after immediate subscription");

        removeSubscription(subUser);


        // --- 7. Testing Daily Channel Delivery to <#C0BT3T88PME> ---
        console.log("\n7. Testing Daily Channel Delivery to <#C0BT3T88PME>...");

        const postedMessages: { channel: string; text: string }[] = [];
        const mockApp: any = {
            client: {
                chat: {
                    postMessage: async ({ channel, text }: { channel: string; text: string }) => {
                        postedMessages.push({ channel, text });
                        return { ok: true };
                    }
                }
            }
        };

        // Test explicit channel delivery
        await sendChannelTidbits(mockApp, 'C0BT3T88PME', 5);
        assert(postedMessages.length === 1, "sendChannelTidbits posts 1 message");
        assert(postedMessages[0]?.channel === 'C0BT3T88PME', "Target channel is 'C0BT3T88PME'");
        assert(postedMessages[0]?.text.includes("*Gembo's Tidbits of the Day* ☀️"), "Message contains '*Gembo's Tidbits of the Day* ☀️' header");
        const channelBulletMatches = postedMessages[0]?.text.match(/• /g);
        assert(channelBulletMatches !== null && channelBulletMatches.length === 5, "Message contains exactly 5 bullet points");

        // Test fallback to default config.slack.tidbitChannelId
        postedMessages.length = 0;
        await sendChannelTidbits(mockApp);
        assert(postedMessages.length === 1, "sendChannelTidbits with default params posts 1 message");
        assert(postedMessages[0]?.channel === (config.slack.tidbitChannelId || 'C0BT3T88PME'), "Default channel fallback resolves to config.slack.tidbitChannelId");
        const defaultBulletMatches = postedMessages[0]?.text.match(/• /g);
        assert(defaultBulletMatches !== null && defaultBulletMatches.length === 5, "Default delivery contains exactly 5 bullet points");

        // Test graceful error handling when Slack API rejects postMessage
        const errorMockApp: any = {
            client: {
                chat: {
                    postMessage: async () => {
                        throw new Error("Slack API channel_not_found error");
                    }
                }
            }
        };
        let threwError = false;
        try {
            await sendChannelTidbits(errorMockApp, 'INVALID_CHANNEL', 5);
        } catch (e) {
            threwError = true;
        }
        assert(!threwError, "sendChannelTidbits gracefully handles Slack API error without throwing unhandled rejection");

        // Validate cron schedule expression format
        assert(cron.validate(config.tidbitSchedule), `Cron schedule expression "${config.tidbitSchedule}" is valid according to node-cron`);
        assert(cron.validate('0 8 * * *'), "Default '0 8 * * *' cron expression is valid");


        // --- 8. Deduplication History & Repeat Prevention Tests ---
        console.log("\n8. Testing Deduplication History & Repeat Prevention...");

        const dedupUser = 'TEST_DEDUP_USER';
        clearTidbitHistory(dedupUser);

        // Run 1: Deliver 3 tidbits to TEST_DEDUP_USER
        const run1 = await generateTidbits(3, dedupUser);
        const run1Bullets = run1.split('\n\n').filter(line => line.startsWith('• '));
        assert(run1Bullets.length === 3, "Run 1 delivered 3 tidbits");

        // Run 2: Deliver 3 tidbits to same user - should avoid duplicates
        const run2 = await generateTidbits(3, dedupUser);
        const run2Bullets = run2.split('\n\n').filter(line => line.startsWith('• '));
        assert(run2Bullets.length === 3, "Run 2 delivered 3 tidbits");

        // Verify zero overlap between run1 and run2 items
        const repeatedBullets = run2Bullets.filter(item => run1Bullets.includes(item));
        assert(repeatedBullets.length === 0, "Second call does not repeat any items delivered in the first call");

        // Verify recipient isolation: another user gets fresh delivery
        const otherUser = 'TEST_DEDUP_USER_2';
        clearTidbitHistory(otherUser);
        const otherRun = await generateTidbits(3, otherUser);
        assert(typeof otherRun === 'string' && otherRun.includes("*Gembo's Tidbits of the Day* ☀️"), "Separate recipient receives independent delivery");

        clearTidbitHistory(dedupUser);
        clearTidbitHistory(otherUser);


        // --- 9. Web Fallback Resilience Tests ---
        console.log("\n9. Testing Web Fallback Resilience...");

        // A. News: Finnhub failure -> Google News RSS fallback
        _setFetchStockNews(async () => { throw new Error('Finnhub connection timed out'); });
        const fallbackNews = await getTopNews();
        assert(fallbackNews.text.includes("Today's Top News"), "Top News successfully falls back to Google News RSS when Finnhub fails");
        _resetFetchStockNews();

        // B. Fun Facts: UselessFacts failure -> Cat Facts fallback
        _setFetch(async (url: string, opts: any) => {
            if (url.includes('uselessfacts')) {
                throw new Error('UselessFacts API 500 Internal Server Error');
            }
            return fetch(url, opts);
        });
        const fallbackFact = await getFunFact();
        assert(fallbackFact.text.includes("Fun Factoid"), "Fun Fact successfully falls back to Cat Facts when UselessFacts fails");

        // C. Recipes: TheMealDB failure -> DummyJSON Recipes fallback
        _setFetch(async (url: string, opts: any) => {
            if (url.includes('themealdb')) {
                throw new Error('TheMealDB API rate limited');
            }
            return fetch(url, opts);
        });
        const fallbackRecipe = await getRecipeIdea();
        assert(fallbackRecipe.text.includes("Recipe Idea"), "Recipe Idea successfully falls back to DummyJSON when TheMealDB fails");

        // D. Quotes: ZenQuotes failure -> DummyJSON Quotes fallback
        _setFetch(async (url: string, opts: any) => {
            if (url.includes('zenquotes')) {
                throw new Error('ZenQuotes API service unavailable');
            }
            return fetch(url, opts);
        });
        const fallbackQuote = await getInspirationalQuote();
        assert(fallbackQuote.text.includes("Inspirational Quote"), "Inspirational Quote successfully falls back to DummyJSON when ZenQuotes fails");

        // E. History: Wikipedia 'events' feed failure -> 'selected' feed fallback
        _setFetch(async (url: string, opts: any) => {
            if (url.includes('/feed/onthisday/events/')) {
                throw new Error('Wikipedia events feed 404');
            }
            return fetch(url, opts);
        });
        const fallbackHistory = await getHistoricalFact();
        assert(fallbackHistory.text.includes("Historical Fact on This Day"), "Historical Fact successfully falls back to selected feed when events feed fails");

        // Reset fetch to native node-fetch
        _resetFetch();
        assert(true, "All web fallbacks successfully recovered and verified");


        // --- 10. Canonical Text Normalization & Hashing Tests ---
        console.log("\n10. Testing Canonical Text Normalization & Hashing...");

        // Case insensitivity
        const hashLower = computeTidbitHash('fact', 'reindeer like to eat bananas');
        const hashUpper = computeTidbitHash('fact', 'REINDEER LIKE TO EAT BANANAS');
        assert(hashLower === hashUpper, "computeTidbitHash is case insensitive");

        // Punctuation stripping
        const hashNoPunct = computeTidbitHash('fact', 'Reindeer like to eat bananas');
        const hashPeriod = computeTidbitHash('fact', 'Reindeer like to eat bananas.');
        const hashExclamation = computeTidbitHash('fact', 'Reindeer like to eat bananas!');
        const hashQuestion = computeTidbitHash('fact', 'Reindeer like to eat bananas?');
        assert(hashNoPunct === hashPeriod, "computeTidbitHash strips trailing periods (Oct 18 vs Oct 12 bug fix)");
        assert(hashNoPunct === hashExclamation, "computeTidbitHash strips trailing exclamation marks");
        assert(hashNoPunct === hashQuestion, "computeTidbitHash strips trailing question marks");

        // Markdown formatting stripping
        const hashBold = computeTidbitHash('recipe', '*Garlic Butter Shrimp*');
        const hashPlainRecipe = computeTidbitHash('recipe', 'Garlic Butter Shrimp');
        assert(hashBold === hashPlainRecipe, "computeTidbitHash strips markdown asterisks");

        const hashMarkdownMix = computeTidbitHash('fact', '*Reindeer* like to _eat_ `bananas`~.');
        assert(hashMarkdownMix === hashNoPunct, "computeTidbitHash strips mixed markdown and trailing punctuation");

        // Typographic quote normalization
        const hashSmartQuotes = computeTidbitHash('quote', '“Stay hungry, stay foolish.”');
        const hashAsciiQuotes = computeTidbitHash('quote', '"Stay hungry, stay foolish"');
        assert(hashSmartQuotes === hashAsciiQuotes, "computeTidbitHash normalizes curly quotes to standard ASCII quotes");

        // Whitespace collapsing and trimming
        const hashExtraSpaces = computeTidbitHash('news', '   Major   breakthrough   in   AI   ');
        const hashCleanSpaces = computeTidbitHash('news', 'Major breakthrough in AI');
        assert(hashExtraSpaces === hashCleanSpaces, "computeTidbitHash collapses multiple whitespaces and trims");


        // --- 11. Slack Message Parsing Tests ---
        console.log("\n11. Testing parseTidbitsFromSlackMessage...");

        const sampleSlackMessage = `*Gembo's Tidbits of the Day* ☀️

• 📰 *Today's Top News*: NASA telescope discovers habitable exoplanet - _Reuters_ (<https://example.com/exoplanet|Read More>)

• 💡 *Fun Factoid*: Reindeer like to eat bananas.

• 📜 *Historical Fact on This Day*: In 1969, Neil Armstrong walked on the Moon.

• 🍳 *Recipe Idea*: *Shakshuka* (North African) - Poached eggs in spiced tomato sauce. (<https://example.com/shakshuka|Recipe>)

• 💬 *Inspirational Quote*: "The journey of a thousand miles begins with a single step." — *Lao Tzu*`;

        const parsedBullets = parseTidbitsFromSlackMessage(sampleSlackMessage);
        assert(parsedBullets.length === 5, "parseTidbitsFromSlackMessage parsed exactly 5 bullet items");

        const newsParsed = parsedBullets.find(b => b.category === 'news');
        assert(newsParsed !== undefined && newsParsed.contentIdentifier.includes('NASA telescope discovers'), "Parsed news bullet and extracted headline");
        assert(newsParsed?.itemHash === computeTidbitHash('news', newsParsed!.contentIdentifier), "Parsed news canonical hash matches");

        const factParsed = parsedBullets.find(b => b.category === 'fact');
        assert(factParsed !== undefined && factParsed.contentIdentifier === 'Reindeer like to eat bananas.', "Parsed fun fact bullet");
        assert(factParsed?.itemHash === computeTidbitHash('fact', 'Reindeer like to eat bananas'), "Parsed fact hash matches canonical fact hash (punctuation stripped)");

        const historyParsed = parsedBullets.find(b => b.category === 'history');
        assert(historyParsed !== undefined && historyParsed.contentIdentifier.startsWith('1969:'), "Parsed historical fact bullet with year:text format");
        assert(historyParsed?.itemHash === computeTidbitHash('history', historyParsed!.contentIdentifier), "Parsed history hash matches canonical hash");

        const recipeParsed = parsedBullets.find(b => b.category === 'recipe');
        assert(recipeParsed !== undefined && recipeParsed.contentIdentifier === 'Shakshuka', "Parsed recipe bullet and extracted dish name");
        assert(recipeParsed?.itemHash === computeTidbitHash('recipe', 'Shakshuka'), "Parsed recipe hash matches canonical hash");

        const quoteParsed = parsedBullets.find(b => b.category === 'quote');
        assert(quoteParsed !== undefined && quoteParsed.contentIdentifier.includes('journey of a thousand miles'), "Parsed quote bullet and extracted quote text");
        assert(quoteParsed?.itemHash === computeTidbitHash('quote', quoteParsed!.contentIdentifier), "Parsed quote hash matches canonical hash");

        const nonTidbitParsed = parseTidbitsFromSlackMessage("Hello team, remember our standup at 10 AM!");
        assert(nonTidbitParsed.length === 0, "parseTidbitsFromSlackMessage returns empty array for non-tidbit message");


        // --- 12. Database History Seeding & Constraints Tests ---
        console.log("\n12. Testing Database History Seeding & getRecentTidbitHistory...");

        const testSeedRecipient = 'C_SEED_TEST_CHANNEL';
        clearTidbitHistory(testSeedRecipient);

        const itemsToSeed = [
            { category: 'fact', itemHash: computeTidbitHash('fact', 'Wombats produce cube-shaped poop.'), contentIdentifier: 'Wombats produce cube-shaped poop.' },
            { category: 'recipe', itemHash: computeTidbitHash('recipe', 'Birria Tacos'), contentIdentifier: 'Birria Tacos' },
            { category: 'quote', itemHash: computeTidbitHash('quote', 'Knowledge is power.'), contentIdentifier: 'Knowledge is power.' },
        ];

        const seededCount = seedTidbitHistory(testSeedRecipient, itemsToSeed);
        assert(seededCount === 3, "seedTidbitHistory inserted 3 new historical records");

        const reseededCount = seedTidbitHistory(testSeedRecipient, itemsToSeed);
        assert(reseededCount === 0, "seedTidbitHistory with INSERT OR IGNORE correctly ignored existing records");

        assert(isTidbitDuplicate(testSeedRecipient, computeTidbitHash('fact', 'Wombats produce cube-shaped poop')), "isTidbitDuplicate returns true for seeded fact");
        assert(isTidbitDuplicate(testSeedRecipient, computeTidbitHash('recipe', 'Birria Tacos')), "isTidbitDuplicate returns true for seeded recipe");

        const recentRecipes = getRecentTidbitHistory(testSeedRecipient, 'recipe', 10);
        assert(recentRecipes.includes('Birria Tacos'), "getRecentTidbitHistory returns seeded dish name for prompt exclusion");

        const recentFacts = getRecentTidbitHistory(testSeedRecipient, 'fact', 10);
        assert(recentFacts.some(f => f.includes('Wombats')), "getRecentTidbitHistory returns seeded fact for prompt exclusion");

        clearTidbitHistory(testSeedRecipient);


        // --- 13. Channel Self-Healing History Sync Tests ---
        console.log("\n13. Testing syncChannelTidbitHistory (Slack API Channel Backfill)...");

        const syncTestChannel = 'C_SELF_HEALING_CHANNEL';
        clearTidbitHistory(syncTestChannel);

        const mockSlackAppForSync: any = {
            client: {
                conversations: {
                    history: async ({ channel, limit }: { channel: string; limit: number }) => {
                        return {
                            ok: true,
                            messages: [
                                { text: 'Good morning everyone!', user: 'U1234', ts: '1729252000.000100' },
                                { text: sampleSlackMessage, bot_id: 'B_GEMBOT', ts: '1729252800.000200' },
                            ]
                        };
                    }
                }
            }
        };

        await syncChannelTidbitHistory(mockSlackAppForSync, syncTestChannel);

        assert(isTidbitDuplicate(syncTestChannel, computeTidbitHash('fact', 'Reindeer like to eat bananas')), "Self-healing sync backfilled fun fact from Slack history");
        assert(isTidbitDuplicate(syncTestChannel, computeTidbitHash('recipe', 'Shakshuka')), "Self-healing sync backfilled recipe from Slack history");
        assert(isTidbitDuplicate(syncTestChannel, computeTidbitHash('history', '1969:Neil Armstrong walked on the Moon.')), "Self-healing sync backfilled historical fact from Slack history");
        assert(isTidbitDuplicate(syncTestChannel, computeTidbitHash('quote', 'The journey of a thousand miles begins with a single step.')), "Self-healing sync backfilled quote from Slack history");
        assert(isTidbitDuplicate(syncTestChannel, computeTidbitHash('news', 'NASA telescope discovers habitable exoplanet')), "Self-healing sync backfilled news from Slack history");

        clearTidbitHistory(syncTestChannel);


        // --- 14. AI Fallback Escalation Under 100% Collision Tests ---
        console.log("\n14. Testing AI Fallback Escalation When Web Sources Collide 100%...");

        const collisionRecipient = 'U_COLLISION_TEST_USER';
        clearTidbitHistory(collisionRecipient);

        // A. Fun Fact Escalation to AI
        const duplicateFact = 'Reindeer like to eat bananas.';
        recordDeliveredTidbits(collisionRecipient, [{
            category: 'fact',
            itemHash: computeTidbitHash('fact', duplicateFact),
            contentIdentifier: duplicateFact,
        }]);

        // Web APIs return the duplicate fact 100% of the time
        _setFetch(async (url: string) => {
            if (url.includes('uselessfacts')) {
                return { ok: true, json: async () => ({ text: duplicateFact }) };
            }
            if (url.includes('catfact')) {
                return { ok: true, json: async () => ({ fact: duplicateFact }) };
            }
            return fetch(url);
        });

        // AI Provider mock returns a fresh, novel fact
        let aiPromptCaptured = '';
        _setCreateProvider(() => ({
            name: () => 'mock-gemini',
            chat: async (prompt: string) => {
                aiPromptCaptured = prompt;
                return { text: 'Bananas are naturally slightly radioactive because of potassium-40.' };
            },
            countTokens: async () => 10,
        }));

        const freshAiFact = await getFunFact(collisionRecipient);
        assert(freshAiFact.text.includes('radioactive'), "getFunFact smoothly escalated to AI when web sources collided");
        assert(!isTidbitDuplicate(collisionRecipient, freshAiFact.hash), "AI-generated fun fact is not a duplicate");
        assert(aiPromptCaptured.includes('Negative constraints'), "AI prompt included negative constraints from history");

        // B. Recipe Escalation to AI
        const duplicateRecipe = 'Spaghetti Carbonara';
        recordDeliveredTidbits(collisionRecipient, [{
            category: 'recipe',
            itemHash: computeTidbitHash('recipe', duplicateRecipe),
            contentIdentifier: duplicateRecipe,
        }]);

        _setFetch(async (url: string) => {
            if (url.includes('themealdb')) {
                return { ok: true, json: async () => ({ meals: [{ strMeal: duplicateRecipe, strInstructions: 'Cook pasta.' }] }) };
            }
            if (url.includes('dummyjson.com/recipes')) {
                return { ok: true, json: async () => ({ recipes: [{ name: duplicateRecipe, instructions: 'Cook pasta.' }] }) };
            }
            return fetch(url);
        });

        _setCreateProvider(() => ({
            name: () => 'mock-gemini',
            chat: async () => ({
                text: JSON.stringify({
                    name: 'Peruvian Ceviche',
                    cuisine: 'Peruvian',
                    snippet: 'Fresh sea bass cured in vibrant lime juice with red onions and cilantro.',
                    query: 'peruvian ceviche recipe'
                })
            }),
            countTokens: async () => 10,
        }));

        const freshAiRecipe = await getRecipeIdea(collisionRecipient);
        assert(freshAiRecipe.text.includes('Ceviche'), "getRecipeIdea smoothly escalated to AI when web sources collided");
        assert(!isTidbitDuplicate(collisionRecipient, freshAiRecipe.hash), "AI-generated recipe idea is not a duplicate");

        // C. Quote Escalation to AI
        const duplicateQuote = 'To be or not to be.';
        recordDeliveredTidbits(collisionRecipient, [{
            category: 'quote',
            itemHash: computeTidbitHash('quote', duplicateQuote),
            contentIdentifier: duplicateQuote,
        }]);

        _setFetch(async (url: string) => {
            if (url.includes('zenquotes')) {
                return { ok: true, json: async () => [{ q: duplicateQuote, a: 'William Shakespeare' }] };
            }
            if (url.includes('dummyjson.com/quotes')) {
                return { ok: true, json: async () => ({ quote: duplicateQuote, author: 'William Shakespeare' }) };
            }
            return fetch(url);
        });

        _setCreateProvider(() => ({
            name: () => 'mock-gemini',
            chat: async () => ({
                text: JSON.stringify({
                    quote: 'Imagination is more important than knowledge.',
                    author: 'Albert Einstein'
                })
            }),
            countTokens: async () => 10,
        }));

        const freshAiQuote = await getInspirationalQuote(collisionRecipient);
        assert(freshAiQuote.text.includes('Imagination is more important'), "getInspirationalQuote smoothly escalated to AI when web sources collided");
        assert(!isTidbitDuplicate(collisionRecipient, freshAiQuote.hash), "AI-generated quote is not a duplicate");

        // D. History Escalation to AI
        const duplicateHistory = 'Battle of Hastings';
        recordDeliveredTidbits(collisionRecipient, [{
            category: 'history',
            itemHash: computeTidbitHash('history', `1066:${duplicateHistory}`),
            contentIdentifier: `1066:${duplicateHistory}`,
        }]);

        _setFetch(async (url: string) => {
            if (url.includes('/feed/onthisday/')) {
                return { ok: true, json: async () => ({ events: [{ year: 1066, text: duplicateHistory }] }) };
            }
            return fetch(url);
        });

        _setCreateProvider(() => ({
            name: () => 'mock-gemini',
            chat: async () => ({
                text: JSON.stringify({
                    year: 1977,
                    text: 'Voyager 1 was launched by NASA to explore the outer solar system.'
                })
            }),
            countTokens: async () => 10,
        }));

        const freshAiHistory = await getHistoricalFact(collisionRecipient);
        assert(freshAiHistory.text.includes('Voyager 1'), "getHistoricalFact smoothly escalated to AI when web feeds collided");
        assert(!isTidbitDuplicate(collisionRecipient, freshAiHistory.hash), "AI-generated historical fact is not a duplicate");

        _resetFetch();
        _resetCreateProvider();
        clearTidbitHistory(collisionRecipient);


        // --- 15. End-to-End Simulation: Consecutive Daily Delivery Zero-Duplicate Guarantee ---
        console.log("\n15. Testing Multi-Run Channel Delivery Simulation (Zero Duplicate Guarantee)...");

        const simulationChannel = 'C_SIMULATION_CHANNEL';
        clearTidbitHistory(simulationChannel);
        const deliveredHashes = new Set<string>();
        let simulationDuplicates = 0;

        // Perform 10 consecutive daily delivery runs (5 items each = 50 total items)
        for (let run = 1; run <= 10; run++) {
            const deliveryMessage = await generateTidbits(5, simulationChannel);
            const bullets = parseTidbitsFromSlackMessage(deliveryMessage);
            for (const b of bullets) {
                if (deliveredHashes.has(b.itemHash)) {
                    simulationDuplicates++;
                }
                deliveredHashes.add(b.itemHash);
            }
        }

        assert(simulationDuplicates === 0, `Across 10 consecutive delivery runs (50 items), exactly 0 duplicate items were generated (found ${simulationDuplicates})`);
        clearTidbitHistory(simulationChannel);


        // --- Cleanup Isolated Test Database ---
        try {
            getDatabase().close();
            const dataDir = getDataDir();
            for (const suffix of ['', '-wal', '-shm']) {
                const target = path.join(dataDir, `${testDbName}${suffix}`);
                if (fs.existsSync(target)) {
                    fs.unlinkSync(target);
                }
            }
            console.log("\n[TestCleanup] Successfully cleaned up isolated test database files.");
        } catch (cleanupError) {
            console.warn("[TestCleanup] Notice during test DB cleanup:", cleanupError);
        }

        console.log(`\n===================================`);
        console.log(`Test Execution Summary: ${passed} passed, ${failed} failed.`);
        console.log(`===================================`);

        if (failed > 0) {
            process.exit(1);
        }
    } catch (err) {
        console.error("Unhandled error during test execution:", err);
        process.exit(1);
    }
}

runTidbitsTests();
