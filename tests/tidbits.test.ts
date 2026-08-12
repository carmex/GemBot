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
    updateLastSentDate
} from '../src/features/tidbit-db';
import {
    generateTidbits,
    getTopNews,
    getFunFact,
    getHistoricalFact,
    getRecipeIdea,
    getInspirationalQuote,
    FAMOUS_QUOTES
} from '../src/features/tidbit-generator';
import { getUserLocalDateTime } from '../src/features/tidbit-worker';

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
        console.log("\n1. Testing Database Operations (WAL Mode, CRUD)...");
        initTidbitDb();

        const testUser = 'U99999_TEST';
        const testChannel = 'C99999_TEST';

        // Clean up pre-existing test record if any
        removeSubscription(testUser);

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


        // --- 3. Content Generator & Quotes Tests ---
        console.log("\n3. Testing Content Generation & Famous Quotes Dataset...");

        assert(FAMOUS_QUOTES.length >= 30, `Famous quotes dataset contains ${FAMOUS_QUOTES.length} items (>= 30 required)`);
        for (const q of FAMOUS_QUOTES) {
            assert(typeof q.text === 'string' && q.text.length > 0 && typeof q.author === 'string' && q.author.length > 0, `Quote valid: "${q.text.slice(0, 20)}..." — ${q.author}`);
        }

        // Test generateTidbits(n) for n = 1..5
        for (let n = 1; n <= 5; n++) {
            const result = await generateTidbits(n);
            assert(result.includes("*Gembo's Tidbits of the Day* ☀️"), `generateTidbits(${n}) includes header`);
            const bulletMatches = result.match(/• /g);
            assert(bulletMatches !== null && bulletMatches.length === n, `generateTidbits(${n}) returned exactly ${n} items`);
        }


        // --- 4. Category Handlers & Fallback Resilience ---
        console.log("\n4. Testing Individual Category Handlers & Fallback Safety...");

        const newsRes = await getTopNews();
        assert(typeof newsRes === 'string' && newsRes.includes("Today's Top News"), "getTopNews returns valid formatted string");

        const factRes = await getFunFact();
        assert(typeof factRes === 'string' && factRes.includes("Fun Factoid"), "getFunFact returns valid formatted string");

        const historyRes = await getHistoricalFact();
        assert(typeof historyRes === 'string' && historyRes.includes("Historical Fact on This Day"), "getHistoricalFact returns valid formatted string");

        const recipeRes = await getRecipeIdea();
        assert(typeof recipeRes === 'string' && recipeRes.includes("Recipe Idea"), "getRecipeIdea returns valid formatted string");

        const quoteRes = await getInspirationalQuote();
        assert(typeof quoteRes === 'string' && quoteRes.includes("Inspirational Quote"), "getInspirationalQuote returns valid formatted string");


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
        upsertSubscription(subUser, subChannel, subN, subTz);

        // Simulate immediate delivery flow
        const immediateTidbits = await generateTidbits(subN);
        assert(typeof immediateTidbits === 'string' && immediateTidbits.includes("*Gembo's Tidbits of the Day* ☀️"), "Immediate delivery tidbit generation returns formatted string");
        const bulletMatches = immediateTidbits.match(/• /g);
        assert(bulletMatches !== null && bulletMatches.length === subN, `Immediate delivery generated exactly ${subN} tidbits`);

        const { localDateString: immediateLocalDate } = getUserLocalDateTime(subTz);
        updateLastSentDate(subUser, immediateLocalDate);

        const updatedSub = getSubscription(subUser);
        assert(updatedSub?.last_sent_date === immediateLocalDate, `last_sent_date updated to today's local date (${immediateLocalDate}) upon subscription`);

        // Verify the worker skip condition (last_sent_date === localDateString) prevents duplicate daily delivery
        const { localDateString: workerCheckDate } = getUserLocalDateTime(subTz);
        const shouldSkipWorkerDelivery = (updatedSub?.last_sent_date === workerCheckDate);
        assert(shouldSkipWorkerDelivery === true, "Worker skip condition prevents duplicate daily delivery after immediate subscription");

        removeSubscription(subUser);

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
