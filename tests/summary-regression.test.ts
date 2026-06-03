
import { Summarizer } from '../src/features/summarizer';
import { Content } from '@google/generative-ai';
import fs from 'fs';

async function testSummaryUpdate() {
    console.log("Running Summary Update Regression Test...");

    const testSummariesFile = "test-summaries.json";
    let capturedPrompts: string[] = [];
    const mockProvider = {
        chat: async (prompt: string, options: any) => {
            capturedPrompts.push(prompt);
            return { text: "Updated summary based on " + prompt.substring(0, 20) };
        }
    };

    const summarizationSystemPrompt = "System Prompt: If this is an update, use the previous summary.";
    const summarizer = new Summarizer(mockProvider, { openai: { maxContextSize: 4096 } }, testSummariesFile, summarizationSystemPrompt);

    // Mock an existing summary
    const threadId = "test-thread-123";
    const oldSummary = "This is the old summary of part 1.";
    
    // Setup initial summary state
    summarizer.saveThreadSummary(threadId, oldSummary);
    
    const messages: Content[] = [
        { role: 'user', parts: [{ text: "Message 16" }] },
        { role: 'model', parts: [{ text: "Response 16" }] }
    ];

    try {
        await summarizer.summarizeConversation(messages, threadId);

        const lastPrompt = capturedPrompts[0];
        console.log("Captured Prompt:", lastPrompt);

        if (!lastPrompt.includes(oldSummary)) {
            console.error("BUG CONFIRMED: Previous summary not included in summarization prompt!");
            process.exit(1);
        } else {
            console.log("SUCCESS: Previous summary included in prompt.");
        }
    } finally {
        // Cleanup
        if (fs.existsSync(testSummariesFile)) {
            fs.unlinkSync(testSummariesFile);
            console.log("Cleaned up test-summaries.json");
        }
    }
}

testSummaryUpdate().catch(err => {
    console.error(err);
    process.exit(1);
});
