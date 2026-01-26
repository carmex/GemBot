/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 * Copyright (C) 2025 David Lott
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { App, SayFn } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { ImageGenerator } from './image-generator';
import { Summarizer } from './summarizer';
import { registerWatchlistCommands } from '../commands/watchlist';
import { registerFinancialCommands } from '../commands/financial';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { getJson as getSerpJson } from 'serpapi';
import {
    initUsageDb,
    trackImageInvocation,
    trackLlmInteraction,
    getUserUsage,
    getAllUserUsage,
} from './usage-db';
import { initializeThreadDatabase } from './thread-db';
import { initializeMarketDataDatabase } from './market-data-db';
import { config } from '../config';
import { createProvider } from './llm/provider-factory';
import { HistoryBuilder } from './history-builder';
import { executeTool } from './tool-executor';
import { markdownToSlack } from './utils';
import { Content, Part } from '@google/generative-ai';
import { LLMMessage, LLMTool, LLMToolCall } from './llm/providers/types';
import { registerEventListeners } from '../listeners/events';
import { registerCommandListeners } from '../listeners/commands';
import { McpClientManager } from './mcp/client-manager';

export interface AIResponse {
    text: string;
    confidence: number;
    totalTokens?: number;
}

export class AIHandler {
    public app: App;
    public auth: GoogleAuth;
    public disabledThreads: Set<string> = new Set();
    public enabledChannels: Set<string> = new Set();
    public rpgEnabledChannels: Map<string, string> = new Map();
    public geminiSystemPrompt: string;
    public rpgGmSystemPrompt: string;
    public rpgPlayerSystemPrompt: string;
    public summarizationSystemPrompt: string;
    public disabledThreadsFilePath: string;
    public enabledChannelsFilePath: string;
    public rpgEnabledChannelsFilePath: string;
    public lastWarningTimestamp: Map<string, number> = new Map();
    private provider = createProvider();
    private threadSummariesFilePath: string;
    private summarizer?: Summarizer;
    private imageGenerator?: ImageGenerator;
    public mcpClientManager: McpClientManager;

    public historyBuilder?: HistoryBuilder;

    constructor(app: App) {
        this.app = app;
        this.auth = new GoogleAuth({
            scopes: 'https://www.googleapis.com/auth/cloud-platform',
        });

        this.mcpClientManager = new McpClientManager();
        this.mcpClientManager.initialize().catch(err => {
            console.error('[MCP] Error initializing MCP Client Manager:', err);
        });

        this.disabledThreadsFilePath = path.join(__dirname, '../../disabled-threads.json');
        this.enabledChannelsFilePath = path.join(__dirname, '../../enabled-channels.json');
        this.rpgEnabledChannelsFilePath = path.join(__dirname, '../../rpg-enabled-channels.json');
        this.threadSummariesFilePath = path.join(__dirname, '../../thread-summaries.json');

        const promptFilePath = path.join(__dirname, '../prompts/gemini-system-prompt.txt');
        try {
            this.geminiSystemPrompt = fs.readFileSync(promptFilePath, 'utf-8');
        } catch (e) {
            console.error('Error reading Gemini system prompt file:', e);
            this.geminiSystemPrompt = 'You are a helpful assistant.';
        }

        const rpgGmPromptFilePath = path.join(__dirname, '../prompts/gemini-rpg-gm-system-prompt.txt');
        try {
            this.rpgGmSystemPrompt = fs.readFileSync(rpgGmPromptFilePath, 'utf-8');
        } catch (e) {
            console.error('Error reading RPG GM system prompt file:', e);
            this.rpgGmSystemPrompt = '';
        }

        const rpgPlayerPromptFilePath = path.join(__dirname, '../prompts/gemini-rpg-player-system-prompt.txt');
        try {
            this.rpgPlayerSystemPrompt = fs.readFileSync(rpgPlayerPromptFilePath, 'utf-8');
        } catch (e) {
            console.error('Error reading RPG Player system prompt file:', e);
            this.rpgPlayerSystemPrompt = '';
        }

        const summarizationPromptFilePath = path.join(__dirname, '../prompts/summarization-system-prompt.txt');
        try {
            this.summarizationSystemPrompt = fs.readFileSync(summarizationPromptFilePath, 'utf-8');
        } catch (e) {
            console.error('Error reading summarization system prompt file:', e);
            this.summarizationSystemPrompt = 'Please provide a concise summary of the following conversation.';
        }

        this.summarizer = new Summarizer(this.provider, config, this.threadSummariesFilePath, this.summarizationSystemPrompt);

        this.initializeListeners();
        this.loadEnabledChannels();
        this.loadDisabledThreads();
        this.loadRpgEnabledChannels();
        initUsageDb();
        initializeThreadDatabase();
        initializeMarketDataDatabase();

        this.imageGenerator = new ImageGenerator(this.app, this.auth);

        this.historyBuilder = new HistoryBuilder(this.app, this.imageGenerator, this.summarizer, config);
    }

