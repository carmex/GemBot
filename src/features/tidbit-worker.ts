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

import { App } from '@slack/bolt';
import * as cron from 'node-cron';
import { config } from '../config';
import { getAllSubscriptions, seedTidbitHistory, updateLastSentDate } from './tidbit-db';
import { generateTidbits, parseTidbitsFromSlackMessage } from './tidbit-generator';

/**
 * Computes the local date (YYYY-MM-DD) and local hour (0-23) for a given IANA timezone.
 * Falls back to UTC if the timezone string is invalid.
 */
export function getUserLocalDateTime(timezoneStr: string, dateObj: Date = new Date()): { localDateString: string; localHour: number } {
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezoneStr,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hour12: false,
        });
        const parts = formatter.formatToParts(dateObj);
        const year = parts.find(p => p.type === 'year')?.value;
        const month = parts.find(p => p.type === 'month')?.value;
        const day = parts.find(p => p.type === 'day')?.value;
        const hourStr = parts.find(p => p.type === 'hour')?.value || '0';
        let hour = parseInt(hourStr, 10);
        if (hour === 24) hour = 0;

        return {
            localDateString: `${year}-${month}-${day}`,
            localHour: hour,
        };
    } catch {
        const year = dateObj.getUTCFullYear();
        const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getUTCDate()).padStart(2, '0');
        return {
            localDateString: `${year}-${month}-${day}`,
            localHour: dateObj.getUTCHours(),
        };
    }
}

/**
 * Self-healing history sync: inspects recent Slack channel history,
 * extracts previously delivered tidbit bullets, and seeds them into tidbit_history.
 * This prevents repeated tidbits across restarts, migrations, or database recreations.
 */
export async function syncChannelTidbitHistory(app: App, channelId: string): Promise<void> {
    try {
        if (!app?.client?.conversations?.history) {
            return;
        }

        console.log(`[TidbitWorker] Syncing channel tidbit history for ${channelId}...`);
        const result = await app.client.conversations.history({
            channel: channelId,
            limit: 100,
        });

        if (!result.messages || result.messages.length === 0) {
            console.log(`[TidbitWorker] No messages found in channel ${channelId} to sync.`);
            return;
        }

        const tidbitMessages = result.messages.filter(msg =>
            msg.text && msg.text.includes("*Gembo's Tidbits of the Day*")
        );

        console.log(`[TidbitWorker] Found ${tidbitMessages.length} tidbit message(s) in channel ${channelId}`);

        const allItems: { category: string; itemHash: string; deliveredAt?: string; contentIdentifier?: string }[] = [];

        for (const msg of tidbitMessages) {
            if (!msg.text) continue;
            const parsed = parseTidbitsFromSlackMessage(msg.text);

            let deliveredAt: string | undefined = undefined;
            if (msg.ts) {
                const tsNum = parseFloat(msg.ts);
                if (!isNaN(tsNum)) {
                    deliveredAt = new Date(tsNum * 1000).toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
                }
            }

            for (const item of parsed) {
                allItems.push({
                    category: item.category,
                    itemHash: item.itemHash,
                    contentIdentifier: item.contentIdentifier,
                    deliveredAt,
                });
            }
        }

        if (allItems.length > 0) {
            const seededCount = seedTidbitHistory(channelId, allItems);
            console.log(`[TidbitWorker] Successfully seeded ${seededCount} historical tidbit(s) from channel ${channelId}`);
        }
    } catch (error) {
        console.warn(`[TidbitWorker] Failed to sync channel history for ${channelId}:`, error);
    }
}

/**
 * Sends n daily tidbits to a Slack channel.
 */
export async function sendChannelTidbits(
    app: App,
    channelId: string = config.slack.tidbitChannelId || 'C0BT3T88PME',
    n: number = 5
): Promise<void> {
    try {
        // Sync channel history before generation to ensure cold starts are healed
        await syncChannelTidbitHistory(app, channelId);

        console.log(`[TidbitWorker] Generating ${n} tidbits for channel ${channelId}...`);
        const tidbitText = await generateTidbits(n, channelId);
        await app.client.chat.postMessage({
            channel: channelId,
            text: tidbitText,
        });
        console.log(`[TidbitWorker] Successfully sent daily tidbits to channel ${channelId}`);
    } catch (error) {
        console.error(`[TidbitWorker] Error sending tidbits to channel ${channelId}:`, error);
    }
}

/**
 * Starts the background worker for Gembo's tidbits of the day.
 * Evaluates active subscriptions every minute for local 8:00 AM delivery,
 * and schedules the daily 8:00 AM channel broadcast.
 */
export function startTidbitWorker(app: App): void {
    console.log('[TidbitWorker] Starting tidbit delivery worker...');

    const channelId = config.slack.tidbitChannelId || 'C0BT3T88PME';
    const schedule = config.tidbitSchedule || '0 8 * * *';
    console.log(`[TidbitWorker] Scheduling daily tidbits for channel ${channelId} with schedule "${schedule}" (America/New_York)...`);

    // Self-healing: sync channel history on worker boot
    syncChannelTidbitHistory(app, channelId).catch(err => {
        console.warn('[TidbitWorker] Startup channel history sync failed:', err);
    });

    cron.schedule(schedule, async () => {
        await sendChannelTidbits(app, channelId, 5);
    }, {
        timezone: 'America/New_York',
    });

    cron.schedule('* * * * *', async () => {
        try {
            const subscriptions = getAllSubscriptions();
            if (subscriptions.length === 0) return;

            const now = new Date();

            for (const sub of subscriptions) {
                try {
                    const { localDateString, localHour } = getUserLocalDateTime(sub.timezone, now);

                    // Trigger at 8:00 AM local time if not already sent today
                    if (localHour === 8 && sub.last_sent_date !== localDateString) {
                        console.log(`[TidbitWorker] Generating and sending ${sub.n} tidbit(s) to user ${sub.user_id} (${sub.timezone})...`);
                        const tidbitText = await generateTidbits(sub.n, sub.user_id);

                        await app.client.chat.postMessage({
                            channel: sub.user_id,
                            text: tidbitText,
                        });

                        updateLastSentDate(sub.user_id, localDateString);
                        console.log(`[TidbitWorker] Successfully sent tidbits to user ${sub.user_id}`);
                    }
                } catch (subError) {
                    console.error(`[TidbitWorker] Error delivering tidbits to user ${sub.user_id}:`, subError);
                }
            }
        } catch (error) {
            console.error('[TidbitWorker] Error in tidbit worker loop:', error);
        }
    });

    console.log('[TidbitWorker] Tidbit worker scheduled (every minute).');
}
