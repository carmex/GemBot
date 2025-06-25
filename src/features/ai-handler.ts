import {App} from '@slack/bolt';
import {config} from '../config';
import {GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, Content} from '@google/generative-ai';
import {GoogleAuth} from 'google-auth-library';
import fetch from 'node-fetch';
import {ChartJSNodeCanvas} from 'chartjs-node-canvas';
import {ChartConfiguration} from 'chart.js';
import * as fs from 'fs';
import * as path from 'path';
import {addToWatchlist, getWatchlist, removeFromWatchlist} from './watchlist-db';
import {fetchQuote, fetchCompanyProfile, fetchStockMetrics, fetchStockNews, fetchCryptoNews, fetchEarningsCalendar} from './finnhub-api';
import {getColoredTileEmoji} from './utils';
import {registerWatchlistCommands} from '../commands/watchlist';
import {registerFinancialCommands} from '../commands/financial';

export interface AIResponse {
    text: string;
    confidence: number;
}

// Example AI handler - you can replace this with actual AI integration
export class AIHandler {
    private app: App;
    private gemini: GoogleGenerativeAI;
    private auth: GoogleAuth;
    private disabledThreads: Map<string, boolean> = new Map(); // Track disabled threads by channel+thread_ts
    private geminiSystemPrompt: string;

    constructor(app: App) {
        this.app = app;
        this.gemini = new GoogleGenerativeAI(config.gemini.apiKey);

        // Initialize Google Auth for direct API calls
        this.auth = new GoogleAuth({
            scopes: 'https://www.googleapis.com/auth/cloud-platform',
        });

        // Load the system prompt from the file
        const promptFilePath = path.join(__dirname, '../prompts/gemini-system-prompt.txt');
        this.geminiSystemPrompt = fs.readFileSync(promptFilePath, 'utf-8');

        this.setupAIHandlers();
    }