    public async generateImage(prompt: string): Promise<{ imageBase64?: string; filteredReason?: string }> {
        return this.imageGenerator!.generateImage(prompt);
    }

    public async processImage(fileUrl: string, mimeType: string): Promise<Part> {
        return this.imageGenerator!.processImagePublic(fileUrl, mimeType);
    }

    public loadThreadSummary(threadId: string): any {
        return this.summarizer!.loadThreadSummary(threadId);
    }

    public saveThreadSummary(threadId: string, summary: string, metadata: any = {}): void {
        this.summarizer!.saveThreadSummary(threadId, summary, metadata);
    }

    public async summarizeConversation(messages: Content[], threadId: string): Promise<string> {
        return this.summarizer!.summarizeConversation(messages, threadId);
    }

    private initializeListeners(): void {
        registerWatchlistCommands(this.app);
        registerFinancialCommands(this.app);
        registerEventListeners(this.app, this);
        registerCommandListeners(this.app, this);
    }


    // Helper to strip scaffolding and meta-instructions from any text before sending to provider or Slack
    private sanitizeNarrative(text: string): string {
        if (!text) return '';
        let out = text;
        // Remove our internal history scaffolding if present
        out = out.replace(/^(?:channel_id:\s*\S+\s*|\s*user_id:\s*\S+\s*|\s*message:\s*)/im, '');
        // Remove tool tags and fenced json blocks or inline tool json blobs
        out = out
            .replace(/\s*\[(?:END_)?TOOL_(?:REQUEST|RESULT)\]\s*/gi, '')
            .replace(/```json\s*[\s\S]*?```/gi, '')
            .replace(/{[^\{\}]*"name"\s*:\s*"[^"]*"\s*,[^\{\}]*"arguments"\s*:\s*{[\s\S]*?}}/g, '');
        // Remove obvious leaked meta-instructions
        out = out.replace(/^\s*You are now in RPG mode.*$/gim, '');
        out = out.replace(/^\s*Act as Game Master.*$/gim, '');
        out = out.replace(/^\s*I will act as the Game Master.*$/gim, '');
        out = out.replace(/^\s*Here's an overview of how to interact with me:.*$/gim, '');
        // Trim extra newlines
        out = out.replace(/\n{3,}/g, '\n\n');
        return out.trim();
    }

    public async processAIQuestion(question: string | Part[], history: Content[], channelId: string, threadTs?: string): Promise<AIResponse> {

        let retries = 3;
        while (retries > 0) {
            try {
                let systemPrompt = this.geminiSystemPrompt;
                const rpgMode = this.rpgEnabledChannels.get(channelId);

                // Include thread summary in system prompt if available
                if (threadTs) {
                    const threadSummary = this.summarizer!.loadThreadSummary(threadTs);
                    if (threadSummary) {
                        systemPrompt = `${systemPrompt}\n\n**Previous Conversation Summary:**\n${threadSummary.summary}`;
                    }
                }

                if (rpgMode === 'gm') {
                    const rpgContext = this.loadRpgContext(channelId);
                    const rpgPrompt = `\n\n**RPG GM Mode Instructions**\n\nYour instructions for this interaction are to act as the Game Master. Please use the following context:\n${JSON.stringify(rpgContext, null, 2)}`;
                    systemPrompt = `${this.rpgGmSystemPrompt}\n\n${systemPrompt}\n\n${rpgPrompt}`;
                } else if (rpgMode === 'player') {
                    const rpgContext = this.loadRpgContext(channelId);
                    const rpgPrompt = `\n\n**RPG Player Mode Instructions**\n\nYour instructions for this interaction are to act as the Player Character. Please use the following character sheet:\n${JSON.stringify(rpgContext, null, 2)}`;
                    systemPrompt = `${this.rpgPlayerSystemPrompt}\n\n${systemPrompt}\n\n${rpgPrompt}`;
                }

                // Define tools (provider-agnostic)
                const tools: LLMTool[] = [];

                const slackTool: LLMTool = {
                    name: "slack_user_profile",
                    description: "Fetches a user's profile information from Slack, such as their name, email, and title.",
                    parameters: {
                        type: "object",
                        properties: {
                            user_id: {
                                type: "string",
                                description: "The Slack user ID (e.g., U12345) of the user to look up.",
                            },
                        },
                        required: ["user_id"],
                    },
                };

                const webTool: LLMTool = {
                    name: "fetch_url_content",
                    description: "Fetches the textual content from a given URL. Useful for reading the content of a search result link.",
                    parameters: {
                        type: "object",
                        properties: {
                            url: {
                                type: "string",
                                description: "The full URL (including http/https) of the page to fetch.",
                            },
                        },
                        required: ["url"],
                    },
                };

                const imageTool: LLMTool = {
                    name: "generate_image",
                    description: "Call this tool to generate an image from a text prompt.",
                    parameters: {
                        type: "object",
                        properties: {
                            prompt: {
                                type: "string",
                                description: "A detailed, descriptive English prompt for the image generation model. Be specific about the subject, style, colors, and composition.",
                            },
                        },
                        required: ["prompt"],
                    },
                };

                const searchTool: LLMTool = {
                    name: "web_search",
                    description: "Use this tool to perform a Google search to find up-to-date information or to answer questions about topics you don't know about. It returns a list of search results with titles, snippets, and links. Workflow: For complex questions, first use web_search. Then review the results and optionally call fetch_url_content for promising sources. Always cite sources.",
                    parameters: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "The search query",
                            },
                        },
                        required: ["query"],
                    },
                };

                const updateRpgContextTool: LLMTool = {
                    name: "update_rpg_context",
                    description: "Updates the JSON context for the RPG channel. Use whenever game state changes.",
                    parameters: {
                        type: "object",
                        properties: {
                            context: {
                                type: "object",
                                properties: {},
                            },
                        },
                        required: ["context"],
                    },
                };

                tools.push(slackTool, webTool, imageTool);
                const searchProvider = config.search.provider;
                if ((searchProvider === 'serpapi' && config.search.serpapiApiKey) || (searchProvider === 'google' && config.search.googleApiKey && config.search.googleCxId)) {
                    tools.push(searchTool);
                }
                if (rpgMode === 'gm') {
                    tools.push(updateRpgContextTool);
                }

                // Add MCP tools
                try {
                    const mcpTools = await this.mcpClientManager.getTools();
                    tools.push(...mcpTools);
                } catch (err) {
                    console.error('[MCP] Error fetching tools from MCP Client Manager:', err);
                }

                // Convert Slack history to provider-agnostic history (text-only fallback)
                const genericHistory: LLMMessage[] = (history || []).map((h: any) => {
                    const raw = (h.parts?.[0]?.text) || '';
                    if (h.role === 'user') {
                        // Strictly strip scaffolding; keep only human message
                        const cleaned = raw.replace(/^channel_id:\s*\S+\s*\|\s*user_id:\s*\S+\s*\|\s*message:\s*/, '').trim();
                        return { role: 'user', content: cleaned };
                    } else {
                        const dateTimeString = new Date().toLocaleString('en-US', {
                            timeZone: 'America/New_York',
                            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                            hour: 'numeric', minute: 'numeric', second: 'numeric', timeZoneName: 'short'
                        });
                        // Add strong guardrails to prevent ignoring RPG context and to avoid inventing unrelated campaigns
                        const systemGuard = `
You must follow the provided RPG context strictly. Do NOT introduce unrelated campaigns, quests, or settings.
If the user asks for a summary or current state, base it ONLY on the saved RPG context and the recent conversation, not on invented scenarios.
`;
                        // For assistant messages, we might want to keep them as is or format them
                        return { role: 'assistant', content: raw };
                    }
                });

                // Prepare history for provider
                const historyForProvider = history;
                const finalPrompt = systemPrompt;

                let currentResponse: any;
                let finalNarrative = '';
                let iteration = 0;
                const maxIterations = 10;
                let totalTokens = 0;

                // Initial call
                try {
                    if (historyForProvider === history) {
                        const imageCount = history.reduce((acc, h) => acc + (h.parts?.filter(p => p.inlineData)?.length || 0), 0);
                        console.log(`[Debug - LLM - Send] Content[] history has ${imageCount} image parts total`);
                        history.forEach((h, idx) => {
                            const imgCount = h.parts?.filter(p => p.inlineData)?.length || 0;
                            if (imgCount > 0) {
                                console.log(`[Debug - LLM - Send] History entry ${idx} (${h.role}): ${imgCount} image(s), text: ${!!h.parts?.some(p => p.text)} `);
                            }
                        });
                    }
                    currentResponse = await this.provider.chat(question, {
                        systemPrompt: finalPrompt,
                        tools,
                        history: historyForProvider,
                    });
                    totalTokens += currentResponse.usage?.totalTokens || 0;
                } catch (err) {
                    throw err;
                }

                // Detailed logging of provider result toolCalls
                const toolCallsLen = currentResponse?.toolCalls ? currentResponse.toolCalls.length : 0;
                if ((!currentResponse.toolCalls || currentResponse.toolCalls.length === 0) && (currentResponse.text && (currentResponse.text as string).length > 0)) {
                    const preview = (currentResponse.text as string).slice(0, 600);
                }

                // Recursive tool handling loop
                while (currentResponse.toolCalls && currentResponse.toolCalls.length > 0 && iteration < maxIterations) {
                    iteration++;

                    const toolCallsLen = currentResponse?.toolCalls ? currentResponse.toolCalls.length : 0;
                    console.log(`[Debug] Iteration ${iteration}: toolCalls = ${toolCallsLen} `);

                    const toolCalls = currentResponse.toolCalls;

                    // Execute calls sequentially
                    const toolResponses: Part[] = [];
                    for (const tc of toolCalls) {
                        try {
                            const resp = await this.executeTool(tc.name, tc.arguments, channelId, threadTs);
                            if (tc.id && resp.functionResponse) {
                                (resp.functionResponse as any).id = tc.id;
                            }
                            toolResponses.push(resp);
                        } catch (e) {
                            console.error(`[Tool] Error executing ${tc.name}: `, e);
                            const errResp: any = { functionResponse: { name: tc.name, response: { error: (e as Error).message } } };
                            if (tc.id) {
                                errResp.functionResponse.id = tc.id;
                            }
                            toolResponses.push(errResp);
                        }
                    }

                    // Log web_search results sent to the model
                    for (const tr of toolResponses) {
                        if (tr.functionResponse?.name === 'web_search') {
                            console.log(`[WebSearch Results to Model] ${JSON.stringify(tr.functionResponse.response, null, 2)} `);
                        }
                    }

                    // Detect special cases
                    const calledNames = (toolCalls as Array<{ name: string; arguments: any }>).map((c) => c.name);
                    const calledGenerateImage = calledNames.includes('generate_image');
                    const calledUpdateRpg = calledNames.includes('update_rpg_context');
                    const hasFetchUrl = calledNames.includes('fetch_url_content');
                    const hasSearch = calledNames.includes('web_search');
                    const hasSlackProfile = calledNames.includes('slack_user_profile');

                    if (!hasFetchUrl && !hasSearch && !hasSlackProfile && (calledGenerateImage || calledUpdateRpg)) {
                        let msg: string[] = [];
                        if (calledUpdateRpg) msg.push('game state updated');
                        if (calledGenerateImage) msg.push('image request submitted');
                        const narrative = (currentResponse.text || '').trim();
                        const confirmation = narrative
                            ? `Acknowledged: ${msg.join(' and ')}.\n\n${narrative} `
                            : `Acknowledged: ${msg.join(' and ')}.`;
                        return { text: confirmation, confidence: 1.0, totalTokens: totalTokens };
                    }

                    // Handle fetch_url_content summarization
                    const fetchUrlResponse = toolResponses.find(r => (r as any).functionResponse?.name === 'fetch_url_content');
                    if (fetchUrlResponse && !(fetchUrlResponse as any).functionResponse.response.error) {
                        console.log(`[Debug] fetch_url_content detected in iteration ${iteration}; entering summarization pipeline`);
                        const responseBody = (fetchUrlResponse as any).functionResponse.response;

                        const fetchedContent = responseBody.content;
                        if (!fetchedContent) {
                            console.warn(`[Debug] fetch_url_content returned no content and no error.`);
                            finalNarrative += `\n\n[System: Failed to fetch URL content. No content returned.]\n\n`;
                            break;
                        }

                        const summary = await this.summarizer!.summarizeText(fetchedContent, typeof question === 'string' ? question : 'Image analysis request');
                        finalNarrative += (summary || '').trim() + '\n\n';

                        // Break out of the loop after handling fetch_url_content to prevent infinite loops
                        console.log(`[Debug] fetch_url_content summarization completed, breaking out of tool loop`);
                        break;
                    } else {
                        // Add narrative and tool results to history
                        const narrativePrefix = (currentResponse.text || '').trim();
                        // Need to reconstruct the turn history:
                        // 1. The user's question (only if it's the first iteration and not already in history)
                        if (iteration === 1) {
                            if (typeof question === 'string') {
                                (historyForProvider as Content[]).push({ role: 'user', parts: [{ text: question }] });
                            } else {
                                (historyForProvider as Content[]).push({ role: 'user', parts: question });
                            }
                        }

                        // 2. The model's response (which triggered the tools)
                        const modelParts: Part[] = [];
                        if (narrativePrefix) {
                            modelParts.push({ text: narrativePrefix });
                        }
                        if (toolCalls && toolCalls.length > 0) {
                            toolCalls.forEach((tc: LLMToolCall) => {
                                modelParts.push({ functionCall: { name: tc.name, args: tc.arguments } });
                            });
                        }
                        (historyForProvider as Content[]).push({ role: 'model', parts: modelParts });

                        // 3. The tool responses (function role)
                        (historyForProvider as Content[]).push(
                            ...toolResponses.map((tr: any) => ({
                                role: 'function',
                                parts: [tr] // tr is { functionResponse: ... }
                            } as unknown as Content))
                        );

                        // Follow-up call
                        try {
                            currentResponse = await this.provider.chat('', {
                                systemPrompt: finalPrompt,
                                tools,
                                history: historyForProvider,
                            });
                            totalTokens += currentResponse.usage?.totalTokens || 0;
                        } catch (e) {
                            console.error(`[Debug] provider.chat iteration ${iteration} threw: `, e);
                            throw e;
                        }
                    }
                }

                if (iteration >= maxIterations) {
                    console.warn(`[ToolLoop] Max iterations(${maxIterations}) reached; forcing final response`);
                }

                // Final response
                let out = currentResponse?.text || finalNarrative || '';

                if (currentResponse?.usage) {
                    //trackLlmInteraction(userId, currentResponse.usage);
                }

                // Inline tool fallback on final out
                let cleanFinal = out;
                const inlineToolRegex = /{[^{}]*"name"\s*:\s*"([^"]+)"\s*,[^{}]*"arguments"\s*:\s*({[\s\S]*?})\s*}/g;
                const detectedCalls: Array<{ name: string; args: any; span: [number, number] }> = [];
                let m: RegExpExecArray | null;
                while ((m = inlineToolRegex.exec(cleanFinal as string)) !== null) {
                    const name = m[1];
                    let args: any = {};
                    try { args = JSON.parse(m[2]); } catch { args = {}; }
                    detectedCalls.push({ name, args, span: [m.index, m.index + m[0].length] });
                }

                if (detectedCalls.length > 0) {
                    const toolResponses: Part[] = [];
                    for (const call of detectedCalls) {
                        try {
                            const resp = await this.executeTool(call.name, call.args, channelId, threadTs);
                            toolResponses.push(resp);
                        } catch (e) {
                            console.error(`[Tool - Fallback] Tool execution failed: `, e);
                            toolResponses.push({ functionResponse: { name: call.name, response: { error: (e as Error).message } } });
                        }
                    }

                    // Strip inline JSON
                    if (detectedCalls.length > 0) {
                        let rebuilt = '';
                        let last = 0;
                        for (const { span: [start, end] } of detectedCalls) {
                            rebuilt += (cleanFinal as string).slice(last, start);
                            last = end;
                        }
                        rebuilt += (cleanFinal as string).slice(last);
                        cleanFinal = rebuilt;
                    }
                }

                // Final cleanup
                cleanFinal = cleanFinal
                    .replace(/\[(?:END_)?TOOL_(?:REQUEST|RESULT)\]/gi, '')
                    .replace(/```json\s * [\s\S] *? ```/gi, '')
                    .replace(/{[^{}]*"name"\s*:\s*"[^"]+"\s*,[^{}]*"arguments"\s*:\s*{[\s\S]*?}}/g, '')
                    .replace(/^(?:channel_id:\s*\S+\s*\|\s*user_id:\s*\S+\s*\|\s*message:\s*)/i, '')
                    .replace(/^\s*You are now in RPG mode.*$/gim, '')
                    .replace(/^\s*Act as Game Master.*$/gim, '')
                    .replace(/^\s*Here's an overview of how to interact with me:.*$/gim, '')
                    .trim();

                // Apply Slack-specific formatting safety net
                cleanFinal = markdownToSlack(cleanFinal);

                const confidence = iteration > 0 ? 0.9 : 0.8;

                return {
                    text: cleanFinal,
                    confidence,
                    totalTokens,
                };

            } catch (error) {
                console.error(`Retry ${3 - retries} failed: `, error);
                retries--;
                if (retries === 0) {

                    return {
                        text: "I'm sorry, I encountered a persistent error while generating a response. Please try again later.",
                        confidence: 0
                    };
                }
            }
        }

        return { text: "I'm sorry, I encountered a persistent error while generating a response. Please try again later.", confidence: 0 };
    }

