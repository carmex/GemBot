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

import {App, SlackEvent, SayFn} from '@slack/bolt';
import {WebClient} from '@slack/web-api';
import {GoogleGenerativeAI, Content, HarmCategory, HarmBlockThreshold, FunctionCall} from '@google/generative-ai';
import {GoogleAuth} from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import {registerWatchlistCommands} from '../commands/watchlist';
import {registerFinancialCommands} from '../commands/financial';
import {Readability} from '@mozilla/readability';
import {JSDOM} from 'jsdom';
import {ChartJSNodeCanvas} from 'chartjs-node-canvas';
import {ChartConfiguration} from 'chart.js';
import {
    initUsageDb,
    trackImageInvocation,
    trackLlmInteraction,
    getUserUsage,
    getAllUserUsage,
} from './usage-db';
import {config} from '../config';
import {fetchCryptoNews, fetchEarningsCalendar, fetchStockNews} from './finnhub-api';
import {registerEventListeners} from "../listeners/events";
import {registerCommandListeners} from "../listeners/commands";

export interface AIResponse {
    text: string;
    confidence: number;
    totalTokens?: number;
}

export class AIHandler {
    public app: App;
    public gemini: GoogleGenerativeAI;
    public auth: GoogleAuth;
    public disabledThreads: Set<string> = new Set();
    public enabledChannels: Set<string> = new Set();
    public rpgEnabledChannels: Map<string, string> = new Map();
    public geminiSystemPrompt: string;
    public rpgGmSystemPrompt: string;
    public rpgPlayerSystemPrompt: string;
    public disabledThreadsFilePath: string;
    public enabledChannelsFilePath: string;
    public rpgEnabledChannelsFilePath: string;
    public lastWarningTimestamp: Map<string, number> = new Map();

    constructor(app: App) {
        this.app = app;
        this.gemini = new GoogleGenerativeAI(config.gemini.apiKey);

        this.auth = new GoogleAuth({
            scopes: 'https://www.googleapis.com/auth/cloud-platform',
        });

        this.disabledThreadsFilePath = path.join(__dirname, '../../disabled-threads.json');
        this.enabledChannelsFilePath = path.join(__dirname, '../../enabled-channels.json');
        this.rpgEnabledChannelsFilePath = path.join(__dirname, '../../rpg-enabled-channels.json');

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

        this.initializeListeners();
        this.loadEnabledChannels();
        this.loadDisabledThreads();
        this.loadRpgEnabledChannels();
        initUsageDb();
    }

    private initializeListeners(): void {
        registerWatchlistCommands(this.app);
        registerFinancialCommands(this.app);
        registerEventListeners(this.app, this);
        registerCommandListeners(this.app, this);
    }

    public buildUserPrompt(promptData: {channel: string, user: string, text?: string}): string {
        return `channel_id: ${promptData.channel} | user_id: ${promptData.user} | message: ${promptData.text ?? ''}`;
    }

