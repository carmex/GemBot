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
import { fetchPollenHistory } from '../features/ambee-api';
import { generatePollenChart } from '../features/pollen-charts';

/**
 * Registers pollen-related commands with the Slack app.
 * @param app The Slack Bolt App instance.
 */
export function registerPollenCommands(app: App): void {
    // !pollen <zip code>
    app.message(/^!pollen\s+(\d+)/i, async ({ message, context, say, client }) => {
        const zipCode = context.matches[1];
        const channelId = (message as any).channel;
        const threadTs = (message as any).thread_ts || (message as any).ts;

        console.log(`[Pollen] Received command for zip: ${zipCode} in channel: ${channelId}`);

        try {
            await say({
                text: `Fetching 30-day pollen history for zip code ${zipCode}...`,
                thread_ts: threadTs
            });

            const data = await fetchPollenHistory(zipCode);
            if (!data || data.length === 0) {
                console.log(`[Pollen] No data found for zip: ${zipCode}`);
                await say({
                    text: `No pollen data found for zip code ${zipCode}.`,
                    thread_ts: threadTs
                });
                return;
            }

            console.log(`[Pollen] Generating chart for zip: ${zipCode} with ${data.length} data points`);
            const chartBuffer = await generatePollenChart(zipCode, data);

            console.log(`[Pollen] Uploading chart for zip: ${zipCode}`);
            await client.files.uploadV2({
                file: chartBuffer,
                filename: `pollen_history_${zipCode}.png`,
                channel_id: channelId,
                thread_ts: threadTs,
                initial_comment: `Here is the 30-day pollen history for zip code ${zipCode}:`,
                title: `Pollen History for ${zipCode}`
            });
            console.log(`[Pollen] Successfully processed zip: ${zipCode}`);

        } catch (error) {
            console.error(`Error in !pollen command for zip ${zipCode}:`, error);
            await say({
                text: `Sorry, I encountered an error while fetching pollen data for ${zipCode}: ${(error as Error).message}`,
                thread_ts: threadTs
            });
        }
    });
}
