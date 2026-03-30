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
    width?: number;
    height?: number;
    box_count: number;
}

export class MemeGenerator {
    private static memeCache: MemeTemplate[] = [];
    private static lastCacheUpdate = 0;
    private static readonly CACHE_DURATION = 1000 * 60 * 60 * 24; // 24 hours

    /**
     * Fetches popular meme templates from memegen.link.
     */
    static async getPopularMemes(): Promise<MemeTemplate[]> {
        const now = Date.now();
        if (this.memeCache.length > 0 && (now - this.lastCacheUpdate < this.CACHE_DURATION)) {
            return this.memeCache;
        }

        try {
            const response = await fetch('https://api.memegen.link/templates');
            const data = await response.json() as any[];

            if (Array.isArray(data)) {
                this.memeCache = data.map((t: any) => ({
                    id: t.id,
                    name: t.name,
                    url: t.blank,
                    box_count: t.lines
                }));
                this.lastCacheUpdate = now;
                return this.memeCache;
            } else {
                console.error('Error fetching memes from memegen.link: Unexpected response format');
                return [];
            }
        } catch (error) {
            console.error('Failed to fetch memes from memegen.link:', error);
            return [];
        }
    }

    /**
     * Searches for multiple meme templates by name or ID.
     */
    static async searchMemes(query: string): Promise<MemeTemplate[]> {
        const memes = await this.getPopularMemes();
        const searchLower = query.toLowerCase();

        return memes.filter(m => 
            m.id.toLowerCase().includes(searchLower) || 
            m.name.toLowerCase().includes(searchLower)
        ).slice(0, 10);
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
     * Sanitizes text for memegen.link URLs.
     */
    private static sanitize(text: string): string {
        if (!text) return '_';
        return text
            .replace(/_/g, '__')
            .replace(/-/g, '--')
            .replace(/\s+/g, '_')
            .replace(/\?/g, '~q')
            .replace(/&/g, '~a')
            .replace(/%/g, '~p')
            .replace(/#/g, '~h')
            .replace(/\//g, '~s')
            .replace(/\\/g, '~b')
            .replace(/"/g, "''");
    }

    /**
     * Captions a meme image using memegen.link.
     */
    static async captionImage(templateId: string, texts: string[]): Promise<string | undefined> {
        // Construct memegen.link URL: https://api.memegen.link/images/<id>/<line1>/<line2>.png
        const sanitizedTexts = texts.map(t => this.sanitize(t));
        
        // memegen.link expects a path-based URL. If fewer lines are provided than needed, 
        // they can be omitted, but the API is flexible.
        const path = [templateId, ...sanitizedTexts].join('/');
        return `https://api.memegen.link/images/${path}.png`;
    }
}
