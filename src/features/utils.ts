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

import {config} from '../config';
import {fetchCompanyProfile, fetchQuote} from './finnhub-api';
import {App} from '@slack/bolt';
import {fetchStockNews} from './finnhub-api';

export const getColoredTileEmoji = (percentChange: number): string => {
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
};

// Helper function to format market cap
export const formatMarketCap = (marketCap: number): string => {
    if (marketCap >= 1e12) {
        return `$${(marketCap / 1e12).toFixed(2)}T`;
    } else if (marketCap >= 1e9) {
        return `$${(marketCap / 1e9).toFixed(2)}B`;
    } else if (marketCap >= 1e6) {
        return `$${(marketCap / 1e6).toFixed(2)}M`;
    } else {
        return `$${marketCap.toFixed(2)}`;
    }
};

export async function formatQuote(ticker: string, displayName?: string): Promise<string> {
    const displayTicker = displayName || ticker;

    if (!config.finnhubApiKey) {
        return `*${displayTicker}*: No data found (API key not configured)`;
    }

    try {
        // Fetch price data from /quote
        const quote = await fetchQuote(ticker);

        if (!quote) {
            return `*${displayTicker}*: No price data found`;
        }

        const {price, change, percentChange} = quote;
        const sign = change >= 0 ? '+' : '';
        const emoji = getColoredTileEmoji(percentChange);

        let namePart: string;
        // If displayName is provided, it's a crypto quote. Just use the ticker.
        if (displayName) {
            namePart = `*${displayTicker}*`;
        } else {
            // Otherwise, it's a stock, so fetch the company profile.
            const profile = await fetchCompanyProfile(ticker);
            const companyName = profile?.name || ticker;
            namePart = `*${displayTicker}* (${companyName})`;
        }

        return `${emoji} ${namePart}: $${price.toFixed(2)} (${sign}${change.toFixed(2)}, ${sign}${percentChange.toFixed(2)}%)`;
    } catch (error) {
        console.error(`Error fetching quote for ${ticker}:`, error);
        return `*${displayTicker}*: Error fetching data`;
    }
}

// Function to send the morning greeting
export async function sendMorningGreeting(app: App, channelId: string) {
    try {
        let text = "Good morning @boltar. What's on your mind?";//'Good morning everyone! What are your top priorities for today?';

        if (config.finnhubApiKey) {
            const articles = await fetchStockNews();
            if (articles && articles.length > 0) {
                const formattedArticles = articles
                    .slice(0, 5)
                    .map((article: {url: string}) => `<${article.url}|.>`)
                    .join(' ');
                text += `\n\nHere are the latest general headlines: ${formattedArticles}`;
            }
        }

        await app.client.chat.postMessage({
            token: config.slack.botToken,
            channel: channelId,
            text: text,
        });

        console.log('Morning greeting sent successfully.');
    } catch (error) {
        console.error('Failed to send morning greeting:', error);
    }
} 
export function buildUserPrompt(promptData: {channel: string, user: string, text?: string}): string {
    // Keep internal scaffolding for logging only; provider history will strip it later.
    return `channel_id: ${promptData.channel} | user_id: ${promptData.user} | message: ${promptData.text || ''}`;
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Converts standard Markdown to Slack-compatible mrkdwn.
 */
export function markdownToSlack(text: string): string {
    if (!text) return text;

    let out = text;

    // 1. Headers: # Header -> *Header*
    out = out.replace(/^(#{1,6})\s+(.+)$/gm, '*$2*');

    // 2. Bold: **text** -> *text*
    out = out.replace(/\*\*(.*?)\*\*/g, '*$1*');

    // 3. Italic: __text__ -> _text_
    out = out.replace(/__(.*?)__/g, '_$1_');

    // 4. Links: [text](url) or [text](<url>) -> <url|text>
    out = out.replace(/\[([^\]]+)\]\((<?)(https?:\/\/[^\s>)]+)(>?)\)/g, '<$3|$1>');

    // 5. Bullets: * , - , + at the start of a line -> •
    out = out.replace(/^(\s*)([*+-])\s+/gm, '$1• ');

    return out;
}