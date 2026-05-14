/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 */

import { Summarizer } from '../src/features/summarizer';

async function testSummarizeFinalResponse() {
    console.log("Running Summarizer Tests...");

    let capturedPrompt = "";
    let capturedOptions: any = null;

    const mockProvider = {
        chat: async (prompt: string, options: any) => {
            capturedPrompt = prompt;
            capturedOptions = options;
            return { text: "This is a one sentence summary." };
        }
    };

    const summarizer = new Summarizer(mockProvider, {}, "dummy.json", "System prompt");

    // Use a text longer than the 1000 character threshold
    const longText = "A".repeat(1001);
    
    await summarizer.summarizeFinalResponse(longText);

    // Verify prompt
    const expectedPromptPart = "Please provide exactly one sentence summary";
    const expectedSentenceConstraint = "Be exactly one sentence long.";
    
    if (!capturedPrompt.includes(expectedPromptPart)) {
        console.error("FAILED: Prompt does not include 'exactly one sentence summary'");
        console.error(`Actual prompt length: ${capturedPrompt.length}`);
        process.exit(1);
    }

    if (!capturedPrompt.includes(expectedSentenceConstraint)) {
        console.error("FAILED: Prompt does not include sentence constraint");
        process.exit(1);
    }

    // Verify system prompt
    const expectedSystemPrompt = "You are a helpful assistant that provides extremely brief summaries (exactly 1 sentence) without any prefixes.";
    if (capturedOptions.systemPrompt !== expectedSystemPrompt) {
        console.error("FAILED: System prompt is incorrect");
        console.error(`  Expected: ${expectedSystemPrompt}`);
        console.error(`  Actual:   ${capturedOptions.systemPrompt}`);
        process.exit(1);
    }

    console.log("PASSED: summarizeFinalResponse prompt and options verification");
}

testSummarizeFinalResponse().catch(err => {
    console.error(err);
    process.exit(1);
});
