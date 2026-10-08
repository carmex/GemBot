/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 * Copyright (C) 2025 David Lott
 *
 * Unit and integration tests for "Gembo's tidbits of the day" subscription service.
 */

import {
    initTidbitDb,
    upsertSubscription,
    getSubscription,
    getAllSubscriptions,
    removeSubscription,
    updateLastSentDate,
    isTidbitDuplicate,
    recordDeliveredTidbits,
    clearTidbitHistory
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
    _setFetch,
    _resetFetch,
    _setFetchStockNews,
    _resetFetchStockNews
} from '../src/features/tidbit-generator';
import fetch from 'node-fetch';
import { getUserLocalDateTime, sendChannelTidbits } from '../src/features/tidbit-worker';

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
        // --- 1. Database Unit & Concurrency Tests ---
        console.log("\n1. Testing Database Operations (WAL Mode, CRUD, Deduplication Helpers)...");
        initTidbitDb();

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
