/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 * Unit tests for SynthIdChecker.
 */

import { SynthIdChecker } from '../src/features/synthid-checker';
import sharp from 'sharp';

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`FAILED: ${message}`);
        process.exit(1);
    }
    console.log(`PASSED: ${message}`);
}

async function runTests() {
    console.log('Running SynthIdChecker Tests...');

    // Create a 10x10 dummy test image buffer using sharp
    const dummyImageBuffer = await sharp({
        create: {
            width: 10,
            height: 10,
            channels: 3,
            background: { r: 255, g: 0, b: 0 }
        }
    }).jpeg().toBuffer();

    // 1. Test graceful handling when Vertex project ID is missing
    {
        const mockAuth: any = {
            getAccessToken: async () => 'mock-token'
        };
        const testConfig: any = {
            vertex: { projectId: '', location: 'us-central1' },
            slack: { botToken: 'mock-bot-token' }
        };

        const checker = new SynthIdChecker(mockAuth, testConfig);
        const result = await checker.checkWatermark(dummyImageBuffer);

        assert(!result.isWatermarked, 'Missing projectId: isWatermarked should be false');
        assert(result.decision === 'UNKNOWN', 'Missing projectId: decision should be UNKNOWN');
        assert(!!result.error && result.error.includes('project ID'), 'Missing projectId: error message should mention project ID');
    }

    // 2. Test graceful handling when access token acquisition fails
    {
        const mockAuth: any = {
            getAccessToken: async () => {
                throw new Error('Token error');
            }
        };
        const testConfig: any = {
            vertex: { projectId: 'test-project', location: 'us-central1' },
            slack: { botToken: 'mock-bot-token' }
        };

        const checker = new SynthIdChecker(mockAuth, testConfig);
        const result = await checker.checkWatermark(dummyImageBuffer);

        assert(!result.isWatermarked, 'Auth error: isWatermarked should be false');
        assert(result.decision === 'UNKNOWN', 'Auth error: decision should be UNKNOWN');
        assert(!!result.error && result.error.includes('Authentication failed'), 'Auth error: error message should report auth failure');
    }

    // 3. Test positive watermark detection outcome (simulating Vertex API response)
    {
        let capturedUrl = '';
        let capturedHeaders: any = {};
        let capturedBody: any = {};

        const mockAuth: any = {
            getAccessToken: async () => 'valid-mock-token'
        };
        const testConfig: any = {
            vertex: { projectId: 'my-gcp-project', location: 'us-central1' },
            slack: { botToken: 'mock-bot-token' }
        };

        const mockFetch: any = async (url: string, opts: any) => {
            capturedUrl = url;
            capturedHeaders = opts.headers;
            capturedBody = JSON.parse(opts.body);

            return {
                ok: true,
                status: 200,
                json: async () => ({
                    predictions: [
                        {
                            decision: 'WATERMARKED',
                            confidenceScore: 0.98,
                            digitalWatermarkDetected: true
                        }
                    ]
                })
            };
        };

        const checker = new SynthIdChecker(mockAuth, testConfig, mockFetch);
        const result = await checker.checkWatermark(dummyImageBuffer);

        assert(capturedUrl.includes('imageverification@001:predict'), 'Endpoint URL should target imageverification@001:predict');
        assert(capturedHeaders['Authorization'] === 'Bearer valid-mock-token', 'Headers should pass Bearer token');
        assert(!!capturedBody.instances?.[0]?.image?.bytesBase64Encoded, 'Payload should include base64 encoded image string');

        assert(result.isWatermarked === true, 'Positive test: isWatermarked should be true');
        assert(result.decision === 'WATERMARKED', 'Positive test: decision should be WATERMARKED');
        assert(result.confidenceScore === 0.98, 'Positive test: confidenceScore should match 0.98');
    }

    // 4. Test negative watermark detection outcome
    {
        const mockAuth: any = {
            getAccessToken: async () => 'valid-mock-token'
        };
        const testConfig: any = {
            vertex: { projectId: 'my-gcp-project', location: 'us-central1' },
            slack: { botToken: 'mock-bot-token' }
        };

        const mockFetch: any = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                predictions: [
                    {
                        decision: 'NOT_WATERMARKED',
                        confidenceScore: 0.02,
                        digitalWatermarkDetected: false
                    }
                ]
            })
        });

        const checker = new SynthIdChecker(mockAuth, testConfig, mockFetch);
        const result = await checker.checkWatermark(dummyImageBuffer);

        assert(result.isWatermarked === false, 'Negative test: isWatermarked should be false');
        assert(result.decision === 'NOT_WATERMARKED', 'Negative test: decision should be NOT_WATERMARKED');
        assert(result.confidenceScore === 0.02, 'Negative test: confidenceScore should match 0.02');
    }

    console.log('\nAll SynthIdChecker tests passed successfully!');
}

runTests().catch(err => {
    console.error('Test script crashed:', err);
    process.exit(1);
});
