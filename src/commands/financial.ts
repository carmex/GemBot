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
import {config} from '../config';
import {fetchQuote, fetchCompanyProfile, fetchStockMetrics, fetchStockNews, fetchCryptoNews, fetchEarningsCalendar} from '../features/finnhub-api';
import {getColoredTileEmoji, formatMarketCap, formatQuote} from '../features/utils';
import {getCryptoCandles} from '../features/stock-charts';

export const registerFinancialCommands = (app: App) => {
    // New command handler for !cq
    app.message(/^!cq (.+)/i, async ({message, context, say}) => {
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
                    return formatQuote(cryptoTicker, ticker);
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

    // New command handler for !cstats
    app.message(/^!cstats ([A-Z\s]+)$/i, async ({message, context, say}) => {
        if (!('user' in message) || !context.matches?.[1]) return;

        if (!config.finnhubApiKey) {
            await say({
                text: 'The cstats feature is not configured. An API key for Finnhub is required.',
            });
            return;
        }

        const tickers = context.matches[1].toUpperCase().split(/\s+/).filter(Boolean);
        try {
            const results = await Promise.all(tickers.map(async (ticker: string) => {
                const cryptoTicker = `BINANCE:${ticker}USDT`;
                const quote = await fetchQuote(cryptoTicker);

                // Fetch historical data for 52-week high/low
                const candles = await getCryptoCandles(ticker, '1y');

                let high52 = 0;
                let low52 = Infinity;

                if (candles.length > 0) {
                    candles.forEach(c => {
                        if (c.c > high52) high52 = c.c;
                        if (c.c < low52) low52 = c.c;
                    });
                }

                if (!quote && candles.length === 0) {
                    return `*${ticker}*: No crypto stats found.`;
                }

                let response = `*${ticker}* crypto stats:\n`;
                if (quote) {
                    const emoji = getColoredTileEmoji(quote.percentChange);
                    response += `• Current Price: $${quote.price.toLocaleString()} ${emoji} (${quote.percentChange >= 0 ? '+' : ''}${quote.percentChange.toFixed(2)}%)\n`;
                }
                if (candles.length > 0) {
                    response += `• 52-Week High: $${high52.toLocaleString()}\n`;
                    response += `• 52-Week Low: $${low52.toLocaleString()}`;
                }
                return response;
            }));

            await say({text: results.join('\n\n')});
        } catch (error) {
            console.error('Crypto stats error:', error);
            await say({text: `Sorry, I couldn't fetch the crypto stats. Error: ${(error as Error).message}`});
        }
    });

    // New command handler for !q
    app.message(/^!q (.+)/i, async ({message, context, say}) => {
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
                tickers.map((ticker: string) => formatQuote(ticker))
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

    // New command handler for !stats (now supports multiple tickers)
    app.message(/^!stats ([A-Z.\s]+)$/i, async ({message, context, say}) => {
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
                if (marketCap) response += `• Market Cap: ${formatMarketCap(marketCap * 1_000_000)}\n`;
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
    app.message(/^!earnings ([A-Z.]+)$/i, async ({message, context, say}) => {
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
}; 