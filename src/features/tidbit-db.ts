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

const dbPath = path.join(__dirname, '..', '..', 'tidbits.db');
const db = new Database(dbPath);

export interface TidbitSubscription {
    user_id: string;
    channel_id: string;
    n: number;
    timezone: string;
    last_sent_date?: string | null;
    created_at?: string;
    updated_at?: string;
}

/**
 * Initializes the tidbits database with WAL mode and table creation.
 */
export function initTidbitDb(): void {
    try {
        console.log(`[TidbitDB] Initializing database at path: ${dbPath}`);
        db.pragma('journal_mode = WAL');
        db.exec(`
            CREATE TABLE IF NOT EXISTS tidbit_subscriptions (
                user_id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL,
                n INTEGER NOT NULL,
                timezone TEXT NOT NULL DEFAULT 'UTC',
                last_sent_date TEXT,
                created_at DATETIME DEFAULT (datetime('now')),
                updated_at DATETIME DEFAULT (datetime('now'))
            );
        `);
        console.log('[TidbitDB] Database initialized successfully with WAL mode.');
    } catch (error) {
        console.error('[TidbitDB] Error initializing database:', error);
        throw error;
    }
}

/**
 * Inserts or updates a user's tidbit subscription.
 */
export function upsertSubscription(userId: string, channelId: string, n: number, timezone: string): void {
    try {
        const stmt = db.prepare(`
            INSERT INTO tidbit_subscriptions (user_id, channel_id, n, timezone, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(user_id) DO UPDATE SET
                channel_id = excluded.channel_id,
                n = excluded.n,
                timezone = excluded.timezone,
                updated_at = datetime('now')
        `);
        stmt.run(userId, channelId, n, timezone);
        console.log(`[TidbitDB] Upserted subscription for user ${userId}: n=${n}, timezone=${timezone}`);
    } catch (error) {
        console.error(`[TidbitDB] Error upserting subscription for user ${userId}:`, error);
        throw error;
    }
}

/**
 * Removes a subscription for a given user.
 * @returns true if subscription was removed, false if not found.
 */
export function removeSubscription(userId: string): boolean {
    try {
        const stmt = db.prepare(`
            DELETE FROM tidbit_subscriptions WHERE user_id = ?
        `);
        const result = stmt.run(userId);
        const removed = result.changes > 0;
        console.log(`[TidbitDB] Removed subscription for user ${userId}: ${removed}`);
        return removed;
    } catch (error) {
        console.error(`[TidbitDB] Error removing subscription for user ${userId}:`, error);
        throw error;
    }
}

/**
 * Fetches a single subscription for a user.
 */
export function getSubscription(userId: string): TidbitSubscription | null {
    try {
        const stmt = db.prepare(`
            SELECT user_id, channel_id, n, timezone, last_sent_date, created_at, updated_at
            FROM tidbit_subscriptions
            WHERE user_id = ?
        `);
        const row = stmt.get(userId) as TidbitSubscription | undefined;
        return row || null;
    } catch (error) {
        console.error(`[TidbitDB] Error getting subscription for user ${userId}:`, error);
        return null;
    }
}

/**
 * Fetches all active subscriptions.
 */
export function getAllSubscriptions(): TidbitSubscription[] {
    try {
        const stmt = db.prepare(`
            SELECT user_id, channel_id, n, timezone, last_sent_date, created_at, updated_at
            FROM tidbit_subscriptions
        `);
        return stmt.all() as TidbitSubscription[];
    } catch (error) {
        console.error('[TidbitDB] Error getting all subscriptions:', error);
        return [];
    }
}

/**
 * Updates the last_sent_date for a user to prevent duplicate daily deliveries.
 */
export function updateLastSentDate(userId: string, dateStr: string): void {
    try {
        const stmt = db.prepare(`
            UPDATE tidbit_subscriptions
            SET last_sent_date = ?, updated_at = datetime('now')
            WHERE user_id = ?
        `);
        stmt.run(dateStr, userId);
        console.log(`[TidbitDB] Updated last_sent_date for user ${userId} to ${dateStr}`);
    } catch (error) {
        console.error(`[TidbitDB] Error updating last_sent_date for user ${userId}:`, error);
        throw error;
    }
}
