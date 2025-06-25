import {App} from '@slack/bolt';
import {config} from '../config';
import {GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, Content} from '@google/generative-ai';
import {GoogleAuth} from 'google-auth-library';
import fetch from 'node-fetch';
import {ChartJSNodeCanvas} from 'chartjs-node-canvas';
import {ChartConfiguration} from 'chart.js';
import {addToWatchlist, getWatchlist, removeFromWatchlist} from './watchlist-db';

export interface AIResponse {
    text: string;
    confidence: number;
}

const GEMINI_SYSTEM_PROMPT = `Your goal is to act as a helpful AI assistant in a Slack bot, participating in multi-user threaded conversations. Your responses should be helpful, concise, and avoid repeating the user's prompt. You should also be aware of the following contextual information about the team's communication style, inside jokes, and common phrases:

Communication Norms & Slack Etiquette
User Mentions: User messages will be prefixed with their Slack user ID (e.g., <@USER_ID>:). Do not include your own user ID in your responses. If a message contains an @ mention to another user, you can assume it's not for you and typically shouldn't respond, but keep it in mind for future context. You can use usernames in your replies but please don't use @ before the username unless you need someone's attention.
Acronyms: Acronyms are common. If a user follows an acronym with :exp: or incorrectly expands it, they're asking for the full phrase. You can either spell it out or reveal the next letters. Users might also guess or :yield: if they need more letters.
Repetition:
x or :xrepeat:: Used when someone verbatim repeats what another user just said.
~x or :xtilde:: Similar to x, but for something kinda like a repetition.
-x: Indicates the speaker was about to say the same thing as the previous message.
Conversation Kill (ck++): If 10 minutes pass without a message in a conversation, it's eligible for a ck++. Slackbot will respond with a random phrase, and the best responses earn a :clark_kent: award.
Life Points (lp--): Decrements if a user is the only one talking for a screen's worth of text.
Dodging Questions:
:ram:: Someone is actively dodging a question.
:zipper_mouth_face: :ram:: Silently dodging a question; used to point out someone else doing it.
Formatting: Use H1 headings for main sections if you were ever to contribute to the team's wiki. Avoid H2 or H3.
Glossary & Common Phrases
144: (archaic) gross
1cb: 1-click buy/bought
:angtft: / :angcft:: "ain't nobody got time/cash for that"
bdb: "but don't bother" (e.g., sfwbdb)
bh: "black home" - when someone corners you, usually at work, to talk about something you may not care about and can't escape. (Originally a typo of "black hole")
bitd: "back in the day"
bm: "boss man," or "bowel movement" (:poop:), or "bad manners"
bq: "burning question" (important questions about an event)
bsly: "basically" or "basily" (:bsly:)
btq: "begs the question" (someone makes an incorrect assumption)
:cow:: "coworker" / colleague
ctrl-v: A call for active chatters to paste their current clipboard.
ctrl-v hard mode: Must paste without checking for embarrassment.
:day:: "there you go"
dd(d)* / :dd: / :d:: "d-d-dang"; more d's indicate greater surprise.
ff: "fun fakt" (a false bit of trivia meant to bamboozle)
:fin: / :finn:: "fin" / "end of story"
fyhg: "for you home gamers" (in case you didn't know)
fzct: "fuzzycat" (used to describe a change in conversation to an unrelated topic)
gisN &lt;string>: Google Image Search Nth result (e.g., gis1 girls). Omit N for the first result (gis1).
gism <string>: gis <string> meme
gisa <string>: gis <string> animated gif
gist <string>: gis <string> then and now
gisg <string>: gis <string> girls (auto-appends "girls")
mkf again if the result contains 3 girls.
:hasslehoff:: "hassle"
hdiw: "how does it work?" (prefaced by x: e.g., x: hdiw)
icba: "I can't be arsed"
its/idts: "I think so"/"I don't think so"
:jake:: "just kidding"
lmt: "lend me tell" (misnomer for "let me know")
mfk: "marry fuck kill" (a game)
nasalol/nasa: When something humorous causes air to be exhaled through the nostril with more force than normal breathing.
nb: "not bad" (sometimes refers to "nick_b")
pita/pitb: "pain in the ass/butt"
pg: "pretty good"
pmc: "productivity, mood, condition" (score); e.g., pmc 548 means productivity 5/10, mood 4/10, condition 8/10. Scores of 10/10 are not permitted.
getpmc: A call to post your current pmc.
regInt(x): "register interrupt" (tell me when x happens)
scay: "scared"
scm: "supercodingmode"
seesly/ssly: "seriously" (adverb form of sees)
:stop:: Indicates intention to discontinue participation in a conversation.
tcs: "this convo sux"
tcyb: "take care of your body"
:ttj:: "thatsthejoke.jpg"
twtd: "those were the days"
wa&lt;x>&lt;y>&lt;z>: e.g., wattba for "what a time to be alive!"
waidwml: "what am I doing with my life"
:cha: / :wang: / :boltar:: Slang for penis.
-well / :well:: "might as well"
x: An expression of profanity, often used after unintentionally repeating someone.
yds: "you don't say"
:yoshi:: "I mean..."
:zombie2:: tired
Modifiers
These are applied to the previous statement:

+ x: Add x (dealer's choice).
- x: Subtract x (dealer's choice).
x > n: Right shift x by n.
x < n: Left shift x by n.
Commands
!urban x: Looks up x on urbandictionary.com.
!wiki y: Looks up y on wikipedia.org. Also aliased to "teh x is y".
mtch: Triggers a Slackbot response with a Mitch Hedberg joke. If the user's joke matches the triggered one, they win. Other users can trigger it, but it's sometimes impolite.`;

