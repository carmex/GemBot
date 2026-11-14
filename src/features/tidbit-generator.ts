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

import crypto from 'crypto';
import fetch from 'node-fetch';
import { fetchStockNews } from './finnhub-api';
import { isTidbitDuplicate, recordDeliveredTidbits } from './tidbit-db';
import {
    generateAiFunFact,
    generateAiHistoricalFact,
    generateAiQuote,
    generateAiRecipeIdea,
    generateAiTopNews,
} from './tidbit-ai';

export interface TidbitItem {
    text: string;
    hash: string;
    category: string;
    contentIdentifier?: string;
    imageUrl?: string;
}

export interface ParsedSlackTidbit {
    category: string;
    itemHash: string;
    contentIdentifier: string;
    text: string;
}

const DEFAULT_FETCH_HEADERS = {
    'User-Agent': 'GemBot/1.0 (https://github.com/carmex/GemBot)',
    'Accept': 'application/json, text/xml, */*',
};

// Internal reference for fetch and fetchStockNews to allow test mocking of web fallbacks
export let _fetch = fetch;
export function _setFetch(fn: any) { _fetch = fn; }
export function _resetFetch() { _fetch = fetch; }

export let _fetchStockNews = fetchStockNews;
export function _setFetchStockNews(fn: any) { _fetchStockNews = fn; }
export function _resetFetchStockNews() { _fetchStockNews = fetchStockNews; }

/**
 * Normalizes text for canonical hashing by stripping markdown, converting typographic quotes,
 * stripping trailing punctuation, collapsing whitespaces, and lowercasing.
 */
