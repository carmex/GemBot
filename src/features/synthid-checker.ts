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

import { GoogleAuth } from 'google-auth-library';
import fetch from 'node-fetch';
import sharp from 'sharp';
import { Config, config as defaultConfig } from '../config';

export interface SynthIdCheckResult {
    isWatermarked: boolean;
    confidenceScore?: number;
    decision?: string;
    rawResponse?: any;
    error?: string;
}

export class SynthIdChecker {
    private auth: GoogleAuth;
    private config: Config;
    private fetchFn: typeof fetch;

    constructor(auth: GoogleAuth, cfg: Config = defaultConfig, fetchFn: typeof fetch = fetch) {
        this.auth = auth;
        this.config = cfg;
        this.fetchFn = fetchFn;
    }

    public async checkWatermark(fileUrlOrBuffer: string | Buffer): Promise<SynthIdCheckResult> {
        try {
            let imageBuffer: Buffer;
            if (typeof fileUrlOrBuffer === 'string') {
                const headers: Record<string, string> = {};
                if (this.config.slack?.botToken) {
                    headers['Authorization'] = `Bearer ${this.config.slack.botToken}`;
                }
                const response = await this.fetchFn(fileUrlOrBuffer, { headers });
                if (!response.ok) {
                    return {
                        isWatermarked: false,
                        decision: 'UNKNOWN',
                        error: `Failed to download image: ${response.statusText} (${response.status})`
                    };
                }
                const arrayBuf = await response.arrayBuffer();
                imageBuffer = Buffer.from(arrayBuf);
            } else {
                imageBuffer = fileUrlOrBuffer;
            }

            const processedBuffer = await sharp(imageBuffer)
                .toFormat('jpeg')
                .toBuffer();
            const base64Image = processedBuffer.toString('base64');

            const projectId = this.config.vertex?.projectId;
            const location = this.config.vertex?.location || 'us-central1';

            if (!projectId) {
                return {
                    isWatermarked: false,
                    decision: 'UNKNOWN',
                    error: 'Vertex AI project ID is not configured.'
                };
            }

            let accessToken: string | null = null;
            try {
                const tokenObj = await this.auth.getAccessToken();
                accessToken = typeof tokenObj === 'string' ? tokenObj : (tokenObj as any)?.token || null;
            } catch (authError: any) {
                return {
                    isWatermarked: false,
                    decision: 'UNKNOWN',
                    error: `Authentication failed: ${authError.message}`
                };
            }

            if (!accessToken) {
                return {
                    isWatermarked: false,
                    decision: 'UNKNOWN',
                    error: 'Failed to acquire OAuth access token for Google Cloud Vertex AI.'
                };
            }

            const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/imageverification@001:predict`;
            const payload = {
                instances: [
                    {
                        image: {
                            bytesBase64Encoded: base64Image
                        }
                    }
                ]
            };

            const apiResponse = await this.fetchFn(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!apiResponse.ok) {
                const errText = await apiResponse.text();
                console.error(`[SynthIDChecker] API error (${apiResponse.status}): ${errText}`);
                return {
                    isWatermarked: false,
                    decision: 'UNKNOWN',
                    error: `Vertex AI API error: ${apiResponse.status}`,
                    rawResponse: errText
                };
            }

            const data: any = await apiResponse.json();
            const prediction = data.predictions?.[0] || {};

            const isWatermarked =
                prediction.decision === 'WATERMARKED' ||
                prediction.watermarkStatus === 'ACCEPT' ||
                prediction.digitalWatermarkDetected === true ||
                prediction.isWatermarked === true;

            const confidenceScore = prediction.confidenceScore ?? prediction.confidence;
            const decision = prediction.decision ?? prediction.watermarkStatus ?? (isWatermarked ? 'WATERMARKED' : 'NOT_WATERMARKED');

            return {
                isWatermarked,
                confidenceScore,
                decision,
                rawResponse: data
            };
        } catch (error: any) {
            console.error('[SynthIDChecker] Error during watermark check:', error);
            return {
                isWatermarked: false,
                decision: 'UNKNOWN',
                error: error.message || 'Unknown error checking SynthID watermark'
            };
        }
    }
}
