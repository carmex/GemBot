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

    // Test Case 1: Mention bot in thread with // prefix
    assert(isCommentedMessage("<@U123> // this is a comment") === true, "Case 1: Should identify mention with // as comment");

    // Test Case 2: Plain comment with // prefix
    assert(isCommentedMessage("// just taking notes") === true, "Case 2: Should identify message with // as comment");

    // Test Case 3: Message with // and whitespace padding
    assert(isCommentedMessage("   // drafting some ideas   ") === true, "Case 3: Should identify message with // (with spaces) as comment");

    // Test Case 4: Normal message without //
    assert(isCommentedMessage("What is the stock price?") === false, "Case 4: Should NOT identify normal message as comment");

    // Test Case 5: Mention bot with // prefix outside thread
    assert(isCommentedMessage("<@U123> // new topic") === true, "Case 5: Should identify mention with // as comment");

    // Test Case 6: Mid-text // (e.g. URLs or references)
    assert(isCommentedMessage("Check out https://google.com") === false, "Case 6a: Should NOT identify message with URL as comment");
    assert(isCommentedMessage("Mid-sentence // note") === false, "Case 6b: Should NOT identify message with mid-sentence // as comment");

    // Test Case 7: # prefix no longer treated as comment
    assert(isCommentedMessage("# heading 1 text") === false, "Case 7: Should NOT identify message with # as comment");

    if (!passed) {
        process.exit(1);
    }
    console.log("\nAll commented message logic tests passed!");
}

runTests();