    public async processAIQuestion(question: string, history: Content[], channelId: string): Promise<AIResponse> {
        let retries = 3;
        while (retries > 0) {
            try {
                let systemPrompt = this.geminiSystemPrompt;
                const rpgMode = this.rpgEnabledChannels.get(channelId);

                if (rpgMode === 'gm') {
                    const rpgContext = this.loadRpgContext(channelId);
                    const rpgPrompt = `RPG GM MODE CONTEXT (channel_id: ${channelId}):\n${JSON.stringify(rpgContext, null, 2)}\n\n`;
                    systemPrompt = `${this.rpgGmSystemPrompt}\n\n${rpgPrompt}`;
                } else if (rpgMode === 'player') {
                    const rpgContext = this.loadRpgContext(channelId);
                    const rpgPrompt = `RPG PLAYER MODE (channel_id: ${channelId}):\nYour character sheet: ${JSON.stringify(rpgContext, null, 2)}\n\n`;
                    systemPrompt = `${this.rpgPlayerSystemPrompt}\n\n${rpgPrompt}`;
                }

                const model = this.gemini.getGenerativeModel({
                    model: config.gemini.model,
                    systemInstruction: systemPrompt,
                    safetySettings: [
                        {category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE},
                        {category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE},
                        {category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE},
                        {category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE},
                    ],
                });

                const contents: Content[] = [...history, {role: 'user', parts: [{text: question}]}];
                const result = await model.generateContent({contents});

                try {
                    const userIdMatch = question.match(/user_id:\s*(\S+)/);
                    if (userIdMatch && userIdMatch[1] && result.response.usageMetadata) {
                        const userId = userIdMatch[1];
                        trackLlmInteraction(userId, result.response.usageMetadata);
                    }
                } catch (e) {
                    console.error('[Usage] Failed to track LLM interaction:', e);
                }

                try {
                    if (!result.response || !result.response.candidates || result.response.candidates.length === 0) {
                        return {
                            text: "I'm sorry, I was unable to generate a response. This may be due to the safety settings.",
                            confidence: 0,
                        };
                    }

                    const responseText = result.response.text();
                    const functionCalls = result.response.functionCalls();

                    if (functionCalls && functionCalls.length > 0) {
                        const toolResponses = await Promise.all(functionCalls.map(toolCall => this.handleToolCall(toolCall, channelId)));
                        contents.push({role: 'model', parts: [{functionCall: functionCalls[0]}]});
                        contents.push({
                            role: 'function',
                            parts: toolResponses.map((toolResponse: {tool_name: string; result: any}) => ({
                                functionResponse: {
                                    name: toolResponse.tool_name,
                                    response: toolResponse.result,
                                },
                            })),
                        });
                        const secondResult = await model.generateContent({contents});
                        const finalResponse = secondResult.response.text();

                        // Strip any existing token count from the final response to prevent double-counting
                        const cleanFinalResponse = finalResponse.replace(/^\(\d+ tokens\)\s*/, '');

                        const totalTokens = (result.response.usageMetadata?.totalTokenCount ?? 0) + (secondResult.response.usageMetadata?.totalTokenCount ?? 0);
                        return {
                            text: cleanFinalResponse,
                            confidence: 0.9,
                            totalTokens,
                        };
                    }

                    // Post-process: strip code block wrappers (triple backticks and language tags) from LLM output before parsing for <tool_code> or <tool_result> blocks
                    let processedResponseText = responseText.replace(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/m, '$1').trim();

                    const toolCodeRegex = /<tool_code>([\s\S]*?)<\/tool_code>/;
                    const userFacingText = processedResponseText.replace(toolCodeRegex, '').trim();
                    const toolCodeMatch = processedResponseText.match(toolCodeRegex);

                    if (toolCodeMatch && toolCodeMatch[1]) {
                        let parsedToolCall;
                        try {
                            parsedToolCall = JSON.parse(toolCodeMatch[1].trim());
                        } catch (error) {
                            console.error('[Tool] Invalid JSON in tool code block:', error);
                            console.error('[Tool] Malformed tool code content:', toolCodeMatch[1].trim());

                            // Instead of returning an error, gracefully fall back to just the user-facing text
                            if (userFacingText) {
                                return {
                                    text: userFacingText,
                                    confidence: 0.9,
                                    totalTokens: result.response.usageMetadata?.totalTokenCount,
                                };
                            }

                            // If there's no user-facing text, return the full response with tool code stripped
                            const fallbackText = responseText.replace(toolCodeRegex, '').trim();
                            if (fallbackText) {
                                return {
                                    text: fallbackText,
                                    confidence: 0.9,
                                    totalTokens: result.response.usageMetadata?.totalTokenCount,
                                };
                            }

                            // Only show error if there's absolutely no usable content
                            return {text: 'I apologize, I encountered a technical issue with my response format.', confidence: 0};
                        }

                        if (userFacingText) {
                            this.executeTool(parsedToolCall.tool_name, parsedToolCall.parameters, channelId).catch(err => {
                                console.error(`[Tool] Background execution of ${parsedToolCall.tool_name} failed:`, err);
                            });

                            return {
                                text: userFacingText,
                                confidence: 0.9,
                                totalTokens: result.response.usageMetadata?.totalTokenCount,
                            };
                        }

                        const toolResult = await this.executeTool(parsedToolCall.tool_name, parsedToolCall.parameters, channelId);

                        const toolResultContent = {
                            role: 'function',
                            parts: [{functionResponse: {name: toolResult.tool_name, response: toolResult.result}}]
                        };

                        contents.push({role: 'model', parts: [{text: responseText}]});
                        contents.push(toolResultContent);

                        const secondResult = await model.generateContent({contents});
                        const finalResponse = secondResult.response.text();

                        // Strip any existing token count from the final response to prevent double-counting
                        const cleanFinalResponse = finalResponse.replace(/^\(\d+ tokens\)\s*/, '');

                        const totalTokens = (result.response.usageMetadata?.totalTokenCount ?? 0) + (secondResult.response.usageMetadata?.totalTokenCount ?? 0);
                        return {
                            text: cleanFinalResponse,
                            confidence: 0.9,
                            totalTokens,
                        };
                    }

                    return {
                        text: responseText,
                        confidence: 0.9,
                        totalTokens: result.response.usageMetadata?.totalTokenCount,
                    };
                } catch (error) {
                    console.error('FATAL: An error occurred in processAIQuestion right after receiving LLM response.', error);
                    return {
                        text: "I'm sorry, an unexpected error occurred while processing the AI response.",
                        confidence: 0
                    };
                }
            } catch (error) {
                console.error(`Retry ${3 - retries} failed:`, error);
                retries--;
                if (retries === 0) {
                    return {
                        text: "I'm sorry, I encountered a persistent error while generating a response. Please try again later.",
                        confidence: 0
                    };
                }
            }
        }
        return {text: "I'm sorry, I encountered a persistent error while generating a response. Please try again later.", confidence: 0};
    }

