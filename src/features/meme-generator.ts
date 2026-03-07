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

import fetch from 'node-fetch';
import { URLSearchParams } from 'url';
import { config } from '../config';

export interface MemeTemplate {
    id: string;
    name: string;
    url: string;
    width: number;
    height: number;
    box_count: number;
    captions: number;
}

export class MemeGenerator {
    private static memeCache: MemeTemplate[] = [];
    private static lastCacheUpdate = 0;
    private static readonly CACHE_DURATION = 1000 * 60 * 60 * 24; // 24 hours

    /**
     * Fetches popular meme templates from Imgflip.
     */
    static async getPopularMemes(): Promise<MemeTemplate[]> {
        const now = Date.now();
        if (this.memeCache.length > 0 && (now - this.lastCacheUpdate < this.CACHE_DURATION)) {
            return this.memeCache;
        }

        try {
            const response = await fetch('https://api.imgflip.com/get_memes');
            const data = await response.json() as any;

            if (data.success) {
                this.memeCache = data.data.memes;
                this.lastCacheUpdate = now;
                return this.memeCache;
            } else {
                console.error('Error fetching memes from Imgflip:', data.error_message);
                return [];
            }
        } catch (error) {
            console.error('Failed to fetch memes from Imgflip:', error);
            return [];
        }
    }

    /**
     * Searches for a meme template by name or ID.
     */
    static async findMeme(search: string): Promise<MemeTemplate | undefined> {
        const memes = await this.getPopularMemes();
        const searchLower = search.toLowerCase();

        // Exact match by ID
        let found = memes.find(m => m.id === search);
        if (found) return found;

        // Exact match by name
        found = memes.find(m => m.name.toLowerCase() === searchLower);
        if (found) return found;

        // Partial match by name
        found = memes.find(m => m.name.toLowerCase().includes(searchLower));
        return found;
    }

    /**
     * Captions a meme image.
     */
    static async captionImage(templateId: string, texts: string[]): Promise<string | undefined> {
        if (!config.imgflip.username || !config.imgflip.password) {
            throw new Error('Imgflip credentials (IMGFLIP_USERNAME/IMGFLIP_PASSWORD) not configured.');
        }

        const params = new URLSearchParams();
        params.append('template_id', templateId);
        params.append('username', config.imgflip.username);
        params.append('password', config.imgflip.password);

        // Map texts to boxes[i][text]
        texts.forEach((text, index) => {
            params.append(`boxes[${index}][text]`, text);
        });

        try {
            const response = await fetch('https://api.imgflip.com/caption_image', {
                method: 'POST',
                body: params,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            const data = await response.json() as any;

            if (data.success) {
                return data.data.url;
            } else {
                console.error('Error captioning image via Imgflip:', data.error_message);
                return undefined;
            }
        } catch (error) {
            console.error('Failed to caption image via Imgflip:', error);
            return undefined;
        }
    }
}
