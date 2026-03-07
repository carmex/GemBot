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
import { MemeGenerator } from '../features/meme-generator';
import { config } from '../config';
import { AIHandler } from '../features/ai-handler';

export const registerMemeCommands = (app: App, aiHandler?: AIHandler) => {
    // !meme list
    app.message(/^!meme\s+list$/i, async ({ message, say }) => {
        if (!('user' in message)) return;
        const threadTs = 'thread_ts' in message ? message.thread_ts : undefined;

        try {
            const memes = await MemeGenerator.getPopularMemes();
            if (memes.length === 0) {
                await say({ text: 'Failed to fetch meme templates.', thread_ts: threadTs });
                return;
            }

            const list = memes.slice(0, 25).map(m => `• *${m.name}* (ID: ${m.id}, Boxes: ${m.box_count})`).join('\n');
            await say({ text: `*Popular Meme Templates:*\n${list}\n\nUse \`!meme search <term>\` to find more.`, thread_ts: threadTs });
        } catch (error) {
            console.error('Error in !meme list:', error);
            await say({ text: 'An error occurred while fetching meme templates.', thread_ts: threadTs });
        }
    });

    // !meme search <term>
    app.message(/^!meme\s+search\s+(.+)$/i, async ({ message, context, say }) => {
        if (!('user' in message) || !context.matches?.[1]) return;
        const threadTs = 'thread_ts' in message ? message.thread_ts : undefined;

        const term = context.matches[1].trim();
        try {
            const memes = await MemeGenerator.getPopularMemes();
            const results = memes.filter(m => m.name.toLowerCase().includes(term.toLowerCase())).slice(0, 15);

            if (results.length === 0) {
                await say({ text: `No templates found for "${term}".`, thread_ts: threadTs });
                return;
            }

            const list = results.map(m => `• *${m.name}* (ID: ${m.id}, Boxes: ${m.box_count})`).join('\n');
            await say({ text: `*Search Results for "${term}":*\n${list}`, thread_ts: threadTs });
        } catch (error) {
            console.error('Error in !meme search:', error);
            await say({ text: 'An error occurred while searching for meme templates.', thread_ts: threadTs });
        }
    });

    // !meme <id_or_name> <text1> [| <text2> | <text3> ... ]
    app.message(/^!meme\s+(.+)$/i, async ({ message, context, say, client }) => {
        if (!('user' in message) || !context.matches?.[1] || (message as any).subtype) return;
        const threadTs = 'thread_ts' in message ? message.thread_ts : undefined;

        const fullInput = context.matches[1].trim();
        
        // Skip if it was list or search (already handled)
        if (fullInput.toLowerCase() === 'list' || fullInput.toLowerCase().startsWith('search ')) {
            return;
        }

        try {
            // Parse template and texts
            // Regex to handle quoted template names: ^(?:"([^"]+)"|(\S+))\s*(.*)$
            const match = fullInput.match(/^(?:"([^"]+)"|(\S+))\s*(.*)$/);
            if (!match) {
                await say({ text: 'Invalid meme command format. Use `!meme "template name" text1 | text2`', thread_ts: threadTs });
                return;
            }

            const templateSearch = match[1] || match[2];
            const textContent = match[3] || '';
            const texts = textContent.split('|').map((t: string) => t.trim()).filter((t: string) => t.length > 0);

            const template = await MemeGenerator.findMeme(templateSearch);
            if (!template) {
                if (aiHandler) {
                    await say({ text: `Template "${templateSearch}" not found. Generating an AI version instead...`, thread_ts: threadTs });
                    
                    let descriptivePrompt = `A meme based on '${templateSearch}'`;
                    if (texts.length >= 2) {
                        descriptivePrompt += ` with text: '${texts[0]}' at the top and '${texts[1]}' at the bottom.`;
                    } else if (texts.length === 1) {
                        descriptivePrompt += ` with text: '${texts[0]}'`;
                    } else {
                        await say({ text: `Please provide text for the meme. Example: \`!meme "${templateSearch}" Top Text | Bottom Text\``, thread_ts: threadTs });
                        return;
                    }

                    const aiResult = await aiHandler.generateImage(descriptivePrompt);
                    if (aiResult.imageBase64) {
                        const buffer = Buffer.from(aiResult.imageBase64, 'base64');
                        await client.files.uploadV2({
                            file: buffer,
                            filename: 'ai_meme.png',
                            channel_id: message.channel,
                            thread_ts: threadTs,
                            initial_comment: `_AI-generated meme for "${templateSearch}":_`
                        });
                    } else {
                        await say({ text: `Failed to generate an AI fallback for "${templateSearch}". ${aiResult.filteredReason || ''}`, thread_ts: threadTs });
                    }
                } else {
                    await say({ text: `Could not find meme template: "${templateSearch}"`, thread_ts: threadTs });
                }
                return;
            }

            if (texts.length === 0) {
                await say({ text: `Please provide text for the meme. Example: \`!meme "${template.name}" Top Text | Bottom Text\``, thread_ts: threadTs });
                return;
            }

            const imageUrl = await MemeGenerator.captionImage(template.id, texts);
            if (!imageUrl) {
                await say({ text: 'Failed to generate meme. Please check your inputs and try again.', thread_ts: threadTs });
                return;
            }

            // Post the image
            await say({
                thread_ts: threadTs,
                blocks: [
                    {
                        type: 'image',
                        title: {
                            type: 'plain_text',
                            text: template.name
                        },
                        image_url: imageUrl,
                        alt_text: template.name
                    }
                ]
            });

        } catch (error) {
            console.error('Error in !meme:', error);
            await say({ text: 'An error occurred while generating your meme.', thread_ts: threadTs });
        }
    });
};
