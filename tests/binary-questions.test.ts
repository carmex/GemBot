
import { AIHandler } from '../src/features/ai-handler';
import { App } from '@slack/bolt';
import * as dotenv from 'dotenv';

dotenv.config();

async function runTests() {
    console.log("Running Binary Question Integration Tests...");

    // Mock Slack App
    const mockApp = {
        command: () => {},
        action: () => {},
        event: () => {},
        message: () => {},
        shortcut: () => {},
        view: () => {},
    } as any;

    const handler = new AIHandler(mockApp);
    
    // Use the provider directly to test the prompt's effect
    const provider = (handler as any).provider;
    const systemPrompt = handler.geminiSystemPrompt;

    const testCases = [
        { question: "Is the sky blue?", expectedPrefix: ["Yes.", "No."] },
        { question: "Do you like pizza?", expectedPrefix: ["Yes.", "No."] },
        { question: "Can you help me?", expectedPrefix: ["Yes.", "No."] },
        { question: "What is 2+2?", negative: true },
        { question: "Tell me a story.", negative: true }
    ];

    for (const test of testCases) {
        console.log(`Testing: "${test.question}"`);
        const response = await provider.chat(test.question, { systemPrompt });
        const text = response.text.trim();
        console.log(`Response: "${text.substring(0, 50)}..."`);

        if (test.negative) {
            if (text.startsWith("Yes.") || text.startsWith("No.")) {
                console.warn(`[WARN] Negative test "${test.question}" started with Yes/No.`);
            } else {
                console.log(`PASSED: Negative test "${test.question}" didn't start with binary prefix.`);
            }
        } else {
            const startsWithYesNo = test.expectedPrefix?.some(prefix => text.startsWith(prefix));
            if (startsWithYesNo) {
                console.log(`PASSED: "${test.question}" started with a binary prefix.`);
            } else {
                console.error(`FAILED: "${test.question}" did NOT start with a binary prefix.`);
                console.error(`Full response: ${text}`);
                process.exit(1);
            }
        }
    }

    console.log("\nAll binary question tests passed!");
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
