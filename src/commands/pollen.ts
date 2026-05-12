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
    app.message(/^!pollen\s+(\d+)/i, async ({ context, say, client }) => {
        const zipCode = context.matches[1];
        const channelId = context.channelId || '';
        const threadTs = context.threadTs;

        try {
            await say({
                text: `Fetching 30-day pollen history for zip code ${zipCode}...`,
                thread_ts: threadTs
            });

            const data = await fetchPollenHistory(zipCode);
            if (!data || data.length === 0) {
                await say({
                    text: `No pollen data found for zip code ${zipCode}.`,
                    thread_ts: threadTs
                });
                return;
            }

            const chartBuffer = await generatePollenChart(zipCode, data);

            await client.files.uploadV2({
                file: chartBuffer,
                filename: `pollen_history_${zipCode}.png`,
                channel_id: channelId,
                thread_ts: threadTs,
                initial_comment: `Here is the 30-day pollen history for zip code ${zipCode}:`,
                title: `Pollen History for ${zipCode}`
            });

        } catch (error) {
            console.error(`Error in !pollen command for zip ${zipCode}:`, error);
            await say({
                text: `Sorry, I encountered an error while fetching pollen data for ${zipCode}: ${(error as Error).message}`,
                thread_ts: threadTs
            });
        }
    });
}
