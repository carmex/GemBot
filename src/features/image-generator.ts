import { App } from '@slack/bolt';
import { GoogleAuth } from 'google-auth-library';
import fetch from 'node-fetch';
import sharp from 'sharp';
import { config } from '../config';
import { trackImageInvocation } from './usage-db';
import { Part } from '@google/generative-ai';

export class ImageGenerator {
    private app: App;
    private auth: GoogleAuth;

    constructor(app: App, auth: GoogleAuth) {
        this.app = app;
        this.auth = auth;
    }

    public async generateImage(prompt: string): Promise<{ imageBase64?: string; filteredReason?: string }> {
        const token = await this.auth.getAccessToken();
        const projectId = config.vertex.projectId;
        const location = config.vertex.location;
        const modelId = 'gemini-3.1-flash-image';
        const apiEndpoint = `${location}-aiplatform.googleapis.com`;
        const url = `https://${apiEndpoint}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`;
        const requestBody = {
            contents: [
                {
                    role: 'user',
                    parts: [{ text: prompt }],
                },
            ],
            generationConfig: {
                responseModalities: ['IMAGE'],
            },
        };
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });
        if (!response.ok) {
            const errorBody = (await response.json()) as { error: { message: string } };
            console.error('Gemini Image API response error:', response.status, JSON.stringify(errorBody, null, 2));
            const apiError = new Error(`Gemini Image API request failed with status ${response.status}`);
            (apiError as any).apiError = errorBody.error;
            throw apiError;
        }
        const data = (await response.json()) as {
            candidates?: Array<{
                content?: {
                    parts?: Array<{
                        text?: string;
                        inlineData?: {
                            mimeType?: string;
                            data?: string;
                        };
                    }>;
                };
                finishReason?: string;
                finishMessage?: string;
            }>;
            promptFeedback?: {
                blockReason?: string;
            };
        };

        if (data.promptFeedback?.blockReason) {
            return { filteredReason: `Prompt blocked: ${data.promptFeedback.blockReason}` };
        }

        const candidate = data.candidates?.[0];
        if (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
            return { filteredReason: candidate.finishMessage || `Generation stopped due to ${candidate.finishReason}` };
        }

        const imagePart = candidate?.content?.parts?.find(p => p.inlineData?.data);
        if (imagePart?.inlineData?.data) {
            return { imageBase64: imagePart.inlineData.data };
        }

        if (candidate?.finishMessage) {
            return { filteredReason: candidate.finishMessage };
        }

        throw new Error('Invalid response structure from Gemini Image API.');
    }

    public async generateAndUploadImage(prompt: string, channelId: string) {
        if (!this.app) {
            console.error('[Tool] Slack app instance is not available for image upload.');
            return;
        }

        const imageData = await this.generateImage(prompt);

        if (imageData.imageBase64) {
            await this.app.client.files.uploadV2({
                channel_id: channelId,
                initial_comment: `Here is the image I generated for you, based on the prompt: "_${prompt}_"`,
                file: Buffer.from(imageData.imageBase64, 'base64'),
                filename: 'gembot-generated-image.png',
            });
            await trackImageInvocation('llm-generated');
        } else if (imageData.filteredReason) {
            await this.app.client.chat.postMessage({
                channel: channelId,
                text: `I tried to generate an image, but my safety filters were triggered. The reason was: *${imageData.filteredReason}*`,
            });
        } else {
            await this.app.client.chat.postMessage({
                channel: channelId,
                text: 'I tried to generate an image, but an unknown error occurred.',
            });
        }
    }

    public async processImageFromUrl(url: string): Promise<Part> {
        const isSlackUrl = url.includes('files.slack.com') || url.includes('.slack.com/files');
        const headers: Record<string, string> = {
            'User-Agent': 'GemBot/1.0',
        };
        if (isSlackUrl && config.slack.botToken) {
            headers['Authorization'] = `Bearer ${config.slack.botToken}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(url, {
                headers,
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.statusText || response.status}`);
            }

            const contentLength = response.headers.get('content-length');
            if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
                throw new Error(`Image size exceeds max download limit of 10MB (${contentLength} bytes)`);
            }

            const arrayBuffer = await response.arrayBuffer();
            if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
                throw new Error(`Image buffer size exceeds max download limit of 10MB (${arrayBuffer.byteLength} bytes)`);
            }

            const processedBuffer = await sharp(Buffer.from(arrayBuffer))
                .resize(320, 240, {
                    fit: 'inside',
                    withoutEnlargement: true,
                })
                .jpeg({ quality: 80 })
                .toBuffer();

            const base64 = processedBuffer.toString('base64');

            return { inlineData: { mimeType: 'image/jpeg', data: base64 } };
        } finally {
            clearTimeout(timeout);
        }
    }

    public async processImagePublic(fileUrl: string, mimeType?: string): Promise<Part> {
        return this.processImageFromUrl(fileUrl);
    }
}