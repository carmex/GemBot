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

    const longText = "This is a very long text that needs to be summarized. It has multiple sentences and is definitely longer than one hundred characters so that the summarizer doesn't return an empty string immediately. We want to make sure the prompt is correct.";
    
    await summarizer.summarizeFinalResponse(longText);

    // Verify prompt
    const expectedPromptPart = "Please provide exactly one sentence summary";
    const expectedStrictConstraint = "MUST NOT exceed one sentence";
    
    if (!capturedPrompt.includes(expectedPromptPart)) {
        console.error("FAILED: Prompt does not include 'exactly one sentence summary'");
        console.error(`Actual prompt: ${capturedPrompt}`);
        process.exit(1);
    }

    if (!capturedPrompt.includes(expectedStrictConstraint)) {
        console.error("FAILED: Prompt does not include strict constraint");
        process.exit(1);
    }

    // Verify system prompt
    const expectedSystemPrompt = "You are a helpful assistant that provides extremely brief summaries (exactly 1 sentence).";
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