    public async executeTool(name: string, args: any, channelId: string, threadTs?: string): Promise<Part> {
        if (name.includes('__')) {
            // Check if it's the python interpreter
            if (name.startsWith('python_interpreter')) {
                const code = args.code || args.python_code || args.script;
                if (code) {
                    try {
                        console.log(`[Python] Uploading code snippet to Slack channel ${channelId}...`);
                        await this.app.client.files.uploadV2({
                            content: code,
                            filename: 'generated_code.py',
                            channel_id: channelId,
                            thread_ts: threadTs,
                            initial_comment: '_Executing generated Python code:_'
                        });
                    } catch (uploadError) {
                        console.error('[Python] Failed to upload code snippet to Slack:', uploadError);
                    }
                }
            }

            // Dice feedback
            if (name.startsWith('dice__')) {
                const query = args.query || args.keywords || args.job_title || args.q || '';
                const feedbackMsg = query ? `_searching Dice for "${query}" jobs..._` : `_searching Dice for tech jobs..._`;
                try {
                    await this.app.client.chat.postMessage({
                        channel: channelId,
                        thread_ts: threadTs,
                        text: feedbackMsg
                    });
                } catch (err) {
                    console.error('[Dice] Failed to post feedback message:', err);
                }
            }

            // Open-Meteo feedback
            if (name.startsWith('open_meteo__')) {
                const feedbackMsg = `_looking up weather information..._`;
                try {
                    await this.app.client.chat.postMessage({
                        channel: channelId,
                        thread_ts: threadTs,
                        text: feedbackMsg
                    });
                } catch (err) {
                    console.error('[Open-Meteo] Failed to post feedback message:', err);
                }
            }

            const toolResult = await this.mcpClientManager.executeTool(name, args);

            // Check for image content in the tool result
            if (toolResult.functionResponse && toolResult.functionResponse.response) {
                const response = toolResult.functionResponse.response as any;
                if (response.content && Array.isArray(response.content)) {
                    for (const part of response.content) {
                        if (part.type === 'image' && part.data) {
                            try {
                                const buffer = Buffer.from(part.data, 'base64');
                                console.log(`[MCP] Uploading tool-generated image to Slack channel ${channelId}...`);
                                await this.app.client.files.uploadV2({
                                    file: buffer,
                                    filename: 'generated_image.png',
                                    channel_id: channelId,
                                    thread_ts: threadTs,
                                    initial_comment: `_Generated by tool ${name}:_`
                                });
                                // Replace the image data with a placeholder to save context and avoid LLM hallucination
                                part.data = "[Image uploaded to Slack channel]";
                            } catch (uploadError) {
                                console.error('[MCP] Failed to upload tool image to Slack:', uploadError);
                            }
                        }
                    }
                }
            }

            return toolResult;
        }
        return executeTool(this.app, this.imageGenerator, name, args, channelId, threadTs);
    }

