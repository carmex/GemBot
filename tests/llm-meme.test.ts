/*
 * GemBot: LLM Meme Integration Test Suite
 */

import { MemeGenerator } from '../src/features/meme-generator';

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`FAILED: ${message}`);
        throw new Error(`Test failed: ${message}`);
    }
    console.log(`PASSED: ${message}`);
}

async function runTests() {
    console.log("Running Meme Search Tests...");

    // Mock the cache update to avoid actual network calls if possible, 
    // but since getPopularMemes is already implemented, we'll let it run.
    // The first call will populate the cache.
    const results = await MemeGenerator.searchMemes("doge");
    
    assert(Array.isArray(results), "Results should be an array");
    assert(results.length > 0, "Should find at least one doge meme");
    assert(results.some(m => m.id === "doge"), "Should include the classic 'doge' meme");
    
    const results2 = await MemeGenerator.searchMemes("distracted");
    assert(results2.length > 0, "Should find 'distracted boyfriend' meme");
    assert(results2.some(m => m.name.toLowerCase().includes("distracted")), "Should match 'distracted' in name");

    console.log("\nAll LLM Meme tests passed!");
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
