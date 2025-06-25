import {App} from '@slack/bolt';
import {config, validateConfig} from './config';
import {AIHandler} from './features/ai-handler';
import {GoogleAuth} from 'google-auth-library';
import * as cron from 'node-cron';
import fetch from 'node-fetch';

// --- Auth & Config Debugging ---
console.log('--- Auth & Config Debugging ---');
console.log('Project ID from config:', config.vertex.projectId);
console.log('Location from config:', config.vertex.location);
console.log('GOOGLE_APPLICATION_CREDENTIALS env var:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
console.log('-----------------------------');

// --- Verify Authenticated Identity ---
async function logAuthInfo() {
    try {
        console.log('--- Verifying Authenticated Identity ---');
        const auth = new GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
        const client = await auth.getClient();
        // Service accounts have an 'email' property on the client object
        if ('email' in client && typeof client.email === 'string') {
            console.log('✅ Successfully authenticated as service account:', client.email);
        } else {
            const projectId = await auth.getProjectId();
            console.log('⚠️  Authenticated, but NOT as a service account.');
            console.log('This is likely using your personal gcloud user credentials.');
            console.log('Project ID from this credential:', projectId);
        }
        console.log('------------------------------------');
    } catch (e) {
        console.error('🚨 Failed to get authentication info:', e);
        console.log('------------------------------------');
    }
}

// Function to fetch stock news (reused from AIHandler)
async function fetchStockNews(): Promise<{headline: string; source: string; url: string}[] | null> {
    if (!config.finnhubApiKey) {
        console.error('Finnhub API key is not configured.');
        return null;
    }
    const url = `https://finnhub.io/api/v1/news?category=general&token=${config.finnhubApiKey}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`Finnhub API bad response for news: ${response.statusText}`);
            return null;
        }
        const data = (await response.json()) as {headline: string; source: string; url: string}[];

        if (!data) {
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error fetching stock news:', error);
        return null;
    }
}

// Function to post morning greeting with stock news
async function postMorningGreeting(app: App) {
    console.log('[MorningGreeting] postMorningGreeting called at:', new Date().toString());
    try {
        const channelId = 'C01KM6WB17H'; // #stonks channel

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

logAuthInfo().then(() => {
    // Validate configuration before starting
    try {
        validateConfig();
    } catch (error) {
        console.error('Configuration error:', (error as Error).message);
        process.exit(1);
    }

    // Initialize the Slack app
    const app = new App({
        token: config.slack.botToken,
        signingSecret: config.slack.signingSecret,
        socketMode: true,
        appToken: config.slack.appToken,
    });

    // Initialize AI handler
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

    // Example interactive button
    app.action('button_click', async ({body, ack, say}) => {
        console.log('Received button click:', body);
        await ack();
        if ('user' in body && body.user && body.user.id && say) {
            await say({
                text: `Button clicked by <@${body.user.id}>! 🎉`,
            });
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

    // Start the app - This part is wrapped to ensure auth logging runs first
    (async () => {
        try {
            await app.start(config.server.port);
            console.log(`⚡️ Bolt app is running on port ${config.server.port}!`);
            console.log(`Environment: ${config.environment}`);
            console.log('Bot is ready to receive events!');
            console.log('Current server time:', new Date().toString());

            // Schedule morning greeting at 9:30am Eastern Time (UTC-5)
            // Cron format: minute hour day month day-of-week
            // 30 9 * * * = 9:30 AM Eastern (America/New_York)
            cron.schedule('30 9 * * *', () => {
                console.log('[MorningGreeting] Cron job fired at:', new Date().toString());
                postMorningGreeting(app);
            }, {
                timezone: 'America/New_York'
            });

            console.log('📅 Morning greeting scheduled for 9:30 AM Eastern Time');

        } catch (error) {
            console.error('Failed to start app:', error);
            process.exit(1);
        }
    })();
}); 