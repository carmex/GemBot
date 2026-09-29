/*
 * GemBot: GIS Upload Mode & Fetching Test Suite
 */

import * as http from 'http';
import * as fs from 'fs';
import sharp from 'sharp';
import {
    getGisMode,
    setGisMode,
    loadGisMode,
    determineFilename,
    fetchAndUploadImage,
    handleGisModeCommand,
    GIS_CONFIG_FILE,
    GIS_MODE_UPLOAD_MSG,
    GIS_MODE_URL_MSG,
    formatGisModeStatus,
} from '../src/commands/gis';

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`FAILED: ${message}`);
        throw new Error(`Test failed: ${message}`);
    }
    console.log(`PASSED: ${message}`);
}

const PNG_BYTES = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d450000000049454e44ae426082',
    'hex'
);

const GIF_BYTES = Buffer.from(
    '47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b',
    'hex'
);

const JPEG_BYTES = Buffer.from(
    'ffd8ffdb00430006040506050406060506070706080a100a0a09090a140e0f0c1017141818171416161a1d251f1a1b231c1616202c20232627292a29191f2d302d283025282928ffdb0043010707070a080a130a0a13281a161a2828282828282828282828282828282828282828282828282828282828282828282828282828282828282828282828282828ffc00011080002000203012200021101031101ffc4001500010100000000000000000000000000000007ffc40014100100000000000000000000000000000000ffc4001501010100000000000000000000000000000608ffc40014110100000000000000000000000000000000ffda000c03010002110311003f009d001ca45fffd9',
    'hex'
);

const WEBP_OPAQUE_BYTES = Buffer.from(
    '524946463e000000574542505650382032000000d001009d012a0200020001402625a00274ba01f80003b000fee9221ffbcf9fb9f3f73e7fd19fff94fdf238fe471ffca04000',
    'hex'
);

const WEBP_ALPHA_BYTES = Buffer.from(
    '524946465a00000057454250565038580a00000010000000010000010000414c504805000000008080808000565038202e0000009001009d012a0200020001402625a00274ba00039800fefb55e3ffa5c1ffd2e0ffe9707fe9707f1bb2ce1ba40000',
    'hex'
);

const WEBP_ANIMATED_BYTES = Buffer.from(
    '524946469400000057454250565038580a00000002000000000000000000414e494d06000000ffffffff0100414e4d46300000000000000000000000000000006400000256503820180000003001009d012a0100010001402625a400037000fefcf40000414e4d46300000000000000000000000000000006400000056503820180000003401009d012a0100010000002625a400037000fefd366800',
    'hex'
);

const SVG_BYTES = Buffer.from(
    '3c73766720786d6c6e733d22687474703a2f2f7777772e77332e6f72672f323030302f737667222077696474683d223222206865696768743d2232223e3c726563742077696474683d223222206865696768743d2232222066696c6c3d22626c7565222f3e3c2f7376673e',
    'hex'
);

const HTML_BYTES = Buffer.from(
    '<!DOCTYPE html><html><head><title>Cloudflare Challenge</title></head><body><h1>403 Forbidden</h1></body></html>',
    'utf-8'
);

