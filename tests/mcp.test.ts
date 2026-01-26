/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 * Copyright (C) 2025 David Lott
 */

import { getMcpServers } from '../src/config';

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`FAILED: ${message}`);
        process.exit(1);
    }
    console.log(`PASSED: ${message}`);
}

function runTests() {
    console.log("Running MCP Configuration Merging Tests...");

    // 1. Default config (no input)
    const defaults = getMcpServers(undefined);
    assert(!!defaults.dice, "Default 'dice' server should be present");
    assert(!!defaults["open-meteo"], "Default 'open-meteo' server should be present");
    assert(Object.keys(defaults).length === 2, "Should only have 2 default servers");

    // 2. Flat merge
    const flatEnv = JSON.stringify({
        "custom-server": { command: "echo", args: ["hello"] }
    });
    const flatMerged = getMcpServers(flatEnv);
    assert(!!flatMerged.dice, "Flat: Default 'dice' server should be present");
    assert(!!flatMerged["open-meteo"], "Flat: Default 'open-meteo' server should be present");
    assert(!!flatMerged["custom-server"], "Flat: Custom server should be present");
    assert(Object.keys(flatMerged).length === 3, "Flat: Should have 3 servers total");

    // 3. Claude-style wrapper
    const claudeEnv = JSON.stringify({
        mcpServers: {
            "claude-server": { command: "node", args: ["server.js"] }
        },
        otherOption: true
    });
    const claudeMerged: any = getMcpServers(claudeEnv);
    assert(!!claudeMerged.mcpServers, "Claude: mcpServers wrapper should be present");
    assert(!!claudeMerged.mcpServers.dice, "Claude: Default 'dice' server should be in wrapper");
    assert(!!claudeMerged.mcpServers["open-meteo"], "Claude: Default 'open-meteo' server should be in wrapper");
    assert(!!claudeMerged.mcpServers["claude-server"], "Claude: Custom server should be in wrapper");
    assert(claudeMerged.otherOption === true, "Claude: Top-level options should be preserved");

    // 4. Overriding a default
    const overrideEnv = JSON.stringify({
        dice: { url: "https://custom.dice.com" }
    });
    const overrideMerged = getMcpServers(overrideEnv);
    assert(overrideMerged.dice.url === "https://custom.dice.com", "Override: Default server should be overridable");
    assert(!!overrideMerged["open-meteo"], "Override: Other defaults should remain");

    // 5. Invalid JSON
    const invalidMerged = getMcpServers("invalid json");
    assert(!!invalidMerged.dice, "Invalid JSON: Should fall back to defaults");

    console.log("\nAll MCP configuration tests passed!");
}

runTests();
