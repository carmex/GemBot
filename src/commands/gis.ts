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

import * as fs from 'fs';
import * as path from 'path';
import { App } from '@slack/bolt';
import { config } from '../config';
import fetch from 'node-fetch';
import sharp from 'sharp';
import { rateImageNsfw } from '../features/nsfw-rater';
import { AIHandler } from '../features/ai-handler';
import { getBotSetting, setBotSetting } from '../features/thread-db';

export type Mod = 'g' | 't' | 'i' | 'a' | 'm' | 'l' | undefined;
export type GisMode = 'url' | 'upload';

export const GIS_CONFIG_FILE = path.join(__dirname, '../../gis-mode.json');

let currentMode: GisMode = 'url';

export function getNsfwScoreEmoji(score: number): string {
    const emojis: Record<number, string> = {
        0: ':_charles_green5:',
        1: ':_charles_green4:',
        2: ':_charles_green3:',
        3: ':_charles_green2:',
        4: ':_charles_green1:',
        5: ':_charles_red1:',
        6: ':_charles_red2:',
        7: ':_charles_red3:',
        8: ':_charles_red4:',
        9: ':_charles_red5:',
        10: ':_charles_red5:',
    };
    return emojis[score] || ':_charles_red5:';
}

export function loadGisMode(): GisMode {
    try {
        const dbSetting = getBotSetting('gis_mode');
        if (dbSetting === 'upload' || dbSetting === 'url') {
            currentMode = dbSetting;
            try {
                fs.writeFileSync(GIS_CONFIG_FILE, JSON.stringify({ mode: dbSetting }, null, 2), 'utf-8');
            } catch (err) {
                // Ignore file sync error
            }
            return dbSetting;
        }
    } catch (err) {
        console.error('Error loading GIS mode from SQLite:', err);
    }

    try {
        if (fs.existsSync(GIS_CONFIG_FILE)) {
            const data = fs.readFileSync(GIS_CONFIG_FILE, 'utf-8');
            const parsed = JSON.parse(data);
            if (parsed && (parsed.mode === 'upload' || parsed.mode === 'url')) {
                currentMode = parsed.mode;
                try {
                    setBotSetting('gis_mode', parsed.mode);
                } catch (err) {
                    // Ignore SQLite sync error
                }
                return parsed.mode;
            }
        }
    } catch (err) {
        console.error('Error loading GIS mode from file:', err);
    }

    const defaultMode: GisMode = process.env.GIS_MODE === 'upload' ? 'upload' : 'url';
    currentMode = defaultMode;
    return defaultMode;
}

export function setGisMode(mode: GisMode): void {
    currentMode = mode;
    try {
        setBotSetting('gis_mode', mode);
    } catch (err) {
        console.error('Error saving GIS mode to SQLite:', err);
    }
    try {
        fs.writeFileSync(GIS_CONFIG_FILE, JSON.stringify({ mode }, null, 2), 'utf-8');
    } catch (err) {
        console.error('Error saving GIS mode to file:', err);
    }
}

export function getGisMode(): GisMode {
    return currentMode;
}

// Module initialization
currentMode = loadGisMode();

export const GIS_MODE_UPLOAD_MSG = '🖼️ GIS mode set to *upload*. Images will now be fetched and uploaded directly to Slack.';
export const GIS_MODE_URL_MSG = '🔗 GIS mode set to *url*. Images will be posted as direct URLs (original behavior).';

export function formatGisModeStatus(mode: GisMode): string {
    const desc = mode === 'upload'
        ? 'images will be fetched and uploaded directly to Slack'
        : 'images will be posted as direct URLs';
    return `GIS is currently in *${mode}* mode (${desc}). Use \`!gis mode upload\` or \`!gis mode url\` to change.`;
}

export async function handleGisModeCommand(
    action: string | undefined,
    say: (args: any) => Promise<any>,
    threadTs?: string
): Promise<void> {
    const cmd = action?.toLowerCase();
    if (cmd === 'upload' || cmd === 'on') {
        setGisMode('upload');
        await say({ text: GIS_MODE_UPLOAD_MSG, thread_ts: threadTs });
    } else if (cmd === 'url' || cmd === 'off') {
        setGisMode('url');
        await say({ text: GIS_MODE_URL_MSG, thread_ts: threadTs });
    } else {
        await say({ text: formatGisModeStatus(getGisMode()), thread_ts: threadTs });
    }
}

