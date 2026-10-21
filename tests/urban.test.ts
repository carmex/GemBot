/*
 * GemBot: Urban Dictionary & Picture Command Test Suite
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { formatUrbanDefinitions, generateUrbanImagePrompt, UrbanDefinition } from '../src/features/urban-dictionary';
import { config } from '../src/config';

async function runTests() {
    console.log("Running Urban Dictionary & !up Tests...\n");

    // 1. Regex Pattern Matching Tests
    console.log("1. Testing Regex Pattern Matching...");
    const upRegex = /^!up\s+(.+)/i;
    const udRegex = /^!(ud|urban)\s+(.+)/i;

    // Positive !up tests
    const testUp1 = "!up yeet";
    const matchUp1 = testUp1.match(upRegex);
    assert.ok(matchUp1, `Regex should match '${testUp1}'`);
    assert.strictEqual(matchUp1![1].trim(), "yeet");

    const testUp2 = "!UP bet";
    const matchUp2 = testUp2.match(upRegex);
    assert.ok(matchUp2, `Regex should match '${testUp2}' case-insensitively`);
    assert.strictEqual(matchUp2![1].trim(), "bet");

    const testUp3 = "!up caught in 4k";
    const matchUp3 = testUp3.match(upRegex);
    assert.ok(matchUp3, `Regex should match multi-word '${testUp3}'`);
    assert.strictEqual(matchUp3![1].trim(), "caught in 4k");

    // Negative !up tests
    const negativeUpCases = [
        "!update",
        "!upper",
        "!uprising",
        "up word",
        "!up",
        "hello !up world"
    ];
    for (const testCase of negativeUpCases) {
        const match = testCase.match(upRegex);
        assert.ok(!match, `Regex should NOT match '${testCase}'`);
    }

    // Positive !ud and !urban tests
    const testUd1 = "!ud no cap";
    const matchUd1 = testUd1.match(udRegex);
    assert.ok(matchUd1, `Regex should match '${testUd1}'`);
    assert.strictEqual(matchUd1![1], "ud");
    assert.strictEqual(matchUd1![2].trim(), "no cap");

    const testUrban1 = "!URBAN rizz";
    const matchUrban1 = testUrban1.match(udRegex);
    assert.ok(matchUrban1, `Regex should match '${testUrban1}'`);
    assert.strictEqual(matchUrban1![1].toLowerCase(), "urban");
    assert.strictEqual(matchUrban1![2].trim(), "rizz");

    console.log("PASSED: Regex pattern matching tests\n");

    // 2. Definition Formatting Tests
    console.log("2. Testing formatUrbanDefinitions...");
    const sampleDefinitions: UrbanDefinition[] = [
        {
            word: "yeet",
            definition: "To [throw] something with [force] and [distance].",
            example: "He [yeeted] the empty can across the [room].",
            thumbs_up: 1250,
            thumbs_down: 85,
            permalink: "https://www.urbandictionary.com/define.php?term=yeet&defid=1"
        },
        {
            word: "yeet",
            definition: "An exclamation of [excitement] or [approval].",
            example: "",
            thumbs_up: 890,
            thumbs_down: 42,
            permalink: "https://www.urbandictionary.com/define.php?term=yeet&defid=2"
        }
    ];

    const formatted = formatUrbanDefinitions("yeet", sampleDefinitions);

    // Verify header
    assert.ok(formatted.includes("*Urban Dictionary: yeet*"), "Header should include search term");

    // Verify brackets stripped
    assert.ok(formatted.includes("To throw something with force and distance."), "Brackets should be removed from definition");
    assert.ok(!formatted.includes("[throw]"), "Original bracketed word should not be present");
    assert.ok(formatted.includes("_Example: He yeeted the empty can across the room._"), "Example should be formatted and bracket-free");

    // Verify thumbs up/down
    assert.ok(formatted.includes("👍 1250  👎 85"), "Thumbs up and down counts should be present");
    assert.ok(formatted.includes("👍 890  👎 42"), "Second item thumbs up and down counts should be present");

    // Verify second definition with empty example does not produce empty example line
    assert.ok(formatted.includes("An exclamation of excitement or approval."), "Second definition should be present");
    assert.ok(!formatted.includes("_Example: _"), "Empty example line should not exist");

    console.log("PASSED: formatUrbanDefinitions verification\n");

    // 3. Prompt Negative Constraints Verification
    console.log("3. Testing Prompt Negative Constraints in src/features/urban-dictionary.ts...");
    const urbanSourcePath = path.join(__dirname, '../src/features/urban-dictionary.ts');
    const urbanSource = fs.readFileSync(urbanSourcePath, 'utf-8');

    assert.ok(
        urbanSource.includes('do not include the word itself or print the literal definition in the image'),
        "Fallback prompt must contain negative constraint against word/definition text"
    );
    assert.ok(
        urbanSource.includes('ABSOLUTELY NO including the target word itself, written text of the word, or printing the literal definition in the image description.'),
        "LLM Prompting Rule 1 must contain negative constraint against word/definition text"
    );
    assert.ok(
        urbanSource.includes('Focus entirely on an action, environment, or characters actively demonstrating the concept or situation in a living, dynamic scene.'),
        "LLM Prompting Rule 2 must focus on positive dynamic scene constraints"
    );

    console.log("PASSED: Prompt negative constraints verification\n");

    // 4. Testing generateUrbanImagePrompt with definitions
    console.log("4. Testing generateUrbanImagePrompt with populated definitions...");
    const promptResult = await generateUrbanImagePrompt("yeet", sampleDefinitions);
    console.log(`Generated prompt: "${promptResult}"`);
    assert.ok(typeof promptResult === 'string' && promptResult.trim().length > 0, "Prompt must be a non-empty string");
    console.log("PASSED: generateUrbanImagePrompt with populated definitions\n");

    // 5. Testing generateUrbanImagePrompt with sparse definitions
    console.log("5. Testing generateUrbanImagePrompt with sparse definitions...");
    const sparseResult = await generateUrbanImagePrompt("ghosting", []);
    console.log(`Generated prompt for sparse definitions: "${sparseResult}"`);
    assert.ok(typeof sparseResult === 'string' && sparseResult.trim().length > 0, "Prompt must be a non-empty string");
    console.log("PASSED: generateUrbanImagePrompt with sparse definitions\n");

    // 6. Testing generateUrbanImagePrompt fallback on provider error
    console.log("6. Testing generateUrbanImagePrompt fallback on provider error...");
    const originalApiKey = config.gemini.apiKey;
    try {
        config.gemini.apiKey = '';
        const fallbackResult = await generateUrbanImagePrompt("fallbackTerm", []);
        console.log(`Fallback prompt: "${fallbackResult}"`);
        assert.ok(fallbackResult.includes("fallbackTerm"), "Fallback prompt should contain search term");
        assert.ok(fallbackResult.includes("do not include the word itself or print the literal definition in the image"), "Fallback prompt should contain negative constraint");
    } finally {
        config.gemini.apiKey = originalApiKey;
    }
    console.log("PASSED: generateUrbanImagePrompt fallback on provider error\n");

    console.log("ALL URBAN DICTIONARY TESTS PASSED SUCCESSFULLY!");
}

runTests().catch(err => {
    console.error("Test failure:", err);
    process.exit(1);
});
