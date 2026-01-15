import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config } from "../../config";
import { LLMTool } from "../llm/providers/types";
import { Part } from "@google/generative-ai";

export class McpClientManager {
    private clients: Map<string, Client> = new Map();

    async initialize() {
        let servers = config.mcp.servers;
        // Handle Claude-style config format if present
        if ((servers as any).mcpServers) {
            servers = (servers as any).mcpServers;
        }

        for (const [name, serverConfig] of Object.entries(servers)) {
            try {
                const transport = new StdioClientTransport({
                    command: serverConfig.command,
                    args: serverConfig.args,
                    env: { ...process.env, ...(serverConfig.env || {}) } as any
                });

                const client = new Client(
                    {
                        name: "GemBot-MCP-Client",
                        version: "1.0.0",
                    },
                    {
                        capabilities: {}
                    }
                );

                await client.connect(transport);
                this.clients.set(name, client);
                console.log(`[MCP] Connected to server: ${name}`);

                // Discovery logging
                try {
                    const response = await client.listTools();
                    console.log(`[MCP] Registered tools for ${name}: ${response.tools.map(t => t.name).join(", ")}`);
                } catch (toolError) {
                    console.error(`[MCP] Failed to list tools for ${name} during initialization:`, toolError);
                }
            } catch (error) {
                console.error(`[MCP] Failed to connect to server ${name}:`, error);
            }
        }
    }

    async getTools(): Promise<LLMTool[]> {
        const allTools: LLMTool[] = [];
        for (const [serverName, client] of this.clients.entries()) {
            try {
                const response = await client.listTools();
                const mcpTools = response.tools.map(tool => ({
                    name: `${serverName}__${tool.name}`,
                    description: tool.description || "",
                    parameters: tool.inputSchema as Record<string, any>
                }));
                allTools.push(...mcpTools);
            } catch (error) {
                console.error(`[MCP] Failed to list tools for server ${serverName}:`, error);
            }
        }
        return allTools;
    }

    async executeTool(fullName: string, args: any): Promise<Part> {
        const [serverName, ...toolNameParts] = fullName.split("__");
        const toolName = toolNameParts.join("__");
        const client = this.clients.get(serverName);

        if (!client) {
            throw new Error(`MCP server not found: ${serverName}`);
        }

        try {
            const result = await client.callTool({
                name: toolName,
                arguments: args
            });
            return {
                functionResponse: {
                    name: fullName,
                    response: result
                }
            };
        } catch (error) {
            console.error(`[MCP] Error executing tool ${fullName}:`, error);
            return {
                functionResponse: {
                    name: fullName,
                    response: { error: (error as Error).message }
                }
            };
        }
    }

    async shutdown() {
        for (const [name, client] of this.clients.entries()) {
            try {
                await client.close();
                console.log(`[MCP] Disconnected from server: ${name}`);
            } catch (error) {
                console.error(`[MCP] Error closing client ${name}:`, error);
            }
        }
    }
}
