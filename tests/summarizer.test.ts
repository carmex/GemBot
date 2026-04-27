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
            return { text: "This is a one sentence summary in English." };
        }
    };

    const summarizer = new Summarizer(mockProvider, {}, "dummy.json", "System prompt");

    // Test 1: Long text
    const longText = "This is a very long text that needs to be summarized. It has multiple sentences and is definitely longer than one hundred characters so that the summarizer doesn't return an empty string immediately. We want to make sure the prompt is correct.";
    
    await summarizer.summarizeFinalResponse(longText);

    // Verify prompt
    const expectedPromptPart = "Please provide exactly one sentence summary of the following text in English";
    const expectedStrictConstraint = "MUST NOT exceed one sentence";
    const expectedEnglishConstraint = "MUST be in English regardless of the input language";
    
    if (!capturedPrompt.includes(expectedPromptPart)) {
        console.error("FAILED: Prompt does not include 'exactly one sentence summary ... in English'");
        console.error(`Actual prompt: ${capturedPrompt}`);
        process.exit(1);
    }

    if (!capturedPrompt.includes(expectedStrictConstraint)) {
        console.error("FAILED: Prompt does not include strict constraint");
        process.exit(1);
    }

    if (!capturedPrompt.includes(expectedEnglishConstraint)) {
        console.error("FAILED: Prompt does not include English language constraint");
        process.exit(1);
    }

    // Verify system prompt
    const expectedSystemPrompt = "You are a helpful assistant that provides extremely brief summaries (exactly 1 sentence) in English.";
    if (capturedOptions.systemPrompt !== expectedSystemPrompt) {
        console.error("FAILED: System prompt is incorrect");
        console.error(`  Expected: ${expectedSystemPrompt}`);
        console.error(`  Actual:   ${capturedOptions.systemPrompt}`);
        process.exit(1);
    }

    // Test 2: Short text (reduced threshold)
    const shortText = "This is a short text, but should still be summarized.";
    capturedPrompt = "";
    const result = await summarizer.summarizeFinalResponse(shortText);
    if (!capturedPrompt && shortText.length >= 10) {
         console.error("FAILED: Short text (length 53) was not processed but threshold is 10");
         process.exit(1);
    }
    if (result !== "This is a one sentence summary in English.") {
        console.error("FAILED: Expected summary for short text");
        process.exit(1);
    }

    console.log("PASSED: summarizeFinalResponse prompt, options, and threshold verification");
}

testSummarizeFinalResponse().catch(err => {
    console.error(err);
    process.exit(1);
});
