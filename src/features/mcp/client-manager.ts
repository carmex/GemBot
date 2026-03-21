import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { config } from "../../config";
import { LLMTool } from "../llm/providers/types";
import { Part } from "@google/generative-ai";
import fetch, { Headers, Request, Response } from "node-fetch";

// Polyfill fetch for Node.js
if (!globalThis.fetch) {
    (globalThis as any).fetch = fetch;
    (globalThis as any).Headers = Headers;
    (globalThis as any).Request = Request;
    (globalThis as any).Response = Response;
}

// Polyfill EventSource for SSEClientTransport
const EventSourceModule = require("eventsource");
if (!(globalThis as any).EventSource) {
    (globalThis as any).EventSource = EventSourceModule.EventSource;
}

interface StoredTool extends LLMTool {
    serverName: string;
    originalName: string;
}

export class McpClientManager {
    // Store normalizedName -> Config
    private serverConfigs: Map<string, any> = new Map();
    private tools: StoredTool[] = [];

    constructor() {
        this.loadServerConfigs();
    }

    private loadServerConfigs() {
        this.serverConfigs.clear();
        let rawConfigs: Record<string, any> = {};

        // 1. Load from config.ts
        if (config.mcp && config.mcp.servers) {
            rawConfigs = { ...(config.mcp.servers as any).mcpServers || config.mcp.servers };
        }

        // 2. Load from env var (overrides/adds)
        const envServers = process.env.MCP_SERVERS_JSON;
        if (envServers) {
            try {
                const parsed = JSON.parse(envServers);
                const servers = (parsed as any).mcpServers || parsed;
                rawConfigs = { ...rawConfigs, ...servers };
            } catch (e) {
                console.error('[MCP] Failed to parse MCP_SERVERS_JSON', e);
            }
        }

        // 3. Normalize and store
        for (const [key, value] of Object.entries(rawConfigs)) {
            const normalizedName = key.replace(/-/g, "_");
            this.serverConfigs.set(normalizedName, value);
        }
    }

    private async createClientAndConnect(name: string, serverConfig: any): Promise<{ client: Client; transport: any }> {
        const client = new Client(
            {
                name: "GemBot-MCP-Client",
                version: "1.0.0",
            },
            {
                capabilities: {},
            }
        );

        let transport;
        let transportType = serverConfig.transport;
        if (!transportType && serverConfig.command) {
            transportType = 'stdio';
        }

        if (transportType === 'stdio') {
            transport = new StdioClientTransport({
                command: serverConfig.command,
                args: serverConfig.args || [],
                env: { ...process.env, ...(serverConfig.env || {}) } as Record<string, string>
            });
        } else if (transportType === 'sse') {
            transport = new SSEClientTransport(new URL(serverConfig.url));
        } else {
            // Default to StreamableHTTP, with fallback to SSE (Smart Fallback)
            try {
                const opts: any = {};
                if (serverConfig.headers) {
                    opts.requestInit = { headers: serverConfig.headers };
                }
                transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), opts);
                await client.connect(transport);
                return { client, transport };
            } catch (streamableErr) {
                console.warn(`[MCP] StreamableHTTP failed for ${name}, attempting SSE fallback...`, streamableErr);

                const fallbackClient = new Client(
                    { name: "GemBot-MCP-Fallback", version: "1.0.0" },
                    { capabilities: {} }
                );

                const opts: any = {};
                if (serverConfig.headers) {
                    opts.requestInit = { headers: serverConfig.headers };
                }

                transport = new SSEClientTransport(new URL(serverConfig.url), opts);

                await fallbackClient.connect(transport);
                return { client: fallbackClient, transport };
            }
        }

        // For stdio and explicit sse
        if (!transport) throw new Error(`Unknown transport type or initialization failed for ${name}`);

        await client.connect(transport);
        return { client, transport };
    }

    public async initialize() {
        console.log("[MCP] Initializing MCP Client Manager (On-Demand Mode)...");
        this.loadServerConfigs();
        this.tools = [];

        for (const [name, config] of this.serverConfigs.entries()) {
            if (config.disabled) continue;

            console.log(`[MCP] Discovering tools for ${name}...`);
            let client: Client | null = null;

            try {
                const connection = await this.createClientAndConnect(name, config);
                client = connection.client;

                // List Tools
                const result = await client.listTools();

                const serverTools: StoredTool[] = result.tools.map(t => ({
                    name: `${name}__${t.name}`,
                    description: t.description || "",
                    parameters: t.inputSchema as Record<string, any>,
                    serverName: name,
                    originalName: t.name
                }));

                this.tools.push(...serverTools);
                console.log(`[MCP] Discovered ${serverTools.length} tools from ${name}.`);

            } catch (error) {
                console.error(`[MCP] Failed to discover tools for ${name}:`, error);
                // Fallback for known problematic servers if discovery fails (e.g. Dice)
                if (name === 'dice') {
                    console.log(`[MCP] Adding manual fallback tool for Dice...`);
                    this.tools.push({
                        name: `dice__search_jobs`,
                        originalName: 'search_jobs',
                        serverName: 'dice',
                        description: "Search for jobs on Dice.com. Requires 'keyword'.",
                        parameters: {
                            type: "object",
                            properties: {
                                keyword: { type: "string" },
                                workplace_types: { type: "string", enum: ["Remote", "On-Site", "Hybrid"] },
                                employment_types: { type: "string" }
                            },
                            required: ["keyword"]
                        }
                    });
                }
            } finally {
                // DISCONNECT IMMEDIATELY
                if (client) {
                    try {
                        await client.close();
                        console.log(`[MCP] Disconnected from ${name} (discovery complete).`);
                    } catch (e) {
                        console.warn(`[MCP] Error disconnecting ${name}:`, e);
                    }
                }
            }
        }

        console.log(`[MCP] Initialization complete. Total tools: ${this.tools.length}`);
    }

    public getTools(): LLMTool[] {
        return this.tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
        }));
    }

    public async executeTool(fullName: string, args: any): Promise<Part> {
        console.log(`[MCP] Executing tool: ${fullName} (On-Demand)`);

        const tool = this.tools.find(t => t.name === fullName);
        if (!tool) {
            throw new Error(`Tool definition not found for ${fullName}`);
        }

        const serverName = tool.serverName;
        const config = this.serverConfigs.get(serverName);

        if (!config) {
            throw new Error(`Configuration for server ${serverName} not found`);
        }

        let client: Client | null = null;
        let transport: any = null;

        try {
            // CONNECT
            const connection = await this.createClientAndConnect(serverName, config);
            client = connection.client;
            transport = connection.transport;

            // EXECUTE
            console.log(`[MCP] Calling ${tool.originalName} on ${serverName}...`);
            const result = await client.callTool({
                name: tool.originalName,
                arguments: args
            });

            console.log(`[MCP] Tool response received.`);
            return {
                functionResponse: {
                    name: fullName,
                    response: result
                }
            };

        } catch (error) {
            console.error(`[MCP] Error executing ${fullName}:`, error);
            return {
                functionResponse: {
                    name: fullName,
                    response: { error: (error as Error).message }
                }
            };
        } finally {
            // DISCONNECT
            if (client) {
                try {
                    await client.close();
                    console.log(`[MCP] Disconnected from ${serverName} after execution.`);
                } catch (e) {
                    console.warn(`[MCP] Error disconnecting ${serverName}:`, e);
                }
            }
        }
    }

    public async shutdown() {
        console.log('[MCP] Shutdown called (no persistent connections to close).');
    }
}
