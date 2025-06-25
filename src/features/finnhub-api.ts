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