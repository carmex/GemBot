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
import fetch from 'node-fetch';
import {FormattedQuoteResult} from '../types';

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

export async function formatQuoteWithDetails(ticker: string, displayName?: string): Promise<FormattedQuoteResult> {
    const displayTicker = displayName || ticker;

    if (!config.finnhubApiKey) {
        return {
            ticker: displayTicker,
            text: `*${displayTicker}*: No data found (API key not configured)`,
            isError: true,
        };
    }

    try {
        // Fetch price data from /quote
        const quote = await fetchQuote(ticker);

        if (!quote) {
            return {
                ticker: displayTicker,
                text: `*${displayTicker}*: No price data found`,
                isError: true,
            };
        }

        const {price, change, percentChange} = quote;
        let totalPercentChange = quote.totalPercentChange;

        if (totalPercentChange === undefined) {
            const prevClose = price - change;
            if (prevClose !== 0) {
                if (quote.postMarketPrice !== undefined) {
                    totalPercentChange = ((quote.postMarketPrice - prevClose) / prevClose) * 100;
                } else if (quote.preMarketPrice !== undefined) {
                    totalPercentChange = ((quote.preMarketPrice - prevClose) / prevClose) * 100;
                }
            }
        }

        let sortPercentChange: number;
        if (totalPercentChange !== undefined && !isNaN(totalPercentChange)) {
            sortPercentChange = totalPercentChange;
        } else {
            sortPercentChange = percentChange;
        }

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

        const sign = change >= 0 ? '+' : '';
        const emoji = getColoredTileEmoji(percentChange);
        let formattedText = `${emoji} ${namePart}: $${price.toFixed(2)} (${sign}${change.toFixed(2)}, ${sign}${percentChange.toFixed(2)}%)`;

        if (quote.postMarketPrice !== undefined) {
            const postSign = (quote.postMarketChange !== undefined && quote.postMarketChange >= 0) ? '+' : '';
            const postChangeStr = quote.postMarketChange !== undefined ? `${postSign}${quote.postMarketChange.toFixed(2)}, ` : '';
            const totalSign = (totalPercentChange !== undefined && totalPercentChange >= 0) ? '+' : '';
            const totalStr = totalPercentChange !== undefined ? `${totalSign}${totalPercentChange.toFixed(2)}% Total` : '';
            formattedText += ` | Post-Market: $${quote.postMarketPrice.toFixed(2)} (${postChangeStr}${totalStr})`;
        } else if (quote.preMarketPrice !== undefined) {
            const preSign = (quote.preMarketChange !== undefined && quote.preMarketChange >= 0) ? '+' : '';
            const preChangeStr = quote.preMarketChange !== undefined ? `${preSign}${quote.preMarketChange.toFixed(2)}, ` : '';
            const totalSign = (totalPercentChange !== undefined && totalPercentChange >= 0) ? '+' : '';
            const totalStr = totalPercentChange !== undefined ? `${totalSign}${totalPercentChange.toFixed(2)}% Total` : '';
            formattedText += ` | Pre-Market: $${quote.preMarketPrice.toFixed(2)} (${preChangeStr}${totalStr})`;
        }

        return {
            ticker: displayTicker,
            text: formattedText,
            percentChange,
            totalPercentChange,
            sortPercentChange,
        };
    } catch (error) {
        console.error(`Error fetching quote for ${ticker}:`, error);
        return {
            ticker: displayTicker,
            text: `*${displayTicker}*: Error fetching data`,
            isError: true,
        };
    }
}

export async function formatQuote(ticker: string, displayName?: string): Promise<string> {
    const result = await formatQuoteWithDetails(ticker, displayName);
    return result.text;
}

/**
 * Checks whether an article is blacklisted from Google News by source or URL.
 */