// Example AI handler - you can replace this with actual AI integration
export class AIHandler {
    private app: App;
    private gemini: GoogleGenerativeAI;
    private auth: GoogleAuth;
    private disabledThreads: Map<string, boolean> = new Map(); // Track disabled threads by channel+thread_ts

    constructor(app: App) {
        this.app = app;
        this.gemini = new GoogleGenerativeAI(config.gemini.apiKey);

        // Initialize Google Auth for direct API calls
        this.auth = new GoogleAuth({
            scopes: 'https://www.googleapis.com/auth/cloud-platform',
        });

        this.setupAIHandlers();
    }

    private getColoredTileEmoji(percentChange: number): string {
        if (percentChange >= 10) return ':_charles_green5:';
        if (percentChange >= 6) return ':_charles_green4:';
        if (percentChange >= 3) return ':_charles_green3:';
        if (percentChange >= 1) return ':_charles_green2:';
        if (percentChange > 0) return ':_charles_green1:';
        if (percentChange === 0) return ':_charles_black_square:';
        if (percentChange <= -10) return ':_charles_red5:';
        if (percentChange <= -6) return ':_charles_red4:';
        if (percentChange <= -3) return ':_charles_red3:';
        if (percentChange <= -1) return ':_charles_red2:';
        if (percentChange < 0) return ':_charles_red1:';
        return ':white_square:'; // Fallback for unexpected cases
    }

