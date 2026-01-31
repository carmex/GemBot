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

import fetch from 'node-fetch';
import { config } from '../config';
import { Candle, Split } from '../types';
import { sleep } from './utils';
import { getCachedSplits, saveSplits } from './market-data-db';

/**
 * Fetches stock splits from Alpha Vantage with caching.
 * @param ticker The stock ticker symbol.
 * @param fromDate Start date (YYYY-MM-DD).
 * @param toDate End date (YYYY-MM-DD).
 */
export async function fetchStockSplits(ticker: string, fromDate: string, toDate: string): Promise<Split[] | null> {
    // Check cache first
    const cached = getCachedSplits(ticker);
    if (cached) {
        return cached.filter(s => s.date >= fromDate && s.date <= toDate);
    }

    const url = `https://www.alphavantage.co/query?function=SPLITS&symbol=${ticker}&apikey=${config.alphaVantageApiKey}`;

    try {
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            attempts++;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Alpha Vantage API request failed: ${response.statusText}`);
            }

            const data = await response.json() as any;

            if (data.Information || data.Note) {
                const info = data.Information || data.Note || "";
                if (info.toLowerCase().includes("rate limit") || info.toLowerCase().includes("spreading out") || info.toLowerCase().includes("standard api call frequency")) {
                    console.warn(`[AlphaVantage] Rate limit hit for splits ${ticker} (attempt ${attempts}/${maxAttempts}). Waiting 1.5s...`);
                    await sleep(1500);
                    continue;
                }
            }

            if (!data.data || !Array.isArray(data.data)) {
                // If it's an error message or empty response that's not a rate limit
                if (data["Error Message"]) {
                    console.error(`[AlphaVantage] Error fetching splits for ${ticker}: ${data["Error Message"]}`);
                    return null;
                }
                // Even if no splits, we should probably mark it as fetched in cache to avoid re-fetching
                saveSplits(ticker, []);
                return [];
            }

            const allSplits: Split[] = data.data
                .map((s: any) => ({
                    date: s.effective_date,
                    fromFactor: 1,
                    toFactor: parseFloat(s.split_factor),
                    symbol: ticker
                }));

            // Save all fetched splits to cache
            saveSplits(ticker, allSplits);

            return allSplits.filter((s: Split) => s.date >= fromDate && s.date <= toDate);
        }
    } catch (error) {
        console.error(`[AlphaVantage] Error in fetchStockSplits for ${ticker}:`, error);
        return null;
    }

    return null;
}

/**
 * Fetches candle data from Alpha Vantage.
 * @param ticker The stock ticker symbol.
 * @param range The time range (1w, 1m, 3m, 6m, 1y, 5y, my).
 */
export async function fetchStockCandles(ticker: string, range: string = '1y'): Promise<Candle[]> {
    let functionName = 'TIME_SERIES_DAILY';
    if (range === 'my') {
        functionName = 'TIME_SERIES_MONTHLY';
    } else if (['6m', '1y', '5y'].includes(range)) {
        functionName = 'TIME_SERIES_WEEKLY';
    }

    const url = `https://www.alphavantage.co/query?function=${functionName}&symbol=${ticker}&apikey=${config.alphaVantageApiKey}`;

    try {
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            attempts++;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Alpha Vantage API request failed: ${response.statusText}`);
            }

            type AlphaVantageResponse = {
                "Time Series (Daily)"?: { [key: string]: { "4. close": string } };
                "Weekly Time Series"?: { [key: string]: { "4. close": string } };
                "Monthly Time Series"?: { [key: string]: { "4. close": string } };
                "Information"?: string;
                "Note"?: string;
                "Error Message"?: string;
            };

            const data = (await response.json()) as AlphaVantageResponse;
            const timeSeries = data["Time Series (Daily)"] || data["Weekly Time Series"] || data["Monthly Time Series"];

            if (!timeSeries) {
                const info = data.Information || data.Note || "";
                if (info.toLowerCase().includes("rate limit") || info.toLowerCase().includes("spreading out") || info.toLowerCase().includes("standard api call frequency")) {
                    console.warn(`[AlphaVantage] Rate limit hit for candles ${ticker} (attempt ${attempts}/${maxAttempts}). Waiting 1.5s...`);
                    await sleep(1500);
                    continue;
                }

                if (data["Error Message"]) {
                     console.error(`[AlphaVantage] Error fetching candles for ${ticker}: ${data["Error Message"]}`);
                } else {
                     console.error(`[AlphaVantage] No Time Series data found for ${ticker} (${functionName}).`);
                }
                return [];
            }

            return Object.entries(timeSeries)
                .map(([date, values]) => ({
                    t: new Date(date).getTime(),
                    c: parseFloat(values["4. close"]),
                }))
                .sort((a, b) => a.t - b.t);
        }
    } catch (error) {
        console.error(`[AlphaVantage] Error in fetchStockCandles for ${ticker}:`, error);
        return [];
    }

    return [];
}

/**
 * Fetches crypto candle data from Alpha Vantage.
 * @param ticker The crypto ticker symbol (e.g., BTC, ETH).
 */
export async function fetchCryptoCandles(ticker: string): Promise<Candle[]> {
    const url = `https://www.alphavantage.co/query?function=DIGITAL_CURRENCY_DAILY&symbol=${ticker}&market=USD&apikey=${config.alphaVantageApiKey}`;

    try {
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            attempts++;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Alpha Vantage API request failed: ${response.statusText}`);
            }

            const data = (await response.json()) as any;
            const timeSeries = data["Time Series (Digital Currency Daily)"];

            if (!timeSeries) {
                const info = data.Information || data.Note || "";
                if (info.toLowerCase().includes("rate limit") || info.toLowerCase().includes("spreading out") || info.toLowerCase().includes("standard api call frequency")) {
                    console.warn(`[AlphaVantage] Rate limit hit for crypto candles ${ticker} (attempt ${attempts}/${maxAttempts}). Waiting 1.5s...`);
                    await sleep(1500);
                    continue;
                }

                if (data["Error Message"]) {
                    console.error(`[AlphaVantage] Error fetching crypto candles for ${ticker}: ${data["Error Message"]}`);
                } else {
                    console.error(`[AlphaVantage] No Crypto Time Series data found for ${ticker}.`);
                }
                return [];
            }

            return Object.entries(timeSeries)
                .map(([date, values]: [string, any]) => ({
                    t: new Date(date).getTime(),
                    c: parseFloat(values["4a. close (USD)"]),
                }))
                .sort((a, b) => a.t - b.t);
        }
    } catch (error) {
        console.error(`[AlphaVantage] Error in fetchCryptoCandles for ${ticker}:`, error);
        return [];
    }

    return [];
}