    private async handleToolCall(toolCall: FunctionCall, channelId: string): Promise<{tool_name: string; result: any}> {
        const {name, args} = toolCall;
        return this.executeTool(name, args, channelId);
    }

    private async executeTool(name: string, args: any, channelId: string): Promise<{tool_name: string; result: any}> {
        try {
            if (name === 'slack_user_profile') {
                const userId = (args as any).user_id as string;
                const result = await this.app.client.users.info({user: userId});
                if (result.ok) {
                    return {
                        tool_name: name,
                        result: {
                            id: (result.user as any)?.id,
                            name: (result.user as any)?.name,
                            real_name: (result.user as any)?.real_name,
                            email: (result.user as any)?.profile?.email,
                            tz: (result.user as any)?.tz,
                            title: (result.user as any)?.profile?.title,
                        }
                    };
                } else {
                    return {tool_name: name, result: {error: result.error}};
                }
            } else if (name === 'fetch_url_content') {
                const url = (args as any).url as string;
                try {
                    const response = await fetch(url);
                    if (!response.ok) {
                        const errorMsg = `Request failed with status ${response.status}`;
                        console.error(`[Tool] Error fetching URL ${url}: ${errorMsg}`);
                        return {tool_name: name, result: {error: errorMsg}};
                    }
                    const contentType = response.headers.get('content-type') || '';
                    let content = '';
                    if (contentType.includes('text/html')) {
                        const html = await response.text();
                        const doc = new JSDOM(html, {url});
                        const reader = new Readability(doc.window.document);
                        const article = reader.parse();
                        if (!article || !article.textContent) {
                            const errorMsg = 'Could not extract article content from HTML.';
                            console.error(`[Tool] ${errorMsg} from ${url}`);
                            return {tool_name: name, result: {error: errorMsg}};
                        }
                        content = article.textContent;
                    } else if (contentType.includes('text/plain')) {
                        content = await response.text();
                    } else {
                        const errorMsg = `Unsupported content type: ${contentType}`;
                        console.error(`[Tool] ${errorMsg} from ${url}`);
                        return {tool_name: name, result: {error: errorMsg}};
                    }
                    const result = {tool_name: name, result: {content}};
                    return result;
                } catch (e) {
                    console.error(`[Tool] Error fetching content from ${url}:`, e);
                    return {tool_name: name, result: {error: (e as Error).message}};
                }
            } else if (name === 'update_rpg_context') {
                const {context} = args as any;
                if (context) {
                    try {
                        const filePath = path.join(__dirname, `../../rpg-context-${channelId}.json`);
                        fs.writeFileSync(filePath, JSON.stringify(context, null, 2), 'utf-8');
                        console.log(`[RPG] Context saved for channel ${channelId}.`);
                        return {tool_name: name, result: {success: true}};
                    } catch (error) {
                        console.error('Error saving RPG context:', error);
                        return {tool_name: name, result: {error: (error as Error).message}};
                    }
                } else {
                    // This case should ideally not be hit if the model follows instructions
                    console.error(`[RPG] Attempted to save context for channel ${channelId} but context was missing.`);
                    return {tool_name: name, result: {success: false, error: 'Context was missing from the arguments.'}};
                }
            }
            return {tool_name: 'unknown_tool', result: {error: 'Tool not found'}};
        } catch (error) {
            console.error('Error executing tool:', error);
            return {tool_name: name, result: {error: (error as Error).message}};
        }
    }

