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

import { createProvider } from './llm/provider-factory';
import { getRecentTidbitHistory, isTidbitDuplicate } from './tidbit-db';
import { computeTidbitHash, TidbitItem } from './tidbit-generator';

export let _createProvider = createProvider;
export function _setCreateProvider(fn: any) { _createProvider = fn; }
export function _resetCreateProvider() { _createProvider = createProvider; }

/**
 * Extracts and parses JSON from model responses that might contain markdown backticks.
 */
function parseJsonFromText(text: string): any {
    try {
        const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        return JSON.parse(cleaned);
    } catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            try {
                return JSON.parse(text.slice(start, end + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
}

/**
 * Generates a novel, verified fun factoid using Gemini when web sources are exhausted or return duplicates.
 */
export async function generateAiFunFact(recipientId?: string): Promise<TidbitItem> {
    const recent = getRecentTidbitHistory(recipientId, 'fact', 30)
        .filter(s => s && s.length < 60);

    const exclusions = recent.length > 0
        ? `\nNegative constraints (DO NOT cover or repeat any of these facts or topics):\n- ${recent.join('\n- ')}`
        : '';

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const provider = _createProvider();
            const prompt = `Generate a fascinating, obscure, and verified fun factoid from science, nature, biology, space, or history.
Rules:
- State the fact in a single engaging sentence (100 to 200 characters).
- Do not repeat common cliches (e.g. honey never spoils, bananas are berries, cleopatra lived closer to iphone).
- Do not include any intro, prefix, quotation marks, or conversational filler. Return ONLY the fact sentence.${exclusions}`;

            const res = await provider.chat(prompt, { temperature: 0.8 });
            let factText = res.text.replace(/^[*\s"“”]+|[*\s"“”]+$/g, '').trim();
            factText = factText.replace(/^(?:💡\s*)?(?:\*?Fun Fact(?:oid)?\*?:?\s*)/i, '').trim();

            if (factText) {
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
        } catch (err) {
            console.warn(`[TidbitAI] generateAiFunFact attempt ${attempt + 1} failed:`, err);
        }
    }

    throw new Error('Failed to generate novel AI fun fact');
}

/**
 * Generates a unique, authentic world cuisine recipe idea using Gemini when web sources fail or return duplicates.
 */
export async function generateAiRecipeIdea(recipientId?: string): Promise<TidbitItem> {
    const recent = getRecentTidbitHistory(recipientId, 'recipe', 30)
        .filter(s => s && s.length < 60);

    const exclusions = recent.length > 0
        ? `\nNegative constraints (DO NOT suggest or repeat any of these dishes):\n- ${recent.join('\n- ')}`
        : '';

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const provider = _createProvider();
            const prompt = `Generate a unique, authentic world cuisine recipe idea.
Rules:
- Choose an exciting traditional or modern dish from global cuisine (e.g., Thai, Ethiopian, Peruvian, Georgian, Mexican, Japanese, Indian, Levantine).
- Respond ONLY with a valid JSON object matching this schema:
{
  "name": "Dish Name",
  "cuisine": "Cuisine / Regional Origin",
  "snippet": "Concise 1-2 sentence preparation summary with key ingredients (max 140 chars).",
  "query": "Short Google search query to find this recipe"
}${exclusions}`;

            const res = await provider.chat(prompt, { temperature: 0.8 });
            const parsed = parseJsonFromText(res.text);
            if (parsed?.name && parsed?.cuisine && parsed?.snippet) {
                const name = parsed.name.trim();
                const cuisine = parsed.cuisine.trim();
                const snippet = parsed.snippet.trim();
                const query = encodeURIComponent(parsed.query?.trim() || `${name} recipe`);
                const sourceUrl = `https://www.google.com/search?q=${query}`;
                const hash = computeTidbitHash('recipe', name);

                if (!recipientId || !isTidbitDuplicate(recipientId, hash)) {
                    return {
                        text: `🍳 *Recipe Idea*: *${name}* (${cuisine}) - ${snippet} (<${sourceUrl}|Recipe>)`,
                        hash,
                        category: 'recipe',
                        contentIdentifier: name,
                    };
                }
            }
        } catch (err) {
            console.warn(`[TidbitAI] generateAiRecipeIdea attempt ${attempt + 1} failed:`, err);
        }
    }

    throw new Error('Failed to generate novel AI recipe idea');
}

/**
 * Generates a verified historical event on a specific date using Gemini when Wikipedia feeds are exhausted.
 */