export function normalizeTidbitText(text: string): string {
    if (!text) return '';
    let normalized = text
        // Normalize typographic quotes and apostrophes to standard ASCII (' and ")
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        // Strip markdown formatting (*, _, ~, `)
        .replace(/[*_~`]/g, '');

    // Strip trailing periods, commas, and punctuation marks (even before closing quotes)
    normalized = normalized
        .replace(/[.,!?;:]+(?=["']*$)/g, '')
        .replace(/[.,!?;:]+$/g, '');

    return normalized
        // Collapse multiple whitespaces and trim
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Computes a deterministic canonical SHA-256 hash for a tidbit item to prevent repetitive deliveries.
 */
export function computeTidbitHash(category: string, contentIdentifier: string): string {
    const normalized = `${category.trim().toLowerCase()}:${normalizeTidbitText(contentIdentifier)}`;
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Decodes common XML/HTML entities found in RSS feeds and web APIs.
 */
function decodeHtmlEntities(str: string): string {
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

/**
 * Fixes capitalization errors where letters after an apostrophe in contractions
 * and possessives are erroneously capitalized (e.g. "It'S" -> "It's", "You'Ve" -> "You've").
 * Preserves genuine capitalized names like O'Connor, D'Angelo, etc.
 */
export function fixContractionCapitalization(text: string): string {
    if (!text) return '';
    // Matches straight (') and curly/typographic (’) apostrophes followed by
    // standard English contraction/possessive suffixes: s, t, re, ve, m, ll, d.
    const contractionRegex = /(?<=[a-zA-Z])(['\u2019])(S|T|RE|Re|VE|Ve|M|LL|Ll|D)\b/g;
    return text.replace(contractionRegex, (_, apostrophe, suffix) => apostrophe + suffix.toLowerCase());
}

/**
 * Detects if a quote string is mechanically Title Cased and normalizes it to sentence case.
 */
export function normalizeQuoteCasing(text: string): string {
    if (!text) return '';
    const cleaned = fixContractionCapitalization(text);

    // Identify words of length >= 2
    const words = cleaned.match(/[a-zA-Z]+/g) || [];
    if (words.length < 4) {
        return cleaned;
    }

    // Check if >= 70% of words are capitalized (indicative of machine title-casing)
    const capitalizedCount = words.filter(w => w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase()).length;
    const isTitleCased = (capitalizedCount / words.length) >= 0.7;

    if (!isTitleCased) {
        return cleaned;
    }

    // Split into sentences preserving terminators (. ! ?)
    const sentenceParts = cleaned.split(/([.!?]+\s*)/);
    const result: string[] = [];

    for (const part of sentenceParts) {
        const tokens = part.split(' ');
        const processedTokens = tokens.map((token, index) => {
            if (!token) return token;

            // Keep initial word in sentence capitalized
            if (index === 0) return token;

            // Preserve English pronoun 'I', 'I'm', 'I've', 'I'll', 'I'd'
            if (/^I(['\u2019][a-z]+)?$/i.test(token)) {
                return 'I' + (token.length > 1 ? token.slice(1).toLowerCase() : '');
            }

            // Preserve acronyms of 2+ letters (e.g. NASA, USA, MLB, CNBC)
            const lettersOnly = token.replace(/[^a-zA-Z]/g, '');
            if (lettersOnly.length >= 2 && lettersOnly === lettersOnly.toUpperCase()) {
                return token;
            }

            // Lowercase first letter of standard title-cased words, preserving any leading punctuation
            return token.replace(/^([^a-zA-Z]*)([A-Z])(.*)$/, (_, prefix, firstLetter, rest) => {
                return prefix + firstLetter.toLowerCase() + rest;
            });
        });
        result.push(processedTokens.join(' '));
    }

    return result.join('');
}

/**
 * Parses a single bullet from Gembo's tidbit message.
 */
function parseSingleBullet(bulletText: string): ParsedSlackTidbit | null {
    // 1. Fun Factoid: 💡 *Fun Factoid*: ...
    if (bulletText.includes('Fun Factoid')) {
        const match = bulletText.match(/(?:💡\s*)?\*?Fun Factoid\*?:\s*([\s\S]*)/i);
        if (match) {
            const raw = match[1].trim();
            return {
                category: 'fact',
                contentIdentifier: raw,
                itemHash: computeTidbitHash('fact', raw),
                text: bulletText,
            };
        }
    }

    // 2. Recipe Idea: 🍳 *Recipe Idea*: *Name* (Cuisine) - Snippet (<Link|Recipe>)
    if (bulletText.includes('Recipe Idea')) {
        const match = bulletText.match(/(?:🍳\s*)?\*?Recipe Idea\*?:\s*([\s\S]*)/i);
        if (match) {
            const raw = match[1].trim();
            const nameMatch = raw.match(/^\*([^*]+)\*/);
            let name = nameMatch ? nameMatch[1].trim() : '';
            if (!name) {
                name = raw.split(/\s*[-—–(]/)[0].trim();
            }
            return {
                category: 'recipe',
                contentIdentifier: name,
                itemHash: computeTidbitHash('recipe', name),
                text: bulletText,
            };
        }
    }

    // 3. Historical Fact: 📜 *Historical Fact on This Day*: In Year, Event
    if (bulletText.includes('Historical Fact')) {
        const match = bulletText.match(/(?:📜\s*)?\*?Historical Fact(?: on This Day)?\*?:\s*([\s\S]*)/i);
        if (match) {
            const raw = match[1].trim();
            const histMatch = raw.match(/^In\s+(\d+)[,:]?\s*([\s\S]*)/i);
            const contentId = histMatch ? `${histMatch[1]}:${histMatch[2].trim()}` : raw;
            return {
                category: 'history',
                contentIdentifier: contentId,
                itemHash: computeTidbitHash('history', contentId),
                text: bulletText,
            };
        }
    }

    // 4. Inspirational Quote: 💬 *Inspirational Quote*: "Quote" — *Author*
    if (bulletText.includes('Inspirational Quote')) {
        const match = bulletText.match(/(?:💬\s*)?\*?Inspirational Quote\*?:\s*([\s\S]*)/i);
        if (match) {
            const raw = match[1].trim();
            const quoteMatch = raw.match(/^["“](.*?)["”]\s*[—–-]/s);
            let quoteText = quoteMatch ? quoteMatch[1].trim() : '';
            if (!quoteText) {
                const parts = raw.split(/\s*[—–-]\s*\*/);
                quoteText = parts[0].replace(/^["“]|["”]$/g, '').trim();
            }
            return {
                category: 'quote',
                contentIdentifier: quoteText,
                itemHash: computeTidbitHash('quote', quoteText),
                text: bulletText,
            };
        }
    }

    // 5. Today's Top News: 📰 *Today's Top News*: Headline - _Source_ (<Link|Read More>)
    if (bulletText.includes("Today's Top News") || bulletText.includes('Top News')) {
        const match = bulletText.match(/(?:📰\s*)?\*?Today's Top News\*?:\s*([\s\S]*)/i);
        if (match) {
            let raw = match[1].trim();
            raw = raw.replace(/\s*\(<[^>]+>\)\s*$/, '').trim();
            raw = raw.replace(/\s*-\s*_[^_]+_\s*$/, '').trim();
            return {
                category: 'news',
                contentIdentifier: raw,
                itemHash: computeTidbitHash('news', raw),
                text: bulletText,
            };
        }
    }

    return null;
}

/**
 * Parses message text containing Gembo's Tidbits of the Day and extracts individual
 * bullets, identifying categories and computing canonical hashes for deduplication.
 */
export function parseTidbitsFromSlackMessage(messageText: string): ParsedSlackTidbit[] {
    if (!messageText || !messageText.includes("*Gembo's Tidbits of the Day*")) {
        return [];
    }

    const items: ParsedSlackTidbit[] = [];
    const lines = messageText.split('\n');
    let currentBullet: string[] = [];

    for (const line of lines) {
        if (line.trim().startsWith('• ')) {
            if (currentBullet.length > 0) {
                const bulletText = currentBullet.join('\n').trim();
                const parsed = parseSingleBullet(bulletText);
                if (parsed) items.push(parsed);
                currentBullet = [];
            }
            currentBullet.push(line.trim().substring(2).trim());
        } else if (currentBullet.length > 0) {
            if (line.trim().length > 0) {
                currentBullet.push(line.trim());
            }
        }
    }

    if (currentBullet.length > 0) {
        const bulletText = currentBullet.join('\n').trim();
        const parsed = parseSingleBullet(bulletText);
        if (parsed) items.push(parsed);
    }

    return items;
}

/**
 * Category 1: Today's Top News
 * Dynamically sources from Finnhub Stock News with live Google News RSS and Gemini AI fallbacks.
 */
export async function getTopNews(recipientId?: string): Promise<TidbitItem> {
    // Primary: Finnhub General Stock News
    try {
        const news = await _fetchStockNews();
        if (news && news.length > 0) {
            const unusedArticles = recipientId
                ? news.filter(a => !isTidbitDuplicate(recipientId, computeTidbitHash('news', a.headline)))
                : news;

            if (unusedArticles.length > 0) {
                const article = unusedArticles[Math.floor(Math.random() * unusedArticles.length)];
                const headline = decodeHtmlEntities(article.headline.trim());
                const source = decodeHtmlEntities(article.source?.trim() || 'Finnhub');
                const url = article.url?.trim() || 'https://finnhub.io';
                const hash = computeTidbitHash('news', article.headline);

                return {
                    text: `📰 *Today's Top News*: ${headline} - _${source}_ (<${url}|Read More>)`,
                    hash,
                    category: 'news',
                    contentIdentifier: article.headline,
                };
            }
        }
    } catch (err) {
        console.warn('[TidbitGenerator] Finnhub news fetch failed, trying Google News RSS fallback:', err);
    }

    // Web Fallback: Google News RSS
    try {
        const response = await _fetch('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', {
            signal: AbortSignal.timeout(6000),
            headers: DEFAULT_FETCH_HEADERS,
        });

        if (response.ok) {
            const xml = await response.text();
            const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
            const parsedItems: { headline: string; source: string; link: string }[] = [];

            for (const item of itemMatches) {
                const rawTitle = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
                const rawLink = (item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
                const rawSource = (item.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '';

                if (rawTitle) {
                    let headline = decodeHtmlEntities(rawTitle.trim());
                    let source = decodeHtmlEntities(rawSource.trim());

                    if (!source && headline.includes(' - ')) {
                        const parts = headline.split(' - ');
                        source = parts.pop()!.trim();
                        headline = parts.join(' - ').trim();
                    }
                    if (!source) source = 'Google News';

                    parsedItems.push({
                        headline,
                        source,
                        link: rawLink.trim() || 'https://news.google.com',
                    });
                }
            }

            if (parsedItems.length > 0) {
                const candidates = recipientId
                    ? parsedItems.filter(item => !isTidbitDuplicate(recipientId, computeTidbitHash('news', item.headline)))
                    : parsedItems;

                if (candidates.length > 0) {
                    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
                    const hash = computeTidbitHash('news', chosen.headline);

                    return {
                        text: `📰 *Today's Top News*: ${chosen.headline} - _${chosen.source}_ (<${chosen.link}|Read More>)`,
                        hash,
                        category: 'news',
                        contentIdentifier: chosen.headline,
                    };
                }
            }
        }
    } catch (err) {
        console.warn('[TidbitGenerator] Google News RSS fetch failed:', err);
    }

    // AI Fallback: Generate novel top news via Gemini
    try {
        console.log('[TidbitGenerator] Escalating top news to AI generation fallback...');
        return await generateAiTopNews(recipientId);
    } catch (aiErr) {
        console.warn('[TidbitGenerator] AI top news generation failed:', aiErr);
    }

    throw new Error('All top news sources failed');
}

/**
 * Category 2: Fun Factoid
 * Sourced dynamically from UselessFacts API with live Cat Facts API and Gemini AI fallbacks.
 */
export async function getFunFact(recipientId?: string): Promise<TidbitItem> {
    // Primary: UselessFacts API (retry up to 10 times if duplicate)
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            const response = await _fetch('https://uselessfacts.jsph.pl/api/v2/facts/random', {
                signal: AbortSignal.timeout(6000),
                headers: DEFAULT_FETCH_HEADERS,
            });
            if (response.ok) {
                const data = (await response.json()) as { text?: string };
                if (data?.text) {
                    const factText = decodeHtmlEntities(data.text.trim());
                    const hash = computeTidbitHash('fact', factText);

                    if (!recipientId || !isTidbitDuplicate(recipientId, hash)) {
                        return {
                            text: `💡 *Fun Factoid*: ${factText}`,
                            hash,
                            category: 'fact',
                            contentIdentifier: factText,
                        };
                    }
                }
            }
        } catch (err) {
            console.warn(`[TidbitGenerator] UselessFacts attempt ${attempt + 1} failed:`, err);
            break;
        }
    }

    // Web Fallback: Cat Facts API (strict duplicate check)
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const response = await _fetch('https://catfact.ninja/fact', {
                signal: AbortSignal.timeout(6000),
                headers: DEFAULT_FETCH_HEADERS,
            });
            if (response.ok) {
                const data = (await response.json()) as { fact?: string };
                if (data?.fact) {
                    const factText = decodeHtmlEntities(data.fact.trim());
                    const hash = computeTidbitHash('fact', factText);
                    if (!recipientId || !isTidbitDuplicate(recipientId, hash)) {
                        return {
                            text: `💡 *Fun Factoid*: ${factText}`,
                            hash,
                            category: 'fact',
                            contentIdentifier: factText,
                        };
                    }
                }
            }
        } catch (err) {
            console.warn(`[TidbitGenerator] Cat Facts attempt ${attempt + 1} failed:`, err);
            break;
        }
    }

    // AI Fallback: Generate novel verified fact via Gemini
    try {
        console.log('[TidbitGenerator] Escalating fun fact to AI generation fallback...');
        return await generateAiFunFact(recipientId);
    } catch (aiErr) {
        console.warn('[TidbitGenerator] AI fun fact generation failed:', aiErr);
    }

    throw new Error('All fun fact sources failed');
}