    public loadDisabledThreads(): void {
        try {
            if (fs.existsSync(this.disabledThreadsFilePath)) {
                const data = fs.readFileSync(this.disabledThreadsFilePath, 'utf-8');
                const threadsArray = JSON.parse(data) as string[];
                this.disabledThreads = new Set(threadsArray);
            }
        } catch (error) {
            console.error('Error loading disabled threads file:', error);
        }
    }

    public saveDisabledThreads(): void {
        try {
            const threadsArray = Array.from(this.disabledThreads);
            fs.writeFileSync(this.disabledThreadsFilePath, JSON.stringify(threadsArray, null, 2), 'utf-8');
        } catch (error) {
            console.error('Error saving disabled threads file:', error);
        }
    }

    public loadEnabledChannels(): void {
        try {
            if (fs.existsSync(this.enabledChannelsFilePath)) {
                const data = fs.readFileSync(this.enabledChannelsFilePath, 'utf-8');
                const channelsArray = JSON.parse(data) as string[];
                this.enabledChannels = new Set(channelsArray);
            }
        } catch (error) {
            console.error('Error loading enabled channels file:', error);
        }
    }

    public saveEnabledChannels(): void {
        try {
            const channelsArray = Array.from(this.enabledChannels);
            fs.writeFileSync(this.enabledChannelsFilePath, JSON.stringify(channelsArray, null, 2), 'utf-8');
        } catch (error) {
            console.error('Error saving enabled channels file:', error);
        }
    }

    public loadRpgEnabledChannels(): void {
        try {
            if (fs.existsSync(this.rpgEnabledChannelsFilePath)) {
                const data = fs.readFileSync(this.rpgEnabledChannelsFilePath, 'utf-8');
                const channels: [string, string][] = JSON.parse(data);
                this.rpgEnabledChannels = new Map(channels);
            }
        } catch (error) {
            console.error('Error loading RPG-enabled channels file:', error);
        }
    }

    public saveRpgEnabledChannels(): void {
        try {
            const data = JSON.stringify(Array.from(this.rpgEnabledChannels.entries()), null, 2);
            fs.writeFileSync(this.rpgEnabledChannelsFilePath, data, 'utf-8');
        } catch (error) {
            console.error('Error saving RPG-enabled channels file:', error);
        }
    }

    public loadRpgContext(channelId: string): any {
        const filePath = path.join(__dirname, `../../rpg-context-${channelId}.json`);
        if (fs.existsSync(filePath)) {
            try {
                const data = fs.readFileSync(filePath, 'utf-8');
                return JSON.parse(data);
            } catch (error) {
                console.error(`[RPG] Error loading or parsing RPG context for channel ${channelId}: `, error);
                return {};
            }
        }
        return {};
    }

}