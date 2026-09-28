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

    console.log("\nRunning GIS Mode Command Parsing Tests...");
    const modeRe = /^!gis(?:\s+(mode|upload))?(?:\s+(upload|url|on|off|status))?$/i;
    const gembotGisRe = /^!gembot gis(?:\s+(upload|url|on|off|status))?$/i;

    function parseModeCommand(text: string) {
        const match = modeRe.exec(text);
        if (!match) return null;
        const arg1 = match[1]?.toLowerCase();
        const arg2 = match[2]?.toLowerCase();
        const action = arg2 || arg1;
        return { arg1, arg2, action };
    }

    function parseGembotGisCommand(text: string) {
        const match = gembotGisRe.exec(text);
        if (!match) return null;
        const action = match[1]?.toLowerCase();
        return { action };
    }

    // Mode command: !gis mode upload
    const mTest1 = parseModeCommand("!gis mode upload");
    assert(mTest1 !== null, "Mode Test 1: '!gis mode upload' should match");
    assert(mTest1?.action === "upload", "Mode Test 1: action should be 'upload'");

    // Mode command: !gis upload on
    const mTest2 = parseModeCommand("!gis upload on");
    assert(mTest2 !== null, "Mode Test 2: '!gis upload on' should match");
    assert(mTest2?.action === "on", "Mode Test 2: action should be 'on'");

    // Mode command: !gis mode url
    const mTest3 = parseModeCommand("!gis mode url");
    assert(mTest3 !== null, "Mode Test 3: '!gis mode url' should match");
    assert(mTest3?.action === "url", "Mode Test 3: action should be 'url'");

    // Mode command: !gis upload off
    const mTest4 = parseModeCommand("!gis upload off");
    assert(mTest4 !== null, "Mode Test 4: '!gis upload off' should match");
    assert(mTest4?.action === "off", "Mode Test 4: action should be 'off'");

    // Mode command: !gis mode
    const mTest5 = parseModeCommand("!gis mode");
    assert(mTest5 !== null, "Mode Test 5: '!gis mode' should match");
    assert(mTest5?.action === "mode", "Mode Test 5: action should be 'mode'");

    // Mode command: !gis status
    const mTest6 = parseModeCommand("!gis status");
    assert(mTest6 !== null, "Mode Test 6: '!gis status' should match");
    assert(mTest6?.action === "status", "Mode Test 6: action should be 'status'");

    // Mode command: !gis
    const mTest7 = parseModeCommand("!gis");
    assert(mTest7 !== null, "Mode Test 7: '!gis' should match");
    assert(mTest7?.action === undefined, "Mode Test 7: action should be undefined");

    // Mode command: !gis upload
    const mTest8 = parseModeCommand("!gis upload");
    assert(mTest8 !== null, "Mode Test 8: '!gis upload' should match");
    assert(mTest8?.action === "upload", "Mode Test 8: action should be 'upload'");

    // Gembot command: !gembot gis upload
    const gTest1 = parseGembotGisCommand("!gembot gis upload");
    assert(gTest1 !== null, "Gembot Test 1: '!gembot gis upload' should match");
    assert(gTest1?.action === "upload", "Gembot Test 1: action should be 'upload'");

    // Gembot command: !gembot gis url
    const gTest2 = parseGembotGisCommand("!gembot gis url");
    assert(gTest2 !== null, "Gembot Test 2: '!gembot gis url' should match");
    assert(gTest2?.action === "url", "Gembot Test 2: action should be 'url'");

    // Gembot command: !gembot gis on
    const gTest3 = parseGembotGisCommand("!gembot gis on");
    assert(gTest3 !== null, "Gembot Test 3: '!gembot gis on' should match");
    assert(gTest3?.action === "on", "Gembot Test 3: action should be 'on'");

    // Gembot command: !gembot gis off
    const gTest4 = parseGembotGisCommand("!gembot gis off");
    assert(gTest4 !== null, "Gembot Test 4: '!gembot gis off' should match");
    assert(gTest4?.action === "off", "Gembot Test 4: action should be 'off'");

    // Gembot command: !gembot gis status
    const gTest5 = parseGembotGisCommand("!gembot gis status");
    assert(gTest5 !== null, "Gembot Test 5: '!gembot gis status' should match");
    assert(gTest5?.action === "status", "Gembot Test 5: action should be 'status'");

    // Gembot command: !gembot gis
    const gTest6 = parseGembotGisCommand("!gembot gis");
    assert(gTest6 !== null, "Gembot Test 6: '!gembot gis' should match");
    assert(gTest6?.action === undefined, "Gembot Test 6: action should be undefined");

    // Non-matching validation
    assert(re.test("!gis mode upload") === false, "Search regex should NOT match '!gis mode upload'");
    assert(re.test("!gis status") === false, "Search regex should NOT match '!gis status'");
    assert(re.test("!gembot gis upload") === false, "Search regex should NOT match '!gembot gis upload'");
    assert(modeRe.test("gis cute cat") === false, "Mode regex should NOT match search query 'gis cute cat'");
    assert(modeRe.test("!gis random query here") === false, "Mode regex should NOT match invalid '!gis random query here'");

    console.log("\nAll GIS tests passed!");
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
