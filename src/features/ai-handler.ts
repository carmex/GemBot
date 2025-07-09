import {App, SlackEvent, SayFn} from '@slack/bolt';
import {WebClient} from '@slack/web-api';
import {GoogleGenerativeAI, Content, HarmCategory, HarmBlockThreshold, FunctionCall} from '@google/generative-ai';
import {GoogleAuth} from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import {registerWatchlistCommands} from '../commands/watchlist';
import {registerFinancialCommands} from '../commands/financial';
import {extract} from '@extractus/article-extractor';
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

export interface AIResponse {
    text: string;
    confidence: number;
    totalTokens?: number;
}

export class AIHandler {
    private app: App;
    private gemini: GoogleGenerativeAI;
    private auth: GoogleAuth;
    private disabledThreads: Set<string> = new Set();
    private enabledChannels: Set<string> = new Set();
    private dndEnabledChannels: Set<string> = new Set();
    private geminiSystemPrompt: string;
    private dndSystemPrompt: string;
    private disabledThreadsFilePath: string;
    private enabledChannelsFilePath: string;
    private dndEnabledChannelsFilePath: string;

    constructor(app: App) {
        this.app = app;
        this.gemini = new GoogleGenerativeAI(config.gemini.apiKey);

        this.auth = new GoogleAuth({
            scopes: 'https://www.googleapis.com/auth/cloud-platform',
        });

        this.disabledThreadsFilePath = path.join(__dirname, '../../disabled-threads.json');
        this.enabledChannelsFilePath = path.join(__dirname, '../../enabled-channels.json');
        this.dndEnabledChannelsFilePath = path.join(__dirname, '../../dnd-enabled-channels.json');

        const promptFilePath = path.join(__dirname, '../prompts/gemini-system-prompt.txt');
        try {
            this.geminiSystemPrompt = fs.readFileSync(promptFilePath, 'utf-8');
        } catch (e) {
            console.error('Error reading Gemini system prompt file:', e);
            this.geminiSystemPrompt = 'You are a helpful assistant.';
        }

        const dndPromptFilePath = path.join(__dirname, '../prompts/gemini-dnd-system-prompt.txt');
        try {
            this.dndSystemPrompt = fs.readFileSync(dndPromptFilePath, 'utf-8');
        } catch (e) {
            console.error('Error reading DND system prompt file:', e);
            this.dndSystemPrompt = '';
        }

        this.initializeListeners();
        this.loadEnabledChannels();
        this.loadDisabledThreads();
        this.loadDndEnabledChannels();
        initUsageDb();
    }

