
import { Summarizer } from '../src/features/summarizer';

async function testSummarizerFixes() {
    console.log("Running Summarizer Fix Tests...");

    let capturedPrompt = "";
    const mockProvider = {
        chat: async (prompt: string, options: any) => {
            capturedPrompt = prompt;
            if (prompt.includes("ALREADY_CONCISE_TEST")) {
                return { text: "ALREADY_CONCISE" };
            }
            return { text: "This is a one sentence summary." };
        }
    };

    const summarizer = new Summarizer(mockProvider, {}, "dummy.json", "System prompt");

    // 1. Test threshold (500 chars)
    console.log("Testing threshold...");
    const shortText = "A".repeat(499);
    const shortSummary = await summarizer.summarizeFinalResponse(shortText);
    if (shortSummary !== "") {
        console.error("FAILED: Summarized text shorter than 500 chars");
        process.exit(1);
    }
    console.log("PASSED: threshold check");

    const longText = "A".repeat(501);
    const longSummary = await summarizer.summarizeFinalResponse(longText);
    if (longSummary === "") {
        console.error("FAILED: Did not summarize text longer than 500 chars");
        process.exit(1);
    }
    console.log("PASSED: long text check");

    // 2. Test redundancy check
    console.log("Testing redundancy check...");
    const textWithSummary = longText + "\n\n*Summary:* something";
    const redundantSummary = await summarizer.summarizeFinalResponse(textWithSummary);
    if (redundantSummary !== "") {
        console.error("FAILED: Summarized text that already contains '*Summary:*'");
        process.exit(1);
    }
    console.log("PASSED: redundancy check (*Summary:*)");

    const textWithSummary2 = longText + "\n\nSummary: something";
    const redundantSummary2 = await summarizer.summarizeFinalResponse(textWithSummary2);
    if (redundantSummary2 !== "") {
        console.error("FAILED: Summarized text that already contains 'Summary:'");
        process.exit(1);
    }
    console.log("PASSED: redundancy check (Summary:)");

    // 3. Test ALREADY_CONCISE handling
    console.log("Testing ALREADY_CONCISE handling...");
    const conciseText = "ALREADY_CONCISE_TEST " + "A".repeat(500);
    const conciseSummary = await summarizer.summarizeFinalResponse(conciseText);
    if (conciseSummary !== "") {
        console.error("FAILED: Did not handle ALREADY_CONCISE token correctly");
        process.exit(1);
    }
    console.log("PASSED: ALREADY_CONCISE check");

    // 4. Test AIHandler logic simulation
    console.log("Testing AIHandler logic simulation...");
    
    // Scenario: wasWebLookupUsed = true, alreadySummarized = true
    let wasWebLookupUsed = true;
    let alreadySummarized = true;
    let cleanFinal = "A".repeat(501);
    
    let finalOutput = cleanFinal;
    if (wasWebLookupUsed && !alreadySummarized) {
        const summary = await summarizer.summarizeFinalResponse(cleanFinal);
        if (summary) {
            finalOutput += `\n\n*Summary:* ${summary}`;
        }
    }
    
    if (finalOutput !== cleanFinal) {
        console.error("FAILED: Appended duplicate summary when alreadySummarized is true");
        process.exit(1);
    }
    console.log("PASSED: AIHandler duplicate summary prevention simulation");

    // Scenario: wasWebLookupUsed = true, alreadySummarized = false
    alreadySummarized = false;
    finalOutput = cleanFinal;
    if (wasWebLookupUsed && !alreadySummarized) {
        const summary = await summarizer.summarizeFinalResponse(cleanFinal);
        if (summary) {
            finalOutput += `\n\n*Summary:* ${summary}`;
        }
    }
    
    if (!finalOutput.includes("*Summary:*")) {
        console.error("FAILED: Did not append summary when alreadySummarized is false");
        process.exit(1);
    }
    console.log("PASSED: AIHandler summary addition simulation");

    console.log("\nALL TESTS PASSED!");
}

testSummarizerFixes().catch(err => {
    console.error(err);
    process.exit(1);
});
