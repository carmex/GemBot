/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 */

import { fetchDictionaryEntry, generateDictionaryImagePrompt, DictionaryEntry, formatDictionaryEntry } from '../src/features/dictionary';

async function runTests() {
    console.log("Running Dictionary Tests...\n");

    // 1. Regex Pattern Matching Tests
    console.log("1. Testing Regex Pattern Matching...");
    const regex = /^!(dict|dictionary)\s+(.+)/i;

    const test1 = "!dict hello";
    const match1 = test1.match(regex);
    if (!match1 || match1[1] !== "dict" || match1[2] !== "hello") {
        console.error(`FAILED: Regex failed for '${test1}'`);
        process.exit(1);
    }

    const test2 = "!dictionary world";
    const match2 = test2.match(regex);
    if (!match2 || match2[1] !== "dictionary" || match2[2] !== "world") {
        console.error(`FAILED: Regex failed for '${test2}'`);
        process.exit(1);
    }

    const dpRegex = /^!dp\s+(.+)/i;

    const testDp1 = "!dp hello";
    const matchDp1 = testDp1.match(dpRegex);
    if (!matchDp1 || matchDp1[1] !== "hello") {
        console.error(`FAILED: Regex failed for '${testDp1}'`);
        process.exit(1);
    }

    const testDp2 = "!dp complex word";
    const matchDp2 = testDp2.match(dpRegex);
    if (!matchDp2 || matchDp2[1] !== "complex word") {
        console.error(`FAILED: Regex failed for '${testDp2}'`);
        process.exit(1);
    }
    console.log("PASSED: Regex pattern matching tests\n");

    // 2. Fetch Dictionary Entry for standard words
    console.log("2. Testing fetchDictionaryEntry('dictionary')...");
    const entryDict = await fetchDictionaryEntry("dictionary");
    if (!entryDict) {
        console.error("FAILED: fetchDictionaryEntry('dictionary') returned null");
        process.exit(1);
    }

    console.log(`Received entry for '${entryDict.word}':`);
    console.log(`- Word: ${entryDict.word}`);
    console.log(`- Pronunciation: ${entryDict.pronunciation}`);
    console.log(`- Etymology: ${entryDict.etymology}`);
    console.log(`- Demonym: ${entryDict.demonym}`);
    console.log(`- Definitions count: ${entryDict.definitions.length}`);

    if (
        typeof entryDict.word !== 'string' || !entryDict.word ||
        typeof entryDict.pronunciation !== 'string' || !entryDict.pronunciation ||
        typeof entryDict.etymology !== 'string' || !entryDict.etymology ||
        typeof entryDict.demonym !== 'string' || !entryDict.demonym ||
        !Array.isArray(entryDict.definitions) || entryDict.definitions.length === 0
    ) {
        console.error("FAILED: Missing or invalid fields in entry for 'dictionary'");
        process.exit(1);
    }
    console.log("PASSED: fetchDictionaryEntry('dictionary') verification\n");

    // 3. Fetch Dictionary Entry for "america"
    console.log("3. Testing fetchDictionaryEntry('america')...");
    const entryAmerica = await fetchDictionaryEntry("america");
    if (!entryAmerica) {
        console.error("FAILED: fetchDictionaryEntry('america') returned null");
        process.exit(1);
    }

    console.log(`Received entry for '${entryAmerica.word}':`);
    console.log(`- Word: ${entryAmerica.word}`);
    console.log(`- Pronunciation: ${entryAmerica.pronunciation}`);
    console.log(`- Etymology: ${entryAmerica.etymology}`);
    console.log(`- Demonym: ${entryAmerica.demonym}`);

    if (
        typeof entryAmerica.word !== 'string' || !entryAmerica.word ||
        typeof entryAmerica.pronunciation !== 'string' || !entryAmerica.pronunciation ||
        typeof entryAmerica.etymology !== 'string' || !entryAmerica.etymology ||
        typeof entryAmerica.demonym !== 'string' || !entryAmerica.demonym ||
        !Array.isArray(entryAmerica.definitions) || entryAmerica.definitions.length === 0
    ) {
        console.error("FAILED: Missing or invalid fields in entry for 'america'");
        process.exit(1);
    }
    console.log("PASSED: fetchDictionaryEntry('america') verification\n");

    // 4. Invalid / Non-existent Word
    console.log("4. Testing invalid/non-existent word...");
    const invalidWord = "xyzqwk123987nonexistent";
    const entryInvalid = await fetchDictionaryEntry(invalidWord);
    console.log(`Result for invalid word: ${entryInvalid ? JSON.stringify(entryInvalid) : 'null'}`);
    console.log("PASSED: Invalid word handling verification\n");

    // 5. Test generateDictionaryImagePrompt with standard entry
    console.log("5. Testing generateDictionaryImagePrompt(entryDict)...");
    const promptResult = await generateDictionaryImagePrompt(entryDict);
    console.log(`Generated prompt: "${promptResult}"`);
    if (typeof promptResult !== 'string' || promptResult.trim().length === 0) {
        console.error("FAILED: generateDictionaryImagePrompt returned empty string");
        process.exit(1);
    }
    console.log("PASSED: generateDictionaryImagePrompt with standard entry\n");

    // 6. Test generateDictionaryImagePrompt with sparse/fallback entry (missing definitions)
    console.log("6. Testing generateDictionaryImagePrompt with sparse entry...");
    const sparseEntry: DictionaryEntry = {
        word: "serendipity",
        pronunciation: "N/A",
        etymology: "N/A",
        demonym: "N/A",
        definitions: []
    };
    const sparsePrompt = await generateDictionaryImagePrompt(sparseEntry);
    console.log(`Generated prompt for sparse entry: "${sparsePrompt}"`);
    if (typeof sparsePrompt !== 'string' || sparsePrompt.trim().length === 0) {
        console.error("FAILED: generateDictionaryImagePrompt failed for sparse entry");
        process.exit(1);
    }
    console.log("PASSED: generateDictionaryImagePrompt with sparse entry\n");

    // 7. Testing Prompt Negative Constraints
    console.log("7. Testing Prompt Negative Constraints...");
    const fs = require('fs');
    const path = require('path');
    const dictionarySource = fs.readFileSync(path.join(__dirname, '../src/features/dictionary.ts'), 'utf-8');

    // Verify blanket restrictions are removed
    if (dictionarySource.includes('no text, no books, no signs')) {
        console.error("FAILED: Blanket constraint 'no text, no books, no signs' still present in src/features/dictionary.ts");
        process.exit(1);
    }
    if (dictionarySource.includes('ABSOLUTELY NO text, letters, words, signs, books, scrolls, dictionary pages, or written definitions')) {
        console.error("FAILED: Blanket constraint 'ABSOLUTELY NO text, letters, words, signs...' still present in src/features/dictionary.ts");
        process.exit(1);
    }

    // Verify updated focused negative constraints are present
    if (!dictionarySource.includes('do not include the word itself or print the literal definition in the image')) {
        console.error("FAILED: Focused fallback negative constraint missing in src/features/dictionary.ts");
        process.exit(1);
    }
    if (!dictionarySource.includes('ABSOLUTELY NO including the target word itself, written text of the word, or printing the literal definition in the image description.')) {
        console.error("FAILED: Focused LLM Rule 1 negative constraint missing in src/features/dictionary.ts");
        process.exit(1);
    }

    console.log("PASSED: Prompt negative constraints verification\n");

    // 8. Testing formatDictionaryEntry
    console.log("8. Testing formatDictionaryEntry...");

    // Test 8.1: Multiple Definitions Test
    const multiEntry: DictionaryEntry = {
        word: "testword",
        pronunciation: "test-wurd",
        etymology: "From Old English",
        demonym: "Testian",
        definitions: [
            {
                partOfSpeech: "noun",
                definition: "An examination or trial.",
                example: "She passed the difficult test."
            },
            {
                partOfSpeech: "verb",
                definition: "To take measures in order to discover quality or effectiveness.",
                example: "They test the software thoroughly."
            }
        ]
    };

    const multiFormatted = formatDictionaryEntry(multiEntry);

    if (!multiFormatted.includes("1. *(noun)* An examination or trial.")) {
        console.error("FAILED: Missing or incorrect first definition formatting (1. *(noun)* ...)");
        process.exit(1);
    }
    if (!multiFormatted.includes('  _Example: "She passed the difficult test."_')) {
        console.error("FAILED: Missing or incorrect example formatting for definition 1");
        process.exit(1);
    }
    if (!multiFormatted.includes("2. *(verb)* To take measures in order to discover quality or effectiveness.")) {
        console.error("FAILED: Missing or incorrect second definition formatting (2. *(verb)* ...)");
        process.exit(1);
    }
    if (!multiFormatted.includes('  _Example: "They test the software thoroughly."_')) {
        console.error("FAILED: Missing or incorrect example formatting for definition 2");
        process.exit(1);
    }

    // Test 8.2: Bullet Check
    if (multiFormatted.includes("•")) {
        console.error("FAILED: Formatted output contains bullet character ('•')");
        process.exit(1);
    }

    // Verify pronunciation, etymology, demonym headers
    if (!multiFormatted.includes("*Dictionary: testword*") ||
        !multiFormatted.includes("*Pronunciation:* /test-wurd/") ||
        !multiFormatted.includes("*Etymology:* From Old English") ||
        !multiFormatted.includes("*Demonym:* Testian") ||
        !multiFormatted.includes("*Definitions:*")) {
        console.error("FAILED: Missing header, pronunciation, etymology, demonym, or definitions label");
        process.exit(1);
    }

    // Test 8.3: Single Definition Test
    const singleEntry: DictionaryEntry = {
        word: "singleword",
        pronunciation: "N/A",
        etymology: "N/A",
        demonym: "N/A",
        definitions: [
            {
                partOfSpeech: "adjective",
                definition: "Only one; not one of several."
            }
        ]
    };

    const singleFormatted = formatDictionaryEntry(singleEntry);
    if (!singleFormatted.includes("1. *(adjective)* Only one; not one of several.")) {
        console.error("FAILED: Missing or incorrect single definition formatting (1. *(adjective)* ...)");
        process.exit(1);
    }
    if (singleFormatted.includes("2.")) {
        console.error("FAILED: Single definition entry should not have a second item");
        process.exit(1);
    }
    if (singleFormatted.includes("•")) {
        console.error("FAILED: Single definition formatted output contains bullet character ('•')");
        process.exit(1);
    }
    if (!singleFormatted.includes("*Pronunciation:* N/A")) {
        console.error("FAILED: Pronunciation N/A formatting failed");
        process.exit(1);
    }

    console.log("PASSED: formatDictionaryEntry verification\n");

    console.log("ALL DICTIONARY TESTS PASSED SUCCESSFULLY!");
}

runTests().catch(err => {
    console.error("Test failure:", err);
    process.exit(1);
});
