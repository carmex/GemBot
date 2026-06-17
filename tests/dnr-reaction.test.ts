/*
 * GemBot: DNR Reaction Test Suite
 */

import { isCommentedMessage } from '../src/features/utils';

async function runTests() {
    console.log("Running Commented Message Logic Tests...");

    let passed = true;
    const assert = (condition: boolean, message: string) => {
        if (!condition) {
            console.error(`FAILED: ${message}`);
            passed = false;
        } else {
            console.log(`PASSED: ${message}`);
        }
    };

    // Test Case 1: Mention bot in thread with # prefix
    assert(isCommentedMessage("<@U123> # this is a comment") === true, "Case 1: Should identify mention with # as comment");

    // Test Case 2: Reply in bot thread with # prefix
    assert(isCommentedMessage("# just taking notes") === true, "Case 2: Should identify message with # as comment");

    // Test Case 3: Message with # but trailing spaces
    assert(isCommentedMessage("   # drafting some ideas   ") === true, "Case 3: Should identify message with # (with spaces) as comment");

    // Test Case 4: Normal message without #
    assert(isCommentedMessage("What is the stock price?") === false, "Case 4: Should NOT identify normal message as comment");

    // Test Case 5: Mention bot with # prefix not in thread
    assert(isCommentedMessage("<@U123> # new topic") === true, "Case 5: Should identify mention with # as comment");

    // Test Case 6: Message with # but NOT at the start
    assert(isCommentedMessage("Check out #hashtag") === false, "Case 6: Should NOT identify message with mid-text # as comment");

    if (!passed) {
        process.exit(1);
    }
    console.log("\nAll commented message logic tests passed!");
}

runTests();
