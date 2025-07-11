import {App, SocketModeReceiver} from '@slack/bolt';
import {config} from './config';
import {AIHandler} from './features/ai-handler';
import * as cron from 'node-cron';
import {fetchStockNews} from './features/finnhub-api';

// Gracefully handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('FATAL: Uncaught exception:', error);
    process.exit(1);
});

// Function to send the morning greeting
async function sendMorningGreeting(app: App, channelId: string) {
    try {
        await app.client.chat.postMessage({
            token: config.slack.botToken,
            channel: channelId,
            text: 'Good morning everyone! What are your top priorities for today?',
        });
        console.log('Morning greeting sent successfully.');
    } catch (error) {
        console.error('Failed to send morning greeting:', error);
    }
}

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
    console.log('Received ping command:', command);
    await ack();
    if (respond) {
        await respond({
            text: `Pong! 🏓 (from <@${command.user_id}>)`,
        });
    }
});

// Test command for morning greeting
app.command('/test-morning-greeting', async ({command, ack, respond}) => {
    console.log('Received test morning greeting command:', command);
    await ack();

    try {
        await sendMorningGreeting(app, config.slack.morningGreetingChannelId);
        if (respond) {
            await respond({
                text: '✅ Morning greeting test completed! Check the #stocks channel.',
            });
        }
    } catch (error) {
        console.error('Error in test morning greeting:', error);
        if (respond) {
            await respond({
                text: `❌ Error testing morning greeting: ${(error as Error).message}`,
            });
        }
    }
});

// Error handling
app.error(async (error) => {
    console.error('Error:', error);
});

// Add general event logging
app.event('*', async ({event}) => {
    console.log('Received event:', event.type, event);
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