/**
 * Category 3: Historical Fact on This Day
 * Sourced dynamically from Wikipedia On This Day API with selected feed and Gemini AI fallbacks.
 */
export async function getHistoricalFact(recipientId?: string): Promise<TidbitItem> {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const fetchWikipediaFeed = async (endpoint: 'events' | 'selected'): Promise<{ year: number; text: string }[] | null> => {
        try {
            const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/${endpoint}/${month}/${day}`;
            const response = await _fetch(url, {
                signal: AbortSignal.timeout(6000),
                headers: DEFAULT_FETCH_HEADERS,
            });
            if (response.ok) {
                const data = (await response.json()) as { events?: { text: string; year: number }[]; selected?: { text: string; year: number }[] };
                const list = endpoint === 'events' ? data.events : data.selected;
                if (list && list.length > 0) {
                    return list;
                }
            }
        } catch (err) {
            console.warn(`[TidbitGenerator] Wikipedia feed/${endpoint} failed:`, err);
        }
        return null;
    };

    let events = await fetchWikipediaFeed('events');
    let unusedEvents = events && recipientId
        ? events.filter(e => !isTidbitDuplicate(recipientId, computeTidbitHash('history', `${e.year}:${decodeHtmlEntities(e.text.trim())}`)))
        : (events || []);

    if (unusedEvents.length === 0) {
        const selected = await fetchWikipediaFeed('selected');
        unusedEvents = selected && recipientId
            ? selected.filter(e => !isTidbitDuplicate(recipientId, computeTidbitHash('history', `${e.year}:${decodeHtmlEntities(e.text.trim())}`)))
            : (selected || []);
    }

    if (unusedEvents.length > 0) {
        const chosen = unusedEvents[Math.floor(Math.random() * unusedEvents.length)];
        const eventText = decodeHtmlEntities(chosen.text.trim());
        const contentIdentifier = `${chosen.year}:${eventText}`;
        const hash = computeTidbitHash('history', contentIdentifier);

        return {
            text: `📜 *Historical Fact on This Day*: In ${chosen.year}, ${eventText}`,
            hash,
            category: 'history',
            contentIdentifier,
        };
    }

    // AI Fallback: Generate novel historical event via Gemini
    try {
        console.log('[TidbitGenerator] Escalating historical fact to AI generation fallback...');
        return await generateAiHistoricalFact(month, day, recipientId);
    } catch (aiErr) {
        console.warn('[TidbitGenerator] AI historical fact generation failed:', aiErr);
    }

    throw new Error('All historical fact sources failed');
}

function extractImageUrlFromLdJsonNode(node: any): string | undefined {
    if (!node || typeof node !== 'object') return undefined;

    if (Array.isArray(node)) {
        for (const item of node) {
            const found = extractImageUrlFromLdJsonNode(item);
            if (found) return found;
        }
        return undefined;
    }

    const typeVal = node['@type'];
    const isRecipe =
        (typeof typeVal === 'string' && typeVal.toLowerCase().includes('recipe')) ||
        (Array.isArray(typeVal) && typeVal.some(t => typeof t === 'string' && t.toLowerCase().includes('recipe')));

    if (isRecipe && node.image) {
        const img = node.image;
        if (typeof img === 'string' && img.trim()) {
            return img.trim();
        }
        if (Array.isArray(img)) {
            for (const entry of img) {
                if (typeof entry === 'string' && entry.trim()) {
                    return entry.trim();
                }
                if (entry && typeof entry === 'object') {
                    const candidate = entry.url || entry.contentUrl;
                    if (typeof candidate === 'string' && candidate.trim()) {
                        return candidate.trim();
                    }
                }
            }
        }
        if (typeof img === 'object') {
            const candidate = img.url || img.contentUrl;
            if (typeof candidate === 'string' && candidate.trim()) {
                return candidate.trim();
            }
        }
    }

    if (node['@graph']) {
        const found = extractImageUrlFromLdJsonNode(node['@graph']);
        if (found) return found;
    }

    return undefined;
}

/**
 * Fetches a recipe webpage and extracts the primary recipe image URL from OpenGraph,
 * Twitter Card, or Schema.org Recipe JSON-LD metadata.
 */
export async function extractImageFromWebpage(url: string): Promise<string | undefined> {
    if (!url || !/^https?:\/\//i.test(url.trim())) {
        return undefined;
    }
    const targetUrl = url.trim();

    const resolveUrl = (rawImgUrl: string): string | undefined => {
        if (!rawImgUrl) return undefined;
        const cleaned = decodeHtmlEntities(rawImgUrl.trim());
        if (!cleaned) return undefined;
        try {
            const resolved = new URL(cleaned, targetUrl).href;
            return /^https?:\/\//i.test(resolved) ? resolved : undefined;
        } catch {
            return undefined;
        }
    };

    try {
        const response = await _fetch(targetUrl, {
            signal: AbortSignal.timeout(4000),
            headers: {
                ...DEFAULT_FETCH_HEADERS,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        });

        if (!response || !response.ok) {
            return undefined;
        }

        const html = await response.text();
        if (!html) {
            return undefined;
        }

        // 1. Check <meta property="og:image"> / <meta name="og:image">
        const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
        let twitterCandidate: string | undefined;

        for (const tag of metaTags) {
            const propMatch = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i);
            const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
            if (!propMatch || !contentMatch) continue;

            const propName = propMatch[1].trim().toLowerCase();
            const contentVal = contentMatch[1].trim();
            if (!contentVal) continue;

            if (propName === 'og:image' || propName === 'og:image:secure_url' || propName === 'og:image:url') {
                const resolved = resolveUrl(contentVal);
                if (resolved) return resolved;
            } else if (!twitterCandidate && (propName === 'twitter:image' || propName === 'twitter:image:src')) {
                twitterCandidate = resolveUrl(contentVal);
            }
        }

        // 2. Fallback to <meta name="twitter:image">
        if (twitterCandidate) {
            return twitterCandidate;
        }

        // 3. Fallback to application/ld+json Recipe schema image
        const ldJsonRegex = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let match: RegExpExecArray | null;
        while ((match = ldJsonRegex.exec(html)) !== null) {
            const rawJson = match[1]?.trim();
            if (!rawJson) continue;
            try {
                const parsed = JSON.parse(rawJson);
                const rawImg = extractImageUrlFromLdJsonNode(parsed);
                if (rawImg) {
                    const resolved = resolveUrl(rawImg);
                    if (resolved) return resolved;
                }
            } catch {
                // Ignore malformed JSON-LD blocks
            }
        }
    } catch {
        // Ignore network/timeout errors and fall back to API thumbnail
    }

    return undefined;
}

/**
 * Category 4: Recipe Ideas
 * Sourced dynamically from TheMealDB API with live DummyJSON Recipes and Gemini AI fallbacks.
 */
export async function getRecipeIdea(recipientId?: string): Promise<TidbitItem> {
    // Primary: TheMealDB random meal (retry up to 10 times if duplicate)
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            const response = await _fetch('https://www.themealdb.com/api/json/v1/1/random.php', {
                signal: AbortSignal.timeout(6000),
                headers: DEFAULT_FETCH_HEADERS,
            });
            if (response.ok) {
                const data = (await response.json()) as { meals?: any[] };
                const meal = data?.meals?.[0];
                if (meal?.strMeal) {
                    const name = decodeHtmlEntities(meal.strMeal.trim());
                    const hash = computeTidbitHash('recipe', name);

                    if (!recipientId || !isTidbitDuplicate(recipientId, hash)) {
                        const cuisine = decodeHtmlEntities(
                            meal.strArea?.trim() && meal.strArea !== 'Unknown'
                                ? meal.strArea.trim()
                                : meal.strCategory?.trim() || 'Delicious'
                        );
                        const cleanInstructions = decodeHtmlEntities(
                            meal.strInstructions?.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim() || ''
                        );
                        const snippet = cleanInstructions.length > 140
                            ? cleanInstructions.slice(0, 140).trim() + '...'
                            : cleanInstructions;
                        const rawSource = meal.strSource?.trim();
                        const sourceUrl = rawSource || meal.strYoutube?.trim() || `https://www.themealdb.com/meal/${meal.idMeal}`;

                        let imageUrl: string | undefined;
                        if (rawSource && /^https?:\/\//i.test(rawSource)) {
                            imageUrl = await extractImageFromWebpage(rawSource);
                        }
                        if (!imageUrl && meal.strMealThumb?.trim() && /^https?:\/\//i.test(meal.strMealThumb.trim())) {
                            imageUrl = meal.strMealThumb.trim();
                        }

                        return {
                            text: `🍳 *Recipe Idea*: *${name}* (${cuisine}) - ${snippet} (<${sourceUrl}|Recipe>)`,
                            hash,
                            category: 'recipe',
                            contentIdentifier: name,
                            ...(imageUrl ? { imageUrl } : {}),
                        };
                    }
                }
            }
        } catch (err) {
            console.warn(`[TidbitGenerator] TheMealDB attempt ${attempt + 1} failed:`, err);
            break;
        }
    }

    // Web Fallback: DummyJSON Recipes API
    try {
        const response = await _fetch('https://dummyjson.com/recipes', {
            signal: AbortSignal.timeout(6000),
            headers: DEFAULT_FETCH_HEADERS,
        });
        if (response.ok) {
            const data = (await response.json()) as { recipes?: any[] };
            if (data?.recipes && data.recipes.length > 0) {
                const candidates = recipientId
                    ? data.recipes.filter(r => !isTidbitDuplicate(recipientId, computeTidbitHash('recipe', r.name)))
                    : data.recipes;

                if (candidates.length > 0) {
                    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
                    const name = decodeHtmlEntities(chosen.name.trim());
                    const cuisine = decodeHtmlEntities(chosen.cuisine?.trim() || 'General');
                    const rawInstructions = Array.isArray(chosen.instructions) ? chosen.instructions.join(' ') : String(chosen.instructions || '');
                    const cleanInstructions = decodeHtmlEntities(rawInstructions.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim());
                    const snippet = cleanInstructions.length > 140 ? cleanInstructions.slice(0, 140).trim() + '...' : cleanInstructions;
                    const sourceUrl = `https://dummyjson.com/recipes/${chosen.id}`;
                    const hash = computeTidbitHash('recipe', name);
                    const imageUrl = typeof chosen.image === 'string' && /^https?:\/\//i.test(chosen.image.trim())
                        ? chosen.image.trim()
                        : undefined;

                    return {
                        text: `🍳 *Recipe Idea*: *${name}* (${cuisine}) - ${snippet} (<${sourceUrl}|Recipe>)`,
                        hash,
                        category: 'recipe',
                        contentIdentifier: name,
                        ...(imageUrl ? { imageUrl } : {}),
                    };
                }
            }
        }
    } catch (err) {
        console.warn('[TidbitGenerator] DummyJSON recipes fallback failed:', err);
    }

    // AI Fallback: Generate unique world cuisine recipe via Gemini
    try {
        console.log('[TidbitGenerator] Escalating recipe idea to AI generation fallback...');
        return await generateAiRecipeIdea(recipientId);
    } catch (aiErr) {
        console.warn('[TidbitGenerator] AI recipe generation failed:', aiErr);
    }

    throw new Error('All recipe sources failed');
}