export function determineFilename(
    urlStr: string,
    contentType: string,
    query: string,
    targetExt?: string
): string {
    let ext = '.jpg';
    if (targetExt) {
        ext = targetExt.startsWith('.') ? targetExt.toLowerCase() : `.${targetExt.toLowerCase()}`;
    } else {
        let urlExt = '';
        try {
            const pathname = new URL(urlStr).pathname;
            const match = pathname.match(/\.(png|jpe?g|gif|webp)$/i);
            if (match) {
                urlExt = match[0].toLowerCase();
                if (urlExt === '.jpeg') urlExt = '.jpg';
            }
        } catch {
            // Ignore URL parsing errors
        }

        const mime = (contentType || '').split(';')[0].trim().toLowerCase();
        const mimeExt: Record<string, string> = {
            'image/jpeg': '.jpg',
            'image/jpg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
        };

        // Preserve .gif extension specifically for animated gifs
        if (urlExt === '.gif' || mimeExt[mime] === '.gif') {
            ext = '.gif';
        } else if (urlExt) {
            ext = urlExt;
        } else if (mimeExt[mime]) {
            ext = mimeExt[mime];
        }
    }

    let base = query
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/gi, '_')
        .replace(/^_+|_+$/g, '');

    if (!base) {
        try {
            const pathname = new URL(urlStr).pathname;
            const urlBase = path.basename(pathname, path.extname(pathname))
                .replace(/[^a-z0-9_-]+/gi, '_')
                .replace(/^_+|_+$/g, '');
            if (urlBase) {
                base = urlBase;
            }
        } catch {
            // Ignore URL parsing errors
        }
    }

    if (!base) {
        base = 'gis_image';
    }

    base = base.slice(0, 50);

    return `${base}${ext}`;
}

export interface FetchAndUploadImageOptions {
    client: any;
    channel: string;
    threadTs?: string;
    imageUrl: string;
    query: string;
    initialComment: string;
    nsfwRater?: (buffer: Buffer) => Promise<number | null>;
    aiHandler?: any;
    say?: (args: any) => Promise<any>;
}

