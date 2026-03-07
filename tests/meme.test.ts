/*
 * GemBot: Meme Generator Test Suite
 */

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`FAILED: ${message}`);
        process.exit(1);
    }
    console.log(`PASSED: ${message}`);
}

function parseMemeInput(fullInput: string) {
    const match = fullInput.match(/^(?:"([^"]+)"|(\S+))\s*(.*)$/);
    if (!match) return null;

    const templateSearch = match[1] || match[2];
    const textContent = match[3] || '';
    const texts = textContent.split('|').map(t => t.trim()).filter(t => t.length > 0);

    return { templateSearch, texts };
}

function runTests() {
    console.log("Running Meme Command Parsing Tests...");

    // 1. Simple template with two texts
    const test1 = parseMemeInput("181913642 Top | Bottom");
    assert(test1 !== null, "Test 1: Should parse successfully");
    assert(test1?.templateSearch === "181913642", "Test 1: Template ID should be 181913642");
    assert(test1?.texts.length === 2, "Test 1: Should have 2 text segments");
    assert(test1?.texts[0] === "Top", "Test 1: First text should be 'Top'");
    assert(test1?.texts[1] === "Bottom", "Test 1: Second text should be 'Bottom'");

    // 2. Quoted template name with spaces and multiple panels
    const test2 = parseMemeInput('"distracted boyfriend" New Feature | Me | Existing Bug');
    assert(test2 !== null, "Test 2: Should parse successfully");
    assert(test2?.templateSearch === "distracted boyfriend", "Test 2: Template name should be 'distracted boyfriend'");
    assert(test2?.texts.length === 3, "Test 2: Should have 3 text segments");
    assert(test2?.texts[0] === "New Feature", "Test 2: First text should be 'New Feature'");
    assert(test2?.texts[1] === "Me", "Test 2: Second text should be 'Me'");
    assert(test2?.texts[2] === "Existing Bug", "Test 2: Third text should be 'Existing Bug'");

    // 3. Template name without quotes (single word)
    const test3 = parseMemeInput("doge Much Wow | Very Meme");
    assert(test3 !== null, "Test 3: Should parse successfully");
    assert(test3?.templateSearch === "doge", "Test 3: Template name should be 'doge'");
    assert(test3?.texts.length === 2, "Test 3: Should have 2 text segments");

    // 4. Template with no texts
    const test4 = parseMemeInput("12345");
    assert(test4 !== null, "Test 4: Should parse successfully even with no text content");
    assert(test4?.templateSearch === "12345", "Test 4: Template ID should be 12345");
    assert(test4?.texts.length === 0, "Test 4: Should have 0 text segments");

    // 5. Template with leading/trailing spaces in segments
    const test5 = parseMemeInput('"woman yelling at cat"   Me   |   My Cat   |   The Salad   ');
    assert(test5 !== null, "Test 5: Should parse successfully");
    assert(test5?.texts[0] === "Me", "Test 5: Should trim first segment");
    assert(test5?.texts[1] === "My Cat", "Test 5: Should trim second segment");
    assert(test5?.texts[2] === "The Salad", "Test 5: Should trim third segment");

    console.log("\nAll Meme parsing tests passed!");
}

runTests();
