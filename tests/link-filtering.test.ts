/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 * Copyright (C) 2025 David Lott
 */

import { isRestrictedLink } from '../src/features/utils';

function assert(actual: boolean, expected: boolean, message: string) {
    if (actual !== expected) {
        console.error(`FAILED: ${message}`);
        console.error(`  Expected: ${expected}`);
        console.error(`  Actual:   ${actual}`);
        process.exit(1);
    }
    console.log(`PASSED: ${message}`);
}

function runTests() {
    console.log("Running Link Filtering Tests...");

    // 1. Reddit main domain
    assert(
        isRestrictedLink("https://www.reddit.com/r/technology"),
        true,
        "Reddit main domain (www.reddit.com)"
    );

    // 2. Old Reddit subdomain
    assert(
        isRestrictedLink("https://old.reddit.com/r/funny"),
        true,
        "Old Reddit subdomain (old.reddit.com)"
    );

    // 3. Redd.it short domain
    assert(
        isRestrictedLink("https://redd.it/xyz"),
        true,
        "Redd.it short domain"
    );

    // 4. Non-restricted domain
    assert(
        isRestrictedLink("https://www.google.com"),
        false,
        "Non-restricted domain (google.com)"
    );

    // 5. Malicious lookalike domain
    assert(
        isRestrictedLink("https://reddit.com.malicious.com"),
        false,
        "Malicious lookalike domain"
    );

    // 6. Sub-subdomain of Reddit
    assert(
        isRestrictedLink("https://np.en.reddit.com/r/pics"),
        true,
        "Sub-subdomain of Reddit"
    );

    // 7. Malformed URL
    assert(
        isRestrictedLink("not-a-url"),
        false,
        "Malformed URL"
    );

    console.log("\nAll link filtering tests passed!");
}

runTests();
