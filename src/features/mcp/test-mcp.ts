
import { McpClientManager } from "./client-manager";
import { config } from "../../config";

async function test() {
    console.log("Testing MCP Client Manager...");
    
    // Mock config with Claude-style wrapper
    (config as any).mcp = {
        servers: {
            mcpServers: {
                "echo_server": {
                    command: "node",
                    args: ["-e", `
                        const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
                        const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
                        const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");

                        const server = new Server({ name: "echo", version: "1.0.0" }, { capabilities: { tools: {} } });
                        server.setRequestHandler(ListToolsRequestSchema, async () => ({
                            tools: [{ name: "echo", description: "Echoes input", inputSchema: { type: "object", properties: { message: { type: "string" } } } }]
                        }));
                        server.setRequestHandler(CallToolRequestSchema, async (request) => ({
                            content: [{ type: "text", text: "Echo: " + request.params.arguments.message }]
                        }));
                        const transport = new StdioServerTransport();
                        server.connect(transport).catch(console.error);
                    `]
                }
            }
        }
    };

    const manager = new McpClientManager();
    await manager.initialize();

    const tools = await manager.getTools();
    console.log("Tools found:", JSON.stringify(tools, null, 2));

    if (tools.length > 0) {
        const result = await manager.executeTool(tools[0].name, { message: "Hello MCP!" });
        console.log("Tool execution result:", JSON.stringify(result, null, 2));
    }

    await manager.shutdown();
    console.log("Test complete.");
}

test().catch(console.error);
