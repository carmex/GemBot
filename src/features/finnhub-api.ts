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
import fetch from 'node-fetch';

const FINNHUB_API_KEY = config.finnhubApiKey;
const BASE_URL = 'https://finnhub.io/api/v1';

async function apiFetch(endpoint: string) {
    if (!FINNHUB_API_KEY) {
        throw new Error('Finnhub API key is not configured.');
    }
    const url = `${BASE_URL}/${endpoint}&token=${FINNHUB_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Finnhub API request failed: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

export async function fetchQuote(ticker: string): Promise<{price: number; change: number; percentChange: number} | null> {
    try {
        const data = (await apiFetch(`quote?symbol=${ticker}`)) as {c: number; d: number; dp: number};
        if (!data || typeof data.c === 'undefined') {
            return null;
        }
        return {
            price: data.c,
            change: data.d,
            percentChange: data.dp,
        };
    } catch (error) {
        console.error(`Error fetching quote for ${ticker}:`, error);
        return null;
    }
}

export async function fetchCompanyProfile(ticker: string): Promise<{name: string; marketCapitalization: number} | null> {
    try {
        return (await apiFetch(`stock/profile2?symbol=${ticker}`)) as {name: string; marketCapitalization: number};
    } catch (error) {
        console.error(`Error fetching company profile for ${ticker}:`, error);
        return null;
    }
}

export async function fetchStockMetrics(ticker: string): Promise<any | null> {
    try {
        const data = await apiFetch(`stock/metric?symbol=${ticker}&metric=all`) as {metric?: any};
        return data?.metric;
    } catch (error) {
        console.error(`Error fetching metrics for ${ticker}:`, error);
        return null;
    }
}

export async function fetchStockNews(): Promise<{headline: string; source: string; url: string}[] | null> {
    try {
        return (await apiFetch('news?category=general')) as {headline: string; source: string; url: string}[];
    } catch (error) {
        console.error('Error fetching stock news:', error);
        return null;
    }
}

export async function fetchCryptoNews(): Promise<{headline: string; source: string; url: string}[] | null> {
    try {
        return (await apiFetch('news?category=crypto')) as {headline: string; source: string; url: string}[];
    } catch (error) {
        console.error('Error fetching crypto news:', error);
        return null;
    }
}

export async function fetchEarningsCalendar(ticker: string): Promise<any[] | null> {
    try {
        const today = new Date().toISOString().split('T')[0];
        const data = await apiFetch(`calendar/earnings?from=${today}&to=${today}&symbol=${ticker}`) as {earningsCalendar?: any[]};
        return data?.earningsCalendar || null;
    } catch (error) {
        console.error(`Error fetching earnings for ${ticker}:`, error);
        return null;
    }
}

export async function fetchStockCandles(symbol: string, resolution: string, from: number, to: number): Promise<{ c: number[], t: number[], s: string } | null> {
    try {
        const data = await apiFetch(`stock/candle?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`) as { c: number[], t: number[], s: string };
        if (data.s === 'no_data') {
            return null;
        }
        return data;
    } catch (error) {
        console.error(`Error fetching candles for ${symbol}:`, error);
        return null;
    }
} 