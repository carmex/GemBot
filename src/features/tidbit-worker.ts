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
import { getAllSubscriptions, updateLastSentDate } from './tidbit-db';
import { generateTidbits } from './tidbit-generator';

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
 * Sends n daily tidbits to a Slack channel.
 */
export async function sendChannelTidbits(
    app: App,
    channelId: string = config.slack.tidbitChannelId || 'C0BT3T88PME',
    n: number = 5
): Promise<void> {
    try {
        console.log(`[TidbitWorker] Generating ${n} tidbits for channel ${channelId}...`);
        const tidbitText = await generateTidbits(n);
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
                        const tidbitText = await generateTidbits(sub.n);

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
