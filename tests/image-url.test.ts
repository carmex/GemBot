/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 * Tests for Automatic Fetching & Context Injection for Image URLs.
 */

import { extractUrls, isImageUrl } from '../src/features/utils';
import { ImageGenerator } from '../src/features/image-generator';
import { HistoryBuilder } from '../src/features/history-builder';
import sharp from 'sharp';
import assert from 'assert';
import http from 'http';

async function runTests() {
    console.log("Running Image URL & Multimodal Context Tests...\n");

    // 1. extractUrls Tests
    console.log("=== 1. extractUrls Tests ===");
    {
        const text = "Check out <https://example.com/image.png|example.png> and <https://foo.com/photo.jpg> and plain http://bar.com/pic.webp";
        const urls = extractUrls(text);
        assert.deepStrictEqual(urls, [
            "https://example.com/image.png",
            "https://foo.com/photo.jpg",
            "http://bar.com/pic.webp"
        ]);
        console.log("PASSED: extractUrls Slack formatting and plain URLs");
    }

    {
        const text = "Duplicate <https://example.com/image.png> and https://example.com/image.png";
        const urls = extractUrls(text);
        assert.deepStrictEqual(urls, ["https://example.com/image.png"]);
        console.log("PASSED: extractUrls deduplication");
    }

    // 2. isImageUrl Tests
    console.log("\n=== 2. isImageUrl Tests ===");
    {
        assert.strictEqual(await isImageUrl("https://example.com/test.png"), true);
        assert.strictEqual(await isImageUrl("https://example.com/photo.JPEG?v=1"), true);
        assert.strictEqual(await isImageUrl("https://example.com/graphic.svg#icon"), true);
        assert.strictEqual(await isImageUrl("https://example.com/animation.gif"), true);
        assert.strictEqual(await isImageUrl("https://example.com/image.webp"), true);
        assert.strictEqual(await isImageUrl("https://example.com/picture.bmp"), true);
        console.log("PASSED: isImageUrl extension detection");
    }

    {
        assert.strictEqual(await isImageUrl("https://invalid-domain-name-that-does-not-exist-99999.com/doc.pdf"), false);
        console.log("PASSED: isImageUrl non-image extension failure handling");
    }

    // 3. processImageFromUrl Tests with Local HTTP Server
    console.log("\n=== 3. processImageFromUrl Tests ===");
    {
        const testPngBuffer = await sharp({
            create: {
                width: 50,
                height: 50,
                channels: 4,
                background: { r: 0, g: 128, b: 255, alpha: 1 }
            }
        }).png().toBuffer();

        const server = http.createServer((req, res) => {
            if (req.url === '/test.png') {
                res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(testPngBuffer.length) });
                res.end(testPngBuffer);
            } else if (req.url === '/large.png') {
                res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(15 * 1024 * 1024) });
                res.end(Buffer.alloc(100));
            } else if (req.url === '/no-ext') {
                res.writeHead(200, { 'Content-Type': 'image/jpeg' });
                res.end(testPngBuffer);
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address() as any;
        const port = address.port;
        const baseUrl = `http://127.0.0.1:${port}`;

        const mockImageGen = new ImageGenerator(null as any, null as any);

        try {
            // Test processImageFromUrl valid image
            const part = await mockImageGen.processImageFromUrl(`${baseUrl}/test.png`);
            assert.strictEqual(part.inlineData?.mimeType, 'image/jpeg');
            assert.ok(typeof part.inlineData?.data === 'string' && part.inlineData.data.length > 0);
            console.log("PASSED: processImageFromUrl valid image conversion");

            // Test isImageUrl with HEAD request for URL without image extension
            const isImgNoExt = await isImageUrl(`${baseUrl}/no-ext`);
            assert.strictEqual(isImgNoExt, true);
            console.log("PASSED: isImageUrl HEAD request fallback detection");

            // Test processImageFromUrl size limit guard
            await assert.rejects(
                async () => await mockImageGen.processImageFromUrl(`${baseUrl}/large.png`),
                /limit of 10MB/
            );
            console.log("PASSED: processImageFromUrl size limit guard");
        } finally {
            server.close();
        }
    }

    // 4. HistoryBuilder Integration Tests
    console.log("\n=== 4. HistoryBuilder Integration Tests ===");
    {
        const mockImageGen: any = {
            processImageFromUrl: async (url: string) => ({
                inlineData: { mimeType: 'image/jpeg', data: 'base64EncodedData' }
            }),
            processImagePublic: async (url: string) => ({
                inlineData: { mimeType: 'image/jpeg', data: 'base64EncodedData' }
            })
        };

        const mockSummarizer: any = {
            loadThreadSummary: () => null
        };

        const historyBuilder = new HistoryBuilder({} as any, mockImageGen, mockSummarizer, { summarization: { maxRecentMessages: 10 } });

        const mockClient: any = {
            users: {
                info: async () => ({ ok: true, user: { real_name: 'Test User' } })
            },
            conversations: {
                replies: async () => ({
                    messages: [
                        {
                            user: 'U12345',
                            text: 'Check this image: https://example.com/test.png',
                            ts: '1000.0001'
                        },
                        {
                            user: 'UBOT',
                            bot_id: 'B123',
                            text: 'Looks good!',
                            ts: '1000.0002'
                        }
                    ]
                })
            }
        };

        const history = await historyBuilder.buildHistoryFromThread('C123', '1000.0001', '1000.0003', mockClient, 'UBOT');
        assert.strictEqual(history.length, 2);
        assert.strictEqual(history[0].role, 'user');
        assert.strictEqual(history[0].parts.length, 2);
        assert.strictEqual(history[0].parts[1].inlineData?.data, 'base64EncodedData');
        console.log("PASSED: HistoryBuilder thread history includes image URLs in user messages");
    }

    console.log("\nALL IMAGE URL TESTS PASSED SUCCESSFULLY!");
}

runTests().catch(err => {
    console.error("Test Suite Failed:", err);
    process.exit(1);
});
