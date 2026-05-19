/*
 * GemBot: DNR Reaction Test Suite
 */

/**
 * Logic from app_mention
 */
function dnrCheckMention(text: string): boolean {
    const prompt = text.replace(/<@[^>]+>\s*/, '').trim();
    return prompt.startsWith('#');
}

/**
 * Logic from app.message
 */
function dnrCheckMessage(text: string, channel: string, thread_ts?: string, isEnabledChannel: boolean = false, isRpgChannel: boolean = false): boolean {
    const prompt = text.replace(/<@[^>]+>\s*/, '').trim();
    if (prompt.startsWith('#')) {
        const isThread = !!thread_ts;
        return (isThread || isEnabledChannel || isRpgChannel);
    }
    return false;
}

async function runTests() {
    console.log("Running DNR Reaction Logic Tests...");

    let passed = true;
    const assert = (condition: boolean, message: string) => {
        if (!condition) {
            console.error(`FAILED: ${message}`);
            passed = false;
        } else {
            console.log(`PASSED: ${message}`);
        }
    };

    // Test Case 1: Mention bot in thread with # prefix (app_mention)
    assert(dnrCheckMention("<@U123> # this is a comment") === true, "Case 1: Should DNR for mention with # in thread");

    // Test Case 2: Reply in bot thread with # prefix (app.message)
    assert(dnrCheckMessage("# just taking notes", "C123", "T123") === true, "Case 2: Should DNR for message with # in thread");

    // Test Case 3: Enabled channel message with # prefix (app.message)
    assert(dnrCheckMessage("# drafting some ideas", "C_ENABLED", undefined, true) === true, "Case 3: Should DNR for message with # in enabled channel");

    // Test Case 4: Normal message with # prefix (no thread, no mention, not enabled) (app.message)
    assert(dnrCheckMessage("# some private notes", "C_REGULAR", undefined, false) === false, "Case 4: Should NOT DNR for normal message with # if not enabled/thread");

    // Test Case 5: Mention bot with # prefix not in thread (app_mention)
    assert(dnrCheckMention("<@U123> # new topic") === true, "Case 5: Should DNR for mention with # (starts new thread check)");

    if (!passed) {
        process.exit(1);
    }
    console.log("\nAll DNR reaction tests passed!");
}

runTests();