async function runTests() {
    console.log('=== Running GIS Upload & Mode Tests ===\n');

    // Backup original config file if present
    let originalConfig: string | null = null;
    if (fs.existsSync(GIS_CONFIG_FILE)) {
        originalConfig = fs.readFileSync(GIS_CONFIG_FILE, 'utf-8');
    }

    try {
        // ==========================================
        // 1. Mode Persistence & Env Fallback Tests
        // ==========================================
        console.log('--- 1. GIS Mode Persistence Tests ---');

        // Clean slate
        if (fs.existsSync(GIS_CONFIG_FILE)) {
            fs.unlinkSync(GIS_CONFIG_FILE);
        }
        delete process.env.GIS_MODE;

        // Default mode should be 'url'
        assert(loadGisMode() === 'url', 'loadGisMode should default to "url" when no config file and no env var');
        assert(getGisMode() === 'url', 'getGisMode should return "url"');

        // Env var GIS_MODE=upload fallback
        process.env.GIS_MODE = 'upload';
        assert(loadGisMode() === 'upload', 'loadGisMode should return "upload" when GIS_MODE env var is upload');
        assert(getGisMode() === 'upload', 'getGisMode should return "upload"');

        delete process.env.GIS_MODE;

        // setGisMode('upload')
        setGisMode('upload');
        assert(getGisMode() === 'upload', 'getGisMode should return "upload" after setGisMode("upload")');
        assert(fs.existsSync(GIS_CONFIG_FILE), 'GIS_CONFIG_FILE should exist after setGisMode');
        const fileContentUpload = JSON.parse(fs.readFileSync(GIS_CONFIG_FILE, 'utf-8'));
        assert(fileContentUpload.mode === 'upload', 'GIS_CONFIG_FILE should contain { mode: "upload" }');
        assert(loadGisMode() === 'upload', 'loadGisMode should read "upload" from file');

        // setGisMode('url')
        setGisMode('url');
        assert(getGisMode() === 'url', 'getGisMode should return "url" after setGisMode("url")');
        const fileContentUrl = JSON.parse(fs.readFileSync(GIS_CONFIG_FILE, 'utf-8'));
        assert(fileContentUrl.mode === 'url', 'GIS_CONFIG_FILE should contain { mode: "url" }');
        assert(loadGisMode() === 'url', 'loadGisMode should read "url" from file');

        // ==========================================
        // 2. Command Handler (handleGisModeCommand)
        // ==========================================
        console.log('\n--- 2. GIS Mode Command Handler Tests ---');
        let lastSaid: any = null;
        const mockSay = async (args: any) => {
            lastSaid = args;
        };

        // Command: upload
        await handleGisModeCommand('upload', mockSay, 'thread_1');
        assert(getGisMode() === 'upload', 'handleGisModeCommand("upload") should set mode to upload');
        assert(lastSaid.text === GIS_MODE_UPLOAD_MSG, 'Should output GIS_MODE_UPLOAD_MSG');
        assert(lastSaid.thread_ts === 'thread_1', 'Should preserve thread_ts');

        // Command: url
        await handleGisModeCommand('url', mockSay, 'thread_2');
        assert(getGisMode() === 'url', 'handleGisModeCommand("url") should set mode to url');
        assert(lastSaid.text === GIS_MODE_URL_MSG, 'Should output GIS_MODE_URL_MSG');
        assert(lastSaid.thread_ts === 'thread_2', 'Should preserve thread_ts');

        // Command: on
        await handleGisModeCommand('on', mockSay);
        assert(getGisMode() === 'upload', 'handleGisModeCommand("on") should set mode to upload');

        // Command: off
        await handleGisModeCommand('off', mockSay);
        assert(getGisMode() === 'url', 'handleGisModeCommand("off") should set mode to url');

        // Command: status
        await handleGisModeCommand('status', mockSay);
        assert(lastSaid.text === formatGisModeStatus('url'), 'handleGisModeCommand("status") should output status');

        // Command: undefined (bare !gis)
        await handleGisModeCommand(undefined, mockSay);
        assert(lastSaid.text === formatGisModeStatus('url'), 'handleGisModeCommand(undefined) should output status');

        // ==========================================
        // 3. Filename & Extension Extraction Tests
        // ==========================================
        console.log('\n--- 3. Filename & Extension Extraction Tests ---');

        // URL extension .png
        const fn1 = determineFilename('https://example.com/photos/cat.png', 'image/png', 'fluffy cat');
        assert(fn1 === 'fluffy_cat.png', `fn1 should be 'fluffy_cat.png', got '${fn1}'`);

        // URL extension .jpg
        const fn2 = determineFilename('https://example.com/photos/sunset.jpg', 'image/jpeg', 'beautiful sunset');
        assert(fn2 === 'beautiful_sunset.jpg', `fn2 should be 'beautiful_sunset.jpg', got '${fn2}'`);

        // URL extension .jpeg normalized to .jpg
        const fn3 = determineFilename('https://example.com/photos/mountain.jpeg', 'image/jpeg', 'snow mountain');
        assert(fn3 === 'snow_mountain.jpg', `fn3 should be 'snow_mountain.jpg', got '${fn3}'`);

        // Animated GIF with .gif in URL
        const fn4 = determineFilename('https://example.com/animations/dance.gif', 'image/gif', 'dance animated gif');
        assert(fn4 === 'dance_animated_gif.gif', `fn4 should be 'dance_animated_gif.gif', got '${fn4}'`);

        // GIF without extension in URL but image/gif Content-Type
        const fn5 = determineFilename('https://example.com/cdn/stream?id=123', 'image/gif', 'spinning logo');
        assert(fn5 === 'spinning_logo.gif', `fn5 should be 'spinning_logo.gif', got '${fn5}'`);

        // WebP image
        const fn6 = determineFilename('https://example.com/img.webp', 'image/webp', 'modern webp');
        assert(fn6 === 'modern_webp.webp', `fn6 should be 'modern_webp.webp', got '${fn6}'`);

        // Query with special characters sanitized to alphanumeric, underscores, hyphens
        const fn7 = determineFilename('https://example.com/test.png', 'image/png', 'Super Cool & Awesome #1 (New)!');
        assert(fn7 === 'super_cool_awesome_1_new.png', `fn7 should sanitize characters, got '${fn7}'`);

        // Empty query falls back to URL basename
        const fn8 = determineFilename('https://example.com/files/sample_photo.png', 'image/png', '');
        assert(fn8 === 'sample_photo.png', `fn8 should fall back to URL basename, got '${fn8}'`);

        // Empty query and non-informative URL falls back to gis_image
        const fn9 = determineFilename('https://example.com/', 'image/jpeg', '');
        assert(fn9 === 'gis_image.jpg', `fn9 should fall back to gis_image.jpg, got '${fn9}'`);

        // Target extension overrides (targetExt argument)
        const fnTarget1 = determineFilename('https://example.com/photos/cat.png', 'image/png', 'fluffy cat', '.jpg');
        assert(fnTarget1 === 'fluffy_cat.jpg', `fnTarget1 should override to .jpg, got '${fnTarget1}'`);

        const fnTarget2 = determineFilename('https://example.com/photos/cat.png', 'image/png', 'fluffy cat', 'jpg');
        assert(fnTarget2 === 'fluffy_cat.jpg', `fnTarget2 should handle extension without dot, got '${fnTarget2}'`);

        const fnTarget3 = determineFilename('https://example.com/photos/cat.png', 'image/png', 'fluffy cat', '.gif');
        assert(fnTarget3 === 'fluffy_cat.gif', `fnTarget3 should override to .gif, got '${fnTarget3}'`);

        const fnTarget4 = determineFilename('https://example.com/files/sample_photo.png', 'image/png', '', '.jpg');
        assert(fnTarget4 === 'sample_photo.jpg', `fnTarget4 should override extension with empty query, got '${fnTarget4}'`);

        // ==========================================
        // 4. HTTP Mock Server & Download / Upload
        // ==========================================
        console.log('\n--- 4. HTTP Mock Server & Image Fetch / Upload Tests ---');

        let lastAcceptHeader = '';
        const server = http.createServer((req, res) => {
            const urlPath = req.url || '';
            lastAcceptHeader = (req.headers['accept'] as string) || '';

            if (urlPath === '/image.png') {
                res.writeHead(200, {
                    'Content-Type': 'image/png',
                    'Content-Length': PNG_BYTES.length.toString(),
                });
                res.end(PNG_BYTES);
            } else if (urlPath === '/animated.gif') {
                res.writeHead(200, {
                    'Content-Type': 'image/gif',
                    'Content-Length': GIF_BYTES.length.toString(),
                });
                res.end(GIF_BYTES);
            } else if (urlPath === '/opaque.webp') {
                res.writeHead(200, {
                    'Content-Type': 'image/webp',
                    'Content-Length': WEBP_OPAQUE_BYTES.length.toString(),
                });
                res.end(WEBP_OPAQUE_BYTES);
            } else if (urlPath === '/alpha.webp') {
                res.writeHead(200, {
                    'Content-Type': 'image/webp',
                    'Content-Length': WEBP_ALPHA_BYTES.length.toString(),
                });
                res.end(WEBP_ALPHA_BYTES);
            } else if (urlPath === '/animated.webp') {
                res.writeHead(200, {
                    'Content-Type': 'image/webp',
                    'Content-Length': WEBP_ANIMATED_BYTES.length.toString(),
                });
                res.end(WEBP_ANIMATED_BYTES);
            } else if (urlPath === '/vector.svg') {
                res.writeHead(200, {
                    'Content-Type': 'image/svg+xml',
                    'Content-Length': SVG_BYTES.length.toString(),
                });
                res.end(SVG_BYTES);
            } else if (urlPath === '/html-error.html') {
                res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Content-Length': HTML_BYTES.length.toString(),
                });
                res.end(HTML_BYTES);
            } else if (urlPath === '/disguised-html.jpg') {
                res.writeHead(200, {
                    'Content-Type': 'image/jpeg',
                    'Content-Length': HTML_BYTES.length.toString(),
                });
                res.end(HTML_BYTES);
            } else if (urlPath === '/mismatched-ext.png') {
                res.writeHead(200, {
                    'Content-Type': 'image/jpeg',
                    'Content-Length': JPEG_BYTES.length.toString(),
                });
                res.end(JPEG_BYTES);
            } else if (urlPath === '/not-found.png') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            } else if (urlPath === '/server-error.png') {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Server Error');
            } else if (urlPath === '/oversized-header.png') {
                res.writeHead(200, {
                    'Content-Type': 'image/png',
                    'Content-Length': (25 * 1024 * 1024).toString(), // 25MB reported in header
                });
                res.end(PNG_BYTES);
            } else if (urlPath === '/oversized-body.png') {
                res.writeHead(200, {
                    'Content-Type': 'image/png',
                });
                // Send > 20MB buffer in chunks
                const chunk = Buffer.alloc(1024 * 1024, 0xaa); // 1MB
                for (let i = 0; i < 21; i++) {
                    res.write(chunk);
                }
                res.end();
            } else {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Bad Request');
            }
        });

        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const address = server.address() as any;
        const serverUrl = `http://127.0.0.1:${address.port}`;
        console.log(`Mock image server running at ${serverUrl}`);

        const uploadCalls: any[] = [];
        const mockClient = {
            files: {
                uploadV2: async (args: any) => {
                    uploadCalls.push(args);
                    return { ok: true };
                },
            },
        };

        // Test 4a: Successful PNG fetch and upload
        uploadCalls.length = 0;
        const successPng = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_1',
            threadTs: 'T_THREAD_1',
            imageUrl: `${serverUrl}/image.png`,
            query: 'cute puppy',
            initialComment: 'https://example.com/image.png (0.42 sec)',
        });

        assert(successPng === true, 'fetchAndUploadImage should return true for valid PNG');
        assert(uploadCalls.length === 1, 'files.uploadV2 should be called once');
        assert(uploadCalls[0].channel_id === 'C_CHANNEL_1', 'channel_id should match');
        assert(uploadCalls[0].thread_ts === 'T_THREAD_1', 'thread_ts should match');
        assert(uploadCalls[0].filename === 'cute_puppy.png', 'filename should be cute_puppy.png');
        assert(uploadCalls[0].initial_comment === 'https://example.com/image.png (0.42 sec)', 'initial_comment should match');
        assert(Buffer.isBuffer(uploadCalls[0].file), 'file should be a Buffer');
        assert(uploadCalls[0].file.equals(PNG_BYTES), 'file buffer should match source PNG bytes');

        // Test 4b: Successful GIF fetch and upload (preserving .gif extension)
        uploadCalls.length = 0;
        const successGif = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_2',
            threadTs: undefined,
            imageUrl: `${serverUrl}/animated.gif`,
            query: 'dancing cat animated gif',
            initialComment: 'https://example.com/animated.gif (0.35 sec)',
        });

        assert(successGif === true, 'fetchAndUploadImage should return true for valid GIF');
        assert(uploadCalls.length === 1, 'files.uploadV2 should be called once for GIF');
        assert(uploadCalls[0].channel_id === 'C_CHANNEL_2', 'channel_id should match');
        assert(uploadCalls[0].thread_ts === undefined, 'thread_ts should be undefined');
        assert(uploadCalls[0].filename === 'dancing_cat_animated_gif.gif', 'filename should end with .gif');
        assert(uploadCalls[0].file.equals(GIF_BYTES), 'file buffer should match source GIF bytes');

        // Test 4c: Accept Header prioritizes Slack native formats
        assert(
            lastAcceptHeader.startsWith('image/jpeg,image/png,image/gif;q=0.9'),
            `Accept header should prioritize native Slack formats, got '${lastAcceptHeader}'`
        );

        // Test 4d: WebP opaque converted to JPEG (.jpg) before uploadV2
        uploadCalls.length = 0;
        const successOpaqueWebp = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_1',
            imageUrl: `${serverUrl}/opaque.webp`,
            query: 'forest landscape',
            initialComment: 'https://example.com/opaque.webp (0.30 sec)',
        });
        assert(successOpaqueWebp === true, 'fetchAndUploadImage should succeed for opaque WebP');
        assert(uploadCalls.length === 1, 'files.uploadV2 should be called once for opaque WebP');
        assert(uploadCalls[0].filename === 'forest_landscape.jpg', `Filename should end in .jpg, got '${uploadCalls[0].filename}'`);
        const opaqueMeta = await sharp(uploadCalls[0].file).metadata();
        assert(opaqueMeta.format === 'jpeg', `Converted buffer format should be jpeg, got '${opaqueMeta.format}'`);

        // Test 4e: WebP alpha converted to PNG (.png) before uploadV2
        uploadCalls.length = 0;
        const successAlphaWebp = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_1',
            imageUrl: `${serverUrl}/alpha.webp`,
            query: 'transparent sticker',
            initialComment: 'https://example.com/alpha.webp (0.30 sec)',
        });
        assert(successAlphaWebp === true, 'fetchAndUploadImage should succeed for alpha WebP');
        assert(uploadCalls.length === 1, 'files.uploadV2 should be called once for alpha WebP');
        assert(uploadCalls[0].filename === 'transparent_sticker.png', `Filename should end in .png, got '${uploadCalls[0].filename}'`);
        const alphaMeta = await sharp(uploadCalls[0].file).metadata();
        assert(alphaMeta.format === 'png', `Converted buffer format should be png, got '${alphaMeta.format}'`);

        // Test 4f: Animated WebP converted to animated GIF (.gif) before uploadV2
        uploadCalls.length = 0;
        const successAnimWebp = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_1',
            imageUrl: `${serverUrl}/animated.webp`,
            query: 'running puppy',
            initialComment: 'https://example.com/animated.webp (0.30 sec)',
        });
        assert(successAnimWebp === true, 'fetchAndUploadImage should succeed for animated WebP');
        assert(uploadCalls.length === 1, 'files.uploadV2 should be called once for animated WebP');
        assert(uploadCalls[0].filename === 'running_puppy.gif', `Filename should end in .gif, got '${uploadCalls[0].filename}'`);
        const animMeta = await sharp(uploadCalls[0].file, { animated: true }).metadata();
        assert(animMeta.format === 'gif', `Converted buffer format should be gif, got '${animMeta.format}'`);
        assert(Boolean(animMeta.pages && animMeta.pages > 1), `Converted GIF should be animated, got pages=${animMeta.pages}`);

        // Test 4g: SVG converted to PNG (.png) before uploadV2
        uploadCalls.length = 0;
        const successSvg = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_1',
            imageUrl: `${serverUrl}/vector.svg`,
            query: 'vector logo',
            initialComment: 'https://example.com/vector.svg (0.30 sec)',
        });
        assert(successSvg === true, 'fetchAndUploadImage should succeed for SVG');
        assert(uploadCalls.length === 1, 'files.uploadV2 should be called once for SVG');
        assert(uploadCalls[0].filename === 'vector_logo.png', `Filename should end in .png, got '${uploadCalls[0].filename}'`);
        const svgMeta = await sharp(uploadCalls[0].file).metadata();
        assert(svgMeta.format === 'png', `Converted buffer format should be png, got '${svgMeta.format}'`);

        // Test 4h: Non-image 200 OK HTML payload rejected early (Content-Type: text/html)
        uploadCalls.length = 0;
        const failHtmlEarly = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_1',
            imageUrl: `${serverUrl}/html-error.html`,
            query: 'cloudflare challenge',
            initialComment: 'challenge',
        });
        assert(failHtmlEarly === false, 'fetchAndUploadImage should return false for text/html');
        assert(uploadCalls.length === 0, 'files.uploadV2 should NOT be called for text/html');

        // Test 4i: Non-image disguised 200 OK payload rejected by sharp
        uploadCalls.length = 0;
        const failHtmlDisguised = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_1',
            imageUrl: `${serverUrl}/disguised-html.jpg`,
            query: 'disguised html',
            initialComment: 'disguised',
        });
        assert(failHtmlDisguised === false, 'fetchAndUploadImage should return false when sharp rejects invalid payload');
        assert(uploadCalls.length === 0, 'files.uploadV2 should NOT be called when sharp rejects payload');

        // Test 4j: Mismatched URL extension (.png URL serving JPEG bytes) corrected to .jpg
        uploadCalls.length = 0;
        const successMismatched = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_1',
            imageUrl: `${serverUrl}/mismatched-ext.png`,
            query: 'sunset mountain',
            initialComment: 'https://example.com/mismatched-ext.png (0.30 sec)',
        });
        assert(successMismatched === true, 'fetchAndUploadImage should succeed for mismatched extension');
        assert(uploadCalls.length === 1, 'files.uploadV2 should be called once');
        assert(uploadCalls[0].filename === 'sunset_mountain.jpg', `Filename extension should be corrected to .jpg, got '${uploadCalls[0].filename}'`);
        const mismatchedMeta = await sharp(uploadCalls[0].file).metadata();
        assert(mismatchedMeta.format === 'jpeg', `File buffer format should remain jpeg, got '${mismatchedMeta.format}'`);

        // Test 4k: Mismatched URL extension with empty query falls back to URL basename with .jpg
        uploadCalls.length = 0;
        const successMismatchedEmptyQuery = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_1',
            imageUrl: `${serverUrl}/mismatched-ext.png`,
            query: '',
            initialComment: 'https://example.com/mismatched-ext.png (0.30 sec)',
        });
        assert(successMismatchedEmptyQuery === true, 'fetchAndUploadImage should succeed with empty query');
        assert(uploadCalls.length === 1, 'files.uploadV2 should be called once');
        assert(uploadCalls[0].filename === 'mismatched-ext.jpg', `Filename should use URL basename with .jpg, got '${uploadCalls[0].filename}'`);

        // Test 4l: 404 Not Found returns false
        uploadCalls.length = 0;
        const fail404 = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_1',
            imageUrl: `${serverUrl}/not-found.png`,
            query: 'missing image',
            initialComment: 'missing',
        });
        assert(fail404 === false, 'fetchAndUploadImage should return false for 404');
        assert(uploadCalls.length === 0, 'files.uploadV2 should NOT be called on 404');

        // Test 4m: 500 Server Error returns false
        uploadCalls.length = 0;
        const fail500 = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_1',
            imageUrl: `${serverUrl}/server-error.png`,
            query: 'server error',
            initialComment: 'error',
        });
        assert(fail500 === false, 'fetchAndUploadImage should return false for 500');
        assert(uploadCalls.length === 0, 'files.uploadV2 should NOT be called on 500');

        // Test 4n: Oversized via Content-Length header returns false
        uploadCalls.length = 0;
        const failOversizedHeader = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_1',
            imageUrl: `${serverUrl}/oversized-header.png`,
            query: 'huge image header',
            initialComment: 'oversized',
        });
        assert(failOversizedHeader === false, 'fetchAndUploadImage should return false for Content-Length > 20MB');
        assert(uploadCalls.length === 0, 'files.uploadV2 should NOT be called for oversized header');

        // Test 4o: Oversized via buffer body returns false
        uploadCalls.length = 0;
        const failOversizedBody = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_1',
            imageUrl: `${serverUrl}/oversized-body.png`,
            query: 'huge image body',
            initialComment: 'oversized',
        });
        assert(failOversizedBody === false, 'fetchAndUploadImage should return false for buffer > 20MB');
        assert(uploadCalls.length === 0, 'files.uploadV2 should NOT be called for oversized body');

        // Test 4p: Network connection failure returns false
        uploadCalls.length = 0;
        const failNetwork = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C_CHANNEL_1',
            imageUrl: 'http://127.0.0.1:1/nonexistent.png',
            query: 'unreachable',
            initialComment: 'unreachable',
        });
        assert(failNetwork === false, 'fetchAndUploadImage should return false on network connection failure');
        assert(uploadCalls.length === 0, 'files.uploadV2 should NOT be called on connection failure');

        // Test 4q: uploadV2 throws error -> returns false
        const throwingClient = {
            files: {
                uploadV2: async () => {
                    throw new Error('Slack API unavailable');
                },
            },
        };
        const failUpload = await fetchAndUploadImage({
            client: throwingClient,
            channel: 'C_CHANNEL_1',
            imageUrl: `${serverUrl}/image.png`,
            query: 'test throw',
            initialComment: 'comment',
        });
        assert(failUpload === false, 'fetchAndUploadImage should return false if files.uploadV2 throws');

        // ==========================================
        // 5. Fallback Delegation Behavior
        // ==========================================
        console.log('\n--- 5. GIS Fallback Behavior Tests ---');

        // Case A: Mode is upload, upload succeeds -> uploadV2 called, say NOT called
        setGisMode('upload');
        const sayState = {
            called: false,
            args: null as any,
        };
        const trackingSay = async (args: any) => {
            sayState.called = true;
            sayState.args = args;
        };

        uploadCalls.length = 0;
        sayState.called = false;
        let uploaded = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C1',
            threadTs: 'T1',
            imageUrl: `${serverUrl}/image.png`,
            query: 'test',
            initialComment: 'https://example.com/image.png (0.50 sec)',
        });
        if (!uploaded) {
            await trackingSay({
                text: 'https://example.com/image.png (0.50 sec)',
                thread_ts: 'T1',
            });
        }
        assert(uploaded === true, 'Upload succeeded');
        assert(uploadCalls.length === 1, 'files.uploadV2 was called');
        assert(!sayState.called, 'say() was NOT called because upload succeeded');

        // Case B: Mode is upload, upload fails (e.g. 404) -> say() IS called with comment and thread_ts
        uploadCalls.length = 0;
        sayState.called = false;
        uploaded = await fetchAndUploadImage({
            client: mockClient,
            channel: 'C1',
            threadTs: 'T1',
            imageUrl: `${serverUrl}/not-found.png`,
            query: 'test',
            initialComment: 'https://example.com/not-found.png (0.50 sec)',
        });
        if (!uploaded) {
            await trackingSay({
                text: 'https://example.com/not-found.png (0.50 sec)',
                thread_ts: 'T1',
            });
        }
        assert(uploaded === false, 'Upload failed as expected');
        assert(uploadCalls.length === 0, 'files.uploadV2 was NOT called');
        assert(sayState.called, 'say() WAS called as fallback');
        assert(sayState.args.text === 'https://example.com/not-found.png (0.50 sec)', 'say text matches');
        assert(sayState.args.thread_ts === 'T1', 'say thread_ts matches');

        // Case C: Mode is url -> upload is not attempted, say() is called directly
        setGisMode('url');
        uploadCalls.length = 0;
        sayState.called = false;
        if (getGisMode() === 'upload') {
            uploaded = await fetchAndUploadImage({
                client: mockClient,
                channel: 'C1',
                threadTs: 'T1',
                imageUrl: `${serverUrl}/image.png`,
                query: 'test',
                initialComment: 'https://example.com/image.png (0.50 sec)',
            });
            if (!uploaded) {
                await trackingSay({
                    text: 'https://example.com/image.png (0.50 sec)',
                    thread_ts: 'T1',
                });
            }
        } else {
            await trackingSay({
                text: 'https://example.com/image.png (0.50 sec)',
                thread_ts: 'T1',
            });
        }
        assert(uploadCalls.length === 0, 'files.uploadV2 was NOT called when in url mode');
        assert(sayState.called, 'say() was called directly in url mode');
        assert(sayState.args.text === 'https://example.com/image.png (0.50 sec)', 'say text matches in url mode');

        // Close mock server
        await new Promise<void>((resolve) => server.close(() => resolve()));
        console.log('Mock server closed.');

        console.log('\nAll GIS Upload & Mode tests passed successfully!');
    } finally {
        // Restore original config file state
        if (originalConfig !== null) {
            fs.writeFileSync(GIS_CONFIG_FILE, originalConfig, 'utf-8');
        } else if (fs.existsSync(GIS_CONFIG_FILE)) {
            fs.unlinkSync(GIS_CONFIG_FILE);
        }
    }
}

runTests().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