export async function generateAiHistoricalFact(month: string, day: string, recipientId?: string): Promise<TidbitItem> {
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthIndex = parseInt(month, 10) - 1;
    const monthName = monthNames[monthIndex] || 'Today';

    const recent = getRecentTidbitHistory(recipientId, 'history', 30)
        .filter(s => s && s.length < 60);

    const exclusions = recent.length > 0
        ? `\nNegative constraints (DO NOT cover or repeat any of these events):\n- ${recent.join('\n- ')}`
        : '';

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const provider = _createProvider();
            const prompt = `Generate an authentic, verified historical event that occurred on ${monthName} ${parseInt(day, 10)}.
Rules:
- Focus on cultural, scientific, exploration, diplomatic, or technological milestones.
- Respond ONLY with a valid JSON object matching this schema:
{
  "year": 1969,
  "text": "Concise 1-sentence description of the event without the year prefix (max 160 chars)."
}${exclusions}`;

            const res = await provider.chat(prompt, { temperature: 0.7 });
            const parsed = parseJsonFromText(res.text);
            if (parsed?.year && parsed?.text) {
                const year = String(parsed.year).trim();
                const eventText = parsed.text.trim().replace(/^in\s+\d+[,:]?\s*/i, '');
                const hash = computeTidbitHash('history', `${year}:${eventText}`);

                if (!recipientId || !isTidbitDuplicate(recipientId, hash)) {
                    return {
                        text: `📜 *Historical Fact on This Day*: In ${year}, ${eventText}`,
                        hash,
                        category: 'history',
                        contentIdentifier: `${year}:${eventText}`,
                    };
                }
            }
        } catch (err) {
            console.warn(`[TidbitAI] generateAiHistoricalFact attempt ${attempt + 1} failed:`, err);
        }
    }

    throw new Error('Failed to generate novel AI historical fact');
}

/**
 * Generates an inspiring, profound quote with attribution using Gemini when web sources are exhausted.
 */
export async function generateAiQuote(recipientId?: string): Promise<TidbitItem> {
    const recent = getRecentTidbitHistory(recipientId, 'quote', 30)
        .filter(s => s && s.length < 60);

    const exclusions = recent.length > 0
        ? `\nNegative constraints (DO NOT repeat any of these quotes or authors):\n- ${recent.join('\n- ')}`
        : '';

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const provider = _createProvider();
            const prompt = `Generate a profound, verified inspirational or philosophical quote from literature, philosophy, science, or art.
Rules:
- Quote must be authentic and accurately attributed to a real historical or literary figure.
- Respond ONLY with a valid JSON object matching this schema:
{
  "quote": "The quote text without quotation marks",
  "author": "Name of Author or Speaker"
}${exclusions}`;

            const res = await provider.chat(prompt, { temperature: 0.8 });
            const parsed = parseJsonFromText(res.text);
            if (parsed?.quote && parsed?.author) {
                const quoteText = parsed.quote.replace(/^["“”]+|["“”]+$/g, '').trim();
                const author = parsed.author.trim();
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
        } catch (err) {
            console.warn(`[TidbitAI] generateAiQuote attempt ${attempt + 1} failed:`, err);
        }
    }

    throw new Error('Failed to generate novel AI inspirational quote');
}

/**
 * Generates a verified top news item using Gemini when web news feeds are exhausted or return duplicates.
 */
export async function generateAiTopNews(recipientId?: string): Promise<TidbitItem> {
    const recent = getRecentTidbitHistory(recipientId, 'news', 30)
        .filter(s => s && s.length < 60);

    const exclusions = recent.length > 0
        ? `\nNegative constraints (DO NOT cover or repeat any of these headlines):\n- ${recent.join('\n- ')}`
        : '';

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const provider = _createProvider();
            const prompt = `Generate a top news summary covering a major recent breakthrough or milestone in technology, science, artificial intelligence, clean energy, or space exploration.
Rules:
- Respond ONLY with a valid JSON object matching this schema:
{
  "headline": "Concise news headline (max 100 chars)",
  "source": "Reputable tech or science publication (e.g. MIT Technology Review, Nature, Reuters, Ars Technica)",
  "url": "https://news.google.com"
}${exclusions}`;

            const res = await provider.chat(prompt, { temperature: 0.7 });
            const parsed = parseJsonFromText(res.text);
            if (parsed?.headline) {
                const headline = parsed.headline.trim();
                const source = (parsed.source || 'News').trim();
                const url = (parsed.url || 'https://news.google.com').trim();
                const hash = computeTidbitHash('news', headline);

                if (!recipientId || !isTidbitDuplicate(recipientId, hash)) {
                    return {
                        text: `📰 *Today's Top News*: ${headline} - _${source}_ (<${url}|Read More>)`,
                        hash,
                        category: 'news',
                        contentIdentifier: headline,
                    };
                }
            }
        } catch (err) {
            console.warn(`[TidbitAI] generateAiTopNews attempt ${attempt + 1} failed:`, err);
        }
    }

    throw new Error('Failed to generate novel AI news item');
}
