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

import {App} from '@slack/bolt';
import {AIHandler} from '../features/ai-handler';
import {config} from '../config';
import {
    getAllUserUsage,
    getUserUsage,
    trackImageInvocation
} from "../features/usage-db";
import {fetchCryptoNews, fetchEarningsCalendar, fetchStockNews} from "../features/finnhub-api";
import Roll from 'roll';
import {formatQuote, getColoredTileEmoji} from "../features/utils";
import {sendMorningGreeting} from '../features/utils';

export const registerCommandListeners = (app: App, aiHandler: AIHandler) => {
    app.message(/^!roll (.+)/i, async ({message, context, client}) => {
        if (!('user' in message) || !message.user) {
            return;
        }
        const diceString = context.matches[1].trim();
        try {
            const {default: Roll} = await import('roll');
            const roll = new Roll();
            const result = roll.roll(diceString);
            const rollResultText = `User <@${message.user}> rolled *${diceString}* and got: *${result.result}*  _(${result.rolled.join(', ')})_`;
            await client.chat.postMessage({
                channel: message.channel,
                text: rollResultText,
            });
        } catch (error) {
            await client.chat.postMessage({
                channel: message.channel,
                text: `Sorry, I couldn't roll "${diceString}". Please use standard dice notation (e.g., \`1d20\`, \`2d6+3\`).`,
            });
        }
    });

    app.message(/^!chart\s*$/i, async ({say}) => {
        await say('Usage: `!chart TICKER [RANGE]`\nExample: `!chart AAPL 1y`\nAvailable ranges: 1m, 3m, 6m, 1y, 5y (default is 1y)');
    });

    app.message(/^!chart ([A-Z]+)(?:\s+(1m|3m|6m|1y|5y))?/i, async ({message, context, say, client}) => {
        if (!('user' in message) || !message.user || !context.matches?.[1]) return;
        if (!config.alphaVantageApiKey) {
            await say({text: 'The charting feature is not configured. An API key for Alpha Vantage is required.'});
            return;
        }
        const ticker = context.matches[1].toUpperCase();
        const range = context.matches[2] || '1y';
        try {
            const workingMessage = await say({text: `📈 Generating chart for *${ticker}* over the last *${range}*...`});
            const candles = await aiHandler.getStockCandles(ticker, range);
            if (candles.length === 0) {
                await say({text: `No data found for *${ticker}* in the selected range.`});
                if (workingMessage.ts) await client.chat.delete({channel: message.channel, ts: workingMessage.ts});
                return;
            }
            const chartImage = await aiHandler.generateChart(ticker, candles);
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

    app.message(/^!usage(?:\s+(\d{4}-\d{2}-\d{2}))?$/, async ({message, context, say}) => {
        if (!('user' in message) || !message.user) {
            return;
        }
        try {
            const date = context.matches?.[1];
            const usage = await getUserUsage(message.user, date);
            if (usage) {
                const cost = (
                    ((usage.totalPromptTokens / 1000000) * 1.25) +
                    ((usage.totalResponseTokens / 1000000) * 10) +
                    (usage.imageInvocations * 0.04)
                ).toFixed(2);
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

    app.message(/^!usage all$/, async ({message, say}) => {
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
                const cost = (
                    ((usage.totalPromptTokens / 1000000) * 1.25) +
                    ((usage.totalResponseTokens / 1000000) * 10) +
                    (usage.imageInvocations * 0.04)
                ).toFixed(2);
                summary += `• *${usage.date}*: LLM: ${usage.llmInvocations}, Image: ${usage.imageInvocations}, Tokens: ${usage.totalTokens}, Prompt: ${usage.totalPromptTokens}, Response: ${usage.totalResponseTokens}, $${cost}\n`;
                totalLLM += usage.llmInvocations;
                totalImage += usage.imageInvocations;
                totalPrompt += usage.totalPromptTokens;
                totalResponse += usage.totalResponseTokens;
                totalTokens += usage.totalTokens;
            }
            const totalCost = (
                ((totalPrompt / 1000000) * 1.25) +
                ((totalResponse / 1000000) * 10) +
                (totalImage * 0.04)
            ).toFixed(2);
            summary += `\n*Total*: LLM: ${totalLLM}, Image: ${totalImage}, Tokens: ${totalTokens}, Prompt: ${totalPrompt}, Response: ${totalResponse}, $${totalCost}`;
            await say(summary);
        } catch (error) {
            console.error('Error in !usage all handler:', error);
            await say('Sorry, there was an error fetching your usage data.');
        }
    });

    app.message(/^!usage total$/, async ({message, say}) => {
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
            for (const usage of allUsage) {
                totalLLM += usage.llmInvocations;
                totalImage += usage.imageInvocations;
                totalPrompt += usage.totalPromptTokens;
                totalResponse += usage.totalResponseTokens;
                totalTokens += usage.totalTokens;
            }
            const totalCost = (
                ((totalPrompt / 1000000) * 1.25) +
                ((totalResponse / 1000000) * 10) +
                (totalImage * 0.04)
            ).toFixed(2);
            const summary =
                `*Total Usage for <@${message.user}>:*
` +
                `*- LLM Invocations:* ${totalLLM}
` +
                `*- Image Invocations:* ${totalImage}
` +
                `*- Total Tokens Used:* ${totalTokens}
` +
                `*- Prompt Tokens:* ${totalPrompt}
` +
                `*- Response Tokens:* ${totalResponse}
` +
                `*- Estimated Cost:* $${totalCost}`;
            await say(summary);
        } catch (error) {
            console.error('Error in !usage total handler:', error);
            await say('Sorry, there was an error fetching your usage data.');
        }
    });

    app.message(/^!usage\s+<@([A-Z0-9]+)>(?:\s+(\d{4}-\d{2}-\d{2}))?$/, async ({message, context, say}) => {
        if (!('user' in message) || !message.user) {
            return;
        }
        try {
            const targetUserId = context.matches?.[1];
            const date = context.matches?.[2];
            if (!targetUserId) {
                await say('Could not parse the user mention.');
                return;
            }
            const usage = await getUserUsage(targetUserId, date);
            if (usage) {
                const cost = (
                    ((usage.totalPromptTokens / 1000000) * 1.25) +
                    ((usage.totalResponseTokens / 1000000) * 10) +
                    (usage.imageInvocations * 0.04)
                ).toFixed(2);
                const responseText =
                    `*Usage Stats for <@${targetUserId}> (${usage.date})*
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
                await say(`I don't have any usage data for <@${targetUserId}> for ${date || 'today'}.`);
            }
        } catch (error) {
            console.error('Error in !usage @username handler:', error);
            await say('Sorry, there was an error fetching the usage data.');
        }
    });

    app.message(/^!image\s+(.+)/, async ({message, context, say, client}) => {
        if (!('user' in message) || !message.user || message.subtype) {
            return;
        }

        if (!config.vertex.projectId || !config.gemini.apiKey) {
            await say({
                text: 'The image generation feature is not configured. A Google Cloud Project ID and Gemini API key are required.',
                thread_ts: message.thread_ts,
            });
            return;
        }

        const prompt = context.matches[1];
        try {
            const workingMessage = await say({
                text: `Got it. Generating an image for "_${prompt}_"...`,
                thread_ts: message.thread_ts,
            });
            const result = await aiHandler.generateImage(prompt);
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
                trackImageInvocation(message.user);
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

    app.message(/^!news(?:\s+(general|crypto))?/i, async ({message, context, say}) => {
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

    app.message(/^!earnings ([A-Z.]+)$/i, async ({message, context, say}) => {
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

    app.message(/^!test-morning-greeting$/i, async ({message, say}) => {
        if (!('user' in message) || !message.user) {
            return;
        }

        try {
            if (config.slack.morningGreetingChannelId) {
                await sendMorningGreeting(app, config.slack.morningGreetingChannelId);
                await say({text: '✅ Morning greeting test completed!', thread_ts: message.ts});
            } else {
                await say({
                    text: 'Morning greeting channel ID is not set. Please configure `SLACK_MORNING_GREETING_CHANNEL_ID` in your `.env` file.',
                    thread_ts: message.ts
                });
            }
        } catch (error) {
            console.error('Error in test morning greeting:', error);
            await say({
                text: `❌ Error testing morning greeting: ${(error as Error).message}`,
                thread_ts: message.ts
            });
        }
    });

    app.message(/^!gembot on$/i, async ({message, say}) => {
        if (!('user' in message) || !message.user || !('thread_ts' in message) || !message.thread_ts) {
            await say({text: 'This command only works in threads.'});
            return;
        }
        const threadKey = `${message.channel}-${message.thread_ts}`;
        aiHandler.disabledThreads.delete(threadKey);
        aiHandler.saveDisabledThreads();
        await say({text: '🤖 Gembot is now enabled in this thread!', thread_ts: message.thread_ts});
    });

    app.message(/^!gembot off$/i, async ({message, say}) => {
        if (!('user' in message) || !message.user || !('thread_ts' in message) || !message.thread_ts) {
            await say({text: 'This command only works in threads.'});
            return;
        }
        const threadKey = `${message.channel}-${message.thread_ts}`;
        aiHandler.disabledThreads.add(threadKey);
        aiHandler.saveDisabledThreads();
        await say({
            text: '🤐 Gembot is now disabled in this thread. Use `!gembot on` to re-enable, or `@mention` me for responses.',
            thread_ts: message.thread_ts
        });
    });

    app.message(/^!gembot channel on$/i, async ({message, say}) => {
        if (!('user' in message) || !message.user) {
            return;
        }
        aiHandler.enabledChannels.add(message.channel);
        aiHandler.saveEnabledChannels();
        await say({text: '🤖 Gembot will now respond to all messages in this channel. Use `!gembot channel off` to disable.'});
    });

    app.message(/^!gembot channel off$/i, async ({message, say}) => {
        if (!('user' in message) || !message.user) {
            return;
        }
        aiHandler.enabledChannels.delete(message.channel);
        aiHandler.saveEnabledChannels();
        await say({text: '🤖 Gembot will no longer respond to all messages in this channel.'});
    });

    app.message(/^!gembot rpg (gm|player)$/i, async ({message, context, say}) => {
        if (!('user' in message) || !message.user) {
            return;
        }
        const mode = context.matches[1];
        aiHandler.rpgEnabledChannels.set(message.channel, mode);
        aiHandler.saveRpgEnabledChannels();
        await say({text: `🧙 RPG mode is now **${mode.toUpperCase()}** in this channel.`});
    });

    app.message(/^!gembot rpg off$/i, async ({message, say}) => {
        if (!('user' in message) || !message.user) {
            return;
        }
        aiHandler.rpgEnabledChannels.delete(message.channel);
        aiHandler.saveRpgEnabledChannels();
        await say({text: '👍 RPG mode has been turned **OFF** in this channel.'});
    });

    app.message(/^!gembot rpg status$/i, async ({message, say}) => {
        if (!('user' in message) || !message.user) {
            return;
        }
        const mode = aiHandler.rpgEnabledChannels.get(message.channel);
        if (mode) {
            await say({text: `RPG mode is currently **${mode.toUpperCase()}** in this channel.`});
        } else {
            await say({text: 'RPG mode is currently **OFF** in this channel.'});
        }
    });

    app.message(/^!gembot rpg$/i, async ({message, say}) => {
        if (!('user' in message) || !message.user) {
            return;
        }
        await say({
            text: 'Usage: `!gembot rpg <command>`\nAvailable commands: `gm`, `player`, `off`, `status`',
        });
    });

    app.message(/^!gembot help$/i, async ({message, say}) => {
        const helpText = `
*Available Commands*

*AI & Fun*
• \`@<BotName> <prompt>\`: Mention the bot in a channel to start a new threaded conversation, or in an existing thread to have it join with context.
• \`!image <prompt>\`: Generates an image based on your text prompt using Imagen 4.
• \`!gembot on\`: Enable Gembot in the current thread.
• \`!gembot off\`: Disable Gembot in the current thread.

*RPG Mode*
• \`!gembot rpg <gm|player|off|status>\`: Manage RPG mode for this channel.
  • \`gm\`: The bot acts as the Game Master, responding to every message.
  • \`player\`: The bot acts as a player, only responding when @-mentioned.
  • \`off\`: Disables RPG mode in the channel.
  • \`status\`: Checks the current RPG mode status for the channel.
• \`!roll <dice>\`: Rolls dice using standard dice notation (e.g., \`1d20\`, \`2d6+3\`).

*Stocks & Crypto*
• \`!q <TICKER...>\`: Get a real-time stock quote.
• \`!cq <TICKER...>\`: Get a real-time crypto quote (e.g., \`!cq BTC ETH\`).
• \`!chart <TICKER> [range]\`: Generates a stock chart. Ranges: \`1m\`, \`3m\`, \`6m\`, \`1y\`, \`5y\`.
• \`!stats <TICKER...>\`: Get key statistics for a stock (Market Cap, 52-week high/low).
• \`!earnings <TICKER>\`: Get upcoming earnings dates.
• \`!stocknews\`: Fetches the latest general stock market news.
• \`!cryptonews\`: Fetches the latest cryptocurrency news.

*Watchlist*
• \`!watchlist\`: View your current stock watchlist with P/L.
• \`!watch <TICKER> [date] [price] [shares]\`: Add a stock to your watchlist.
• \`!unwatch <TICKER>\`: Remove a stock from your watchlist.

*Usage Tracking*
The bot tracks usage of the LLM and image generation features. You can check your usage with the following commands. The costs shown are estimates only and should not be used for billing purposes.
• \`!usage\`: Show your usage statistics for today.
• \`!usage YYYY-MM-DD\`: Show your usage statistics for a specific date.
• \`!usage all\`: Show a detailed, day-by-day breakdown of your entire usage history.
• \`!usage total\`: Show a lifetime summary of your usage statistics.
• \`!usage @user\`: Show another user's usage statistics for today.
• \`!usage @user YYYY-MM-DD\`: Show another user's usage statistics for a specific date.
`;
        await say({text: helpText, thread_ts: message.ts});
    });

    const gembotUsage =
        'Usage: `!gembot <command>`\n' +
        'Available commands:\n' +
        '• `on`: Enable Gembot in the current thread.\n' +
        '• `off`: Disable Gembot in the current thread.\n' +
        '• `channel on`: Enable Gembot for all messages in this channel.\n' +
        '• `channel off`: Disable Gembot for all messages in this channel.\n' +
        '• `rpg <gm|player|off|status>`: Manage RPG mode for this channel.\n' +
        '• `help`: Show the help message with all commands.';

    app.message(/^!gembot$/i, async ({say}) => {
        await say(gembotUsage);
    });

    app.message(/^!gembot (.+)/i, async ({context, say}) => {
        const subcommand = context.matches[1].trim();

        const knownPatterns = [
            /^on$/i,
            /^off$/i,
            /^channel on$/i,
            /^channel off$/i,
            /^rpg (gm|player)$/i,
            /^rpg off$/i,
            /^rpg status$/i,
            /^rpg$/i,
            /^help$/i,
        ];

        if (knownPatterns.some(pattern => pattern.test(subcommand))) {
            return; // It's a known command handled elsewhere, so we do nothing.
        }

        console.log(`Unknown gembot command: ${context.matches[1]}`);
        await say(gembotUsage);
    });
};
