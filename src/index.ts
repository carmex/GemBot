import {App, SocketModeReceiver} from '@slack/bolt';
import {config, validateConfig} from './config';
import {AIHandler} from './features/ai-handler';
import * as cron from 'node-cron';
import {fetchStockNews} from './features/finnhub-api';

// Gracefully handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('FATAL: Uncaught exception:', error);
    process.exit(1);
});

// Function to post morning greeting with stock news
async function postMorningGreeting(app: App) {
    console.log('[MorningGreeting] postMorningGreeting called at:', new Date().toString());
    try {
        const channelId = config.slack.morningGreetingChannelId;

        // Post the greeting message
        const greetingResult = await app.client.chat.postMessage({
            channel: channelId,
            text: 'Good morning #stonks! Here is the latest news 📰',
        });

        if (!greetingResult.ok || !greetingResult.ts) {
            console.error('Failed to post greeting message');
            return;
        }

        // Fetch stock news
        const articles = await fetchStockNews();

        if (!articles || articles.length === 0) {
            // Post a message in thread if no news found
            await app.client.chat.postMessage({
                channel: channelId,
                thread_ts: greetingResult.ts,
                text: 'No recent stock market news available at the moment.',
            });
            return;
        }

        // Format the top 5 articles
        const formattedArticles = articles
            .slice(0, 5)
            .map(
                (article) => `• *${article.headline}* - _${article.source}_\n   <${article.url}|Read More>`
            )
            .join('\n\n');

        // Post the news in a thread
        await app.client.chat.postMessage({
            channel: channelId,
            thread_ts: greetingResult.ts,
            text: `Here are the latest headlines:\n\n${formattedArticles}`,
        });

        console.log('✅ Morning greeting with stock news posted successfully');
    } catch (error) {
        console.error('❌ Error posting morning greeting:', error);
    }
}

// Validate configuration before starting
try {
    validateConfig();
} catch (error) {
    console.error('Configuration error:', (error as Error).message);
    process.exit(1);
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
        console.log('[Socket Mode] Disconnected normally.');
    }
});

receiver.client.on('error', (error: Error) => {
    console.error('[Socket Mode] An error occurred:', error);
});

// Initialize AI handler
try {
    new AIHandler(app);
} catch (error) {
    console.error('Failed to initialize AIHandler:', error);
    process.exit(1);
}

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
        await postMorningGreeting(app);
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
        console.log('Current server time:', new Date().toString());

        // Schedule morning greeting at 9:30am Eastern Time (UTC-5)
        // Cron format: minute hour day month day-of-week
        // 30 9 * * * = 9:30 AM Eastern (America/New_York)
        cron.schedule(config.morningGreetingSchedule, () => {
            console.log(`[MorningGreeting] Cron job fired at: ${new Date().toString()} for schedule: ${config.morningGreetingSchedule}`);
            postMorningGreeting(app);
        }, {
            timezone: 'America/New_York'
        });

        console.log(`📅 Morning greeting scheduled with pattern: "${config.morningGreetingSchedule}" in America/New_York timezone`);

    } catch (error) {
        console.error('Failed to start app:', error);
        process.exit(1);
    }
})(); 