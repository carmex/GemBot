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