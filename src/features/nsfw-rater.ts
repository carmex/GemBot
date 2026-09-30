/*
 * GemBot: NSFW Image Rater
 * Rates images on a 0-10 scale using LLM vision capabilities.
 */

import sharp from 'sharp';
import { Part } from '@google/generative-ai';
import { LLMProvider } from './llm/providers/types';
import { createProvider, providerHealth } from './llm/provider-factory';

export const NSFW_RATING_SYSTEM_PROMPT =
    'You are an objective content safety evaluation assistant that rates images strictly on an integer scale from 0 to 10.';

export const NSFW_RATING_USER_PROMPT = `Rate the NSFW level of this image on a scale from 0 to 10:
0 = Completely safe (general audience, everyday objects, animals, nature, landscapes, food, harmless cartoons, fully clothed people).
1-2 = Mildly suggestive (revealing clothing, deep cleavage, swimwear, suggestive poses).
3-5 = Moderately suggestive (underwear, lingerie, partial nudity, erotic modeling).
6-9 = Sexually explicit / graphic.
10 = Extreme explicit (hardcore pornography, graphic violence/gore).

If the image contains multiple animation frames or panels, rate based on the most severe frame depicted.
If completely safe with no suggestive or adult content, the rating must be 0.

First provide a brief 1-sentence explanation of what is depicted and any safety concerns, then give the rating as "Rating: <number>".
Format:
Explanation: <1 sentence>
Rating: <single integer 0-10>`;

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

    // 1. Line-start labeled check: e.g. "^Rating: 8", "\nRating: 0"
    const lineLabeledMatch = cleaned.match(/^\s*(?:rating|score|nsfw|scale)\s*[:=\-]?\s*(10|[0-9])\b/im);
    if (lineLabeledMatch) {
        const val = parseInt(lineLabeledMatch[1], 10);
        if (val >= 0 && val <= 10) return val;
    }

    // 2. Fraction check: e.g. "9/10", "2 out of 10", "NSFW: 9/10"
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

/**
 * Calculates key frame indices (first, middle, and last) for animated GIF evaluation.
 */
export function getFrameIndices(totalPages: number): number[] {
    if (totalPages <= 1) {
        return [0];
    }
    if (totalPages === 2) {
        return [0, 1];
    }
    return [0, Math.floor((totalPages - 1) / 2), totalPages - 1];
}

/**
 * Prepares an image buffer for LLM rating.
 * For static images, resizes to fit within 768x768 JPEG.
 * For animated images (e.g. multi-frame GIFs), extracts up to 3 key frames
 * (first, middle, last), resizes each to fit proportionally, and stitches them
 * side-by-side into a single composite JPEG.
 */
export async function prepareImageForRating(imageBuffer: Buffer): Promise<Buffer> {
    const metadata = await sharp(imageBuffer, { animated: true }).metadata();
    const isAnimated = Boolean(metadata.pages && metadata.pages > 1);

    if (!isAnimated || !metadata.pages) {
        return await sharp(imageBuffer)
            .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
    }

    try {
        const frameIndices = getFrameIndices(metadata.pages);
        const maxFrameWidth = Math.floor(768 / frameIndices.length);
        const maxFrameHeight = 768;

        const frameBuffers = await Promise.all(
            frameIndices.map((page) =>
                sharp(imageBuffer, { page })
                    .resize(maxFrameWidth, maxFrameHeight, { fit: 'inside', withoutEnlargement: true })
                    .png()
                    .toBuffer()
            )
        );

        const frameMetas = await Promise.all(frameBuffers.map((buf) => sharp(buf).metadata()));
        const canvasHeight = Math.max(...frameMetas.map((m) => m.height || 0));
        const totalWidth = frameMetas.reduce((sum, m) => sum + (m.width || 0), 0);

        let currentLeft = 0;
        const compositeList: sharp.OverlayOptions[] = [];
        for (let i = 0; i < frameBuffers.length; i++) {
            const top = Math.floor((canvasHeight - (frameMetas[i].height || 0)) / 2);
            compositeList.push({ input: frameBuffers[i], left: currentLeft, top });
            currentLeft += frameMetas[i].width || 0;
        }

        return await sharp({
            create: {
                width: totalWidth,
                height: canvasHeight,
                channels: 3,
                background: { r: 0, g: 0, b: 0 },
            },
        })
            .composite(compositeList)
            .jpeg({ quality: 80 })
            .toBuffer();
    } catch (err) {
        console.warn(
            '[NSFW-Rater] Failed to extract/stitch animated frames, falling back to single frame:',
            err
        );
        return await sharp(imageBuffer, { page: 0 })
            .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
    }
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

        // Preprocess image using sharp: resize to max 768x768 and convert to JPEG (stitches animated GIFs)
        const resizedJpegBuffer = await prepareImageForRating(imageBuffer);

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
            const rating = parseNsfwRating(result.text);
            const cleanText = (result.text || '').trim().replace(/\r?\n/g, ' | ');
            console.log(`[NSFW-Rater] LLM evaluation: "${cleanText}" -> Parsed score: ${rating}`);
            return rating;
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
