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
import { PollenData } from '../types';

/**
 * Fetches historical pollen data for a given zip code from the Ambee API.
 * @param zipCode The zip code to fetch data for.
 * @param days The number of days of history to fetch (default: 30).
 * @returns A promise that resolves to an array of PollenData.
 */
export async function fetchPollenHistory(zipCode: string, days: number = 30): Promise<PollenData[]> {
    if (!config.ambeeApiKey) {
        throw new Error('Ambee API key is not configured.');
    }

    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(toDate.getDate() - days);

    const formatDate = (date: Date) => {
        const pad = (num: number) => num.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    };

    const from = formatDate(fromDate);
    const to = formatDate(toDate);

    const url = `https://api.ambeedata.com/history/pollen/by-place?place=${zipCode}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

    const maskedKey = config.ambeeApiKey ? `${config.ambeeApiKey.substring(0, 4)}...${config.ambeeApiKey.substring(config.ambeeApiKey.length - 4)}` : 'MISSING';
    console.log(`[Ambee API] Fetching pollen history: ${url.replace(config.ambeeApiKey!, maskedKey)}`);

    const response = await fetch(url, {
        headers: {
            'x-api-key': config.ambeeApiKey,
            'Content-type': 'application/json'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Ambee API] error: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`Failed to fetch pollen data: ${response.statusText}`);
    }

    const json = await response.json() as any;
    if (json.message !== 'success' || !json.data) {
        console.error(`[Ambee API] unexpected response:`, json);
        throw new Error(`Ambee API error: ${json.message || 'Unknown error'}`);
    }

    console.log(`[Ambee API] Successfully fetched ${json.data.length} data points for zip: ${zipCode}`);

    return json.data.map((item: any) => ({
        timestamp: item.updatedAt,
        grass_pollen: item.Count.grass_pollen,
        tree_pollen: item.Count.tree_pollen,
        weed_pollen: item.Count.weed_pollen
    }));
}
