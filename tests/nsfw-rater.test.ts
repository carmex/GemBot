/*
 * GemBot: NSFW Rater Test Suite
 */

import sharp from 'sharp';
import { Part } from '@google/generative-ai';
import {
    parseNsfwRating,
    parseNsfwExplanation,
    getFrameIndices,
    prepareImageForRating,
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
    assert(parseNsfwRating('**Rating:** **10**') === 10, '"**Rating:** **10**" should return 10');

    // Reason / Explanation + Rating multi-line formats
    assert(
        parseNsfwRating('Explanation: The image depicts a standard desktop computer setup.\nRating: 0') === 0,
        '"Explanation + Rating: 0" should return 0'
    );
    assert(
        parseNsfwRating('Explanation: A small, fluffy lop-eared rabbit.\nRating: 0') === 0,
        '"Explanation + Rating: 0" for bunny should return 0'
    );
    assert(
        parseNsfwRating('Explanation: Two women in revealing summer dresses with cleavage.\nRating: 1') === 1,
        '"Explanation + Rating: 1" should return 1'
    );
    assert(
        parseNsfwRating('Reason: Fully safe image with 0 risk.\nScore: 0/10') === 0,
        '"Reason with number + Score: 0/10" should return 0'
    );

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
    // 1b. parseNsfwExplanation Unit Tests
    // ==========================================
    console.log('\n--- 1b. parseNsfwExplanation Tests ---');

    // Plain explanation
    assert(
        parseNsfwExplanation('Explanation: Fluffy white rabbit in a meadow.\nRating: 0') === 'Fluffy white rabbit in a meadow.',
        'Plain explanation should parse correctly'
    );

    // Markdown formatted
    assert(
        parseNsfwExplanation('**Explanation:** Two women in revealing swimwear.\n**Rating:** 2') === 'Two women in revealing swimwear.',
        'Markdown formatted explanation should strip markdown and parse'
    );

    // Alternative label
    assert(
        parseNsfwExplanation('Reason: Graphic violence depicted.\nScore: 9/10') === 'Graphic violence depicted.',
        'Alternative label "Reason" should parse correctly'
    );

    // Leading text without label
    assert(
        parseNsfwExplanation('A sunset over the mountains.\nRating: 0') === 'A sunset over the mountains.',
        'Leading text without label should parse as fallback explanation'
    );

    // Multiline explanation collapsed to single space
    assert(
        parseNsfwExplanation('Explanation: A small dog is playing in the park.\nIt has a ball in its mouth.\nRating: 0') === 'A small dog is playing in the park. It has a ball in its mouth.',
        'Multiline explanation should collapse newlines to spaces'
    );

    // Pure score response
    assert(parseNsfwExplanation('7') === null, 'Pure score "7" should return null explanation');

    // Score only response
    assert(parseNsfwExplanation('Rating: 4') === null, '"Rating: 4" should return null explanation');
    assert(parseNsfwExplanation('Score: 3') === null, '"Score: 3" should return null explanation');

    // Empty/whitespace/null strings
    assert(parseNsfwExplanation('') === null, 'Empty string should return null explanation');
    assert(parseNsfwExplanation('   ') === null, 'Whitespace string should return null explanation');
    assert(parseNsfwExplanation(null as any) === null, 'null input should return null explanation');
    assert(parseNsfwExplanation(undefined as any) === null, 'undefined input should return null explanation');
    assert(parseNsfwExplanation('Explanation: \nRating: 0') === null, 'Empty explanation field should return null');
    assert(parseNsfwExplanation('Rating: 0\nScore: 0') === null, 'Rating followed by Score should return null');

    // ==========================================
    // 2. getFrameIndices Unit Tests
    // ==========================================
    console.log('\n--- 2. getFrameIndices Tests ---');
    const eq = (a: number[], b: number[]) =>
        a.length === b.length && a.every((v, i) => v === b[i]);

    assert(eq(getFrameIndices(0), [0]), 'getFrameIndices(0) should be [0]');
    assert(eq(getFrameIndices(1), [0]), 'getFrameIndices(1) should be [0]');
    assert(eq(getFrameIndices(2), [0, 1]), 'getFrameIndices(2) should be [0, 1]');
    assert(eq(getFrameIndices(3), [0, 1, 2]), 'getFrameIndices(3) should be [0, 1, 2]');
    assert(eq(getFrameIndices(5), [0, 2, 4]), 'getFrameIndices(5) should be [0, 2, 4]');
    assert(eq(getFrameIndices(10), [0, 4, 9]), 'getFrameIndices(10) should be [0, 4, 9]');

    // ==========================================
    // 3. prepareImageForRating Unit Tests
    // ==========================================
    console.log('\n--- 3. prepareImageForRating Tests ---');

    async function createTestGif(
        frames: { r: number; g: number; b: number }[],
        width = 60,
        height = 60
    ): Promise<Buffer> {
        const framePixelCount = width * height;
        const rawBuffers = frames.map(({ r, g, b }) => {
            const buf = Buffer.alloc(framePixelCount * 3);
            for (let i = 0; i < framePixelCount; i++) {
                buf[i * 3] = r;
                buf[i * 3 + 1] = g;
                buf[i * 3 + 2] = b;
            }
            return buf;
        });
        return await sharp(Buffer.concat(rawBuffers), {
            raw: {
                width,
                height: height * frames.length,
                channels: 3,
                pageHeight: height,
            },
        })
            .gif()
            .toBuffer();
    }

    // 3a: Static PNG input
    const staticPngBuffer = await sharp({
        create: {
            width: 800,
            height: 600,
            channels: 3,
            background: { r: 50, g: 100, b: 150 },
        },
    })
        .png()
        .toBuffer();

    const preparedPng = await prepareImageForRating(staticPngBuffer);
    const preparedPngMeta = await sharp(preparedPng).metadata();
    assert(preparedPngMeta.format === 'jpeg', 'Static PNG should return a JPEG');
    assert(
        (preparedPngMeta.width || 0) <= 768 && (preparedPngMeta.height || 0) <= 768,
        `Static PNG should be resized within 768x768, got ${preparedPngMeta.width}x${preparedPngMeta.height}`
    );

    // 3b: 1-frame static GIF input
    const singleFrameGif = await createTestGif([{ r: 128, g: 128, b: 128 }]);
    const preparedSingleGif = await prepareImageForRating(singleFrameGif);
    const preparedSingleGifMeta = await sharp(preparedSingleGif).metadata();
    assert(preparedSingleGifMeta.format === 'jpeg', '1-frame static GIF should return a JPEG');
    assert(
        (preparedSingleGifMeta.width || 0) <= 768 && (preparedSingleGifMeta.height || 0) <= 768,
        `1-frame static GIF should be within 768x768, got ${preparedSingleGifMeta.width}x${preparedSingleGifMeta.height}`
    );

    // 3c: 2-frame animated GIF input
    const twoFrameGif = await createTestGif([
        { r: 255, g: 0, b: 0 },
        { r: 0, g: 0, b: 255 },
    ]);
    const preparedTwoGif = await prepareImageForRating(twoFrameGif);
    const preparedTwoGifMeta = await sharp(preparedTwoGif).metadata();
    assert(preparedTwoGifMeta.format === 'jpeg', '2-frame GIF should return a stitched JPEG');
    assert(
        (preparedTwoGifMeta.width || 0) <= 768 && (preparedTwoGifMeta.height || 0) <= 768,
        `2-frame GIF should be within 768x768, got ${preparedTwoGifMeta.width}x${preparedTwoGifMeta.height}`
    );
    assert(
        preparedTwoGifMeta.width === 120 && preparedTwoGifMeta.height === 60,
        `2-frame GIF should stitch 2 frames side-by-side to 120x60, got ${preparedTwoGifMeta.width}x${preparedTwoGifMeta.height}`
    );

    // 3d: 5-frame animated GIF input with distinct frame colors (Red, Yellow, Green, Cyan, Blue)
    const fiveColors = [
        { r: 255, g: 0, b: 0 }, // 0: Red
        { r: 255, g: 255, b: 0 }, // 1: Yellow
        { r: 0, g: 255, b: 0 }, // 2: Green
        { r: 0, g: 255, b: 255 }, // 3: Cyan
        { r: 0, g: 0, b: 255 }, // 4: Blue
    ];
    const fiveFrameGif = await createTestGif(fiveColors, 60, 60);
    const preparedFiveGif = await prepareImageForRating(fiveFrameGif);
    const preparedFiveGifMeta = await sharp(preparedFiveGif).metadata();

    assert(preparedFiveGifMeta.format === 'jpeg', '5-frame GIF should return a JPEG');
    assert(
        (preparedFiveGifMeta.width || 0) <= 768 && (preparedFiveGifMeta.height || 0) <= 768,
        `5-frame stitched JPEG should be within 768x768, got ${preparedFiveGifMeta.width}x${preparedFiveGifMeta.height}`
    );
    assert(
        preparedFiveGifMeta.width === 180 && preparedFiveGifMeta.height === 60,
        `5-frame stitched JPEG should have width 180 (3 stitched frames of 60px) and height 60, got ${preparedFiveGifMeta.width}x${preparedFiveGifMeta.height}`
    );

    // Sample raw pixels at left (x = width / 6), center (x = width / 2), and right (x = 5 * width / 6)
    const rawPixels = await sharp(preparedFiveGif).raw().toBuffer();
    const channels = preparedFiveGifMeta.channels || 3;
    const w = preparedFiveGifMeta.width || 180;
    const yCenter = Math.floor((preparedFiveGifMeta.height || 60) / 2);

    const getPixel = (x: number, y: number) => {
        const idx = (y * w + x) * channels;
        return {
            r: rawPixels[idx],
            g: rawPixels[idx + 1],
            b: rawPixels[idx + 2],
        };
    };

    const leftColor = getPixel(Math.floor(w / 6), yCenter);
    const centerColor = getPixel(Math.floor(w / 2), yCenter);
    const rightColor = getPixel(Math.floor((5 * w) / 6), yCenter);

    assert(
        leftColor.r > 200 && leftColor.g < 50 && leftColor.b < 50,
        `Left pixel should be Red, got rgb(${leftColor.r}, ${leftColor.g}, ${leftColor.b})`
    );
    assert(
        centerColor.r < 50 && centerColor.g > 200 && centerColor.b < 50,
        `Center pixel should be Green, got rgb(${centerColor.r}, ${centerColor.g}, ${centerColor.b})`
    );
    assert(
        rightColor.r < 50 && rightColor.g < 50 && rightColor.b > 200,
        `Right pixel should be Blue, got rgb(${rightColor.r}, ${rightColor.g}, ${rightColor.b})`
    );

    // 3e: Malformed/corrupt buffer gracefully throws/rejects
    let corruptRejected = false;
    try {
        await prepareImageForRating(Buffer.from('corrupt non-image buffer'));
    } catch {
        corruptRejected = true;
    }
    assert(corruptRejected, 'prepareImageForRating should reject on malformed buffer');

    // ==========================================
    // 4. rateImageNsfw Tests
    // ==========================================
    console.log('\n--- 4. rateImageNsfw Tests ---');

    // Test 2a: Valid rating with mock LLMProvider
    let capturedQuestion: any = null;
    let capturedOptions: any = null;

    const mockProvider: LLMProvider = {
        name: () => 'mock-vision',
        chat: async (question: string | Part[], options: LLMChatOptions): Promise<LLMResult> => {
            capturedQuestion = question;
            capturedOptions = options;
            return { text: 'Explanation: Test image showing red square.\nRating: 7' };
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

    const result = await rateImageNsfw(largePngBuffer, { provider: mockProvider });
    assert(result.rating === 7, `rateImageNsfw should return 7, got ${result.rating}`);
    assert(
        result.explanation === 'Test image showing red square.',
        `rateImageNsfw should return explanation, got "${result.explanation}"`
    );
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

    // Test 4b: Multi-frame animated GIF rateImageNsfw integration
    capturedQuestion = null;
    capturedOptions = null;
    const multiFrameResult = await rateImageNsfw(fiveFrameGif, { provider: mockProvider });
    assert(multiFrameResult.rating === 7, `rateImageNsfw should return 7 for multi-frame GIF, got ${multiFrameResult.rating}`);
    assert(
        multiFrameResult.explanation === 'Test image showing red square.',
        `rateImageNsfw should return explanation for multi-frame GIF, got "${multiFrameResult.explanation}"`
    );
    assert(Array.isArray(capturedQuestion), 'capturedQuestion should be an array of Part');
    assert(capturedQuestion.length === 2, 'capturedQuestion should contain 2 parts');
    assert(capturedQuestion[0].text === NSFW_RATING_USER_PROMPT, 'Part 0 should be user prompt');
    assert(
        capturedQuestion[1].inlineData?.mimeType === 'image/jpeg',
        'capturedQuestion[1].inlineData.mimeType should be image/jpeg'
    );
    const multiDecodedBuffer = Buffer.from(capturedQuestion[1].inlineData.data, 'base64');
    const multiMeta = await sharp(multiDecodedBuffer).metadata();
    assert(multiMeta.format === 'jpeg', 'Decoded multi-frame buffer should be jpeg');
    assert(
        multiMeta.width === 180 && multiMeta.height === 60,
        `Decoded buffer should decode to a valid stitched JPEG containing 3 frames (180x60), got ${multiMeta.width}x${multiMeta.height}`
    );

    // Test 4c: Provider timeout recovery
    const slowProvider: LLMProvider = {
        name: () => 'slow-mock',
        chat: async (): Promise<LLMResult> => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return { text: '5' };
        },
        countTokens: async () => 10,
    };

    const timeoutResult = await rateImageNsfw(PNG_1x1, {
        provider: slowProvider,
        timeoutMs: 25,
    });
    assert(
        timeoutResult.rating === null && timeoutResult.explanation === null,
        'rateImageNsfw should return null rating and explanation on timeout'
    );

    // Test 2c: Provider rejection / error recovery
    const errorProvider: LLMProvider = {
        name: () => 'error-mock',
        chat: async (): Promise<LLMResult> => {
            throw new Error('Upstream provider rate limited');
        },
        countTokens: async () => 10,
    };

    const errorResult = await rateImageNsfw(PNG_1x1, { provider: errorProvider });
    assert(
        errorResult.rating === null && errorResult.explanation === null,
        'rateImageNsfw should return null rating and explanation when provider throws'
    );

    // Test 2d: Corrupt image buffer handling
    const corruptBuffer = Buffer.from('this is not an image');
    const corruptResult = await rateImageNsfw(corruptBuffer, { provider: mockProvider });
    assert(
        corruptResult.rating === null && corruptResult.explanation === null,
        'rateImageNsfw should return null rating and explanation on corrupt image buffer'
    );

    // Test 2e: Unconfigured provider in test environment
    const unconfiguredResult = await rateImageNsfw(PNG_1x1);
    assert(
        unconfiguredResult.rating === null && unconfiguredResult.explanation === null,
        'rateImageNsfw should return null rating and explanation when no provider configured without throwing'
    );

    console.log('\nAll NSFW Rater tests passed successfully!');
}

runTests().catch((err) => {
    console.error('NSFW Rater test suite failed:', err);
    process.exit(1);
});
