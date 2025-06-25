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
    gemini: {
        apiKey: string;
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
    gemini: {
        apiKey: process.env.GEMINI_API_KEY || '',
    },
    vertex: {
        projectId: process.env.GCLOUD_PROJECT || '',
        location: process.env.GCLOUD_LOCATION || 'us-central1',
    },
    alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY || '',
    finnhubApiKey: process.env.FINNHUB_API_KEY || '',
};

// Validate required environment variables
export function validateConfig(): void {
    const requiredVars = [
        'SLACK_BOT_TOKEN',
        'SLACK_SIGNING_SECRET',
        'SLACK_APP_TOKEN',
        'GEMINI_API_KEY',
        'GCLOUD_PROJECT',
        'GCLOUD_LOCATION',
        'GOOGLE_APPLICATION_CREDENTIALS',
        'SLACK_MORNING_GREETING_CHANNEL_ID',
        'MORNING_GREETING_SCHEDULE',
    ];

    const missing = requiredVars.filter(varName => !process.env[varName]);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}

function checkConfig(config: Config): void {
    if (!config.slack.appToken || !config.slack.botToken) {
        throw new Error('Missing required Slack bot token or app token in config.');
    }
    if (!config.gemini.apiKey) {
        throw new Error('Missing required Gemini API key in config.');
    }
    if (!config.vertex.projectId) {
        throw new Error('Missing required Vertex AI Project ID in config.');
    }
    if (!config.alphaVantageApiKey) {
        console.warn('ALPHA_VANTAGE_API_KEY is not set. The !q and !chart commands will not work.');
    }
}

checkConfig(config); 