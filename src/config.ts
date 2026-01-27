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

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('DEBUG: process.env.AI_PROVIDER =', process.env.AI_PROVIDER);
console.log('DEBUG: process.env.GEMINI_API_KEY =', process.env.GEMINI_API_KEY ? 'SET' : 'NOT SET');
console.log('DEBUG: process.env.GEMINI_API_KEY length =', process.env.GEMINI_API_KEY?.length);

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
    ai: {
        provider: 'gemini' | 'openai';
    };
    gemini: {
        apiKey: string;
        model: string;
    };
    openai: {
        baseUrl: string;
        apiKey?: string;
        model: string;
        maxContextSize: number;
    };
    summarization: {
        triggerPercent: number;
        targetPercent: number;
        maxRecentMessages: number;
    };
    vertex: {
        projectId: string;
        location: string;
    };
    search: {
        provider: 'serpapi' | 'google';
        googleApiKey?: string;
        googleCxId?: string;
        serpapiApiKey?: string;
    };
    wikipedia: {
        userAgent: string;
    };
    alphaVantageApiKey: string;
    finnhubApiKey: string;
    serpapiApiKey: string; // for backwards compat
    apiPort: number;
    apiKey: string;
    mcp: {
        servers: Record<string, {
            command?: string;
            args?: string[];
            url?: string;
            env?: Record<string, string>;
            headers?: Record<string, string>;
        }>;
    };
}

export function getMcpServers(envJson?: string) {
    const defaultServers = {
        dice: {
            url: "https://mcp.dice.com/mcp"
        },
        "open-meteo": {
            command: "npx",
            args: ["-y", "open-meteo-mcp-server"]
        },
        "wikimedia-image-search": {
            command: "npx",
            args: ["-y", "wikimedia-image-search-mcp"]
        }
    };

    const json = envJson ?? process.env.MCP_SERVERS_JSON;

    if (json) {
        try {
            const envServers = JSON.parse(json);
            // Handle Claude-style wrapper
            if (envServers.mcpServers) {
                return {
                    ...envServers,
                    mcpServers: { ...defaultServers, ...envServers.mcpServers }
                };
            }
            // Flat merge
            return { ...defaultServers, ...envServers };
        } catch (e) {
            console.error('Error parsing MCP_SERVERS_JSON:', e);
            return defaultServers;
        }
    }
    return defaultServers;
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
    ai: {
        provider: (process.env.AI_PROVIDER as 'gemini' | 'openai') ||
            ((process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 0) ? 'gemini' : 'openai'),
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
    },
    openai: {
        baseUrl: process.env.OPENAI_BASE_URL || '',
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'google/gemma-3-12b',
        maxContextSize: parseInt(process.env.OPENAI_MAX_CONTEXT_SIZE || '4096', 10),
    },
    vertex: {
        projectId: process.env.VERTEX_PROJECT_ID || process.env.GCLOUD_PROJECT || '',
        location: process.env.VERTEX_LOCATION || process.env.GCLOUD_LOCATION || 'us-central1',
    },
    search: {
        provider: (process.env.SEARCH_PROVIDER as 'serpapi' | 'google') || 'serpapi',
        googleApiKey: process.env.GOOGLE_API_KEY,
        googleCxId: process.env.GOOGLE_CX_ID,
        serpapiApiKey: process.env.SERPAPI_API_KEY,
    },
    wikipedia: {
        userAgent: 'GemBot/1.0 (https://github.com/carmex/GemBot; carmex@gmail.com)',
    },
    apiPort: process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 3000,
    apiKey: process.env.API_KEY || '',
    alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY || '',
    finnhubApiKey: process.env.FINNHUB_API_KEY || '',
    serpapiApiKey: process.env.SERPAPI_API_KEY || '',
    mcp: {
        servers: getMcpServers(),
    },
    summarization: {
        triggerPercent: parseInt(process.env.SUMMARY_TRIGGER_PERCENT || '85', 10),
        targetPercent: parseInt(process.env.SUMMARY_TARGET_PERCENT || '50', 10),
        maxRecentMessages: parseInt(process.env.MAX_RECENT_MESSAGES || '15', 10),
    },
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