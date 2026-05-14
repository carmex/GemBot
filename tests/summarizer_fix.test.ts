
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

    // 1. Test threshold (1000 chars)
    console.log("Testing threshold...");
    const shortText = "A".repeat(999);
    const shortSummary = await summarizer.summarizeFinalResponse(shortText);
    if (shortSummary !== "") {
        console.error("FAILED: Summarized text shorter than 1000 chars");
        process.exit(1);
    }
    console.log("PASSED: threshold check (short)");

    const longText = "A".repeat(1001);
    const longSummary = await summarizer.summarizeFinalResponse(longText);
    if (longSummary === "") {
        console.error("FAILED: Did not summarize text longer than 1000 chars");
        process.exit(1);
    }
    console.log("PASSED: threshold check (long)");

    // 2. Test redundancy check with various markers and formats
    console.log("Testing redundancy check variations...");
    
    const variations = [
        "*Summary:* something",
        "Summary: something",
        "**Summary:** something",
        "summary: something",
        "TL;DR: something",
        "Conclusion: something",
        "In summary: something",
        "To recap: something",
        "In short: something",
        "**TL;DR:** something",
        "*Conclusion:* something"
    ];

    for (const variation of variations) {
        const textWithSummary = longText + "\n\n" + variation;
        const redundantSummary = await summarizer.summarizeFinalResponse(textWithSummary);
        if (redundantSummary !== "") {
            console.error(`FAILED: Summarized text that already contains '${variation}'`);
            process.exit(1);
        }
        console.log(`PASSED: redundancy check (${variation})`);
    }

    // 3. Test ALREADY_CONCISE handling
    console.log("Testing ALREADY_CONCISE handling...");
    const conciseText = "ALREADY_CONCISE_TEST " + "A".repeat(1000);
    const conciseSummary = await summarizer.summarizeFinalResponse(conciseText);
    if (conciseSummary !== "") {
        console.error("FAILED: Did not handle ALREADY_CONCISE token correctly");
        process.exit(1);
    }
    console.log("PASSED: ALREADY_CONCISE check");

    // 4. Test prompt content (ensuring it contains instructions about prefixes)
    console.log("Testing prompt refinement...");
    await summarizer.summarizeFinalResponse(longText);
    if (!capturedPrompt.includes("NOT include any prefix like \"Summary:\" or \"TL;DR:\"")) {
        console.error("FAILED: Prompt does not include new prefix instructions");
        process.exit(1);
    }
    console.log("PASSED: prompt refinement check");

    console.log("\nALL TESTS PASSED!");
}

testSummarizerFixes().catch(err => {
    console.error(err);
    process.exit(1);
});
