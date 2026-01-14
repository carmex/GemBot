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

import { App } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { Content, Part } from '@google/generative-ai';
import { config } from '../config';
import { ImageGenerator } from './image-generator';
import { Summarizer } from './summarizer';
import { buildUserPrompt } from './utils';

export class HistoryBuilder {
    constructor(
        private app: App,
        private imageGenerator: ImageGenerator,
        private summarizer: Summarizer,
        private config: any
    ) {}

    public async buildHistoryFromThread(channel: string, thread_ts: string | undefined, trigger_ts: string, client: WebClient, botUserId: string): Promise<Content[]> {
        const history: Content[] = [];
        if (!thread_ts) {
            return history;
        }

        // Check if we have a summary for this thread
        const existingSummary = this.summarizer.loadThreadSummary(thread_ts);
        if (existingSummary) {
            console.log(`[Summary] Using existing summary for thread ${thread_ts}`);
            // Summary will be handled in the system prompt, not as a message
        }

        try {
            const replies = await client.conversations.replies({
                channel,
                ts: thread_ts,
                inclusive: true,
            });
            if (!replies.messages) {
                return history;
            }

            // If we have a summary, only include recent messages
            // If no summary, include all messages
            const maxMessages = existingSummary ? this.config.summarization.maxRecentMessages : replies.messages.length;
            const recentMessages = replies.messages.slice(-maxMessages);

            // Find the first user message to ensure we start with user/assistant alternation
            let startIndex = 0;
            if (existingSummary) {
                // When we have a summary, we MUST start with a user message
                for (let i = 0; i < recentMessages.length; i++) {
                    const reply = recentMessages[i];
                    if (reply.user && reply.user !== botUserId && !reply.bot_id && reply.ts !== trigger_ts) {
                        startIndex = i;
                        break;
                    }
                }
            }

            for (let i = startIndex; i < recentMessages.length; i++) {
                const reply = recentMessages[i];
                if (reply.ts === trigger_ts) continue;

                if (!reply.user && !reply.bot_id) {
                    continue; // Skip messages without user or bot
                }
            
                let role: 'user' | 'model';
                if (reply.bot_id || (reply.user && reply.user === botUserId)) {
                    role = 'model';
                } else if (reply.user) {
                    role = 'user';
                } else {
                    continue;
                }
            
                let parts: Part[] = [];
            
                if (reply.text) {
                    const text = role === 'model' ? reply.text : buildUserPrompt({channel, user: reply.user!, text: reply.text});
                    parts.push({text});
                }
            
                console.log(`[Debug-Image] Message ${reply.ts} has ${(reply.files || []).length} files`);

                if (reply.files && reply.files.length > 0) {
                    for (const file of reply.files) {
                        if (file.mimetype && file.mimetype.startsWith('image/') && file.url_private) {
                            console.log(`[Debug-Image] Processing image file: ${file.name || 'unknown'} from message ${reply.ts}, URL: ${file.url_private}`);
                            try {
                                const imagePart = await this.imageGenerator.processImagePublic(file.url_private, file.mimetype);
                                parts.push(imagePart);
                                console.log(`[Debug-Image] Successfully added image part for message ${reply.ts}`);
                            } catch (e) {
                                console.error(`[Debug-Image] Failed to process image from message ${reply.ts}:`, e);
                            }
                        } else {
                            console.log(`[Debug-Image] Skipping non-image file in message ${reply.ts}: ${file.mimetype || 'no mimetype'}, URL: ${file.url_private || 'no url'}`);
                        }
                    }
                }
            
                console.log(`[Debug-Image] Message ${reply.ts} (${role}) final parts count: ${parts.length} (text: ${parts.some(p => p.text) ? 'yes' : 'no'}, images: ${parts.filter(p => p.inlineData).length})`);

                if (parts.length > 0) {
                    history.push({role, parts});
                }
            }
        } catch (error) {
            console.error("[Debug-Image] Error building history from thread:", error);
        }

        console.log(`[Debug-Image] Final thread history length: ${history.length} entries, total image parts: ${history.reduce((acc, h) => acc + (h.parts?.filter(p => p.inlineData)?.length || 0), 0)}`);
        return history;
    }

    public async buildHistoryFromChannel(channel: string, trigger_ts: string, client: WebClient, botUserId: string): Promise<Content[]> {
        const history: Content[] = [];
        try {
            const result = await client.conversations.history({
                channel,
                limit: this.config.channelHistoryLimit,
            });
            if (!result.messages) {
                return history;
            }
            const messages = result.messages.reverse();
            for (const reply of messages) {
                if (reply.ts === trigger_ts) continue;

                if (!reply.user && !reply.bot_id) {
                    continue; // Skip messages without user or bot
                }

                let role: 'user' | 'model';
                if (reply.bot_id || (reply.user && reply.user === botUserId)) {
                    role = 'model';
                } else if (reply.user) {
                    role = 'user';
                } else {
                    continue;
                }

                let parts: Part[] = [];

                if (reply.text) {
                    const text = role === 'model' ? reply.text : buildUserPrompt({channel, user: reply.user!, text: reply.text});
                    parts.push({text});
                }

                if (reply.files && reply.files.length > 0) {
                    for (const file of reply.files) {
                        if (file.mimetype && file.mimetype.startsWith('image/') && file.url_private) {
                            try {
                                const imagePart = await this.imageGenerator.processImagePublic(file.url_private, file.mimetype);
                                parts.push(imagePart);
                            } catch (e) {
                                console.error(`Failed to process image from message ${reply.ts}:`, e);
                            }
                        }
                    }
                }

                if (parts.length > 0) {
                    history.push({role, parts});
                }
            }
        } catch (error) {
            console.error("Error building history from channel:", error);
        }

        return history;
    }

    public async buildHistorySinceLastBotMessage(channel: string, client: WebClient, botUserId: string): Promise<Content[]> {
        const history: Content[] = [];
        const relevantMessages: any[] = [];
        let hasMore = true;
        let cursor: string | undefined = undefined;

        try {
            while (hasMore) {
                const result = await client.conversations.history({
                    channel,
                    limit: 200, // A reasonable page size.
                    cursor: cursor,
                });

                if (!result.messages || result.messages.length === 0) {
                    break;
                }

                const botMessageIndex = result.messages.findIndex(reply => reply.user === botUserId || reply.bot_id);

                if (botMessageIndex !== -1) {
                    relevantMessages.push(...result.messages.slice(0, botMessageIndex));
                    hasMore = false; // Stop paginating
                } else {
                    relevantMessages.push(...result.messages);
                }

                if (hasMore && result.has_more) {
                    cursor = result.response_metadata?.next_cursor;
                } else {
                    hasMore = false;
                }
            }
            for (const reply of relevantMessages.reverse()) {
                if (reply.user) {
                    history.push({role: 'user', parts: [{text: buildUserPrompt({channel, user: reply.user, text: reply.text})}]});
                }
            }
        } catch (error) {
            console.error("Error building history since last bot message:", error);
        }
        return history;
    }
}