/**
 * Category 5: Inspirational Quotes
 * Sourced dynamically from ZenQuotes API with live DummyJSON Quotes and Gemini AI fallbacks.
 */
export async function getInspirationalQuote(recipientId?: string): Promise<TidbitItem> {
    // Primary: ZenQuotes API (retry up to 10 times if duplicate)
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            const response = await _fetch('https://zenquotes.io/api/random', {
                signal: AbortSignal.timeout(6000),
                headers: DEFAULT_FETCH_HEADERS,
            });
            if (response.ok) {
                const data = (await response.json()) as { q?: string; a?: string }[];
                const first = data?.[0];
                if (first?.q && first?.a) {
                    const quoteText = normalizeQuoteCasing(decodeHtmlEntities(first.q.trim()));
                    const author = decodeHtmlEntities(first.a.trim());
                    const hash = computeTidbitHash('quote', quoteText);

                    if (!recipientId || !isTidbitDuplicate(recipientId, hash)) {
                        return {
                            text: `💬 *Inspirational Quote*: "${quoteText}" — *${author}*`,
                            hash,
                            category: 'quote',
                            contentIdentifier: quoteText,
                        };
                    }
                }
            }
        } catch (err) {
            console.warn(`[TidbitGenerator] ZenQuotes attempt ${attempt + 1} failed:`, err);
            break;
        }
    }

    // Web Fallback: DummyJSON Quotes API (strict duplicate check)
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            const response = await _fetch('https://dummyjson.com/quotes/random', {
                signal: AbortSignal.timeout(6000),
                headers: DEFAULT_FETCH_HEADERS,
            });
            if (response.ok) {
                const data = (await response.json()) as { quote?: string; author?: string };
                if (data?.quote && data?.author) {
                    const quoteText = normalizeQuoteCasing(decodeHtmlEntities(data.quote.trim()));
                    const author = decodeHtmlEntities(data.author.trim());
                    const hash = computeTidbitHash('quote', quoteText);

                    if (!recipientId || !isTidbitDuplicate(recipientId, hash)) {
                        return {
                            text: `💬 *Inspirational Quote*: "${quoteText}" — *${author}*`,
                            hash,
                            category: 'quote',
                            contentIdentifier: quoteText,
                        };
                    }
                }
            }
        } catch (err) {
            console.warn(`[TidbitGenerator] DummyJSON quotes fallback failed:`, err);
            break;
        }
    }

    // AI Fallback: Generate inspiring quote via Gemini
    try {
        console.log('[TidbitGenerator] Escalating inspirational quote to AI generation fallback...');
        return await generateAiQuote(recipientId);
    } catch (aiErr) {
        console.warn('[TidbitGenerator] AI quote generation failed:', aiErr);
    }

    throw new Error('All inspirational quote sources failed');
}

