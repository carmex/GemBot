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

        console.log(`[MCP] Initializing with ${Object.keys(servers).length} potential servers...`);

        for (const [originalName, serverConfig] of Object.entries(servers)) {
            // Normalize name: hyphens to underscores for LLM compatibility
            const name = originalName.replace(/-/g, "_");
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

                console.log(`[MCP] Starting server "${name}" with command: ${serverConfig.command} ${serverConfig.args.join(" ")}`);
                await client.connect(transport);
                this.clients.set(name, client);
                console.log(`[MCP] Connected to server: ${name}${originalName !== name ? ` (from ${originalName})` : ""}`);

                // Discovery logging
                try {
                    const response = await client.listTools();
                    console.log(`[MCP] Registered tools for ${name}: ${response.tools.map(t => t.name).join(", ")}`);
                } catch (toolError) {
                    console.error(`[MCP] Failed to list tools for ${name} during initialization:`, toolError);
                }
            } catch (error) {
                console.error(`[MCP] Failed to connect to server ${originalName}:`, error);
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
        const [requestedServerName, ...toolNameParts] = fullName.split("__");
        const toolName = toolNameParts.join("__");
        
        // Try exact match, then normalized match
        let client = this.clients.get(requestedServerName);
        let serverName = requestedServerName;

        if (!client) {
            const normalizedName = requestedServerName.replace(/-/g, "_");
            client = this.clients.get(normalizedName);
            if (client) {
                serverName = normalizedName;
            }
        }

        if (!client) {
            const availableServers = Array.from(this.clients.keys()).join(", ");
            console.error(`[MCP] Server not found: ${requestedServerName}. Available: ${availableServers}`);
            throw new Error(`MCP server not found: ${requestedServerName}`);
        }

        const isPython = serverName.startsWith('python_interpreter');
        if (isPython) {
            console.log(`[Python Interpreter] Executing tool: ${toolName}`);
            console.log(`[Python Interpreter] Arguments:\n${JSON.stringify(args, null, 2)}`);
        }

        try {
            const result = await client.callTool({
                name: toolName,
                arguments: args
            });

            if (isPython) {
                console.log(`[Python Interpreter] Result:\n${JSON.stringify(result, null, 2)}`);
            }

            return {
                functionResponse: {
                    name: fullName,
                    response: result
                }
            };
        } catch (error) {
            console.error(`[MCP] Error executing tool ${fullName} on server ${serverName}:`, error);
            if (isPython) {
                console.error(`[Python Interpreter] Tool execution failed:`, error);
            }
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
