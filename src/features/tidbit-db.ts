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

            CREATE TABLE IF NOT EXISTS tidbit_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipient_id TEXT NOT NULL,
                category TEXT NOT NULL,
                item_hash TEXT NOT NULL,
                delivered_at DATETIME DEFAULT (datetime('now')),
                UNIQUE(recipient_id, item_hash)
            );
            CREATE INDEX IF NOT EXISTS idx_tidbit_history_recipient ON tidbit_history(recipient_id);
            CREATE INDEX IF NOT EXISTS idx_tidbit_history_lookup ON tidbit_history(recipient_id, item_hash);
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
        if (removed) {
            clearTidbitHistory(userId);
        }
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

/**
 * Checks if a specific content hash has already been delivered to this recipient.
 */
export function isTidbitDuplicate(recipientId: string, itemHash: string): boolean {
    try {
        const stmt = db.prepare(`
            SELECT 1 FROM tidbit_history
            WHERE recipient_id = ? AND item_hash = ?
            LIMIT 1
        `);
        const row = stmt.get(recipientId, itemHash);
        return !!row;
    } catch (error) {
        console.error(`[TidbitDB] Error checking duplicate for recipient ${recipientId}:`, error);
        return false;
    }
}

/**
 * Records delivered tidbits for a recipient using a batch INSERT OR IGNORE transaction.
 */
export function recordDeliveredTidbits(recipientId: string, items: { category: string; itemHash: string }[]): void {
    if (!items || items.length === 0) return;
    try {
        const insertStmt = db.prepare(`
            INSERT OR IGNORE INTO tidbit_history (recipient_id, category, item_hash)
            VALUES (?, ?, ?)
        `);
        const insertMany = db.transaction((tidbitItems: { category: string; itemHash: string }[]) => {
            for (const item of tidbitItems) {
                insertStmt.run(recipientId, item.category, item.itemHash);
            }
        });
        insertMany(items);
        console.log(`[TidbitDB] Recorded ${items.length} delivered tidbit(s) for recipient ${recipientId}`);
    } catch (error) {
        console.error(`[TidbitDB] Error recording delivered tidbits for recipient ${recipientId}:`, error);
    }
}

/**
 * Clears tidbit delivery history for a specific recipient.
 */
export function clearTidbitHistory(recipientId: string): void {
    try {
        const stmt = db.prepare(`DELETE FROM tidbit_history WHERE recipient_id = ?`);
        const result = stmt.run(recipientId);
        console.log(`[TidbitDB] Cleared ${result.changes} tidbit history item(s) for recipient ${recipientId}`);
    } catch (error) {
        console.error(`[TidbitDB] Error clearing tidbit history for recipient ${recipientId}:`, error);
    }
}

