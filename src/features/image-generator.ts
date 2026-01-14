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
        const modelId = 'imagen-4.0-generate-preview-06-06'; // imagegeneration@006';
        const apiEndpoint = `${location}-aiplatform.googleapis.com`;
        const url = `https://${apiEndpoint}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;
        const requestBody = {
            instances: [{ prompt }],
            parameters: {
                sampleCount: 1,
                includeRaiReason: true,
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
            console.error('Imagen API response error:', response.status, JSON.stringify(errorBody, null, 2));
            const apiError = new Error(`Imagen API request failed with status ${response.status}`);
            (apiError as any).apiError = errorBody.error;
            throw apiError;
        }
        const data = (await response.json()) as {
            predictions: [
                {
                    bytesBase64Encoded?: string;
                    raiFilteredReason?: string;
                }
            ];
        };
        if (data.predictions?.[0]?.raiFilteredReason) {
            return { filteredReason: data.predictions[0].raiFilteredReason };
        }
        if (data.predictions?.[0]?.bytesBase64Encoded) {
            return { imageBase64: data.predictions[0].bytesBase64Encoded };
        }
        throw new Error('Invalid response structure from Imagen API.');
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

    private async processImage(fileUrl: string, mimeType: string): Promise<Part> {
        const response = await fetch(fileUrl, {
            headers: {
                'Authorization': `Bearer ${config.slack.botToken}`
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();

        const processedBuffer = await sharp(Buffer.from(buffer))
            .resize(320, 240, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: 80 })
            .toBuffer();

        const base64 = processedBuffer.toString('base64');

        return { inlineData: { mimeType: 'image/jpeg', data: base64 } };
    }

    public async processImagePublic(fileUrl: string, mimeType: string): Promise<Part> {
        return this.processImage(fileUrl, mimeType);
    }
}