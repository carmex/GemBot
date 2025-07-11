import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface Config {
    slack: {
        botToken: string;
        signingSecret: string;
        appToken: string;
        morningGreetingChannelId: string;
    };
    server: {
        port: number;
    };
    environment: string;
    morningGreetingSchedule: string;
    channelHistoryLimit: number;
    gemini: {
        apiKey: string;
        model: string;
    };
    vertex: {
        projectId: string;
        location: string;
    };
    alphaVantageApiKey: string;
    finnhubApiKey: string;
}

export const config: Config = {
    slack: {
        botToken: process.env.SLACK_BOT_TOKEN || '',
        signingSecret: process.env.SLACK_SIGNING_SECRET || '',
        appToken: process.env.SLACK_APP_TOKEN || '',
        morningGreetingChannelId: process.env.SLACK_MORNING_GREETING_CHANNEL_ID || '',
    },
    server: {
        port: parseInt(process.env.PORT || '3000', 10),
    },
    environment: process.env.NODE_ENV || 'development',
    morningGreetingSchedule: process.env.MORNING_GREETING_SCHEDULE || '30 9 * * *',
    channelHistoryLimit: parseInt(process.env.CHANNEL_HISTORY_LIMIT || '20', 10),
    gemini: {
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    },
    vertex: {
        projectId: process.env.VERTEX_PROJECT_ID || '',
        location: process.env.VERTEX_LOCATION || '',
    },
    alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY || '',
    finnhubApiKey: process.env.FINNHUB_API_KEY || '',
};

function checkConfig(config: Config): void {
    if (!config.slack.botToken) {
        throw new Error('Missing required environment variable: SLACK_BOT_TOKEN');
    }
    if (!config.slack.appToken) {
        throw new Error('Missing required environment variable: SLACK_APP_TOKEN');
    }
}

checkConfig(config); 