    private setupAIHandlers(): void {
        registerWatchlistCommands(this.app);
        registerFinancialCommands(this.app);

        // New command handler for !chart
        this.app.message(/^!chart ([A-Z]+)(?:\s+(1m|3m|6m|1y|5y))?/i, async ({message, context, say, client}) => {
            if (!('user' in message) || !context.matches?.[1]) return;

            if (!config.alphaVantageApiKey) {
                await say({
                    text: 'The charting feature is not configured. An API key for Alpha Vantage is required.',
                });
                return;
            }

            const ticker = context.matches[1].toUpperCase();
            const range = context.matches[2] || '1y'; // Default to 1 year

            try {
                const workingMessage = await say({text: `📈 Generating chart for *${ticker}* over the last *${range}*...`});

                const now = Math.floor(Date.now() / 1000);
                const from = this.calculateFromTimestamp(now, range);

                const candles = await this.getStockCandles(ticker);
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

        // Enhanced !gem command with thread support
        this.app.message(/^!gem (.+)/i, async ({message, context, client, say}) => {
            if (!('user' in message)) {
                return;
            }

            const question = context.matches[1].trim();

            if ('thread_ts' in message && message.thread_ts && context.botUserId) {
                try {
                    const history = await this.buildHistoryFromThread(message.channel, message.thread_ts, message.ts, client, context.botUserId);
                    const userPrompt = `<@${message.user}>: ${question}`;
                    const response = await this.processAIQuestion(userPrompt, history, this.geminiSystemPrompt);
                    await say({text: response.text, thread_ts: message.thread_ts});
                } catch (error) {
                    console.error('Gemini API error in-thread (!gem):', error);
                    await say({text: `Sorry <@${message.user}>, I couldn't process your request.`, thread_ts: message.ts});
                }
                return;
            }

            // Otherwise, start a new thread as before.
            try {
                const response = await this.processAIQuestion(question, [], this.geminiSystemPrompt);
                await say({
                    text: `:robot_face: <@${message.user}> asked: "${question}"\n\n${response.text}`,
                    thread_ts: message.ts,
                });
            } catch (error) {
                console.error('Gemini API error (!gem message):', error);
                await say({text: `Sorry <@${message.user}>, I couldn't process your request.`, thread_ts: message.ts});
            }
        });

        // This handler allows the bot to be mentioned in any thread to gain context and respond.
        this.app.event('app_mention', async ({event, context, client, say}) => {
            if (event.thread_ts && context.botUserId) {
                try {
                    const history = await this.buildHistoryFromThread(event.channel, event.thread_ts, event.ts, client, context.botUserId);
                    const prompt = event.text.replace(/<@[^>]+>\s*/, '').trim();
                    const userPrompt = `<@${event.user}>: ${prompt}`;
                    const response = await this.processAIQuestion(userPrompt, history, this.geminiSystemPrompt);
                    await say({text: response.text, thread_ts: event.thread_ts});
                } catch (error) {
                    console.error("Error in mention handler:", error);
                }
            }
        });

        // This handler responds to regular messages in threads where the bot is already participating
        this.app.message(/^[^!].*/, async ({message, context, client, say}) => {
            // Only process messages in threads where the bot is already participating
            if ('thread_ts' in message && message.thread_ts && context.botUserId && 'user' in message) {
                // Check if gembot is disabled in this thread
                const threadKey = `${message.channel}-${message.thread_ts}`;
                if (this.disabledThreads.has(threadKey)) {
                    return; // Skip responding if disabled
                }

                // Check if this is a thread where the bot has already responded
                try {
                    const history = await this.buildHistoryFromThread(message.channel, message.thread_ts, message.ts, client, context.botUserId);

                    // Only respond if there are bot messages in the history (meaning the bot has participated)
                    const hasBotMessages = history.some(content => content.role === 'model');
                    if (hasBotMessages) {
                        const userPrompt = `<@${message.user}>: ${message.text}`;
                        const response = await this.processAIQuestion(userPrompt, history, this.geminiSystemPrompt);
                        await say({text: response.text, thread_ts: message.thread_ts});
                    }
                } catch (error) {
                    console.error("Error in thread follow-up handler:", error);
                }
            }
        });

        // Add new !image handler for Imagen 4
        this.app.message(/^!image (.+)/i, async ({message, context, client, say}) => {
            if (!('user' in message)) {
                return;
            }

            const prompt = context.matches[1].trim();

            if (!prompt) {
                await say({text: 'Please provide a prompt for the image after `!image`.'});
                return;
            }

            try {
                // Let the user know we're working on it
                const workingMessage = await say({
                    text: `🎨 Generating an image with a direct API call for prompt: "_${prompt}_"... this can take a moment.`
                });

                // Generate the image
                const result = await this.generateImage(prompt);

                if (result.filteredReason) {
                    await say({
                        text: `Sorry, I can't generate that image. It was blocked for the following reason: *${result.filteredReason}*`,
                    });
                    if (workingMessage.ts) {
                        await client.chat.delete({channel: message.channel, ts: workingMessage.ts});
                    }
                    return;
                }

                if (result.imageBase64) {
                    // Upload the image to Slack
                    await client.files.uploadV2({
                        channel_id: message.channel,
                        initial_comment: `Here's the image for <@${message.user}>, prompted by: "_${prompt}_"`,
                        file: Buffer.from(result.imageBase64, 'base64'),
                        filename: 'imagen4-image.png',
                        title: prompt,
                    });
                }

                // Delete the "working on it" message if we can
                if (workingMessage.ts) {
                    await client.chat.delete({
                        channel: message.channel,
                        ts: workingMessage.ts
                    });
                }

            } catch (error) {
                console.error('Imagen API error:', error);
                await say({text: `Sorry, I couldn't generate an image. Error: ${(error as Error).message}`});
            }
        });

        // New command for !news (consolidated)
        this.app.message(/^!news(?:\s+(general|crypto))?/i, async ({message, context, say}) => {
            if (!('user' in message)) {
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

                // Format the top 5 articles
                const formattedArticles = articles
                    .slice(0, 5)
                    .map(
                        (article) => `• *${article.headline}* - _${article.source}_\n   <${article.url}|Read More>`
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

        // New command handler for !stats (now supports multiple tickers)
        this.app.message(/^!stats ([A-Z.\s]+)$/i, async ({message, context, say}) => {
            if (!('user' in message) || !context.matches?.[1]) return;

            if (!config.finnhubApiKey) {
                await say({
                    text: 'The stats feature is not configured. An API key for Finnhub is required.',
                });
                return;
            }

            const tickers = context.matches[1].toUpperCase().split(/\s+/).filter(Boolean);
            try {
                const results = await Promise.all(tickers.map(async (ticker: string) => {
                    // Fetch market cap from /stock/profile2
                    const profile = await fetchCompanyProfile(ticker);
                    const marketCap = profile?.marketCapitalization;
                    const companyName = profile?.name;

                    // Fetch 52 week high/low from /stock/metric
                    const metric = await fetchStockMetrics(ticker);
                    const high52 = metric?.['52WeekHigh'];
                    const high52Date = metric?.['52WeekHighDate'];
                    const low52 = metric?.['52WeekLow'];
                    const low52Date = metric?.['52WeekLowDate'];

                    if (!marketCap && !high52 && !low52) {
                        return `*${ticker}*: No stats found.`;
                    }

                    let response = `*${ticker}*`;
                    if (companyName) response += ` (${companyName})`;
                    response += ` stats:\n`;
                    if (marketCap) response += `• Market Cap: ${this.formatMarketCap(marketCap * 1_000_000)}\n`;
                    if (high52) response += `• 52-Week High: $${high52}` + (high52Date ? ` (on ${high52Date})` : '') + `\n`;
                    if (low52) response += `• 52-Week Low: $${low52}` + (low52Date ? ` (on ${low52Date})` : '');
                    return response;
                }));

                await say({text: results.join('\n\n')});
            } catch (error) {
                console.error('Finnhub API error (!stats):', error);
                await say({text: `Sorry, I couldn't fetch the stats. Error: ${(error as Error).message}`});
            }
        });

        // New command handler for !earnings
        this.app.message(/^!earnings ([A-Z.]+)$/i, async ({message, context, say}) => {
            if (!('user' in message) || !context.matches?.[1]) return;

            if (!config.finnhubApiKey) {
                await say({
                    text: 'The earnings feature is not configured. An API key for Finnhub is required.',
                });
                return;
            }

            const ticker = context.matches[1].toUpperCase();
            const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD

            try {
                const earnings = await fetchEarningsCalendar(ticker);

                if (!earnings || earnings.length === 0) {
                    await say({text: `No upcoming earnings found for *${ticker}*.`});
                    return;
                }

                const upcomingEarnings = earnings
                    .filter((earning: any) => new Date(earning.date) >= new Date())
                    .slice(0, 5); // Show next 5 earnings

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

        // Command to enable gembot in a thread
        this.app.message(/^!gembot on$/i, async ({message, say}) => {
            if (!('user' in message) || !('thread_ts' in message) || !message.thread_ts) {
                await say({text: 'This command only works in threads.'});
                return;
            }

            const threadKey = `${message.channel}-${message.thread_ts}`;
            this.disabledThreads.delete(threadKey);
            await say({text: '🤖 Gembot is now enabled in this thread!', thread_ts: message.thread_ts});
        });

        // Command to disable gembot in a thread
        this.app.message(/^!gembot off$/i, async ({message, say}) => {
            if (!('user' in message) || !('thread_ts' in message) || !message.thread_ts) {
                await say({text: 'This command only works in threads.'});
                return;
            }

            const threadKey = `${message.channel}-${message.thread_ts}`;
            this.disabledThreads.set(threadKey, true);
            await say({text: '🤐 Gembot is now disabled in this thread. Use `!gembot on` to re-enable, or `@mention` me for responses.', thread_ts: message.thread_ts});
        });
    }

    private calculateFromTimestamp(now: number, range: string): number {
        const day = 60 * 60 * 24;
        switch (range) {
            case '1m': return now - 30 * day;
            case '3m': return now - 90 * day;
            case '6m': return now - 180 * day;
            case '5y': return now - 5 * 365 * day;
            case '1y':
            default:
                return now - 365 * day;
        }
    }

    private async getStockCandles(ticker: string): Promise<{t: number; c: number}[]> {
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

        return Object.entries(timeSeries)
            .map(([date, values]) => ({
                t: new Date(date).getTime(),
                c: parseFloat(values["4. close"]),
            }))
            .reverse(); // Data comes in reverse chronological order
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
                        backgroundColor: color + '33', // Add some transparency
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

    private async processAIQuestion(question: string, history: Content[], systemPrompt?: string): Promise<AIResponse> {
        // Use Gemini API to generate a response
        const model = this.gemini.getGenerativeModel({
            model: 'gemini-2.5-flash',
            safetySettings: [
                {category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE},
                {category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE},
                {category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE},
                {category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE},
            ],
            systemInstruction: systemPrompt || this.geminiSystemPrompt,
        });

        const contents: Content[] = [...history, {role: 'user', parts: [{text: question}]}];

        const result = await model.generateContent({contents});

        if (!result.response || !result.response.candidates || result.response.candidates.length === 0) {
            return {
                text: "I'm sorry, I was unable to generate a response. This may be due to the safety settings.",
                confidence: 0,
            };
        }

        const text = result.response.text();
        return {
            text,
            confidence: 100, // Gemini does not provide a confidence score
        };
    }

    private async generateImage(prompt: string): Promise<{imageBase64?: string; filteredReason?: string}> {
        const token = await this.auth.getAccessToken();

        const projectId = config.vertex.projectId;
        const location = config.vertex.location;
        const modelId = 'imagen-4.0-generate-preview-06-06';

        const apiEndpoint = `${location}-aiplatform.googleapis.com`;
        const url = `https://${apiEndpoint}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;

        const requestBody = {
            instances: [
                {
                    prompt: prompt,
                },
            ],
            parameters: {
                sampleCount: 1, // We only need one image for the bot
                // Ask the API to include the reason if an image is filtered.
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
            const errorBody = await response.text();
            console.error('Imagen API response error:', response.status, errorBody);
            throw new Error(`Imagen API request failed with status ${response.status}: ${errorBody}`);
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

    private async fetchStockNews(): Promise<{headline: string; source: string; url: string}[] | null> {
        if (!config.finnhubApiKey) {
            console.error('Finnhub API key is not configured.');
            return null;
        }
        const url = `https://finnhub.io/api/v1/news?category=general&token=${config.finnhubApiKey}`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`Finnhub API bad response for news: ${response.statusText}`);
                return null;
            }
            const data = (await response.json()) as {headline: string; source: string; url: string}[];

            if (!data) {
                return null;
            }

            return data;
        } catch (error) {
            console.error('Error fetching stock news:', error);
            return null;
        }
    }

    private async fetchCryptoNews(): Promise<{headline: string; source: string; url: string}[] | null> {
        if (!config.finnhubApiKey) {
            console.error('Finnhub API key is not configured.');
            return null;
        }
        const url = `https://finnhub.io/api/v1/news?category=crypto&token=${config.finnhubApiKey}`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`Finnhub API bad response for crypto news: ${response.statusText}`);
                return null;
            }
            const data = (await response.json()) as {headline: string; source: string; url: string}[];

            if (!data) {
                return null;
            }

            return data;
        } catch (error) {
            console.error('Error fetching crypto news:', error);
            return null;
        }
    }

    /**
     * Fetches all messages from a thread and constructs a history for the AI.
     * @param channel The channel ID of the thread.
     * @param thread_ts The timestamp of the parent message of the thread.
     * @param trigger_ts The timestamp of the message that triggered this action, to exclude it from history.
     * @param client The Slack WebClient instance.
     * @param botUserId The bot's own user ID.
     * @returns A promise that resolves to an array of Content objects for the AI.
     */
    private async buildHistoryFromThread(channel: string, thread_ts: string | undefined, trigger_ts: string, client: any, botUserId: string): Promise<Content[]> {
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
                    history.push({role: 'user', parts: [{text: `<@${reply.user}>: ${reply.text || ''}`}]});
                }
            }
        } catch (error) {
            console.error("Error building history from thread:", error);
        }
        return history;
    }

    // Helper function to format market cap
    private formatMarketCap(marketCap: number): string {
        if (marketCap >= 1e12) {
            return `$${(marketCap / 1e12).toFixed(2)}T`;
        } else if (marketCap >= 1e9) {
            return `$${(marketCap / 1e9).toFixed(2)}B`;
        } else if (marketCap >= 1e6) {
            return `$${(marketCap / 1e6).toFixed(2)}M`;
        } else {
            return `$${marketCap.toFixed(2)}`;
        }
    }
}