export async function fetchAndUploadImage({
    client,
    channel,
    threadTs,
    imageUrl,
    query,
    initialComment,
    nsfwRater,
    aiHandler,
    say,
}: FetchAndUploadImageOptions): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(imageUrl, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/jpeg,image/png,image/gif;q=0.9,image/*;q=0.8,*/*;q=0.5',
            },
            signal: controller.signal,
            redirect: 'follow',
        });

        if (!response.ok) {
            console.warn(`[GIS] Image fetch failed: HTTP ${response.status} for ${imageUrl}`);
            return false;
        }

        const contentType = response.headers.get('content-type') || '';
        const normalizedContentType = contentType.toLowerCase().trim();
        if (normalizedContentType.startsWith('text/') || normalizedContentType.startsWith('application/json')) {
            console.warn(`[GIS] Non-image Content-Type (${contentType}) for ${imageUrl}`);
            return false;
        }

        const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB limit
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
            console.warn(`[GIS] Content-Length (${contentLength}) exceeds 20MB limit for ${imageUrl}`);
            return false;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (buffer.length > MAX_IMAGE_SIZE) {
            console.warn(`[GIS] Image buffer size (${buffer.length}) exceeds 20MB limit for ${imageUrl}`);
            return false;
        }

        let metadata: sharp.Metadata;
        try {
            metadata = await sharp(buffer, { animated: true }).metadata();
        } catch (err) {
            console.warn(`[GIS] Failed to read image metadata for ${imageUrl}:`, err);
            return false;
        }

        if (!metadata.format) {
            console.warn(`[GIS] Unknown image format for ${imageUrl}`);
            return false;
        }

        let uploadBuffer: Buffer = buffer;
        let targetExt: string;

        if (metadata.format === 'jpeg' || (metadata.format as string) === 'jpg') {
            targetExt = '.jpg';
        } else if (metadata.format === 'png') {
            targetExt = '.png';
        } else if (metadata.format === 'gif') {
            targetExt = '.gif';
        } else {
            // Non-native Slack format (webp, avif, svg, tiff, bmp, heif, etc.)
            try {
                if (metadata.pages && metadata.pages > 1) {
                    uploadBuffer = await sharp(buffer, { animated: true }).gif().toBuffer();
                    targetExt = '.gif';
                } else if (metadata.hasAlpha) {
                    uploadBuffer = await sharp(buffer).png().toBuffer();
                    targetExt = '.png';
                } else {
                    uploadBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
                    targetExt = '.jpg';
                }
            } catch (convErr) {
                console.warn(`[GIS] Failed to convert image format (${metadata.format}) for ${imageUrl}:`, convErr);
                return false;
            }

            if (uploadBuffer.length > MAX_IMAGE_SIZE) {
                console.warn(`[GIS] Converted image buffer size (${uploadBuffer.length}) exceeds 20MB limit for ${imageUrl}`);
                return false;
            }
        }

        const filename = determineFilename(imageUrl, contentType, query, targetExt);

        let finalComment = initialComment;
        let rating: number | null = null;
        try {
            const rater = nsfwRater || (aiHandler?.rateImageNsfw ? (buf: Buffer) => aiHandler.rateImageNsfw(buf) : rateImageNsfw);
            rating = await rater(uploadBuffer);
            if (typeof rating === 'number' && rating >= 0 && rating <= 10) {
                const scoreTag = `[${rating}/10 ${getNsfwScoreEmoji(rating)}]`;
                finalComment = `${initialComment} ${scoreTag}`;
            }
        } catch (err) {
            console.warn(`[GIS] NSFW rating error for ${imageUrl}:`, err);
        }

        if (typeof rating === 'number' && rating > 0 && rating <= 10) {
            if (say) {
                await say({ text: finalComment, thread_ts: threadTs });
            } else if (client?.chat?.postMessage) {
                await client.chat.postMessage({ channel, thread_ts: threadTs, text: finalComment });
            }
            return true;
        }

        await client.files.uploadV2({
            channel_id: channel,
            thread_ts: threadTs,
            file: uploadBuffer,
            filename,
            initial_comment: finalComment,
        });

        return true;
    } catch (error) {
        console.warn(`[GIS] Failed to fetch or upload image from ${imageUrl}:`, error);
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
}

const re = /^gis([gtiaml])?(\d+)?\s+(?!(?:mode|upload|status)(?:\s+(?:upload|url|on|off|status))?$)(.+)/i;

const BadDomains =
    /(reddit\.com)|(redd\.it)|(alamy\.com)|(depositphotos\.com)|(shutterstock\.com)|(maps\.google\.com)|(fbsbx.*\.com)|(memegenerator.*\.net)|(gstatic.*\.com)|(instagram.*\.com)|(tiktok.*\.com)|(yarn\.co)/i;

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

export const registerGisCommands = (app: App, aiHandler?: AIHandler) => {
    app.message(/^!?gis(?:\s+(mode|upload))?(?:\s+(upload|url|on|off|status))?$/i, async ({ message, context, say }) => {
        if (!('user' in message) || !message.user) {
            return;
        }

        const arg1 = context.matches[1]?.toLowerCase();
        const arg2 = context.matches[2]?.toLowerCase();
        const action = arg2 || arg1;
        const threadTs = 'thread_ts' in message ? message.thread_ts : undefined;

        await handleGisModeCommand(action, say, threadTs);
    });

    app.message(re, async ({ message, context, say, client }) => {
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
            const commentText = `${sanitizedUrl} (${elapsed} sec)`;

            if (getGisMode() === 'upload') {
                let uploaded = false;
                if ('channel' in message && message.channel) {
                    uploaded = await fetchAndUploadImage({
                        client,
                        channel: message.channel,
                        threadTs,
                        imageUrl: sanitizedUrl,
                        query,
                        initialComment: commentText,
                        aiHandler,
                        say,
                    });
                }
                if (!uploaded) {
                    await say({
                        text: commentText,
                        thread_ts: threadTs,
                    });
                }
            } else {
                await say({
                    text: commentText,
                    thread_ts: threadTs,
                });
            }

        } catch (error) {
            console.error('Error in GIS command:', error);
            await say({ text: '¯\\_(ツ)_/¯', thread_ts: threadTs });
        }
    });
};
