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

import Database from 'better-sqlite3';
import path from 'path';
import { Split } from '../types';

const dbPath = path.join(__dirname, '..', '..', 'market_data.db');
const db = new Database(dbPath);

/**
 * Initializes the market data database.
 */
export function initializeMarketDataDatabase(): void {
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS splits (
                symbol TEXT NOT NULL,
                date TEXT NOT NULL,
                fromFactor REAL NOT NULL,
                toFactor REAL NOT NULL,
                PRIMARY KEY (symbol, date)
            );
            CREATE TABLE IF NOT EXISTS split_meta (
                symbol TEXT PRIMARY KEY,
                last_fetched DATETIME DEFAULT (datetime('now', 'localtime'))
            );
        `);
    } catch (error) {
        console.error(`[MarketDataDB] Error initializing database:`, error);
    }
}

/**
 * Saves splits for a symbol.
 */
export function saveSplits(symbol: string, splits: Split[]): void {
    const insertSplit = db.prepare(`
        INSERT OR REPLACE INTO splits (symbol, date, fromFactor, toFactor)
        VALUES (?, ?, ?, ?)
    `);

    const updateMeta = db.prepare(`
        INSERT OR REPLACE INTO split_meta (symbol, last_fetched)
        VALUES (?, datetime('now', 'localtime'))
    `);

    const transaction = db.transaction((symbol: string, splits: Split[]) => {
        for (const split of splits) {
            insertSplit.run(symbol, split.date, split.fromFactor, split.toFactor);
        }
        updateMeta.run(symbol);
    });

    try {
        transaction(symbol, splits);
    } catch (error) {
        console.error(`[MarketDataDB] Error saving splits for ${symbol}:`, error);
    }
}

/**
 * Gets cached splits for a symbol.
 */
export function getCachedSplits(symbol: string): Split[] | null {
    try {
        const meta = db.prepare('SELECT last_fetched FROM split_meta WHERE symbol = ?').get(symbol) as { last_fetched: string } | undefined;
        if (!meta) return null;

        // Consider cache valid for 1 week for splits
        const lastFetched = new Date(meta.last_fetched).getTime();
        const now = Date.now();
        if (now - lastFetched > 7 * 24 * 60 * 60 * 1000) {
            return null;
        }

        const rows = db.prepare('SELECT date, fromFactor, toFactor FROM splits WHERE symbol = ?').all(symbol) as any[];
        return rows.map(r => ({
            symbol,
            date: r.date,
            fromFactor: r.fromFactor,
            toFactor: r.toFactor
        }));
    } catch (error) {
        console.error(`[MarketDataDB] Error getting cached splits for ${symbol}:`, error);
        return null;
    }
}
