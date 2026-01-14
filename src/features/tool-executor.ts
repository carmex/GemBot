import { App } from '@slack/bolt';
import fetch from 'node-fetch';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { getJson as getSerpJson } from 'serpapi';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { Part } from '@google/generative-ai';

export async function googleCustomSearch(query: string): Promise<string> {
    const apiKey = config.search.googleApiKey;
    const cxId = config.search.googleCxId;
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cxId}&q=${encodeURIComponent(query)}`;

    const response = await fetch(url);
    if (!response.ok) {
        const errorBody: any = await response.json();
        throw new Error(`Google Custom Search API request failed: ${errorBody.error.message}`);
    }

    const data: any = await response.json();
    if (!data.items || data.items.length === 0) {
        return "No search results found.";
    }

    let summarizedContent = '';
    if (data.spelling) {
        summarizedContent += `Did you mean: ${data.spelling.correctedQuery}\n\n`;
    }

    summarizedContent += 'Search Results:\n';
    data.items.slice(0, 5).forEach((item: any, index: number) => {
        summarizedContent += `[${index + 1}] ${item.title}\nSnippet: ${item.snippet}\nSource: ${item.link}\n\n`;
    });

    return summarizedContent;
}

export async function executeTool(
    app: App,
    imageGenerator: any,
    name: string,
    args: any,
    channelId: string,
    threadTs?: string
): Promise<Part> {
    try {
        if (name === 'slack_user_profile') {
            const userId = (args as any).user_id as string;
            await app.client.chat.postMessage({
                channel: channelId,
                thread_ts: threadTs,
                text: `_looking up user profile for <@${userId}>_`
            });
            const result = await app.client.users.info({ user: userId });
            if (result.ok) {
                return {
                    functionResponse: {
                        name: name,
                        response: {
                            id: (result.user as any)?.id,
                            name: (result.user as any)?.name,
                            real_name: (result.user as any)?.real_name,
                            email: (result.user as any)?.profile?.email,
                            tz: (result.user as any)?.tz,
                            title: (result.user as any)?.profile?.title,

                        }
                    }
                }
            } else {
                return { functionResponse: { name: name, response: { error: result.error } } };
            }
        } else if (name === 'web_search') {
            const query = (args as any).query as string;
            if (!query) {
                return { functionResponse: { name: name, response: { error: 'Query was missing from the arguments.' } } };
            }
            await app.client.chat.postMessage({
                channel: channelId,
                thread_ts: threadTs,
                text: `_searching the web for "${query}"_`
            });

            if (config.search.provider === 'google') {
                if (!config.search.googleApiKey || !config.search.googleCxId) {
                    const errorMsg = 'Google Custom Search is not configured. `GOOGLE_API_KEY` and `GOOGLE_CX_ID` are required.';
                    console.error(`[Tool] ${errorMsg}`);
                    return { functionResponse: { name: name, response: { error: errorMsg } } };
                }
                try {
                    const searchResult = await googleCustomSearch(query);
                    return { functionResponse: { name: name, response: { content: searchResult } } };
                } catch (e) {
                    console.error(`[Tool] Error performing Google Custom Search for "${query}":`, e);
                    return { functionResponse: { name: name, response: { error: (e as Error).message } } };
                }
            } else { // default to serpapi
                if (!config.search.serpapiApiKey) {
                    const errorMsg = 'The web_search tool is not available because the SERPAPI_API_KEY is not configured.';
                    console.error(`[Tool] ${errorMsg}`);
                    return { functionResponse: { name: name, response: { error: errorMsg } } };
                }
                try {
                    const serpResponse = await getSerpJson({
                        engine: 'google',
                        q: query,
                        api_key: config.search.serpapiApiKey,
                    });

                    let summarizedContent = '';
                    if (serpResponse.answer_box) {
                        summarizedContent += `Answer Box: ${serpResponse.answer_box.title}\n${serpResponse.answer_box.snippet}\n\n`;
                    }
                    if (serpResponse.organic_results && serpResponse.organic_results.length > 0) {
                        summarizedContent += 'Search Results:\n';
                        serpResponse.organic_results.slice(0, 5).forEach((result: any, index: number) => {
                            summarizedContent += `[${index + 1}] ${result.title}\nSnippet: ${result.snippet}\nSource: ${result.link}\n\n`;
                        });
                    }

                    if (!summarizedContent) {
                        return { functionResponse: { name: name, response: { content: 'No search results found.' } } };
                    }
                    return { functionResponse: { name: name, response: { content: summarizedContent } } };
                } catch (e) {
                    console.error(`[Tool] Error performing web search for "${query}":`, e);
                    return { functionResponse: { name: name, response: { error: (e as Error).message } } };
                }
            }
        } else if (name === 'fetch_url_content') {
            const url = (args as any).url as string;
            await app.client.chat.postMessage({
                channel: channelId,
                thread_ts: threadTs,
                text: `_ fetching content from ${url} _`
            });
            try {
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    },
                });
                if (!response.ok) {
                    const errorMsg = `Request failed with status ${response.status}`;
                    console.error(`[Tool] Error fetching URL ${url}: ${errorMsg}`);
                    return { functionResponse: { name: name, response: { error: errorMsg } } };
                }
                const contentType = response.headers.get('content-type') ?? '';
                let content = '';
                if (contentType.includes('text/html')) {
                    const html = await response.text();
                    try {
                        // Pre-process HTML to remove style tags and CSS that might cause parsing errors
                        let processedHtml = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
                        processedHtml = processedHtml.replace(/<link[^>]*rel=['"]?stylesheet['"]?[^>]*>/gi, '');

                        const doc = new JSDOM(processedHtml, {
                            url,
                            pretendToBeVisual: false,
                            // resources: 'usable' // Disabled to prevent hanging on external resources
                        });
                        const reader = new Readability(doc.window.document);
                        const article = reader.parse();
                        if (article && article.textContent) {
                            content = article.textContent;
                        } else {
                            console.warn(`[Tool] Readability failed for ${url}. Falling back to body text content.`);
                            content = doc.window.document.body.textContent ?? '';
                        }
                    } catch (domError) {
                        console.error(`[Tool] JSDOM parsing failed for ${url}:`, domError);
                        // Fallback to fetching text without JSDOM if parsing fails
                        const textResponse = await fetch(url);
                        if (!textResponse.ok) {
                            const errorMsg = `Fallback request failed with status ${textResponse.status}`;
                            console.error(`[Tool] Fallback error fetching URL ${url}: ${errorMsg}`);
                            return { functionResponse: { name: name, response: { error: errorMsg } } };
                        } content = await textResponse.text();
                    }
                } else if (contentType.includes('text/plain')) {
                    content = await response.text();
                } else {
                    const errorMsg = `Unsupported content type: ${contentType}`;
                    console.error(`[Tool] ${errorMsg} from ${url}`);
                    return { functionResponse: { name: name, response: { error: errorMsg } } };
                }
                const result = { functionResponse: { name: name, response: { content } } };
                return result;
            } catch (e) {
                console.error(`[Tool] Error fetching content from ${url}:`, e);
                return { functionResponse: { name: name, response: { error: (e as Error).message } } };
            }
        } else if (name === 'update_rpg_context') {
            const { context } = args as any;
            await app.client.chat.postMessage({
                channel: channelId,
                thread_ts: threadTs,
                text: `_updating game state_`
            });
            if (context) {
                try {
                    const filePath = path.join(__dirname, `../../rpg-context-${channelId}.json`);
                    fs.writeFileSync(filePath, JSON.stringify(context, null, 2), 'utf-8');
                    console.log(`[RPG] Context saved for channel ${channelId}.`);
                    return { functionResponse: { name: name, response: { success: true } } }
                } catch (error) {
                    console.error('Error saving RPG context:', error);
                    return { functionResponse: { name: name, response: { error: (error as Error).message } } };
                }
            } else {
                console.error(`[RPG] Attempted to save context for channel ${channelId} but context was missing.`);
                return { functionResponse: { name: name, response: { success: false, error: 'Context was missing from the arguments.' } } };
            }
        } else if (name === 'generate_image') {
            const { prompt } = args;
            if (prompt) {
                try {
                    imageGenerator.generateAndUploadImage(prompt, channelId).catch((error: unknown) => {
                        console.error(`[Tool] Image generation/upload failed in background:`, error);
                    });
                    return { functionResponse: { name: name, response: { success: true, message: 'The image is being generated and will be posted shortly.' } } };
                } catch (error) {
                    console.error(`[Tool] Error generating image for prompt "${prompt}":`, error);
                    return { functionResponse: { name: name, response: { success: false, error: (error as Error).message } } };
                }
            } else {
                return { functionResponse: { name: name, response: { error: 'Prompt was missing from the arguments.' } } };
            }
        }
        return { functionResponse: { name: 'unknown_tool', response: { error: 'Tool not found' } } };
    } catch (error) {
        console.error('Error executing tool:', error);
        return { functionResponse: { name: name, response: { error: (error as Error).message } } };
    }
}