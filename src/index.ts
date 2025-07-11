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

import {App, SocketModeReceiver} from '@slack/bolt';
import {config} from './config';
import {AIHandler} from './features/ai-handler';
import * as cron from 'node-cron';
import {sendMorningGreeting} from "./features/utils";

// Gracefully handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('FATAL: Uncaught exception:', error);
    process.exit(1);
});

// Initialize the receiver
const receiver = new SocketModeReceiver({
    appToken: config.slack.appToken,
});

// Initialize the Slack app
const app = new App({
    token: config.slack.botToken,
    receiver: receiver,
});

// Add listeners for Socket Mode client lifecycle events
receiver.client.on('connecting', () => {
    console.log('[Socket Mode] Connecting to Slack...');
});

receiver.client.on('connected', () => {
    console.log('[Socket Mode] Connected.');
});

receiver.client.on('reconnecting', () => {
    console.log('[Socket Mode] Reconnecting...');
});

receiver.client.on('disconnecting', () => {
    console.log('[Socket Mode] Disconnecting...');
});

receiver.client.on('disconnected', (error?: Error) => {
    if (error) {
        console.error('[Socket Mode] Disconnected with error:', error);
    } else {
        console.log('[Socket Mode] Disconnected from Slack.');
    }
});

receiver.client.on('error', (error: Error) => {
    console.error('[Socket Mode] An error occurred:', error);
});

// Instantiate the AI Handler
new AIHandler(app);

// Example slash command
app.command('/ping', async ({command, ack, respond}) => {
    await ack();
    if (respond) {
        await respond({
            text: `Pong! 🏓 (from <@${command.user_id}>)`,
        });
    }
});

// Error handling
app.error(async (error) => {
    console.error('Error:', error);
});

// Start the app
(async () => {
    try {
        await app.start();
        console.log(`⚡️ Bolt app is running in Socket Mode!`);
        console.log(`Environment: ${config.environment}`);
        console.log('Bot is ready to receive events!');

        // Schedule the morning greeting if the channel ID is set
        if (config.slack.morningGreetingChannelId) {
            console.log(`Scheduling morning greeting for channel ${config.slack.morningGreetingChannelId} with schedule "${config.morningGreetingSchedule}"`);
            cron.schedule(config.morningGreetingSchedule, () => sendMorningGreeting(app, config.slack.morningGreetingChannelId), {
                timezone: 'America/New_York',
            });
        }
    } catch (error) {
        console.error('Failed to start the app:', error);
        process.exit(1);
    }
})();