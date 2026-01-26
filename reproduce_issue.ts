import { McpClientManager } from './src/features/mcp/client-manager';
import { config } from './src/config';

async function main() {
    const manager = new McpClientManager();
    // Force only open-meteo to be used for this test
    config.mcp.servers = {
        "open-meteo": {
            command: "npx",
            args: ["-y", "open-meteo-mcp-server"]
        }
    };

    try {
        await manager.initialize();
        const tools = await manager.getTools();
        const fs = require('fs');
        fs.writeFileSync('tools_output.json', JSON.stringify(tools, null, 2));
        console.log("Tools written to tools_output.json");
    } catch (e) {
        console.error(e);
    } finally {
        await manager.shutdown();
    }
}

main();
