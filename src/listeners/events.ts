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
import { AIHandler } from '../features/ai-handler';
import { config } from '../config';
import { providerHealth } from '../features/llm/provider-factory';
import { getThreadHistory, saveThreadHistory } from '../features/thread-db';
import { Content, Part } from '@google/generative-ai';
import { buildUserPrompt } from '../features/utils';
import { FeatureRequestHandler } from '../features/feature-request';

const processedEvents = new Set<string>();

export const registerEventListeners = (app: App, aiHandler: AIHandler) => {
    const featureRequest = new FeatureRequestHandler(app);

    app.event('app_mention', async ({ event, context, client, say }) => {

        const health = providerHealth();
        if (!health.ok) {
            await say({ text: `AI features are not available: ${health.reason}` });
            return;
        }
        if (processedEvents.has(event.ts)) {
            return;
        }
        processedEvents.add(event.ts);
        const prompt = event.text.replace(/<@[^>]+>\s*/, '').trim();
        if (!context.botUserId || !event.user) {
            return;
        }

        // Check for feature request trigger
        if (prompt.toLowerCase().startsWith('feature request')) {
            await featureRequest.handleRequest(event, client, say);
            return;
        }

        // Mentioned in a thread
        if (event.thread_ts) {
            try {
                const history = await aiHandler.historyBuilder!.buildHistoryFromThread(event.channel, event.thread_ts, event.ts, client, context.botUserId);
                const userPrompt = buildUserPrompt({ channel: event.channel, user: event.user, text: prompt });

                let question: string | Part[] = userPrompt;
                if ((event as any).files && (event as any).files.length > 0) {
                    const imageFile = (event as any).files.find((f: any) => f.mimetype.startsWith('image/'));
                    if (imageFile && imageFile.url_private) {
                        try {
                            const imagePart = await aiHandler.processImage(imageFile.url_private, imageFile.mimetype);
                            question = [
                                { text: userPrompt },
                                imagePart
                            ];
                        } catch (error) {
                            console.error('Error processing image:', error);
                            await say({ text: `I found an image but couldn't process it: ${(error as Error).message}`, thread_ts: event.thread_ts });
                            return;
                        }
                    }
                }

                const response = await aiHandler.processAIQuestion(question, history, event.channel, event.thread_ts);
                if (response.text.trim().includes('<DO_NOT_RESPOND>')) {
                    console.log(`[DEBUG] <DO_NOT_RESPOND> received: ${response.text}`);
                } else if (response.text.trim()) {
                    const responseText = response.text;
                    await say({ text: responseText, thread_ts: event.thread_ts });
                }

                // Save the updated history
                const finalHistory: Content[] = [
                    ...history,
                    typeof question === 'string' ? { role: 'user', parts: [{ text: question }] } : { role: 'user', parts: question },
                    { role: 'assistant', parts: [{ text: response.text }] },
                ];
                saveThreadHistory(event.thread_ts, event.channel, finalHistory);
            } catch (error) {
                console.error("Error in mention handler (thread):", error);
                await say({ text: `Sorry <@${event.user}>, I encountered an error.`, thread_ts: event.thread_ts });
            }
            return;
        }

        // Mentioned in a channel (not a thread)
        const rpgMode = aiHandler.rpgEnabledChannels.get(event.channel);
        if (rpgMode === 'player') {
            try {
                const history = await aiHandler.historyBuilder!.buildHistorySinceLastBotMessage(event.channel, client, context.botUserId);
                const userPrompt = buildUserPrompt({ channel: event.channel, user: event.user, text: prompt });

                let question: string | Part[] = userPrompt;
                if ((event as any).files && (event as any).files.length > 0) {
                    const imageFile = (event as any).files.find((f: any) => f.mimetype.startsWith('image/'));
                    if (imageFile && imageFile.url_private) {
                        try {
                            const imagePart = await aiHandler.processImage(imageFile.url_private, imageFile.mimetype);
                            question = [
                                { text: userPrompt },
                                imagePart
                            ];
                        } catch (error) {
                            console.error('Error processing image:', error);
                            await say({ text: `I found an image but couldn't process it: ${(error as Error).message}` });
                            return;
                        }
                    }
                }

                const response = await aiHandler.processAIQuestion(question, history, event.channel, event.thread_ts);
                if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                    const responseText = response.text;
                    await say({ text: responseText });
                }
            } catch (error) {
                console.error("Error in RPG player mode mention handler:", error);
                await say({ text: `Sorry <@${event.user}>, I couldn't process your request in player mode.` });
            }
        } else {
            // Standard mention to start a new thread
            try {
                const userPrompt = buildUserPrompt({ channel: event.channel, user: event.user, text: prompt });

                let question: string | Part[] = userPrompt;
                if ((event as any).files && (event as any).files.length > 0) {
                    const imageFile = (event as any).files.find((f: any) => f.mimetype.startsWith('image/'));
                    if (imageFile && imageFile.url_private) {
                        try {
                            const imagePart = await aiHandler.processImage(imageFile.url_private, imageFile.mimetype);
                            question = [
                                { text: userPrompt },
                                imagePart
                            ];
                        } catch (error) {
                            console.error('Error processing image:', error);
                            await say({ text: `I found an image but couldn't process it: ${(error as Error).message}`, thread_ts: event.ts });
                            return;
                        }
                    }
                }

                const response = await aiHandler.processAIQuestion(question, [], event.channel, event.ts);
                console.log(`[DEBUG] response =`, JSON.stringify(response, null, 2));

                const condition = response.text && response.text.trim() && !response.text.trim().includes('<DO_NOT_RESPOND>');
                if (response.text.trim().includes('<DO_NOT_RESPOND>')) {
                    console.log(`[DEBUG] <DO_NOT_RESPOND> received: ${response.text}`);
                }

                if (condition) {
                    const responseText = response.text;
                    await say({
                        text: `${responseText}`,
                        thread_ts: event.ts,
                    });

                    // Save the initial history for the new thread
                    const finalHistory: Content[] = [
                        typeof question === 'string' ? { role: 'user', parts: [{ text: question }] } : { role: 'user', parts: question },
                        { role: 'assistant', parts: [{ text: response.text }] },
                    ];
                    saveThreadHistory(event.ts, event.channel, finalHistory);
                }
            } catch (error) {
                console.error('Error in mention handler (channel):', error);
                await say({ text: `Sorry <@${event.user}>, I couldn't process your request.`, thread_ts: event.ts });
            }
        }
    });

    app.message(
        async ({ message, next }) => {
            // This middleware ensures we only process regular messages from users that are not commands.
            if (message.subtype === undefined && 'text' in message && message.text && !message.text.startsWith('!')) {
                await next();
            }
        },
        async ({ message, context, say, client }) => {

            // Although the middleware should guarantee 'text' exists, the linter doesn't know that.
            if (!('text' in message) || !message.text) {
                return;
            }

            const health = providerHealth();
            if (!health.ok) {
                const shouldHaveTriggered =
                    ('thread_ts' in message && (message as any).thread_ts && message.text.length > 5) ||
                    aiHandler.enabledChannels.has(message.channel) ||
                    aiHandler.rpgEnabledChannels.has(message.channel);

                if (shouldHaveTriggered) {
                    const now = new Date().getTime();
                    const lastWarning = aiHandler.lastWarningTimestamp.get(message.channel);
                    if (!lastWarning || now - lastWarning > 5 * 60 * 1000) {
                        await say({ text: `AI features are not available: ${health.reason}` });
                        aiHandler.lastWarningTimestamp.set(message.channel, now);
                    }
                }
                return;
            }

            if (!('user' in message) || !message.user || !context.botUserId) {
                return;
            }

            if (typeof message.user !== 'string' || typeof message.text !== 'string') {
                return;
            }

            if (message.user === context.botUserId) {
                return;
            }

            if (message.text.includes(`<@${context.botUserId}>`)) {
                return;
            }

            if (processedEvents.has(message.ts)) {
                return;
            }
            processedEvents.add(message.ts);

            // Check if this is a feature request workflow
            if ('thread_ts' in message && (message as any).thread_ts) {
                const threadTs = (message as any).thread_ts;
                if (featureRequest.isFeatureRequestThread(threadTs)) {
                    await featureRequest.handleMessage(message, client, say);
                    return;
                }
            }

            const isRpgChannel = aiHandler.rpgEnabledChannels.has(message.channel);
            const rpgMode = isRpgChannel ? aiHandler.rpgEnabledChannels.get(message.channel) : null;
            if ('thread_ts' in message && (message as any).thread_ts) {
                const threadTs = (message as any).thread_ts;
                const threadKey = `${message.channel}-${threadTs}`;
                if (aiHandler.disabledThreads.has(threadKey) || rpgMode === 'gm') {
                    return;
                }

                if (message.user === context.botUserId) {
                    return;
                }

                if (!getThreadHistory(threadTs)) {
                    return;
                }

                try {
                    const history = await aiHandler.historyBuilder!.buildHistoryFromThread(
                        message.channel,
                        threadTs,
                        message.ts,
                        client,
                        context.botUserId!
                    );

                    const userPrompt = buildUserPrompt({
                        channel: message.channel,
                        user: message.user,
                        text: message.text,
                    });

                    // Check if we need to summarize based on hysteresis
                    const historyText = history.map(h => h.parts?.[0]?.text || '').join('\n');
                    const historyChars = historyText.length;
                    const estimatedHistoryTokens = Math.ceil(historyChars / 4);
                    const maxContextTokens = config.openai.maxContextSize;

                    const triggerThreshold = Math.ceil(maxContextTokens * config.summarization.triggerPercent / 100);
                    if (estimatedHistoryTokens > triggerThreshold) {
                        const existingSummary = aiHandler.loadThreadSummary(threadTs);

                        // Check if we need to summarize (first time or if existing summary is no longer sufficient)
                        const needsSummary = !existingSummary ||
                            (existingSummary && estimatedHistoryTokens > triggerThreshold * 1.2); // 20% buffer

                        if (needsSummary) {
                            console.log(`[Summary] History tokens ${estimatedHistoryTokens} exceeds trigger ${triggerThreshold}, ${existingSummary ? 'updating' : 'creating'} summary for thread ${threadTs}`);

                            // Notify user that summarization is starting
                            const notificationText = existingSummary
                                ? "🔄 This conversation has grown significantly, so I'm updating the summary to keep things running smoothly. This may take a moment..."
                                : "🔄 This conversation is getting long, so I'm creating a summary to keep things running smoothly. This may take a moment...";

                            await say({
                                text: notificationText,
                                thread_ts: threadTs
                            });

                            // Create summary of current history
                            const summary = await aiHandler.summarizeConversation(history, threadTs);
                            aiHandler.saveThreadSummary(threadTs, summary, {
                                originalMessageCount: history.length,
                                tokenCount: estimatedHistoryTokens,
                                isUpdate: !!existingSummary
                            });

                            // Notify user that summarization is complete
                            await say({
                                text: "✅ Conversation summary updated! I'm now using the refreshed context to keep our chat efficient.",
                                thread_ts: threadTs
                            });

                            console.log(`[Summary] ${existingSummary ? 'Updated' : 'Created'} summary for thread ${threadTs}`);
                        }
                    }

                    let question: string | Part[] = userPrompt;
                    if ((message as any).files && (message as any).files.length > 0) {
                        const imageFile = (message as any).files.find((f: any) => f.mimetype.startsWith('image/'));
                        if (imageFile && imageFile.url_private) {
                            try {
                                const imagePart = await aiHandler.processImage(imageFile.url_private, imageFile.mimetype);
                                question = [
                                    { text: userPrompt },
                                    imagePart
                                ];
                            } catch (error) {
                                console.error('Error processing image:', error);
                                await say({ text: `I found an image but couldn't process it: ${(error as Error).message}`, thread_ts: threadTs });
                                return;
                            }
                        }
                    }

                    const response = await aiHandler.processAIQuestion(question, history, message.channel, threadTs);
                    if (response.text.trim().includes('<DO_NOT_RESPOND>')) {
                        console.log(`[DEBUG] <DO_NOT_RESPOND> received: ${response.text}`);
                    } else if (response.text.trim()) {
                        const responseText = response.text;
                        await say({ text: responseText, thread_ts: threadTs });
                    }

                    // Save the updated history
                    const finalHistory: Content[] = [
                        ...history,
                        typeof question === 'string' ? { role: 'user', parts: [{ text: question }] } : { role: 'user', parts: question },
                        { role: 'assistant', parts: [{ text: response.text }] },
                    ];
                    if (threadTs) {
                        saveThreadHistory(threadTs, message.channel, finalHistory);
                    }
                } catch (error) {
                    console.error('Error in thread follow-up handler:', error);
                }
                return;
            }

            if (aiHandler.enabledChannels.has(message.channel)) {

                if (typeof message.user !== 'string' || typeof message.text !== 'string') {
                    return;
                }

                if (message.user === context.botUserId) {
                    return;
                }
                try {
                    const history = await aiHandler.historyBuilder!.buildHistoryFromChannel(
                        message.channel,
                        message.ts,
                        client,
                        context.botUserId!
                    );
                    const userPrompt = buildUserPrompt({
                        channel: message.channel,
                        user: message.user,
                        text: message.text,
                    });

                    let question: string | Part[] = userPrompt;
                    if ((message as any).files && (message as any).files.length > 0) {
                        const imageFile = (message as any).files.find((f: any) => f.mimetype.startsWith('image/'));
                        if (imageFile && imageFile.url_private) {
                            try {
                                const imagePart = await aiHandler.processImage(imageFile.url_private, imageFile.mimetype);
                                question = [
                                    { text: userPrompt },
                                    imagePart
                                ];
                            } catch (error) {
                                console.error('Error processing image:', error);
                                await say({ text: `I found an image but couldn't process it: ${(error as Error).message}` });
                                return;
                            }
                        }
                    }

                    const response = await aiHandler.processAIQuestion(question, history, message.channel, message.ts);
                    if (response.text.trim().includes('<DO_NOT_RESPOND>')) {
                        console.log(`[DEBUG] <DO_NOT_RESPOND> received: ${response.text}`);
                    }

                    if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                        const responseText = response.text;
                        await say({ text: responseText });
                    }
                } catch (error) {
                    console.error('Error in enabled channel handler:', error);
                }
                return;
            }

            if (rpgMode === 'gm') {
                if (typeof message.user !== 'string' || typeof message.text !== 'string') {
                    return;
                }

                if (message.user === context.botUserId) {
                    return;
                }
                try {
                    const rpgContext = aiHandler.loadRpgContext(message.channel);
                    const history = await aiHandler.historyBuilder!.buildHistoryFromChannel(
                        message.channel,
                        message.ts,
                        client,
                        context.botUserId!
                    );
                    const rpgPrompt = `RPG GM MODE CONTEXT (channel_id: ${message.channel}):\n${JSON.stringify(
                        rpgContext,
                        null,
                        2
                    )}\n\n`;
                    const userPrompt = `${rpgPrompt}${buildUserPrompt({
                        channel: message.channel,
                        user: message.user,
                        text: message.text,
                    })}`;

                    let question: string | Part[] = userPrompt;
                    if ((message as any).files && (message as any).files.length > 0) {
                        const imageFile = (message as any).files.find((f: any) => f.mimetype.startsWith('image/'));
                        if (imageFile && imageFile.url_private) {
                            try {
                                const imagePart = await aiHandler.processImage(imageFile.url_private, imageFile.mimetype);
                                question = [
                                    { text: userPrompt },
                                    imagePart
                                ];
                            } catch (error) {
                                console.error('Error processing image:', error);
                                await say({ text: `I found an image but couldn't process it: ${(error as Error).message}` });
                                return;
                            }
                        }
                    }

                    const response = await aiHandler.processAIQuestion(question, history, message.channel, message.ts);
                    if (response.text.trim().includes('<DO_NOT_RESPOND>')) {
                        console.log(`[DEBUG] <DO_NOT_RESPOND> received: ${response.text}`);
                    } else if (response.text.trim()) {
                        const responseText = response.text;
                        await say({ text: responseText });
                    }
                } catch (error) {
                    console.error('Error in RPG GM handler:', error);
                }
            }
        }
    );
}