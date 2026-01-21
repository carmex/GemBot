/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 * Copyright (C) 2025 David Lott
 */

import { markdownToSlack } from '../src/features/utils';

function assert(actual: string, expected: string, message: string) {
    if (actual !== expected) {
        console.error(`FAILED: ${message}`);
        console.error(`  Expected: ${JSON.stringify(expected)}`);
        console.error(`  Actual:   ${JSON.stringify(actual)}`);
        process.exit(1);
    }
    console.log(`PASSED: ${message}`);
}

function runTests() {
    console.log("Running Markdown to Slack Formatting Tests...");

    // 1. Basic link test
    assert(
        markdownToSlack("Check out [Google](https://google.com)"),
        "Check out <https://google.com|Google>",
        "Basic link conversion"
    );

    // 2. Links at the beginning of a line
    assert(
        markdownToSlack("[Google](https://google.com) is a search engine"),
        "<https://google.com|Google> is a search engine",
        "Link at the beginning of a line"
    );

    // 3. Multiple links with varied spacing
    assert(
        markdownToSlack("[One](https://one.com) and [Two](https://two.com)"),
        "<https://one.com|One> and <https://two.com|Two>",
        "Multiple links conversion"
    );

    // 4. Bullet conversion (*, -, + to •)
    assert(
        markdownToSlack("* Item 1\n- Item 2\n+ Item 3"),
        "• Item 1\n• Item 2\n• Item 3",
        "Basic bullet conversion"
    );

    // 5. Indented bullets
    assert(
        markdownToSlack("  * Indented Item"),
        "  • Indented Item",
        "Indented bullet conversion"
    );

    // 6. Headers to bold
    assert(
        markdownToSlack("### My Header"),
        "*My Header*",
        "Header conversion"
    );

    // 7. Bold and Italic
    assert(
        markdownToSlack("**bold** and __italic__"),
        "*bold* and _italic_",
        "Bold and Italic conversion"
    );

    // 8. Link with <> around URL
    assert(
        markdownToSlack("[Link](<https://example.com>)"),
        "<https://example.com|Link>",
        "Link with angle brackets around URL"
    );

    console.log("\nAll formatting tests passed!");
}

runTests();
