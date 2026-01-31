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
import { Candle } from '../types';

/**
 * Fetches crypto candle data from CryptoCompare.
 * @param ticker The crypto ticker symbol (e.g., BTC, ETH).
 * @param range The time range (1w, 1m, 3m, 6m, 1y, 5y, my).
 */
export async function fetchCryptoCompareCandles(ticker: string, range: string = '1y'): Promise<Candle[]> {
    if (!config.cryptoCompareApiKey) {
        console.warn('[CryptoCompare] API key missing, skipping.');
        return [];
    }

    let endpoint = 'histoday';
    let limit = 365;

    switch (range) {
        case '1w':
            endpoint = 'histohour';
            limit = 168;
            break;
        case '1m':
            limit = 30;
            break;
        case '3m':
            limit = 90;
            break;
        case '6m':
            limit = 180;
            break;
        case '1y':
            limit = 365;
            break;
        case '5y':
            limit = 1825;
            break;
        case 'my':
            limit = 2000;
            break;
        default:
            limit = 365;
    }

    const url = `https://min-api.cryptocompare.com/data/v2/${endpoint}?fsym=${ticker}&tsym=USD&limit=${limit}&api_key=${config.cryptoCompareApiKey}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`CryptoCompare API request failed: ${response.statusText}`);
        }

        const data = (await response.json()) as any;

        if (data.Response === 'Error') {
            console.error(`[CryptoCompare] Error fetching candles for ${ticker}: ${data.Message}`);
            return [];
        }

        if (!data.Data || !data.Data.Data) {
            console.error(`[CryptoCompare] No data found for ${ticker}.`);
            return [];
        }

        return data.Data.Data.map((d: any) => ({
            t: d.time * 1000, // CryptoCompare returns unix timestamp in seconds
            c: d.close,
        }));
    } catch (error) {
        console.error(`[CryptoCompare] Error in fetchCryptoCompareCandles for ${ticker}:`, error);
        return [];
    }
}
