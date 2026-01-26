
import { McpClientManager } from './src/features/mcp/client-manager';
import * as dotenv from 'dotenv';
dotenv.config();

// Mock config if needed, or rely on .env
// We need to ensure we can load the McpClientManager and run it.

async function main() {
    console.log("=== Starting Verification of On-Demand MCP ===");
    const manager = new McpClientManager();

    console.log("\n--- Step 1: Initialization (Discovery) ---");
    await manager.initialize();

    const tools = manager.getTools();
    console.log(`\nDiscovered ${tools.length} tools:`);
    tools.forEach(t => console.log(`- ${t.name} (from ${t.name.split('__')[0]})`));

    if (tools.length === 0) {
        console.error("No tools discovered! Verification Failed.");
        process.exit(1);
    }

    // Pick a tool to test. prefer 'tier_list_remote' tools if available.
    const tierListTool = tools.find(t => t.name.includes('tier_list'));
    const targetTool = tierListTool || tools[0];

    console.log(`\n--- Step 2: Execution (On-Demand) ---`);
    console.log(`Testing tool: ${targetTool.name}`);

    // Create dummy args based on tool
    let args = {};
    if (targetTool.name.includes('generate_tier_list')) {
        args = { topic: 'Fruits', items: ['Apple', 'Banana', 'Orange'] };
    } else if (targetTool.name.includes('search_jobs')) {
        args = { keyword: 'Software Engineer' };
    }

    try {
        const result = await manager.executeTool(targetTool.name, args);
        console.log("\nResult received:", JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("Execution failed:", e);
    }

    console.log("\n=== Verification Complete ===");
}

main().catch(console.error);