    private initializeListeners(): void {
        registerWatchlistCommands(this.app);
        registerFinancialCommands(this.app);

        this.app.message(/^!roll (.+)/i, async ({message, context}) => {
            if (!('user' in message) || !message.user) {
                return;
            }
            const diceString = context.matches[1].trim();
            try {
                const {default: Roll} = await import('roll');
                const roll = new Roll();
                const result = roll.roll(diceString);
                const rollResultText = `User <@${message.user}> rolled *${diceString}* and got: *${result.result}*  _(${result.rolled.join(', ')})_`;
                await this.app.client.chat.postMessage({
                    channel: message.channel,
                    text: rollResultText,
                });
            } catch (error) {
                await this.app.client.chat.postMessage({
                    channel: message.channel,
                    text: `Sorry, I couldn't roll "${diceString}". Please use standard dice notation (e.g., \`1d20\`, \`2d6+3\`).`,
                });
            }
        });

        this.app.message(/^!chart\s*$/i, async ({say}) => {
            await say('Usage: `!chart TICKER [RANGE]`\nExample: `!chart AAPL 1y`\nAvailable ranges: 1m, 3m, 6m, 1y, 5y (default is 1y)');
        });

        this.app.message(/^!chart ([A-Z]+)(?:\s+(1m|3m|6m|1y|5y))?/i, async ({message, context, say, client}) => {
            if (!('user' in message) || !message.user || !context.matches?.[1]) return;
            if (!config.alphaVantageApiKey) {
                await say({text: 'The charting feature is not configured. An API key for Alpha Vantage is required.'});
                return;
            }
            const ticker = context.matches[1].toUpperCase();
            const range = context.matches[2] || '1y';
            try {
                const workingMessage = await say({text: `📈 Generating chart for *${ticker}* over the last *${range}*...`});
                const candles = await this.getStockCandles(ticker, range);
                if (candles.length === 0) {
                    await say({text: `No data found for *${ticker}* in the selected range.`});
                    if (workingMessage.ts) await client.chat.delete({channel: message.channel, ts: workingMessage.ts});
                    return;
                }
                const chartImage = await this.generateChart(ticker, candles);
                await client.files.uploadV2({
                    channel_id: message.channel,
                    initial_comment: `Here's the chart for <@${message.user}> for *${ticker}* (${range}):`,
                    file: chartImage,
                    filename: `${ticker}_chart.png`,
                    title: `${ticker} Chart (${range})`,
                });
                if (workingMessage.ts) {
                    await client.chat.delete({channel: message.channel, ts: workingMessage.ts});
                }
            } catch (error) {
                console.error(`Chart generation error for ${ticker}:`, error);
                await say({text: `Sorry, I couldn't generate the chart. Error: ${(error as Error).message}`});
            }
        });

        this.app.message(/^!gem (.+)/i, async ({message, context, client, say}) => {
            if (!('user' in message) || !message.user) {
                return;
            }
            const question = context.matches[1].trim();
            if ('thread_ts' in message && message.thread_ts && context.botUserId) {
                try {
                    const history = await this.buildHistoryFromThread(message.channel, message.thread_ts, message.ts, client, context.botUserId);
                    const userPrompt = this.buildUserPrompt({channel: message.channel, user: message.user, text: question});
                    const response = await this.processAIQuestion(userPrompt, history, message.channel);
                    if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                        const responseText = response.totalTokens ? `(${response.totalTokens} tokens) ${response.text}` : response.text;
                        await say({text: responseText, thread_ts: message.thread_ts});
                    }
                    return;
                } catch (error) {
                    console.error('Gemini API error in-thread (!gem):', error);
                    await say({text: `Sorry <@${message.user}>, I couldn't process your request.`, thread_ts: message.ts});
                }
                return;
            }
            try {
                const userPrompt = this.buildUserPrompt({channel: message.channel, user: message.user, text: question});
                const response = await this.processAIQuestion(userPrompt, [], message.channel);
                if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                    const responseText = response.totalTokens ? `(${response.totalTokens} tokens) ${response.text}` : response.text;
                    await say({
                        text: `:robot_face: <@${message.user}> asked: "${question}"\n\n${responseText}`,
                        thread_ts: message.ts,
                    });
                }
                return;
            } catch (error) {
                console.error('Gemini API error (!gem message):', error);
                await say({text: `Sorry <@${message.user}>, I couldn't process your request.`, thread_ts: message.ts});
            }
        });

        this.app.event('app_mention', async ({event, context, client, say}) => {
            if (event.thread_ts && context.botUserId && event.user) {
                try {
                    const history = await this.buildHistoryFromThread(event.channel, event.thread_ts, event.ts, client, context.botUserId);
                    const prompt = event.text.replace(/<@[^>]+>\s*/, '').trim();
                    const userPrompt = this.buildUserPrompt({channel: event.channel, user: event.user, text: prompt});
                    const response = await this.processAIQuestion(userPrompt, history, event.channel);
                    if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                        const responseText = response.totalTokens ? `(${response.totalTokens} tokens) ${response.text}` : response.text;
                        await say({text: responseText, thread_ts: event.thread_ts});
                    }
                } catch (error) {
                    console.error("Error in mention handler:", error);
                }
            }
        });

        this.app.message(/^[^!].*/, async ({message, context, say, client}) => {
            if (!('user' in message) || !message.user || (message.subtype && message.subtype !== 'bot_message')) {
                return;
            }
            const rollRegex = /User <@(.+?)> rolled .* and got: .*/;
            const rollMatch = 'text' in message && message.text?.match(rollRegex);
            if (
                context.botId &&
                message.subtype === 'bot_message' &&
                'bot_id' in message &&
                message.bot_id === context.botId &&
                rollMatch &&
                this.dndEnabledChannels.has(message.channel)
            ) {
                const originalUserId = rollMatch[1];
                if (!context.botUserId) {
                    console.error("Could not determine bot user ID for history building.");
                    return;
                }
                try {
                    const dndContext = this.loadDndContext(message.channel);
                    const history = await this.buildHistoryFromChannel(message.channel, message.ts, client, context.botUserId);
                    const dndPrompt = `DND MODE CONTEXT (channel_id: ${message.channel}):\n${JSON.stringify(dndContext, null, 2)}\n\n`;
                    const userPrompt = `${dndPrompt}channel_id: ${message.channel} | user_id: ${originalUserId} | message: ${message.text}`;
                    const response = await this.processAIQuestion(userPrompt, history, message.channel);
                    if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                        const responseText = response.totalTokens ? `(${response.totalTokens} tokens) ${response.text}` : response.text;
                        await say({text: responseText});
                    }
                } catch (error) {
                    console.error("Error in DND roll-follow-up handler:", error);
                }
                return;
            }
            if (!('user' in message) || !message.user || !context.botUserId) {
                return;
            }

            // Check if the message is a direct mention and ignore it, as it's handled by the app_mention event listener
            if (message.text && message.text.includes(`<@${context.botUserId}>`)) {
                return;
            }

            if ('thread_ts' in message && message.thread_ts) {
                const threadKey = `${message.channel}-${message.thread_ts}`;
                if (this.disabledThreads.has(threadKey)) {
                    return;
                }
                try {
                    const history = await this.buildHistoryFromThread(message.channel, message.thread_ts, message.ts, client, context.botUserId);
                    const hasBotMessages = history.some(content => content.role === 'model');
                    if (hasBotMessages) {
                        const userPrompt = this.buildUserPrompt({channel: message.channel, user: message.user, text: message.text});
                        const response = await this.processAIQuestion(userPrompt, history, message.channel);
                        if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                            const responseText = response.totalTokens ? `(${response.totalTokens} tokens) ${response.text}` : response.text;
                            await say({text: responseText, thread_ts: message.thread_ts});
                        }
                    }
                } catch (error) {
                    console.error("Error in thread follow-up handler:", error);
                }
                return;
            }
            if (this.enabledChannels.has(message.channel)) {
                try {
                    const history = await this.buildHistoryFromChannel(message.channel, message.ts, client, context.botUserId);
                    const userPrompt = this.buildUserPrompt({channel: message.channel, user: message.user, text: message.text});
                    const response = await this.processAIQuestion(userPrompt, history, message.channel);
                    if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                        const responseText = response.totalTokens ? `(${response.totalTokens} tokens) ${response.text}` : response.text;
                        await say({text: responseText});
                    }
                } catch (error) {
                    console.error('Error in enabled channel handler:', error);
                }
                return;
            }
            if (this.dndEnabledChannels.has(message.channel)) {
                try {
                    const dndContext = this.loadDndContext(message.channel);
                    const history = await this.buildHistoryFromChannel(message.channel, message.ts, client, context.botUserId);
                    const dndPrompt = `DND MODE CONTEXT (channel_id: ${message.channel}):\n${JSON.stringify(dndContext, null, 2)}\n\n`;
                    const userPrompt = `${dndPrompt}${this.buildUserPrompt({channel: message.channel, user: message.user, text: message.text})}`;
                    const response = await this.processAIQuestion(userPrompt, history, message.channel);
                    if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                        const responseText = response.totalTokens ? `(${response.totalTokens} tokens) ${response.text}` : response.text;
                        await say({text: responseText});
                    }
                } catch (error) {
                    console.error("Error in DND handler:", error);
                }
            }
        });

        this.app.message(/^!usage(?:\s+(\d{4}-\d{2}-\d{2}))?$/, async ({message, context, say}) => {
            if (!('user' in message) || !message.user) {
                return;
            }
            try {
                const date = context.matches?.[1];
                const usage = await getUserUsage(message.user, date);
                if (usage) {
                    const cost = (((usage.totalPromptTokens / 1000000) * 1.25) + ((usage.totalResponseTokens / 1000000) * 10)).toFixed(2);
                    const responseText =
                        `*Usage Stats for <@${message.user}> (${usage.date})*
` +
                        `*- LLM Invocations:* ${usage.llmInvocations}
` +
                        `*- Image Invocations:* ${usage.imageInvocations}
` +
                        `*- Total Tokens Used:* ${usage.totalTokens}
` +
                        `*- Prompt Tokens:* ${usage.totalPromptTokens}
` +
                        `*- Response Tokens:* ${usage.totalResponseTokens}
` +
                        `*- Estimated Cost:* $${cost}
` +
                        `_Last activity: ${new Date(usage.lastUpdated).toLocaleString()}_`;
                    await say(responseText);
                } else {
                    await say(`I don't have any usage data for you for ${date || 'today'}. Try interacting with the bot first!`);
                }
            } catch (error) {
                console.error('Error in !usage handler:', error);
                await say('Sorry, there was an error fetching your usage data.');
            }
        });

        this.app.message(/^!usage all$/, async ({message, context, say}) => {
            if (!('user' in message) || !message.user) {
                return;
            }
            try {
                const allUsage = await getAllUserUsage(message.user);
                if (!allUsage.length) {
                    await say("I don't have any usage data for you yet. Try interacting with the bot first!");
                    return;
                }
                let totalLLM = 0, totalImage = 0, totalPrompt = 0, totalResponse = 0, totalTokens = 0;
                let summary = `*All Usage Stats for <@${message.user}>:*
`;
                for (const usage of allUsage.sort((a, b) => a.date.localeCompare(b.date))) {
                    const cost = (((usage.totalPromptTokens / 1000000) * 1.25) + ((usage.totalResponseTokens / 1000000) * 10)).toFixed(2);
                    summary += `• *${usage.date}*: LLM: ${usage.llmInvocations}, Image: ${usage.imageInvocations}, Tokens: ${usage.totalTokens}, Prompt: ${usage.totalPromptTokens}, Response: ${usage.totalResponseTokens}, $${cost}\n`;
                    totalLLM += usage.llmInvocations;
                    totalImage += usage.imageInvocations;
                    totalPrompt += usage.totalPromptTokens;
                    totalResponse += usage.totalResponseTokens;
                    totalTokens += usage.totalTokens;
                }
                const totalCost = (((totalPrompt / 1000000) * 1.25) + ((totalResponse / 1000000) * 10)).toFixed(2);
                summary += `\n*Total*: LLM: ${totalLLM}, Image: ${totalImage}, Tokens: ${totalTokens}, Prompt: ${totalPrompt}, Response: ${totalResponse}, $${totalCost}`;
                await say(summary);
            } catch (error) {
                console.error('Error in !usage all handler:', error);
                await say('Sorry, there was an error fetching your usage data.');
            }
        });

        this.app.message(/^!image\s+(.+)/, async ({message, context, say, client}) => {
            if (!('user' in message) || !message.user || message.subtype) {
                return;
            }
            console.log(`[Command] !image command received from ${message.user}: ${context.matches[1]}`);
            trackImageInvocation(message.user);
            const prompt = context.matches[1];
            try {
                const workingMessage = await say({
                    text: `Got it. Generating an image for "_${prompt}_"...`,
                    thread_ts: message.thread_ts,
                });
                const result = await this.generateImage(prompt);
                if (workingMessage.ts) {
                    await client.chat.delete({
                        channel: message.channel,
                        ts: workingMessage.ts,
                    });
                }
                if (result.imageBase64) {
                    await client.files.uploadV2({
                        channel_id: message.channel,
                        initial_comment: `Here's the image for <@${message.user}>, prompted by: "_${prompt}_"`,
                        file: Buffer.from(result.imageBase64, 'base64'),
                        filename: 'image.png',
                        thread_ts: message.thread_ts,
                    });
                } else if (result.filteredReason) {
                    await say({
                        text: `Sorry, I can't generate that image. It was blocked for the following reason: *${result.filteredReason}*`,
                        thread_ts: message.thread_ts,
                    });
                } else {
                    await say({
                        text: `Sorry, I couldn't generate an image for an unknown reason.`,
                        thread_ts: message.thread_ts,
                    });
                }
            } catch (error) {
                console.error('Error generating image:', error);
                const errorMessage = (error as any)?.apiError?.message || (error as Error).message;
                await say(`An error occurred while generating the image: ${errorMessage}`);
            }
        });

        this.app.message(/^!news(?:\s+(general|crypto))?/i, async ({message, context, say}) => {
            if (!('user' in message) || !message.user) {
                return;
            }
            if (!config.finnhubApiKey) {
                await say({text: 'The news feature is not configured. An API key for Finnhub is required.'});
                return;
            }
            const category = context.matches?.[1] || 'general';
            try {
                const articles = category === 'crypto' ? await fetchCryptoNews() : await fetchStockNews();
                if (!articles || articles.length === 0) {
                    await say({
                        text: `I couldn't find any recent ${category} news.`, thread_ts: message.ts
                    });
                    return;
                }
                const formattedArticles = articles
                    .slice(0, 5)
                    .map(
                        (article: {headline: string; source: string; url: string;}) => `• *${article.headline}* - _${article.source}_\n   <${article.url}|Read More>`
                    )
                    .join('\n\n');
                await say({
                    text: `Here are the latest ${category} headlines:\n\n${formattedArticles}`,
                    thread_ts: message.ts,
                });
            } catch (error) {
                console.error('News error:', error);
                await say({
                    text: `Sorry, I couldn't fetch the news. Error: ${(error as Error).message}`,
                    thread_ts: message.ts,
                });
            }
        });

        this.app.message(/^!earnings ([A-Z.]+)$/i, async ({message, context, say}) => {
            if (!('user' in message) || !message.user || !context.matches?.[1]) return;
            if (!config.finnhubApiKey) {
                await say({text: 'The earnings feature is not configured. An API key for Finnhub is required.'});
                return;
            }
            const ticker = context.matches[1].toUpperCase();
            try {
                const earnings = await fetchEarningsCalendar(ticker);
                if (!earnings || earnings.length === 0) {
                    await say({text: `No upcoming earnings found for *${ticker}*.`});
                    return;
                }
                const upcomingEarnings = earnings
                    .filter((earning: any) => new Date(earning.date) >= new Date())
                    .slice(0, 5);
                if (upcomingEarnings.length === 0) {
                    await say({text: `No upcoming earnings found for *${ticker}*.`});
                    return;
                }
                let response = `*${ticker}* upcoming earnings:\n`;
                upcomingEarnings.forEach((earning: any) => {
                    const date = new Date(earning.date).toLocaleDateString();
                    const time = earning.hour || 'TBD';
                    const estimate = earning.estimate ? ` (Est: $${earning.estimate})` : '';
                    response += `• ${date} at ${time}${estimate}\n`;
                });
                await say({text: response});
            } catch (error) {
                console.error('Finnhub API error (!earnings):', error);
                await say({text: `Sorry, I couldn't fetch earnings for *${ticker}*. Error: ${(error as Error).message}`});
            }
        });

        this.app.message(/^!gembot on$/i, async ({message, say}) => {
            if (!('user' in message) || !message.user || !('thread_ts' in message) || !message.thread_ts) {
                await say({text: 'This command only works in threads.'});
                return;
            }
            const threadKey = `${message.channel}-${message.thread_ts}`;
            this.disabledThreads.delete(threadKey);
            this.saveDisabledThreads();
            await say({text: '🤖 Gembot is now enabled in this thread!', thread_ts: message.thread_ts});
        });

        this.app.message(/^!gembot off$/i, async ({message, say}) => {
            if (!('user' in message) || !message.user || !('thread_ts' in message) || !message.thread_ts) {
                await say({text: 'This command only works in threads.'});
                return;
            }
            const threadKey = `${message.channel}-${message.thread_ts}`;
            this.disabledThreads.add(threadKey);
            this.saveDisabledThreads();
            await say({text: '🤐 Gembot is now disabled in this thread. Use `!gembot on` to re-enable, or `@mention` me for responses.', thread_ts: message.thread_ts});
        });

        this.app.message(/^!gembot channel on$/i, async ({message, say}) => {
            if (!('user' in message) || !message.user) {
                return;
            }
            this.enabledChannels.add(message.channel);
            this.dndEnabledChannels.delete(message.channel);
            this.saveEnabledChannels();
            this.saveDndEnabledChannels();
            await say({text: '🤖 Gembot will now respond to all messages in this channel. Use `!gembot channel off` to disable.'});
        });

        this.app.message(/^!gembot channel off$/i, async ({message, say}) => {
            if (!('user' in message) || !message.user) {
                return;
            }
            this.enabledChannels.delete(message.channel);
            this.saveEnabledChannels();
            await say({text: '🤐 Gembot will no longer respond to all messages in this channel.'});
        });

        this.app.message(/^!gembot dnd on$/i, async ({message, say}) => {
            if (!('user' in message) || !message.user) {
                return;
            }
            this.dndEnabledChannels.add(message.channel);
            this.enabledChannels.delete(message.channel);
            this.saveDndEnabledChannels();
            this.saveEnabledChannels();
            await say({text: '⚔️ DND Mode Enabled! The bot will now act as the Dungeon Master for this channel. All game state will be saved.'});
        });

        this.app.message(/^!gembot dnd off$/i, async ({message, say}) => {
            if (!('user' in message) || !message.user) {
                return;
            }
            this.dndEnabledChannels.delete(message.channel);
            this.saveDndEnabledChannels();
            await say({text: '✅ DND Mode Disabled. The bot will no longer act as the Dungeon Master.'});
        });
    }

    private buildUserPrompt(promptData: {channel: string, user: string, text?: string}): string {
        return `channel_id: ${promptData.channel} | user_id: ${promptData.user} | message: ${promptData.text ?? ''}`;
    }

    private async processAIQuestion(question: string, history: Content[], channelId: string): Promise<AIResponse> {
        let retries = 3;
        while (retries > 0) {
            try {
                let systemPrompt = this.geminiSystemPrompt;
                if (this.dndEnabledChannels.has(channelId)) {
                    systemPrompt += `\n\n${this.dndSystemPrompt}`;
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
                        const toolResponses = await Promise.all(functionCalls.map(toolCall => this.handleToolCall(toolCall)));
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
                            this.executeTool(parsedToolCall.tool_name, parsedToolCall.parameters).catch(err => {
                                console.error(`[Tool] Background execution of ${parsedToolCall.tool_name} failed:`, err);
                            });

                            return {
                                text: userFacingText,
                                confidence: 0.9,
                                totalTokens: result.response.usageMetadata?.totalTokenCount,
                            };
                        }

                        const toolResult = await this.executeTool(parsedToolCall.tool_name, parsedToolCall.parameters);

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

    private async handleToolCall(toolCall: FunctionCall): Promise<{tool_name: string; result: any}> {
        const {name, args} = toolCall;
        return this.executeTool(name, args);
    }

    private async executeTool(name: string, args: any): Promise<{tool_name: string; result: any}> {
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
                const charLimit = ((args as any).char_limit as number) || 8000;
                try {
                    const response = await fetch(url);
                    if (!response.ok) {
                        throw new Error(`Request failed with status ${response.status}`);
                    }
                    const contentType = response.headers.get('content-type') || '';
                    let content = '';
                    if (contentType.includes('text/html')) {
                        const html = await response.text();
                        const article = await extract(html);
                        if (!article || !article.content) {
                            throw new Error('Could not extract article content from HTML.');
                        }
                        content = article.content;
                    } else if (contentType.includes('text/plain')) {
                        content = await response.text();
                    } else {
                        throw new Error(`Unsupported content type: ${contentType}`);
                    }
                    const snippet = content.substring(0, charLimit);
                    const result = {tool_name: name, result: {content: snippet}};
                    return result;
                } catch (e) {
                    console.error(`[Tool] Error fetching content from ${url}:`, e);
                    return {tool_name: name, result: {error: (e as Error).message}};
                }
            } else if (name === 'update_dnd_context') {
                const {channel_id, context} = args as any;
                if (!channel_id || !context) {
                    return {tool_name: name, result: {error: 'Missing channel_id or context'}};
                }
                try {
                    const filePath = path.join(__dirname, `../../dnd-context-${channel_id}.json`);
                    fs.writeFileSync(filePath, JSON.stringify(context, null, 2), 'utf-8');
                    return {tool_name: name, result: {success: true}};
                } catch (error) {
                    console.error('Error saving DND context:', error);
                    return {tool_name: name, result: {error: (error as Error).message}};
                }
            }
            return {tool_name: 'unknown_tool', result: {error: 'Tool not found'}};
        } catch (error) {
            console.error('Error executing tool:', error);
            return {tool_name: name, result: {error: (error as Error).message}};
        }
    }

    private async getStockCandles(ticker: string, range: string = '1y'): Promise<{t: number; c: number}[]> {
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
            console.log(`[Chart Debug] ${ticker} ${range}: ${candles.length} candles, from ${first} to ${last}`);
        } else {
            console.log(`[Chart Debug] ${ticker} ${range}: 0 candles`);
        }
        return candles;
    }

    private async generateChart(ticker: string, data: {t: number; c: number}[]): Promise<Buffer> {
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

    private async generateImage(prompt: string): Promise<{imageBase64?: string; filteredReason?: string}> {
        const token = await this.auth.getAccessToken();
        const projectId = config.vertex.projectId;
        const location = config.vertex.location;
        const modelId = 'imagegeneration@006';
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

    private async buildHistoryFromThread(channel: string, thread_ts: string | undefined, trigger_ts: string, client: WebClient, botUserId: string): Promise<Content[]> {
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

    private async buildHistoryFromChannel(channel: string, trigger_ts: string, client: WebClient, botUserId: string): Promise<Content[]> {
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

    private loadDisabledThreads(): void {
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

    private saveDisabledThreads(): void {
        try {
            const threadsArray = Array.from(this.disabledThreads);
            fs.writeFileSync(this.disabledThreadsFilePath, JSON.stringify(threadsArray, null, 2), 'utf-8');
        } catch (error) {
            console.error('Error saving disabled threads file:', error);
        }
    }

    private loadEnabledChannels(): void {
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

    private saveEnabledChannels(): void {
        try {
            const channelsArray = Array.from(this.enabledChannels);
            fs.writeFileSync(this.enabledChannelsFilePath, JSON.stringify(channelsArray, null, 2), 'utf-8');
        } catch (error) {
            console.error('Error saving enabled channels file:', error);
        }
    }

    private loadDndEnabledChannels(): void {
        try {
            if (fs.existsSync(this.dndEnabledChannelsFilePath)) {
                const data = fs.readFileSync(this.dndEnabledChannelsFilePath, 'utf-8');
                const channelsArray = JSON.parse(data) as string[];
                this.dndEnabledChannels = new Set(channelsArray);
            }
        } catch (error) {
            console.error('Error loading DND-enabled channels file:', error);
        }
    }

    private saveDndEnabledChannels(): void {
        try {
            const channelsArray = Array.from(this.dndEnabledChannels);
            fs.writeFileSync(this.dndEnabledChannelsFilePath, JSON.stringify(channelsArray, null, 2), 'utf-8');
        } catch (error) {
            console.error('Error saving DND-enabled channels file:', error);
        }
    }

    private loadDndContext(channelId: string): any {
        const filePath = path.join(__dirname, `../../dnd-context-${channelId}.json`);
        if (fs.existsSync(filePath)) {
            try {
                const data = fs.readFileSync(filePath, 'utf-8');
                return JSON.parse(data);
            } catch (error) {
                console.error(`[DND] Error loading or parsing DND context for channel ${channelId}:`, error);
                return {};
            }
        }
        return {};
    }
}