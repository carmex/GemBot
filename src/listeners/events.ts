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

import {App} from '@slack/bolt';
import {AIHandler} from '../features/ai-handler';
import {config} from '../config';

export const registerEventListeners = (app: App, aiHandler: AIHandler) => {
    app.event('app_mention', async ({event, context, client, say}) => {
        if (!config.gemini.apiKey) {
            await say({text: 'This feature is not configured. A Gemini API key is required.'});
            return;
        }
        const prompt = event.text.replace(/<@[^>]+>\s*/, '').trim();
        if (!context.botUserId || !event.user) {
            return;
        }

        // Mentioned in a thread
        if (event.thread_ts) {
            try {
                const history = await aiHandler.buildHistoryFromThread(event.channel, event.thread_ts, event.ts, client, context.botUserId);
                const userPrompt = aiHandler.buildUserPrompt({channel: event.channel, user: event.user, text: prompt});
                const response = await aiHandler.processAIQuestion(userPrompt, history, event.channel);
                if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                    const responseText = response.totalTokens ? `(${response.totalTokens} tokens) ${response.text}` : response.text;
                    await say({text: responseText, thread_ts: event.thread_ts});
                }
            } catch (error) {
                console.error("Error in mention handler (thread):", error);
                await say({text: `Sorry <@${event.user}>, I encountered an error.`, thread_ts: event.thread_ts});
            }
            return;
        }

        // Mentioned in a channel (not a thread)
        const rpgMode = aiHandler.rpgEnabledChannels.get(event.channel);
        if (rpgMode === 'player') {
            try {
                const history = await aiHandler.buildHistorySinceLastBotMessage(event.channel, client, context.botUserId);
                const userPrompt = aiHandler.buildUserPrompt({channel: event.channel, user: event.user, text: prompt});
                const response = await aiHandler.processAIQuestion(userPrompt, history, event.channel);
                if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                    const responseText = response.totalTokens ? `(${response.totalTokens} tokens) ${response.text}` : response.text;
                    await say({text: responseText});
                }
            } catch (error) {
                console.error("Error in RPG player mode mention handler:", error);
                await say({text: `Sorry <@${event.user}>, I couldn't process your request in player mode.`});
            }
        } else {
            // Standard mention to start a new thread
            try {
                const userPrompt = aiHandler.buildUserPrompt({channel: event.channel, user: event.user, text: prompt});
                const response = await aiHandler.processAIQuestion(userPrompt, [], event.channel);
                if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                    const responseText = response.totalTokens ? `(${response.totalTokens} tokens) ${response.text}` : response.text;
                    await say({
                        text: `:robot_face: <@${event.user}> asked: "${prompt}"\n\n${responseText}`,
                        thread_ts: event.ts,
                    });
                }
            } catch (error) {
                console.error('Error in mention handler (channel):', error);
                await say({text: `Sorry <@${event.user}>, I couldn't process your request.`, thread_ts: event.ts});
            }
        }
    });

    app.message(/^[^!].*/, async ({message, context, say, client}) => {
        if ('text' in message && message.text && !config.gemini.apiKey) {
            // Heuristically check if this is a message that would have triggered the AI.
            // This is imperfect but prevents spamming "not configured" messages in busy channels.
            const shouldHaveTriggered =
                ('thread_ts' in message && message.thread_ts && message.text.length > 5) ||
                aiHandler.enabledChannels.has(message.channel) ||
                aiHandler.rpgEnabledChannels.has(message.channel);

            if (shouldHaveTriggered) {
                // Check if the bot has already warned in the last 5 minutes in this channel to avoid spam
                const now = new Date().getTime();
                const lastWarning = aiHandler.lastWarningTimestamp.get(message.channel);
                if (!lastWarning || now - lastWarning > 5 * 60 * 1000) {
                    await say({text: 'The AI features are not configured. A Gemini API key is required.'});
                    aiHandler.lastWarningTimestamp.set(message.channel, now);
                }
            }
            return;
        }

        if (!('user' in message) || !message.user || (message.subtype && message.subtype !== 'bot_message')) {
            return;
        }
        const rollRegex = /User <@(.+?)> rolled .* and got: .*/;
        const rollMatch = 'text' in message && message.text?.match(rollRegex);
        if (
            context.botId &&
            message.subtype === 'bot_message' &&
            'bot_id' in message &&
            message.bot_id === context.botId &&
            rollMatch &&
            aiHandler.rpgEnabledChannels.has(message.channel)
        ) {
            const originalUserId = rollMatch[1];
            if (!context.botUserId) {
                console.error("Could not determine bot user ID for history building.");
                return;
            }
            try {
                const rpgContext = aiHandler.loadRpgContext(message.channel);
                const history = await aiHandler.buildHistoryFromChannel(message.channel, message.ts, client, context.botUserId);
                const rpgMode = aiHandler.rpgEnabledChannels.get(message.channel);
                let rpgPrompt = '';
                if (rpgMode === 'gm') {
                    rpgPrompt = `RPG GM MODE CONTEXT (channel_id: ${message.channel}):\n${JSON.stringify(rpgContext, null, 2)}\n\n`;
                } else if (rpgMode === 'player') {
                    rpgPrompt = `RPG PLAYER MODE (channel_id: ${message.channel}):\nYour character sheet: ${JSON.stringify(rpgContext, null, 2)}\n\n`;
                }
                const userPrompt = `${rpgPrompt}channel_id: ${message.channel} | user_id: ${originalUserId} | message: ${message.text}`;
                const response = await aiHandler.processAIQuestion(userPrompt, history, message.channel);
                if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                    const responseText = response.totalTokens ? `(${response.totalTokens} tokens) ${response.text}` : response.text;
                    await say({text: responseText});
                }
            } catch (error) {
                console.error("Error in RPG roll-follow-up handler:", error);
            }
            return;
        }
        if (!('user' in message) || !message.user || !context.botUserId) {
            return;
        }

        // Check if the message is a direct mention and ignore it, as it's handled by the app_mention event listener
        if (message.text && message.text.includes(`<@${context.botUserId}>`)) {
            return;
        }

        if ('thread_ts' in message && message.thread_ts) {
            const threadKey = `${message.channel}-${message.thread_ts}`;
            if (aiHandler.disabledThreads.has(threadKey)) {
                return;
            }
            try {
                const history = await aiHandler.buildHistoryFromThread(message.channel, message.thread_ts, message.ts, client, context.botUserId);
                const hasBotMessages = history.some(content => content.role === 'model');
                const isRpgChannel = aiHandler.rpgEnabledChannels.has(message.channel);

                if (hasBotMessages || isRpgChannel) {
                    const userPrompt = aiHandler.buildUserPrompt({channel: message.channel, user: message.user, text: message.text});
                    const response = await aiHandler.processAIQuestion(userPrompt, history, message.channel);
                    if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                        const responseText = response.totalTokens ? `(${response.totalTokens} tokens) ${response.text}` : response.text;
                        await say({text: responseText, thread_ts: message.thread_ts});
                    }
                }
            } catch (error) {
                console.error("Error in thread follow-up handler:", error);
            }
            return;
        }
        if (aiHandler.enabledChannels.has(message.channel)) {
            try {
                const history = await aiHandler.buildHistoryFromChannel(message.channel, message.ts, client, context.botUserId);
                const userPrompt = aiHandler.buildUserPrompt({channel: message.channel, user: message.user, text: message.text});
                const response = await aiHandler.processAIQuestion(userPrompt, history, message.channel);
                if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                    const responseText = response.totalTokens ? `(${response.totalTokens} tokens) ${response.text}` : response.text;
                    await say({text: responseText});
                }
            } catch (error) {
                console.error('Error in enabled channel handler:', error);
            }
            return;
        }
        if (aiHandler.rpgEnabledChannels.has(message.channel)) {
            const rpgMode = aiHandler.rpgEnabledChannels.get(message.channel);
            if (rpgMode === 'gm') {
                try {
                    const rpgContext = aiHandler.loadRpgContext(message.channel);
                    const history = await aiHandler.buildHistoryFromChannel(message.channel, message.ts, client, context.botUserId);
                    const rpgPrompt = `RPG GM MODE CONTEXT (channel_id: ${message.channel}):\n${JSON.stringify(rpgContext, null, 2)}\n\n`;
                    const userPrompt = `${rpgPrompt}${aiHandler.buildUserPrompt({
                        channel: message.channel,
                        user: message.user,
                        text: message.text
                    })}`;
                    const response = await aiHandler.processAIQuestion(userPrompt, history, message.channel);
                    if (response.text.trim() && response.text.trim() !== '<DO_NOT_RESPOND>') {
                        const responseText = response.totalTokens ? `(${response.totalTokens} tokens) ${response.text}` : response.text;
                        await say({text: responseText});
                    }
                } catch (error) {
                    console.error("Error in RPG handler:", error);
                }
            }
        }
    });
}