/**
 * Generates `n` random tidbit items (1 <= n <= 5) sampled from 5 dynamically sourced categories,
 * returning both the formatted message text and Slack Block Kit blocks (including recipe images).
 * Records delivered items to the database if recipientId is supplied.
 */
export async function generateTidbitsWithBlocks(
    n: number,
    recipientId?: string
): Promise<{ text: string; blocks: any[]; items: TidbitItem[] }> {
    const validN = Math.max(1, Math.min(5, Math.floor(n)));

    const categoryHandlers: { [key: string]: (recipient?: string) => Promise<TidbitItem> } = {
        news: getTopNews,
        fact: getFunFact,
        history: getHistoricalFact,
        recipe: getRecipeIdea,
        quote: getInspirationalQuote,
    };

    const keys = Object.keys(categoryHandlers);

    // Fisher-Yates shuffle
    for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
    }

    const selectedKeys = keys.slice(0, validN);
    const results = await Promise.all(selectedKeys.map(k => categoryHandlers[k](recipientId)));

    // Clean mid-word contraction capitalization across all items
    for (const item of results) {
        item.text = fixContractionCapitalization(item.text);
    }

    if (recipientId && results.length > 0) {
        recordDeliveredTidbits(
            recipientId,
            results.map(r => ({
                category: r.category,
                itemHash: r.hash,
                contentIdentifier: r.contentIdentifier,
            }))
        );
    }

    const header = `*Gembo's Tidbits of the Day* ☀️\n\n`;
    const body = results.map(item => `• ${item.text}`).join('\n\n');
    const text = `${header}${body}`;

    const blocks: any[] = [];
    const itemsWithImages = results.filter(item => item.imageUrl && /^https?:\/\//i.test(item.imageUrl));
    if (itemsWithImages.length > 0) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text,
            },
        });
        for (const item of itemsWithImages) {
            blocks.push({
                type: 'image',
                image_url: item.imageUrl,
                alt_text: item.contentIdentifier || 'Recipe Image',
                title: {
                    type: 'plain_text',
                    text: item.contentIdentifier ? `🍳 ${item.contentIdentifier}` : '🍳 Recipe Idea',
                    emoji: true,
                },
            });
        }
    }

    return { text, blocks, items: results };
}

/**
 * Generates `n` random tidbit items (1 <= n <= 5) sampled from 5 dynamically sourced categories.
 * Records delivered items to the database if recipientId is supplied.
 */
export async function generateTidbits(n: number, recipientId?: string): Promise<string> {
    const { text } = await generateTidbitsWithBlocks(n, recipientId);
    return text;
}
