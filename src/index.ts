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

import { App, SocketModeReceiver } from '@slack/bolt';
import { config } from './config';
import { AIHandler } from './features/ai-handler';
import { startApiServer } from './api';
import * as cron from 'node-cron';
import { sendMorningGreeting } from "./features/utils";


// Initialize the receiver
const receiver = new SocketModeReceiver({
    appToken: config.slack.appToken,
});

// Initialize the Slack app
const app = new App({
    token: config.slack.botToken,
    receiver: receiver,
});

// Reconnection management for Socket Mode
let reconnectAttempts = 0;
let reconnectTimer: NodeJS.Timeout | null = null;

const scheduleReconnect = () => {
    if (reconnectTimer) return;
    const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts)); // 1s, 2s, 4s ... max 30s
    console.warn(`[Socket Mode] Scheduling reconnect in ${delay}ms (attempt ${reconnectAttempts + 1})`);
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;
        try {
            reconnectAttempts++;
            // If the client is stuck in 'connecting' state, start() will throw.
            // Attempt to force a disconnect first to reset the state machine.
            try {
                await receiver.client.disconnect();
            } catch (ignore) {
                // Ignore errors during disconnect (e.g. if already disconnected)
            }

            await receiver.client.start();
            console.log('[Socket Mode] Reconnect attempt started.');
        } catch (err) {
            console.error('[Socket Mode] Reconnect start failed:', err);
            scheduleReconnect();
        }
    }, delay);
};

// Add listeners for Socket Mode client lifecycle events
receiver.client.on('connecting', () => {
    console.log('[Socket Mode] Connecting to Slack...');
});

receiver.client.on('connected', () => {
    console.log('[Socket Mode] Connected.');
    // Reset backoff on successful connection
    reconnectAttempts = 0;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
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
    // Proactively schedule reconnect if the internal state machine bails during connecting
    scheduleReconnect();
});

receiver.client.on('error', (error: Error) => {
    console.error('[Socket Mode] An error occurred:', error);
    // Try to recover from transient socket mode errors
    scheduleReconnect();
});

// Process-level error handlers (suppress fatal exit for Slack explicit disconnect during connecting)
process.on('uncaughtException', (error) => {
    const msg = (error as any)?.message ? String((error as any).message) : String(error);
    const isExplicitDisconnectConnecting =
        msg.includes("Unhandled event 'server explicit disconnect'") &&
        msg.includes("in state 'connecting'");
    if (isExplicitDisconnectConnecting) {
        console.warn('[Socket Mode] Explicit disconnect during connecting detected. Suppressing exit and scheduling reconnect.');
        scheduleReconnect();
        return; // don't exit; allow reconnect
    }
    console.error('FATAL: Uncaught exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    const msg = (reason as any)?.message ? String((reason as any).message) : String(reason);
    const isExplicitDisconnectConnecting =
        msg.includes("Unhandled event 'server explicit disconnect'") &&
        msg.includes("in state 'connecting'");
    if (isExplicitDisconnectConnecting) {
        console.warn('[Socket Mode] Unhandled rejection due to explicit disconnect during connecting. Suppressing exit and scheduling reconnect.');
        scheduleReconnect();
        return; // don't exit; allow reconnect
    }
    console.error('FATAL: Unhandled promise rejection:', reason);
    process.exit(1);
});

// Instantiate the AI Handler
const aiHandler = new AIHandler(app);

// Graceful shutdown
const shutdown = async () => {
    console.log('Shutting down...');
    try {
        await aiHandler.mcpClientManager.shutdown();
    } catch (err) {
        console.error('Error shutting down MCP clients:', err);
    }
    try {
        await app.stop();
    } catch (err) {
        console.error('Error stopping Slack app:', err);
    }
    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Example slash command
app.command('/ping', async ({ command, ack, respond }) => {
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
        await startApiServer(app);
        console.log(`⚡️ Bolt app is running!`);
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