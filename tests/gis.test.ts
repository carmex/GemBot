/*
 * GemBot: GIS Command Test Suite
 */

const re = /^gis([gtiaml])?(\d+)? (.+)/i;

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`FAILED: ${message}`);
        throw new Error(`Test failed: ${message}`);
    }
    console.log(`PASSED: ${message}`);
}

function parseGisInput(messageText: string) {
    const match = re.exec(messageText);
    if (!match) return null;

    const mod = match[1];
    const idxStr = match[2];
    const search = (match[3] ?? '').trim();
    const index = idxStr ? parseInt(idxStr, 10) : 1;

    const modSuffix = {
        undefined: '',
        'g': ' girls',
        't': ' then and now',
        'i': ' infographic',
        'a': ' animated gif',
        'm': ' meme',
        'l': ' sexy ladies',
    }[String(mod).toLowerCase()];

    const query = `${search}${modSuffix}`;

    return { mod, index, search, query };
}

async function runTests() {
    console.log("Running GIS Command Parsing Tests...");

    // 1. Simple gis command
    const test1 = parseGisInput("gis cat");
    assert(test1 !== null, "Test 1: Should parse successfully");
    assert(test1?.mod === undefined, "Test 1: mod should be undefined");
    assert(test1?.index === 1, "Test 1: index should be 1");
    assert(test1?.search === "cat", "Test 1: search should be 'cat'");
    assert(test1?.query === "cat", "Test 1: query should be 'cat'");

    // 2. gis with mod 'a'
    const test2 = parseGisInput("gisa dancing");
    assert(test2 !== null, "Test 2: Should parse successfully");
    assert(test2?.mod === 'a', "Test 2: mod should be 'a'");
    assert(test2?.index === 1, "Test 2: index should be 1");
    assert(test2?.search === "dancing", "Test 2: search should be 'dancing'");
    assert(test2?.query === "dancing animated gif", "Test 2: query should be 'dancing animated gif'");

    // 3. gis with index
    const test3 = parseGisInput("gis5 mountains");
    assert(test3 !== null, "Test 3: Should parse successfully");
    assert(test3?.mod === undefined, "Test 3: mod should be undefined");
    assert(test3?.index === 5, "Test 3: index should be 5");
    assert(test3?.search === "mountains", "Test 3: search should be 'mountains'");
    assert(test3?.query === "mountains", "Test 3: query should be 'mountains'");

    // 4. gis with mod 'l' and index
    const test4 = parseGisInput("gisl3 beach");
    assert(test4 !== null, "Test 4: Should parse successfully");
    assert(test4?.mod === 'l', "Test 4: mod should be 'l'");
    assert(test4?.index === 3, "Test 4: index should be 3");
    assert(test4?.search === "beach", "Test 4: search should be 'beach'");
    assert(test4?.query === "beach sexy ladies", "Test 4: query should be 'beach sexy ladies'");

    // 5. Case insensitive
    const test5 = parseGisInput("GISM2 funny dog");
    assert(test5 !== null, "Test 5: Should parse successfully");
    assert(test5?.mod?.toLowerCase() === 'm', "Test 5: mod should be 'm'");
    assert(test5?.index === 2, "Test 5: index should be 2");
    assert(test5?.search === "funny dog", "Test 5: search should be 'funny dog'");
    assert(test5?.query === "funny dog meme", "Test 5: query should be 'funny dog meme'");

    // 6. Multi-word search
    const test6 = parseGisInput("gis red formula 1 car");
    assert(test6 !== null, "Test 6: Should parse successfully");
    assert(test6?.search === "red formula 1 car", "Test 6: search should be 'red formula 1 car'");

    console.log("\nAll GIS tests passed!");
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
