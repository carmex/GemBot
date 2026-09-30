/*
 * GemBot: NSFW Rater Test Suite
 */

import sharp from 'sharp';
import { Part } from '@google/generative-ai';
import {
    parseNsfwRating,
    rateImageNsfw,
    NSFW_RATING_SYSTEM_PROMPT,
    NSFW_RATING_USER_PROMPT,
} from '../src/features/nsfw-rater';
import { LLMProvider, LLMChatOptions, LLMResult } from '../src/features/llm/providers/types';

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`FAILED: ${message}`);
        throw new Error(`Test failed: ${message}`);
    }
    console.log(`PASSED: ${message}`);
}

const PNG_1x1 = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d450000000049454e44ae426082',
    'hex'
);

async function runTests() {
    console.log('=== Running NSFW Rater Tests ===\n');

    // ==========================================
    // 1. parseNsfwRating Unit Tests
    // ==========================================
    console.log('--- 1. parseNsfwRating Tests ---');

    // Clean ratings
    assert(parseNsfwRating('0') === 0, 'Clean "0" should return 0');
    assert(parseNsfwRating('1') === 1, 'Clean "1" should return 1');
    assert(parseNsfwRating('10') === 10, 'Clean "10" should return 10');
    assert(parseNsfwRating('5') === 5, 'Clean "5" should return 5');

    // Text formats
    assert(parseNsfwRating('Rating: 0') === 0, '"Rating: 0" should return 0');
    assert(parseNsfwRating('Score: 0') === 0, '"Score: 0" should return 0');
    assert(parseNsfwRating('0/10') === 0, '"0/10" should return 0');
    assert(parseNsfwRating('Rating: 8') === 8, '"Rating: 8" should return 8');
    assert(parseNsfwRating('NSFW: 9/10') === 9, '"NSFW: 9/10" should return 9');
    assert(parseNsfwRating('Score: 3') === 3, '"Score: 3" should return 3');
    assert(
        parseNsfwRating('I would rate this image a 2 out of 10') === 2,
        '"I would rate this image a 2 out of 10" should return 2'
    );
    assert(parseNsfwRating('Rating: 10/10') === 10, '"Rating: 10/10" should return 10');
    assert(parseNsfwRating('NSFW scale: 6') === 6, '"NSFW scale: 6" should return 6');
    assert(parseNsfwRating('Score = 7') === 7, '"Score = 7" should return 7');

    // Markdown formatted
    assert(parseNsfwRating('**7**') === 7, '"**7**" should return 7');
    assert(parseNsfwRating('*Rating: 4*') === 4, '"*Rating: 4*" should return 4');
    assert(parseNsfwRating('`9`') === 9, '"`9`" should return 9');
    assert(parseNsfwRating('**Rating:** **10**') === 10, '"**Rating:** **10**" should return 10');

    // Invalid formats
    assert(parseNsfwRating('11') === null, '"11" should return null');
    assert(parseNsfwRating('-5') === null, '"-5" should return null');
    assert(parseNsfwRating('Score: -5') === null, '"Score: -5" should return null');
    assert(parseNsfwRating('Unsafe') === null, '"Unsafe" should return null');
    assert(parseNsfwRating('') === null, '"" should return null');
    assert(parseNsfwRating('   ') === null, 'Whitespace-only should return null');
    assert(parseNsfwRating(null as any) === null, 'null input should return null');
    assert(parseNsfwRating(undefined as any) === null, 'undefined input should return null');
    assert(parseNsfwRating('1.5') === null, '"1.5" should return null');
    assert(parseNsfwRating('100') === null, '"100" should return null');
    assert(parseNsfwRating('I rate this 12 out of 10') === null, '"12 out of 10" should return null');

    // Prompt verification
    assert(NSFW_RATING_USER_PROMPT.includes('0 to 10'), 'NSFW_RATING_USER_PROMPT should mention 0 to 10');
    assert(NSFW_RATING_SYSTEM_PROMPT.includes('0 to 10'), 'NSFW_RATING_SYSTEM_PROMPT should mention 0 to 10');

    // ==========================================
    // 2. rateImageNsfw Tests
    // ==========================================
    console.log('\n--- 2. rateImageNsfw Tests ---');

    // Test 2a: Valid rating with mock LLMProvider
    let capturedQuestion: any = null;
    let capturedOptions: any = null;

    const mockProvider: LLMProvider = {
        name: () => 'mock-vision',
        chat: async (question: string | Part[], options: LLMChatOptions): Promise<LLMResult> => {
            capturedQuestion = question;
            capturedOptions = options;
            return { text: '7' };
        },
        countTokens: async () => 10,
    };

    // Create a 1000x800 test image using sharp to verify downscaling
    const largePngBuffer = await sharp({
        create: {
            width: 1000,
            height: 800,
            channels: 3,
            background: { r: 255, g: 0, b: 0 },
        },
    })
        .png()
        .toBuffer();

    const rating = await rateImageNsfw(largePngBuffer, { provider: mockProvider });
    assert(rating === 7, `rateImageNsfw should return 7, got ${rating}`);
    assert(Array.isArray(capturedQuestion), 'capturedQuestion should be an array of Part');
    assert(capturedQuestion.length === 2, 'capturedQuestion should contain 2 parts');
    assert(capturedQuestion[0].text === NSFW_RATING_USER_PROMPT, 'Part 0 should be user prompt');
    assert(!!capturedQuestion[1].inlineData, 'Part 1 should have inlineData');
    assert(
        capturedQuestion[1].inlineData.mimeType === 'image/jpeg',
        'inlineData mimeType should be image/jpeg'
    );
    assert(
        capturedOptions?.systemPrompt === NSFW_RATING_SYSTEM_PROMPT,
        'systemPrompt should match NSFW_RATING_SYSTEM_PROMPT'
    );

    // Verify downscaled JPEG buffer
    const base64Str = capturedQuestion[1].inlineData.data;
    const decodedBuffer = Buffer.from(base64Str, 'base64');
    const meta = await sharp(decodedBuffer).metadata();
    assert(meta.format === 'jpeg', 'Downscaled buffer should be jpeg');
    assert(
        (meta.width || 0) <= 768 && (meta.height || 0) <= 768,
        `Image should be downscaled within 768x768, got ${meta.width}x${meta.height}`
    );

    // Test 2b: Provider timeout recovery
    const slowProvider: LLMProvider = {
        name: () => 'slow-mock',
        chat: async (): Promise<LLMResult> => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return { text: '5' };
        },
        countTokens: async () => 10,
    };

    const timeoutRating = await rateImageNsfw(PNG_1x1, {
        provider: slowProvider,
        timeoutMs: 25,
    });
    assert(timeoutRating === null, 'rateImageNsfw should return null on timeout');

    // Test 2c: Provider rejection / error recovery
    const errorProvider: LLMProvider = {
        name: () => 'error-mock',
        chat: async (): Promise<LLMResult> => {
            throw new Error('Upstream provider rate limited');
        },
        countTokens: async () => 10,
    };

    const errorRating = await rateImageNsfw(PNG_1x1, { provider: errorProvider });
    assert(errorRating === null, 'rateImageNsfw should return null when provider throws');

    // Test 2d: Corrupt image buffer handling
    const corruptBuffer = Buffer.from('this is not an image');
    const corruptRating = await rateImageNsfw(corruptBuffer, { provider: mockProvider });
    assert(corruptRating === null, 'rateImageNsfw should return null on corrupt image buffer');

    // Test 2e: Unconfigured provider in test environment
    const unconfiguredRating = await rateImageNsfw(PNG_1x1);
    assert(
        unconfiguredRating === null,
        'rateImageNsfw should return null when no provider configured without throwing'
    );

    console.log('\nAll NSFW Rater tests passed successfully!');
}

runTests().catch((err) => {
    console.error('NSFW Rater test suite failed:', err);
    process.exit(1);
});