    public async getStockCandles(ticker: string, range: string = '1y'): Promise<{t: number; c: number}[]> {
        const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&apikey=${config.alphaVantageApiKey}&outputsize=full`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Alpha Vantage API request failed: ${response.statusText}`);
        }
        const data = (await response.json()) as {"Time Series (Daily)"?: {[key: string]: {"4. close": string}}};
        const timeSeries = data["Time Series (Daily)"];
        if (!timeSeries) {
            return [];
        }
        let candles = Object.entries(timeSeries)
            .map(([date, values]) => ({
                t: new Date(date).getTime(),
                c: parseFloat(values["4. close"]),
            }))
            .sort((a, b) => a.t - b.t); // oldest to newest

        // Filter by range
        const now = Date.now();
        let msBack = 0;
        switch (range) {
            case '1m': msBack = 31 * 24 * 60 * 60 * 1000; break;
            case '3m': msBack = 93 * 24 * 60 * 60 * 1000; break;
            case '6m': msBack = 186 * 24 * 60 * 60 * 1000; break;
            case '1y': msBack = 365 * 24 * 60 * 60 * 1000; break;
            case '5y': msBack = 5 * 365 * 24 * 60 * 60 * 1000; break;
            default: msBack = 365 * 24 * 60 * 60 * 1000; break;
        }
        const minTime = now - msBack;
        candles = candles.filter(c => c.t >= minTime);
        if (candles.length > 0) {
            const first = new Date(candles[0].t).toISOString().slice(0, 10);
            const last = new Date(candles[candles.length - 1].t).toISOString().slice(0, 10);
        } else {
        }
        return candles;
    }

    public async generateChart(ticker: string, data: {t: number; c: number}[]): Promise<Buffer> {
        const width = 800;
        const height = 400;
        const chartJSNodeCanvas = new ChartJSNodeCanvas({width, height, backgroundColour: '#ffffff'});
        const lastPrice = data[data.length - 1].c;
        const firstPrice = data[0].c;
        const isUp = lastPrice >= firstPrice;
        const color = isUp ? 'rgb(75, 192, 192)' : 'rgb(255, 99, 132)';
        const configuration: ChartConfiguration = {
            type: 'line',
            data: {
                labels: data.map(d => new Date(d.t).toLocaleDateString()),
                datasets: [
                    {
                        label: `${ticker} Closing Price`,
                        data: data.map(d => d.c),
                        borderColor: color,
                        backgroundColor: color + '33',
                        fill: true,
                        pointRadius: 0,
                        tension: 0.4,
                    },
                ],
            },
            options: {
                scales: {
                    x: {
                        ticks: {
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 10,
                        },
                    },
                    y: {
                        ticks: {
                            callback: value => '$' + value,
                        },
                    },
                },
                plugins: {
                    legend: {
                        display: false,
                    },
                },
            },
        };
        return await chartJSNodeCanvas.renderToBuffer(configuration);
    }

    public async generateImage(prompt: string): Promise<{imageBase64?: string; filteredReason?: string}> {
        const token = await this.auth.getAccessToken();
        const projectId = config.vertex.projectId;
        const location = config.vertex.location;
        const modelId = 'imagen-4.0-generate-preview-06-06';//imagegeneration@006';
        const apiEndpoint = `${location}-aiplatform.googleapis.com`;
        const url = `https://${apiEndpoint}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;
        const requestBody = {
            instances: [{prompt}],
            parameters: {
                sampleCount: 1,
                includeRaiReason: true,
            },
        };
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
            const errorBody = (await response.json()) as {error: {message: string}};
            console.error('Imagen API response error:', response.status, JSON.stringify(errorBody, null, 2));
            const apiError = new Error(`Imagen API request failed with status ${response.status}`);
            (apiError as any).apiError = errorBody.error;
            throw apiError;
        }
        const data = (await response.json()) as {
            predictions: [
                {
                    bytesBase64Encoded?: string;
                    raiFilteredReason?: string;
                },
            ];
        };
        if (data.predictions?.[0]?.raiFilteredReason) {
            return {filteredReason: data.predictions[0].raiFilteredReason};
        }
        if (data.predictions?.[0]?.bytesBase64Encoded) {
            return {imageBase64: data.predictions[0].bytesBase64Encoded};
        }
        throw new Error('Invalid response structure from Imagen API.');
    }

    public async buildHistoryFromThread(channel: string, thread_ts: string | undefined, trigger_ts: string, client: WebClient, botUserId: string): Promise<Content[]> {
        const history: Content[] = [];
        if (!thread_ts) {
            return history;
        }
        try {
            const replies = await client.conversations.replies({
                channel,
                ts: thread_ts,
                inclusive: true,
            });
            if (!replies.messages) {
                return history;
            }
            for (const reply of replies.messages) {
                if (reply.ts === trigger_ts) {
                    continue;
                }
                if (reply.user === botUserId || reply.bot_id) {
                    history.push({role: 'model', parts: [{text: reply.text || ''}]});
                } else if (reply.user) {
                    history.push({role: 'user', parts: [{text: this.buildUserPrompt({channel, user: reply.user, text: reply.text})}]});
                }
            }
        } catch (error) {
            console.error("Error building history from thread:", error);
        }
        return history;
    }

    public async buildHistoryFromChannel(channel: string, trigger_ts: string, client: WebClient, botUserId: string): Promise<Content[]> {
        const history: Content[] = [];
        try {
            const result = await client.conversations.history({
                channel,
                limit: config.channelHistoryLimit,
            });
            if (!result.messages) {
                return history;
            }
            const messages = result.messages.reverse();
            for (const reply of messages) {
                if (reply.ts === trigger_ts) {
                    continue;
                }
                if (reply.user === botUserId || reply.bot_id) {
                    history.push({role: 'model', parts: [{text: reply.text || ''}]});
                } else if (reply.user) {
                    history.push({role: 'user', parts: [{text: this.buildUserPrompt({channel, user: reply.user, text: reply.text})}]});
                }
            }
        } catch (error) {
            console.error("Error building history from channel:", error);
        }
        return history;
    }

    public async buildHistorySinceLastBotMessage(channel: string, client: WebClient, botUserId: string): Promise<Content[]> {
        const history: Content[] = [];
        const relevantMessages: any[] = [];
        let hasMore = true;
        let cursor: string | undefined = undefined;

        try {
            while (hasMore) {
                const result = await client.conversations.history({
                    channel,
                    limit: 200, // A reasonable page size.
                    cursor: cursor,
                });

                if (!result.messages || result.messages.length === 0) {
                    break;
                }

                const botMessageIndex = result.messages.findIndex(reply => reply.user === botUserId || reply.bot_id);

                if (botMessageIndex !== -1) {
                    // Bot message found on this page.
                    // Add messages before it and we're done.
                    relevantMessages.push(...result.messages.slice(0, botMessageIndex));
                    hasMore = false; // Stop paginating
                } else {
                    // No bot message on this page, add all messages and continue.
                    relevantMessages.push(...result.messages);
                }

                if (hasMore && result.has_more) {
                    cursor = result.response_metadata?.next_cursor;
                } else {
                    hasMore = false;
                }
            }

            // The messages are newest to oldest, we need to reverse them to process chronologically
            for (const reply of relevantMessages.reverse()) {
                if (reply.user) {
                    history.push({role: 'user', parts: [{text: this.buildUserPrompt({channel, user: reply.user, text: reply.text})}]});
                }
            }
        } catch (error) {
            console.error("Error building history since last bot message:", error);
        }
        return history;
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
                console.error(`[RPG] Error loading or parsing RPG context for channel ${channelId}:`, error);
                return {};
            }
        }
        return {};
    }
}