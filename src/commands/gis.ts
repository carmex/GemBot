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
import { config } from '../config';
import fetch from 'node-fetch';

export type Mod = 'g' | 't' | 'i' | 'a' | 'm' | 'l' | undefined;
const re = /^gis([gtiaml])?(\d+)? (.+)/i;

const BadDomains =
    /(alamy\.com)|(depositphotos\.com)|(shutterstock\.com)|(maps\.google\.com)|(fbsbx.*\.com)|(memegenerator.*\.net)|(gstatic.*\.com)|(instagram.*\.com)|(tiktok.*\.com)|(yarn\.co)/i;

interface GoogleImageResult {
    link: string;
    image: {
        width: number;
        height: number;
    };
}

interface GoogleSearchResult {
    items?: GoogleImageResult[];
}

export const registerGisCommands = (app: App) => {
    app.message(re, async ({ message, context, say }) => {
        if (!('user' in message) || !message.user) {
            return;
        }

        const mod = context.matches[1] as Mod;
        const idxStr = context.matches[2];
        const search = (context.matches[3] ?? '').replace(/&amp;/g, '&').trim();
        const index = idxStr ? parseInt(idxStr, 10) : 1;

        if (!search) return;

        if (!config.search.googleApiKey || !config.search.googleCxId) {
            await say('Google Search API key or Search Engine ID is not configured.');
            return;
        }

        const modSuffix = {
            undefined: '',
            'g': ' girls',
            't': ' then and now',
            'i': ' infographic',
            'a': ' animated gif',
            'm': ' meme',
            'l': ' sexy ladies',
        }[String(mod).toLowerCase()];

        const query = `${search}${modSuffix}`;
        const threadTs = 'thread_ts' in message ? message.thread_ts : undefined;

        try {
            const startTime = Date.now();
            const baseUrl = 'https://www.googleapis.com/customsearch/v1';
            const params = new URLSearchParams({
                key: config.search.googleApiKey!,
                cx: config.search.googleCxId!,
                q: query,
                searchType: 'image',
            });

            const url = `${baseUrl}?${params.toString()}`;
            const response = await fetch(url);

            if (!response.ok) {
                console.error(`Google Search API error: ${response.status} ${response.statusText}`);
                await say({ text: '¯\\_(ツ)_/¯', thread_ts: threadTs });
                return;
            }

            const json = (await response.json()) as GoogleSearchResult;
            const items = json.items ?? [];

            const filteredItems = items.filter(item => {
                const isBadDomain = BadDomains.test(item.link);
                const matchesMod = mod === 'a' ? item.link.toLowerCase().endsWith('.gif') : true;
                return !isBadDomain && matchesMod;
            });

            const result = filteredItems[index - 1];

            if (!result) {
                await say({ text: '¯\\_(ツ)_/¯', thread_ts: threadTs });
                return;
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            const sanitizedUrl = result.link
                .replace(/%25/g, '%')
                .replace(/\\u003d/g, '=')
                .replace(/\\u0026/g, '&');

            await say({
                text: `${sanitizedUrl} (${elapsed} sec)`,
                thread_ts: threadTs,
            });

        } catch (error) {
            console.error('Error in GIS command:', error);
            await say({ text: '¯\\_(ツ)_/¯', thread_ts: threadTs });
        }
    });
};
