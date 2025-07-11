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

import {JSONFilePreset} from 'lowdb/node';
import {Low} from 'lowdb';

type WatchlistEntry = {
    userId: string;
    ticker: string;
    shares: number;
    purchaseDate: string;
    purchasePrice: number;
};

type Schema = {
    watchlist: WatchlistEntry[];
};

const defaultData: Schema = {
    watchlist: [],
};

// Use a promise-based approach to avoid top-level await
const dbPromise: Promise<Low<Schema>> = JSONFilePreset<Schema>('db.json', defaultData);

export const addToWatchlist = async (entry: WatchlistEntry): Promise<void> => {
    const db = await dbPromise;
    await db.update(({watchlist}) => {
        // Prevent adding the same ticker for the same user twice
        const existing = watchlist.find(
            item => item.userId === entry.userId && item.ticker.toUpperCase() === entry.ticker.toUpperCase()
        );
        if (!existing) {
            watchlist.push(entry);
        } else {
            // If it exists, update it
            existing.shares = entry.shares;
            existing.purchaseDate = entry.purchaseDate;
            existing.purchasePrice = entry.purchasePrice;
        }
    });
};

export const removeFromWatchlist = async (userId: string, ticker: string): Promise<boolean> => {
    const db = await dbPromise;
    let success = false;
    await db.update(({watchlist}) => {
        const index = watchlist.findIndex(
            item => item.userId === userId && item.ticker.toUpperCase() === ticker.toUpperCase()
        );
        if (index !== -1) {
            watchlist.splice(index, 1);
            success = true;
        }
    });
    return success;
};

export const getWatchlist = async (userId: string): Promise<WatchlistEntry[]> => {
    const db = await dbPromise;
    return db.data.watchlist.filter(item => item.userId === userId);
}; 