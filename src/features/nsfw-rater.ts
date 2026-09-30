/*
 * GemBot: NSFW Image Rater
 * Rates images on a 0-10 scale using LLM vision capabilities.
 */

import sharp from 'sharp';
import { Part } from '@google/generative-ai';
import { LLMProvider } from './llm/providers/types';
import { createProvider, providerHealth } from './llm/provider-factory';

export const NSFW_RATING_SYSTEM_PROMPT =
    'You are an objective workplace content safety evaluation assistant that rates images strictly on an integer scale from 0 to 10 based on appropriateness for an open corporate office environment.';

export const NSFW_RATING_USER_PROMPT = `Evaluate this image on a NSFW (Not Safe For Work) scale from 0 to 10 based on appropriateness for an open workplace screen:

0 = Strictly safe for work (general audience, modest/everyday clothing, non-sexual, professional scenes, nature, everyday objects). 100% safe to display on an open monitor at work.
1-2 = Mildly suggestive / borderline (revealing clothing, deep cleavage, swimwear/beachwear, provocative or sexy posing, tight/skimpy attire, risqué modeling). Not appropriate for an open workplace monitor.
3-5 = Moderately suggestive (lingerie, underwear, erotic modeling, partial nudity, heavy sexual innuendo).
6-9 = Explicit / Graphic (nudity, sexual acts, graphic violence/gore).
10 = Extreme explicit (hardcore pornography, extreme violence/gore).

CRITICAL BOUNDARY RULES:
- If the image features visible cleavage, revealing/sexy outfits, or suggestive/provocative posing, it MUST be rated at least 1 and NEVER 0.
- A rating of 0 is strictly reserved for images with ZERO sexual suggestiveness.
- If in doubt between 0 and 1, always rate at least 1.

Respond with ONLY a single integer between 0 and 10 representing the rating (e.g. "1"). Do not provide explanations.`;

/**
 * Parses a 0-10 NSFW integer rating from LLM text response.
 * Returns null if unparseable, out of range, or invalid.
 */
export function parseNsfwRating(text: string): number | null {
    if (!text || typeof text !== 'string') {
        return null;
    }

    // Strip markdown formatting (e.g. **, *, _, `) and surrounding whitespace
    const cleaned = text.replace(/[*_`]/g, '').trim();
    if (!cleaned) {
        return null;
    }

    // Reject negative numbers (e.g. "-5", "score: -2")
    if (/(?:^|[\s:=])-\s*\d+/.test(cleaned)) {
        return null;
    }

    // Reject decimals / floating point numbers
    if (/\d+\.\d+/.test(cleaned)) {
        return null;
    }

    // 1. Fraction check: e.g. "9/10", "2 out of 10", "NSFW: 9/10"
    const fractionMatch = cleaned.match(/\b(10|[0-9])\s*(?:\/|\s+out\s+of\s+)\s*10\b/i);
    if (fractionMatch) {
        const val = parseInt(fractionMatch[1], 10);
        if (val >= 0 && val <= 10) return val;
    }

    // 2. Labeled check: e.g. "Rating: 8", "Score: 3", "NSFW: 9", "Scale: 5"
    const labeledMatch = cleaned.match(/(?:rating|score|nsfw|scale)\s*[:=\-]?\s*(10|[0-9])\b/i);
    if (labeledMatch) {
        const val = parseInt(labeledMatch[1], 10);
        if (val >= 0 && val <= 10) return val;
    }

    // 3. Exact number check: starts with 0-10 followed by word boundary, punctuation, or end of string
    const exactMatch = cleaned.match(/^\s*(10|[0-9])(?:\b|[.:]|$)/);
    if (exactMatch) {
        const val = parseInt(exactMatch[1], 10);
        if (val >= 0 && val <= 10) return val;
    }

    // 4. Standalone integer check: if there is only a single integer in the entire text
    const allNumbers = cleaned.match(/\b\d+\b/g);
    if (allNumbers && allNumbers.length === 1) {
        const val = parseInt(allNumbers[0], 10);
        if (val >= 0 && val <= 10) return val;
    }

    return null;
}

export interface RateImageNsfwOptions {
    provider?: LLMProvider;
    timeoutMs?: number;
}

/**
 * Rates an image buffer on a 0-10 NSFW scale using an LLM vision provider.
 * Never throws; returns null on any error or timeout.
 */
export async function rateImageNsfw(
    imageBuffer: Buffer,
    options?: RateImageNsfwOptions
): Promise<number | null> {
    try {
        let provider = options?.provider;
        if (!provider) {
            const health = providerHealth();
            if (!health.ok) {
                console.warn(`[NSFW-Rater] Provider is not healthy: ${health.reason}`);
                return null;
            }
            try {
                provider = createProvider();
            } catch (e) {
                console.warn('[NSFW-Rater] Failed to create provider:', e);
                return null;
            }
        }

        // Preprocess image using sharp: resize to max 768x768 and convert to JPEG
        const resizedJpegBuffer = await sharp(imageBuffer)
            .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();

        const base64Data = resizedJpegBuffer.toString('base64');

        const question: Part[] = [
            { text: NSFW_RATING_USER_PROMPT },
            { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
        ];

        const timeoutMs = options?.timeoutMs ?? 8000;
        let timeoutId: NodeJS.Timeout | undefined;

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`NSFW rating timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        try {
            const chatPromise = provider.chat(question, {
                systemPrompt: NSFW_RATING_SYSTEM_PROMPT,
            });

            const result = await Promise.race([chatPromise, timeoutPromise]);
            return parseNsfwRating(result.text);
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    } catch (error) {
        console.warn('[NSFW-Rater] Rating failed:', error);
        return null;
    }
}