export function isGoogleNewsArticle(article: {source?: string; url?: string} | null | undefined): boolean {
    if (!article) return false;

    // Check source name
    if (article.source && typeof article.source === 'string') {
        if (article.source.trim().toLowerCase() === 'google news') {
            return true;
        }
    }

    // Check URL
    if (article.url && typeof article.url === 'string') {
        const lowerUrl = article.url.trim().toLowerCase();

        // Defensive fallback: check if raw url string contains news.google.com or google.com/news
        if (lowerUrl.includes('news.google.com') || lowerUrl.includes('google.com/news')) {
            return true;
        }

        try {
            const parsedUrl = new URL(article.url);
            const hostname = parsedUrl.hostname.toLowerCase();

            if (
                hostname === 'news.google.com' ||
                hostname.endsWith('.news.google.com') ||
                hostname === 'google.com' ||
                hostname.endsWith('.google.com')
            ) {
                return true;
            }
        } catch {
            // Safely handle malformed URLs without throwing exceptions
            if (lowerUrl.includes('news.google.com') || lowerUrl.includes('google.com/news')) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Alias for isGoogleNewsArticle to identify blacklisted articles.
 */
export const isBlacklistedArticle = isGoogleNewsArticle;

/**
 * Filters out Google News articles from morning greeting news candidates.
 */
export function filterMorningGreetingArticles<T extends {source?: string; url?: string}>(articles: T[]): T[] {
    if (!Array.isArray(articles)) {
        return [];
    }
    return articles.filter(article => !isGoogleNewsArticle(article));
}

// Function to send the morning greeting
export async function sendMorningGreeting(app: App, channelId: string) {
    try {
        let text = "Good morning everyone! What's on your mind?";

        if (config.finnhubApiKey) {
            const articles = await fetchStockNews();
            if (articles && articles.length > 0) {
                const filteredArticles = filterMorningGreetingArticles(articles);
                if (filteredArticles.length > 0) {
                    const formattedArticles = filteredArticles
                        .slice(0, 5)
                        .map((article: {url: string}) => `<${article.url}|.>`)
                        .join(' ');
                    text += `\n\nHere are the latest general headlines: ${formattedArticles}`;
                }
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
export function buildUserPrompt(promptData: {channel: string, user: string, userName?: string, text?: string}): string {
    // Keep internal scaffolding for logging only; provider history will strip it later.
    const userName = promptData.userName || promptData.user;
    return `channel_id: ${promptData.channel} | user_name: ${userName} | user_id: ${promptData.user} | message: ${promptData.text || ''}`;
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Checks if a message starts with '//' (after stripping bot mentions).
 */
export function isCommentedMessage(text: string): boolean {
    if (!text) return false;
    const stripped = text.replace(/<@[^>]+>\s*/, '').trim();
    return stripped.startsWith('//');
}

/**
 * Helper to parse a markdown table row into trimmed cell values,
 * correctly handling escaped pipe characters.
 */
function parseTableRow(line: string): string[] {
    let trimmed = line.trim();
    if (trimmed.startsWith('|')) {
        trimmed = trimmed.slice(1);
    }
    if (trimmed.endsWith('|')) {
        trimmed = trimmed.slice(0, -1);
    }
    // Protect escaped pipes \|
    const safeLine = trimmed.replace(/\\\|/g, '\u0000PIPE\u0000');
    return safeLine.split('|').map(cell => cell.trim().replace(/\u0000PIPE\u0000/g, '\\|'));
}

/**
 * Checks if a line matches a markdown table delimiter row.
 * E.g., | :--- | :---: | ---: |
 */
function isDelimiterRow(line: string): boolean {
    if (!line.includes('|')) return false;
    if (!/^\s*\|?(\s*:?-+:?\s*\|?)+\s*$/.test(line)) return false;
    const cells = parseTableRow(line);
    if (cells.length === 0) return false;
    return cells.every(cell => /^:?-+:?$/.test(cell));
}

/**
 * Pads a cell's text to a target width based on column alignment.
 */
function padTableCell(text: string, width: number, align: 'left' | 'right' | 'center'): string {
    const totalPad = width - text.length;
    if (totalPad <= 0) return text;
    if (align === 'right') {
        return ' '.repeat(totalPad) + text;
    } else if (align === 'center') {
        const padLeft = Math.floor(totalPad / 2);
        const padRight = totalPad - padLeft;
        return ' '.repeat(padLeft) + text + ' '.repeat(padRight);
    } else {
        return text + ' '.repeat(totalPad);
    }
}

/**
 * Detects markdown tables in text, aligns column widths with padding,
 * and encloses each table in a Slack monospace code block (```).
 */
export function formatMarkdownTables(text: string): string {
    if (!text || !text.includes('|')) return text;

    // Protect existing code blocks (fenced and inline)
    const codeBlocks: string[] = [];
    const salt = Math.random().toString(36).substring(2, 8);
    let protectedText = text.replace(/\r\n/g, '\n');

    // Fenced code blocks
    protectedText = protectedText.replace(/```[\s\S]*?```/g, (match) => {
        const token = `%%CODE_BLOCK_${salt}_${codeBlocks.length}%%`;
        codeBlocks.push(match);
        return token;
    });

    // Inline code
    protectedText = protectedText.replace(/`[^`\n]+`/g, (match) => {
        const token = `%%CODE_BLOCK_${salt}_${codeBlocks.length}%%`;
        codeBlocks.push(match);
        return token;
    });

    const lines = protectedText.split('\n');
    const outputLines: string[] = [];
    let i = 0;

    while (i < lines.length) {
        if (i + 1 < lines.length && lines[i].includes('|') && isDelimiterRow(lines[i + 1])) {
            const headerCells = parseTableRow(lines[i]);
            const delimiterCells = parseTableRow(lines[i + 1]);

            if (headerCells.length > 0 && delimiterCells.length > 0 && headerCells.length === delimiterCells.length) {
                const numCols = delimiterCells.length;
                const dataRows: string[][] = [];
                let j = i + 2;

                while (j < lines.length) {
                    const rowLine = lines[j];
                    if (!rowLine.trim() || !rowLine.includes('|')) {
                        break;
                    }
                    const rowCells = parseTableRow(rowLine);
                    while (rowCells.length < numCols) {
                        rowCells.push('');
                    }
                    dataRows.push(rowCells.slice(0, numCols));
                    j++;
                }

                // Determine column alignments
                const alignments: ('left' | 'right' | 'center')[] = delimiterCells.map(delim => {
                    if (delim.startsWith(':') && delim.endsWith(':')) return 'center';
                    if (delim.endsWith(':')) return 'right';
                    return 'left';
                });

                // Determine maximum character width for each column across all rows
                const colWidths: number[] = [];
                for (let c = 0; c < numCols; c++) {
                    let maxLen = Math.max(headerCells[c].length, delimiterCells[c].length);
                    for (const row of dataRows) {
                        maxLen = Math.max(maxLen, row[c].length);
                    }
                    const minLen = alignments[c] === 'center' ? 3 : 2;
                    colWidths.push(Math.max(maxLen, minLen));
                }

                // Format header row
                const formattedHeader = headerCells.map((cell, c) => padTableCell(cell, colWidths[c], alignments[c]));

                // Format delimiter row with matching dashes per column
                const formattedDelimiter = delimiterCells.map((delim, c) => {
                    const width = colWidths[c];
                    const align = alignments[c];
                    if (align === 'center') {
                        return ':' + '-'.repeat(Math.max(1, width - 2)) + ':';
                    } else if (align === 'right') {
                        return '-'.repeat(Math.max(1, width - 1)) + ':';
                    } else {
                        if (delim.startsWith(':')) {
                            return ':' + '-'.repeat(Math.max(1, width - 1));
                        } else {
                            return '-'.repeat(width);
                        }
                    }
                });

                // Format data rows
                const formattedDataRows = dataRows.map(row =>
                    row.map((cell, c) => padTableCell(cell, colWidths[c], alignments[c]))
                );

                const formatRow = (cells: string[]) => `| ${cells.join(' | ')} |`;
                const tableRows = [
                    formatRow(formattedHeader),
                    formatRow(formattedDelimiter),
                    ...formattedDataRows.map(row => formatRow(row)),
                ];

                outputLines.push('```');
                outputLines.push(...tableRows);
                outputLines.push('```');

                i = j;
                continue;
            }
        }

        outputLines.push(lines[i]);
        i++;
    }

    let result = outputLines.join('\n');

    // Restore protected code blocks
    const tokenRegex = new RegExp(`%%CODE_BLOCK_${salt}_(\\d+)%%`, 'g');
    result = result.replace(tokenRegex, (_, idx) => codeBlocks[Number(idx)]);

    return result;
}

/**
 * Converts standard Markdown to Slack-compatible mrkdwn.
 */
export function markdownToSlack(text: string): string {
    if (!text) return text;

    // 1. Format markdown tables into aligned code blocks
    let out = formatMarkdownTables(text);

    // 2. Protect existing code blocks (fenced and inline) before standard transformations
    const codeBlocks: string[] = [];
    const salt = Math.random().toString(36).substring(2, 8);

    // Fenced code blocks
    out = out.replace(/```[\s\S]*?```/g, (match) => {
        const token = `%%CODE_BLOCK_${salt}_${codeBlocks.length}%%`;
        codeBlocks.push(match);
        return token;
    });

    // Inline code
    out = out.replace(/`[^`\n]+`/g, (match) => {
        const token = `%%CODE_BLOCK_${salt}_${codeBlocks.length}%%`;
        codeBlocks.push(match);
        return token;
    });

    // 3. Headers: # Header -> *Header*
    out = out.replace(/^(#{1,6})\s+(.+)$/gm, '*$2*');

    // 4. Bold: **text** -> *text*
    out = out.replace(/\*\*(.*?)\*\*/g, '*$1*');

    // 5. Italic: __text__ -> _text_
    out = out.replace(/__(.*?)__/g, '_$1_');

    // 6. Links: [text](url) or [text](<url>) -> <url|text>
    out = out.replace(/\[([^\]]+)\]\((<?)(https?:\/\/[^\s>)]+)(>?)\)/g, '<$3|$1>');

    // 7. Bullets: * , - , + at the start of a line -> •
    out = out.replace(/^(\s*)([*+-])\s+/gm, '$1• ');

    // 8. Restore protected code blocks
    const tokenRegex = new RegExp(`%%CODE_BLOCK_${salt}_(\\d+)%%`, 'g');
    out = out.replace(tokenRegex, (_, idx) => codeBlocks[Number(idx)]);

    return out;
}

/**
 * Checks if a link is restricted (e.g., Reddit).
 */
export function isRestrictedLink(link: string): boolean {
    try {
        const url = new URL(link);
        const hostname = url.hostname.toLowerCase();
        return (
            hostname === 'reddit.com' ||
            hostname.endsWith('.reddit.com') ||
            hostname === 'redd.it' ||
            hostname.endsWith('.redd.it')
        );
    } catch (e) {
        // If the URL is malformed, consider it not restricted but log it or handle as needed
        return false;
    }
}

/**
 * Extracts URLs from message text, handling both Slack formatted links (<url|label> or <url>)
 * and plain HTTP/HTTPS URLs. De-duplicates and returns an array of URLs.
 */
export function extractUrls(text: string): string[] {
    if (!text) return [];

    const urls: string[] = [];

    // Slack formatted links: <https://url|label> or <https://url>
    const slackRegex = /<(https?:\/\/[^>|]+)(?:\|[^>]+)?>/g;
    let match: RegExpExecArray | null;

    while ((match = slackRegex.exec(text)) !== null) {
        if (match[1]) {
            urls.push(match[1]);
        }
    }

    // Strip Slack formatted links to avoid duplicate matches with plain URL regex
    const cleanText = text.replace(slackRegex, ' ');
    const plainRegex = /(https?:\/\/[^\s<>]+)/g;

    while ((match = plainRegex.exec(cleanText)) !== null) {
        if (match[1]) {
            let url = match[1].replace(/[.,;)]+$/, '');
            urls.push(url);
        }
    }

    return Array.from(new Set(urls));
}

/**
 * Checks whether a given URL points to an image.
 * First checks path extensions (.png, .jpg, .jpeg, .gif, .webp, .bmp, .svg).
 * If ambiguous or no extension match, performs a HEAD request with 3s timeout to check Content-Type header.
 */
export async function isImageUrl(url: string): Promise<boolean> {
    if (!url) return false;

    // 1. Check path extension
    try {
        const parsed = new URL(url);
        const pathname = parsed.pathname;
        if (/\.(jpeg|jpg|gif|png|webp|bmp|svg)$/i.test(pathname)) {
            return true;
        }
    } catch {
        const cleanUrl = url.split('?')[0].split('#')[0];
        if (/\.(jpeg|jpg|gif|png|webp|bmp|svg)$/i.test(cleanUrl)) {
            return true;
        }
    }

    // 2. Fallback to HEAD request with 3-second timeout
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            headers: {
                'User-Agent': 'GemBot/1.0',
            },
        });
        clearTimeout(timeout);

        if (response.ok) {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.toLowerCase().startsWith('image/')) {
                return true;
            }
        }
    } catch {
        // Return false if HEAD request fails or times out
    }

    return false;
}