    private setupAIHandlers(): void {
        // New command handler for !watchlist
        this.app.message(/^!watchlist/i, async ({message, say}) => {
            if (!('user' in message) || !message.user) return;

            const userWatchlist = await getWatchlist(message.user);
            if (userWatchlist.length === 0) {
                await say({
                    text: "Your watchlist is empty. Add stocks with `!watch <TICKER>`.",
                });
                return;
            }

            let totalPortfolioValue = 0;
            let totalCostBasis = 0;

            const report = await Promise.all(
                userWatchlist.map(async (item) => {
                    const quote = await this.fetchQuoteData(item.ticker);
                    if (!quote) {
                        return `*${item.ticker}*: Could not retrieve current price.`;
                    }
                    const currentPrice = quote.price;
                    const gainLoss = (currentPrice - item.purchasePrice) * item.shares;
                    const gainLossPercent = (gainLoss / (item.purchasePrice * item.shares)) * 100;
                    const emoji = gainLoss >= 0 ? '📈' : '📉';
                    const sign = gainLoss >= 0 ? '+' : '';

                    const costBasis = item.purchasePrice * item.shares;
                    totalCostBasis += costBasis;
                    totalPortfolioValue += currentPrice * item.shares;

                    return `*${item.ticker}* (${item.shares} @ $${item.purchasePrice.toFixed(2)}): $${(currentPrice * item.shares).toFixed(2)} | P/L: ${sign}$${gainLoss.toFixed(2)} (${sign}${gainLossPercent.toFixed(2)}%) ${emoji}`;
                })
            );

            const overallGainLoss = totalPortfolioValue - totalCostBasis;
            const overallGainLossPercent = (overallGainLoss / totalCostBasis) * 100;
            const overallSign = overallGainLoss >= 0 ? '+' : '';
            const overallEmoji = overallGainLoss >= 0 ? '🔼' : '🔽';

            const summary = `*Your Watchlist Summary* ${overallEmoji}\nOverall P/L: ${overallSign}$${overallGainLoss.toFixed(2)} (${overallSign}${overallGainLossPercent.toFixed(2)}%)\n------------------------------------`;

            await say({
                text: `${summary}\n${report.join('\n')}`,
            });
        });

        // New command handler for !watch (help)
        this.app.message(/^!watch$/i, async ({say}) => {
            await say({
                text: 'Usage: `!watch <TICKER> [purchase_date] [purchase_price] [shares]`\n' +
                    '• `<TICKER>`: The stock symbol (e.g., AAPL).\n' +
                    '• `[purchase_date]`: Optional. Date of purchase (e.g., 2023-01-15). Defaults to today.\n' +
                    '• `[purchase_price]`: Optional. Price per share. Defaults to current market price.\n' +
                    '• `[shares]`: Optional. Number of shares. Defaults to 1.',
            });
        });

        // New command handler for !watch (add)
        this.app.message(/^!watch\s+([A-Z]+)(?:\s+([\d.-]+))?(?:\s+([\d.]+))?(?:\s+(\d+))?/i, async ({message, context, say}) => {
            if (!('user' in message) || !message.user || !context.matches?.[1]) return;

            const ticker = context.matches[1].toUpperCase();
            const purchaseDateInput = context.matches[2];
            const purchasePriceInput = context.matches[3];
            const sharesInput = context.matches[4];

            let purchasePrice = purchasePriceInput ? parseFloat(purchasePriceInput) : undefined;
            const purchaseDate = purchaseDateInput ? new Date(purchaseDateInput).toLocaleDateString() : new Date().toLocaleDateString();
            const shares = sharesInput ? parseInt(sharesInput, 10) : 1;

            if (purchasePrice === undefined) {
                const quote = await this.fetchQuoteData(ticker);
                if (!quote) {
                    await say({text: `Could not fetch the current price for *${ticker}*. Please provide a purchase price or try again later.`});
                    return;
                }
                purchasePrice = quote.price;
            }

            await addToWatchlist({
                userId: message.user,
                ticker,
                shares,
                purchaseDate,
                purchasePrice,
            });

            await say({text: `*${ticker}* (${shares} shares) has been added to your watchlist at $${purchasePrice.toFixed(2)}/share.`});
        });

        // New command handler for !unwatch
        this.app.message(/^!unwatch\s+([A-Z]+)/i, async ({message, context, say}) => {
            if (!('user' in message) || !message.user || !context.matches?.[1]) return;
            const ticker = context.matches[1].toUpperCase();

            const success = await removeFromWatchlist(message.user, ticker);

            if (success) {
                await say({text: `*${ticker}* has been removed from your watchlist.`});
            } else {
                await say({text: `*${ticker}* was not found in your watchlist.`});
            }
        });

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

        // New command handler for !cq
        this.app.message(/^!cq (.+)/i, async ({message, context, say}) => {
            if (!('user' in message) || !context.matches?.[1]) {
                return;
            }

            if (!config.finnhubApiKey) {
                await say({
                    text: 'The crypto quote feature is not configured. An API key for Finnhub is required.',
                });
                return;
            }

            const tickers = context.matches[1].trim().toUpperCase().split(/\s+/);
            if (tickers.length === 0) {
                await say({
                    text: 'Please provide at least one crypto ticker. Example: `!cq BTC ETH`',
                });
                return;
            }

            try {
                const results = await Promise.all(
                    tickers.map((ticker: string) => {
                        const cryptoTicker = `BINANCE:${ticker}USDT`;
                        return this.formatQuote(cryptoTicker, ticker);
                    })
                );
                const reply = results.join('\n');
                await say({text: reply});
            } catch (error) {
                console.error('Finnhub API error:', error);
                await say({
                    text: `Sorry, I couldn't fetch the crypto prices. Error: ${(error as Error).message}`,
                });
            }
        });

        // New command handler for !q
        this.app.message(/^!q (.+)/i, async ({message, context, say}) => {
            if (!('user' in message) || !context.matches?.[1]) {
                return;
            }

            if (!config.finnhubApiKey) {
                await say({
                    text: 'The stock quote feature is not configured. An API key for Finnhub is required.',
                });
                return;
            }

            const tickers = context.matches[1].trim().toUpperCase().split(/\s+/);
            if (tickers.length === 0) {
                await say({
                    text: 'Please provide at least one stock ticker. Example: `!q AAPL TSLA`',
                });
                return;
            }

            try {
                const results = await Promise.all(
                    tickers.map((ticker: string) => this.formatQuote(ticker))
                );
                const reply = results.join('\n');
                await say({text: reply});
            } catch (error) {
                console.error('Finnhub API error:', error);
                await say({
                    text: `Sorry, I couldn't fetch the stock prices. Error: ${(error as Error).message}`,
                });
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
                    const response = await this.processAIQuestion(userPrompt, history, GEMINI_SYSTEM_PROMPT);
                    await say({text: response.text, thread_ts: message.thread_ts});
                } catch (error) {
                    console.error('Gemini API error in-thread (!gem):', error);
                    await say({text: `Sorry <@${message.user}>, I couldn't process your request.`, thread_ts: message.ts});
                }
                return;
            }

            // Otherwise, start a new thread as before.
            try {
                const response = await this.processAIQuestion(question, [], GEMINI_SYSTEM_PROMPT);
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
                    const response = await this.processAIQuestion(userPrompt, history, GEMINI_SYSTEM_PROMPT);
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
                        const response = await this.processAIQuestion(userPrompt, history, GEMINI_SYSTEM_PROMPT);
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

        // New command for !stocknews
        this.app.message(/^!stocknews/i, async ({message, say}) => {
            if (!('user' in message)) {
                return;
            }

            if (!config.finnhubApiKey) {
                await say({text: 'The stock news feature is not configured. An API key for Finnhub is required.'});
                return;
            }

            try {
                const articles = await this.fetchStockNews();

                if (!articles || articles.length === 0) {
                    await say({
                        text: 'I couldn\'t find any recent stock market news.', thread_ts: message.ts
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
                    text: `Here are the latest headlines:\n\n${formattedArticles}`,
                    thread_ts: message.ts,
                });
            } catch (error) {
                console.error('Stock news error:', error);
                await say({
                    text: `Sorry, I couldn't fetch the stock news. Error: ${(error as Error).message}`,
                    thread_ts: message.ts,
                });
            }
        });

        // New command for !cryptonews
        this.app.message(/^!cryptonews/i, async ({message, say}) => {
            if (!('user' in message)) {
                return;
            }

            if (!config.finnhubApiKey) {
                await say({text: 'The crypto news feature is not configured. An API key for Finnhub is required.'});
                return;
            }

            try {
                const articles = await this.fetchCryptoNews();

                if (!articles || articles.length === 0) {
                    await say({
                        text: 'I couldn\'t find any recent crypto news.', thread_ts: message.ts
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
                    text: `Here are the latest crypto headlines:\n\n${formattedArticles}`,
                    thread_ts: message.ts,
                });
            } catch (error) {
                console.error('Crypto news error:', error);
                await say({
                    text: `Sorry, I couldn't fetch the crypto news. Error: ${(error as Error).message}`,
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
                    const profileRes = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${config.finnhubApiKey}`);
                    const profile: any = await profileRes.json();
                    const marketCap = profile.marketCapitalization;
                    const companyName = profile.name;

                    // Fetch 52 week high/low from /stock/metric
                    const metricRes = await fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${config.finnhubApiKey}`);
                    const metric: any = await metricRes.json();
                    const high52 = metric.metric?.['52WeekHigh'];
                    const high52Date = metric.metric?.['52WeekHighDate'];
                    const low52 = metric.metric?.['52WeekLow'];
                    const low52Date = metric.metric?.['52WeekLowDate'];

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
                const earningsRes = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${today}&to=${today}&symbol=${ticker}&token=${config.finnhubApiKey}`);
                const earnings: any = await earningsRes.json();

                if (!earnings.earningsCalendar || earnings.earningsCalendar.length === 0) {
                    await say({text: `No upcoming earnings found for *${ticker}*.`});
                    return;
                }

                const upcomingEarnings = earnings.earningsCalendar
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

    private async fetchQuoteData(ticker: string): Promise<{price: number; change: number; percentChange: number} | null> {
        if (!config.finnhubApiKey) {
            console.error('Finnhub API key is not configured.');
            return null;
        }
        const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${config.finnhubApiKey}`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`Finnhub API bad response for ${ticker}: ${response.statusText}`);
                return null;
            }
            const data = (await response.json()) as {c: number; d: number; dp: number};

            if (!data || typeof data.c === 'undefined') {
                return null;
            }

            return {
                price: data.c, // current price
                change: data.d, // change
                percentChange: data.dp, // percent change
            };
        } catch (error) {
            console.error(`Error fetching quote for ${ticker}:`, error);
            return null;
        }
    }

    private async formatQuote(ticker: string, displayName?: string): Promise<string> {
        const displayTicker = displayName || ticker;

        if (!config.finnhubApiKey) {
            return `*${displayTicker}*: No data found (API key not configured)`;
        }

        try {
            // Fetch company name from /stock/profile2
            const profileRes = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${config.finnhubApiKey}`);
            const profile: any = await profileRes.json();
            const companyName = profile?.name || ticker;

            // Fetch price data from /quote
            const quote = await this.fetchQuoteData(ticker);

            if (!quote) {
                return `*${ticker} (${companyName})*: No price data found`;
            }

            const {price, change, percentChange} = quote;
            const sign = change >= 0 ? '+' : '';
            const emoji = this.getColoredTileEmoji(percentChange);

            return `${emoji} *${ticker}* (${companyName}): $${price.toFixed(2)} (${sign}${change.toFixed(2)}, ${sign}${percentChange.toFixed(2)}%)`;
        } catch (error) {
            console.error(`Error fetching quote for ${ticker}:`, error);
            return `*${displayTicker}*: Error fetching data`;
        }
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
            systemInstruction: systemPrompt,
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