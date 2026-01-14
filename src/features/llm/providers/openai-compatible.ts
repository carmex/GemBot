/*
 * OpenAICompatibleProvider: adapts OpenAI-style Chat Completions (LM Studio, vLLM) to LLMProvider
 */
import fetch from 'node-fetch';
import { config } from '../../../config';
import { Content, Part } from '@google/generative-ai';
import {
    LLMChatOptions,
    LLMMessage,
    LLMProvider,
    LLMResult,
    LLMTool,
    LLMToolCall,
    LLMRole,
} from './types';

import { get_encoding, Tiktoken } from 'tiktoken';

interface MultimodalContent {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string };
}

type OpenAIMessage =
    | { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | MultimodalContent[]; name?: string; tool_call_id?: string }
    // Some servers support array of content parts; we use simple string
    ;

function toOpenAIMessages(question: string | Part[], options: LLMChatOptions): OpenAIMessage[] {
    const msgs: OpenAIMessage[] = [];

    if (options.systemPrompt) {
        msgs.push({ role: 'system', content: options.systemPrompt });
    }

    // Check if model supports vision (Gemma 3, GPT-4o, etc.)
    const model = config.openai.model.toLowerCase();
    const supportsVision = model.includes('gemma-3') || model.includes('gpt-4o') || model.includes('gpt-4-vision') || model.includes('qwen') || model.includes('vl');
    console.log(`[Debug-OpenAI-Vision] Model "${config.openai.model}" supports vision: ${supportsVision}`);

    if (options.history && options.history.length > 0) {
        for (const m of options.history) {
            if ('parts' in m) {
                // Handle Content (Gemini format)
                const contentItem = m as Content;
                const role = contentItem.role === 'model' ? 'assistant' : contentItem.role as LLMRole;
                const parts = contentItem.parts || [];

                if (supportsVision && parts.length > 0) {
                    // Build multimodal content array
                    const contentArray: MultimodalContent[] = [];
                    let imageCount = 0;
                    for (const part of parts) {
                        if ('text' in part && part.text) {
                            contentArray.push({ type: 'text', text: part.text });
                        } else if ('inlineData' in part && part.inlineData) {
                            const mimeType = part.inlineData.mimeType || 'image/jpeg';
                            const dataUrl = `data:${mimeType};base64,${part.inlineData.data}`;
                            contentArray.push({ type: 'image_url', image_url: { url: dataUrl } });
                            imageCount++;
                        }
                    }
                    if (contentArray.length > 0) {
                        console.log(`[Debug-OpenAI-Vision] Converted Content entry (${role}): ${parts.length} parts -> ${contentArray.length} content items, ${imageCount} images`);
                        msgs.push({ role, content: contentArray });
                    } else {
                        // Check for functionResponse
                        const functionResponsePart = parts.find(p => 'functionResponse' in p);
                        if (functionResponsePart && functionResponsePart.functionResponse) {
                            const fr = functionResponsePart.functionResponse;
                            const id = (fr as any).id;
                            const content = JSON.stringify(fr.response);
                            if (id) {
                                msgs.push({ role: 'tool', tool_call_id: id, content });
                            } else {
                                // Fallback if no ID
                                msgs.push({ role: 'user', content: `Tool '${fr.name}' output: ${content}` });
                            }
                        }
                    }
                } else {
                    // Fallback to text-only (extract first text or join)
                    const text = parts.map(p => 'text' in p ? p.text : '').filter(t => t).join('\n') || '';
                    if (text) {
                        console.log(`[Debug-OpenAI-Vision] Text-only fallback for Content entry (${role}): "${text.substring(0, 100)}..."`);
                        msgs.push({ role, content: text });
                    } else {
                        // Check for functionResponse
                        const functionResponsePart = parts.find(p => 'functionResponse' in p);
                        if (functionResponsePart && functionResponsePart.functionResponse) {
                            const fr = functionResponsePart.functionResponse;
                            const id = (fr as any).id;
                            const content = JSON.stringify(fr.response);
                            if (id) {
                                msgs.push({ role: 'tool', tool_call_id: id, content });
                            } else {
                                // Fallback if no ID
                                msgs.push({ role: 'user', content: `Tool '${fr.name}' output: ${content}` });
                            }
                        }
                    }
                }
            } else {
                // Handle LLMMessage (text-only)
                const messageItem = m as LLMMessage;
                msgs.push({
                    role: messageItem.role === 'assistant' ? 'assistant' : messageItem.role,
                    content: messageItem.content,
                    name: messageItem.name,
                } as OpenAIMessage);
            }
        }
    }

    // Current user turn
    if (typeof question === 'string') {
        msgs.push({ role: 'user', content: question });
    } else {
        // Handle Part[] (multimodal)
        if (supportsVision) {
            const contentArray: MultimodalContent[] = [];
            for (const part of question) {
                if ('text' in part && part.text) {
                    contentArray.push({ type: 'text', text: part.text });
                } else if ('inlineData' in part && part.inlineData) {
                    const mimeType = part.inlineData.mimeType || 'image/jpeg';
                    const dataUrl = `data:${mimeType};base64,${part.inlineData.data}`;
                    contentArray.push({ type: 'image_url', image_url: { url: dataUrl } });
                }
            }
            msgs.push({ role: 'user', content: contentArray });
        } else {
            // Fallback to text-only
            const text = question.map(p => 'text' in p ? p.text : '').filter(t => t).join('\n') || '';
            msgs.push({ role: 'user', content: text });
        }
    }

    return msgs;
}

// Map generic tools to OpenAI "tools" format if supported
function toOpenAITools(tools: LLMTool[] | undefined) {
    if (!tools || tools.length === 0) return undefined;
    return tools.map((t) => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters || { type: 'object', properties: {}, required: [] },
        },
    }));
}

// Fallback tool calling contract for runtimes without native tools:
// The assistant should reply with a JSON object:
// { "tool_calls": [ { "name": "...", "arguments": {...} } ] }
// or { "final": "assistant message" }
function buildToolJSONContractPrompt(tools: LLMTool[]): string {
    return `
You can use the following tools when needed:
${tools
            .map(
                (t) =>
                    `- ${t.name}: ${t.description}\n  parameters: ${JSON.stringify(t.parameters || { type: 'object', properties: {}, required: [] })}`
            )
            .join('\n')}

When you need to call a tool, respond ONLY with JSON:
{"tool_calls":[{"name":"TOOL_NAME","arguments":{...}}]}
If no tool is needed, respond ONLY with JSON:
{"final":"YOUR_NORMAL_TEXT_RESPONSE"}

Do NOT include backticks or extra text around the JSON. Strictly produce valid JSON.
`.trim();
}

export class OpenAICompatibleProvider implements LLMProvider {
    private tokenizer: Tiktoken;

    constructor() {
        this.tokenizer = get_encoding('cl100k_base');
    }

    name(): string {
        return 'openai';
    }

    async countTokens(text: string): Promise<number> {
        return this.tokenizer.encode(text).length;
    }

    private baseUrl(): string {
        return config.openai.baseUrl;
    }

    private apiKey(): string | undefined {
        return config.openai.apiKey;
    }

    private model(): string {
        return config.openai.model;
    }

    async chat(question: string | Part[], options: LLMChatOptions): Promise<LLMResult> {
        // Prefer native tools when server supports them, but also add a lightweight, model-facing instruction
        // to steer the model to return native tool_calls instead of dumping inline JSON in text.
        const useNativeTools = true;

        // Augment system prompt with explicit guidance for tool call formatting on OpenAI-compatible servers.
        let systemPrompt = options.systemPrompt || '';
        if (options.tools && options.tools.length > 0) {
            const toolNames = options.tools.map(t => t.name).join(', ');
            const nativeToolCallHint = `
When you need to use a tool (${toolNames}), do NOT include any inline JSON in your text.
Instead, return native tool_calls in the OpenAI Chat Completions format (function name and JSON arguments) so the client can execute them.
Do not echo the tool call in the assistant text.`.trim();
            systemPrompt = `${systemPrompt ? systemPrompt + '\n\n' : ''}${nativeToolCallHint}`;
        }

        const body: any = {
            model: this.model(),
            messages: toOpenAIMessages(question, { ...options, systemPrompt }),
            temperature: options.temperature ?? 0.7,
            top_p: options.topP ?? 1.0,
        };

        if (useNativeTools && options.tools && options.tools.length > 0) {
            body.tools = toOpenAITools(options.tools);
            // Prefer auto first, but many local servers obey "required" better for producing tool_calls
            body.tool_choice = 'auto';
            // Also set parallel_tool_calls to false to discourage mixing prose with tool json in the same turn
            (body as any).parallel_tool_calls = false;
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (this.apiKey()) {
            headers['Authorization'] = `Bearer ${this.apiKey()}`;
        }

        // DEBUG: request summary
        try {
            const toolCount = options.tools?.length ?? 0;
            const hasTools = toolCount > 0;
            const previewSys = (options.systemPrompt || '').slice(0, 160).replace(/\s+/g, ' ');
            // New token estimation: character count / 4
            const messagesJson = JSON.stringify(body.messages);
            const estimatedTokens = Math.ceil(messagesJson.length / 4);
            console.log(`Estimated tokens: ${estimatedTokens}`);

        } catch { }

        const resp = await fetch(`${this.baseUrl()}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            console.error(`[Debug-OpenAI-Error] Full server response (status ${resp.status}): ${text}`);
            throw new Error(`OpenAI-compatible server error ${resp.status}: ${text}`);
        }

        const data: any = await resp.json();

        // Parse native tool calls if present
        const choice = data.choices?.[0];
        const msg = choice?.message;

        // 1) Native tool_calls supported by many OpenAI-compatible servers
        const toolCalls: LLMToolCall[] | undefined = Array.isArray(msg?.tool_calls)
            ? msg.tool_calls.map((tc: any) => ({
                name: tc.function?.name,
                arguments: (() => {
                    try {
                        if (typeof tc.function?.arguments === 'string') {
                            return JSON.parse(tc.function.arguments);
                        }
                        return tc.function?.arguments ?? {};
                    } catch {
                        return {};
                    }
                })(),
                id: tc.id,
            }))
            : undefined;

        // 2) Fallback parsing: extract multiple inline tool call JSON blobs from assistant text
        let text = typeof msg?.content === 'string' ? msg.content : '';
        let parsedToolCalls: LLMToolCall[] | undefined = undefined;

        if ((!toolCalls || toolCalls.length === 0) && text) {
            const foundCalls: LLMToolCall[] = [];

            // Helper: attempt to parse a JSON string safely
            const tryParse = (s: string): any | undefined => {
                try {
                    return JSON.parse(s);
                } catch {
                    return undefined;
                }
            };

            // a) Extract fenced ```json blocks (can contain either the contract or direct array/object)
            const fencedRegex = /```json\s*([\s\S]*?)```/gi;
            let fencedMatch: RegExpExecArray | null;
            const fencedSpans: [number, number][] = [];
            while ((fencedMatch = fencedRegex.exec(text)) !== null) {
                const payload = fencedMatch[1]?.trim();
                if (!payload) continue;

                const parsed = tryParse(payload);
                if (!parsed) continue;

                if (Array.isArray(parsed)) {
                    // Array of tool calls directly
                    for (const item of parsed) {
                        if (item && typeof item.name === 'string' && item.arguments !== undefined) {
                            foundCalls.push({ name: item.name, arguments: item.arguments ?? {} });
                        }
                    }
                    fencedSpans.push([fencedMatch.index, fencedMatch.index + fencedMatch[0].length]);
                } else if (parsed && typeof parsed === 'object') {
                    // Contract {"tool_calls":[...]} or single {"name","arguments"} or {"final": "..."}
                    if (Array.isArray(parsed.tool_calls)) {
                        for (const tc of parsed.tool_calls) {
                            if (tc && typeof tc.name === 'string' && tc.arguments !== undefined) {
                                foundCalls.push({ name: tc.name, arguments: tc.arguments ?? {} });
                            }
                        }
                        fencedSpans.push([fencedMatch.index, fencedMatch.index + fencedMatch[0].length]);
                    } else if (typeof parsed.final === 'string') {
                        // keep final text, but remove the fenced block
                        fencedSpans.push([fencedMatch.index, fencedMatch.index + fencedMatch[0].length]);
                        text = parsed.final;
                    } else if (typeof parsed.name === 'string' && parsed.arguments !== undefined) {
                        foundCalls.push({ name: parsed.name, arguments: parsed.arguments ?? {} });
                        fencedSpans.push([fencedMatch.index, fencedMatch.index + fencedMatch[0].length]);
                    }
                }
            }

            // Remove fenced blocks we consumed
            if (fencedSpans.length > 0) {
                let rebuilt = '';
                let last = 0;
                for (const [start, end] of fencedSpans) {
                    rebuilt += text.slice(last, start);
                    last = end;
                }
                rebuilt += text.slice(last);
                text = rebuilt;
            }

            // b) Extract inline occurrences like {"name":"...","arguments":{...}} possibly multiple times
            // We use a tolerant regex to find candidate JSON objects and then parse/validate.
            const inlineRegex = /{[^{}]*"name"\s*:\s*"[^"]+"\s*,[^{}]*"arguments"\s*:\s*{[\s\S]*?}}/g;
            let inlineMatch: RegExpExecArray | null;
            const inlineSpans: [number, number][] = [];
            while ((inlineMatch = inlineRegex.exec(text)) !== null) {
                const candidate = inlineMatch[0];
                const parsed = tryParse(candidate);
                if (parsed && typeof parsed.name === 'string' && parsed.arguments !== undefined) {
                    foundCalls.push({ name: parsed.name, arguments: parsed.arguments ?? {} });
                    inlineSpans.push([inlineMatch.index, inlineMatch[0].length + inlineMatch.index]);
                }
            }

            // Remove inline blobs
            if (inlineSpans.length > 0) {
                let rebuilt = '';
                let last = 0;
                for (const [start, end] of inlineSpans) {
                    rebuilt += text.slice(last, start);
                    last = end;
                }
                rebuilt += text.slice(last);
                text = rebuilt;
            }

            if (foundCalls.length > 0) {
                parsedToolCalls = foundCalls;
                // If text is just whitespace or tool scaffolding, clear it so we don't post raw artifacts
                if (text && /^\s*[[\](){}"'`.,;:-]*\s*$/.test(text)) {
                    text = '';
                }
            } else if (text) {
                // c) As a last fallback, support contract outside of fenced blocks
                const contractMatch = text.match(/({\s*"tool_calls"\s*:\s*\[[\s\S]*?\]\s*})/);
                if (contractMatch) {
                    const parsed = tryParse(contractMatch[1]);
                    if (parsed && Array.isArray(parsed.tool_calls)) {
                        parsedToolCalls = parsed.tool_calls
                            .filter((tc: any) => tc && typeof tc.name === 'string' && tc.arguments !== undefined)
                            .map((tc: any) => ({ name: tc.name, arguments: tc.arguments ?? {} }));
                        text = text.replace(contractMatch[1], '').trim();
                    }
                } else {
                    // or {"final":"..."}
                    const finalMatch = text.match(/({\s*"final"\s*:\s*"[\s\S]*?"\s*})/);
                    if (finalMatch) {
                        const parsed = tryParse(finalMatch[1]);
                        if (parsed && typeof parsed.final === 'string') {
                            text = parsed.final;
                        }
                    }
                }
            }
        }

        // DEBUG: response summary
        try {
            const hasNative = Array.isArray(toolCalls) && toolCalls.length > 0;
            const hasParsed = Array.isArray(parsedToolCalls) && parsedToolCalls.length > 0;
            const contentPreview = (typeof text === 'string' ? text : '').slice(0, 200).replace(/\s+/g, ' ');
            const toolLoc = Array.isArray((data.choices?.[0]?.message?.tool_calls)) ? 'message' :
                (Array.isArray((data.choices?.[0]?.tool_calls)) ? 'choice' : 'none');
            // console.debug(`[OpenAICompat] RESP model=${this.model()} native_tool_calls=${hasNative ? 'yes' : 'no'} parsed_inline_calls=${hasParsed ? 'yes' : 'no'} tool_calls_location=${toolLoc} content="${contentPreview}"`);
        } catch { }

        // Final minimal cleanup of tool artifacts in provider layer
        if (typeof text === 'string' && text) {
            text = text.replace(/\[(?:END_)?TOOL_(?:REQUEST|RESULT)\]/gi, '').trim();
        }

        return {
            text: text || '',
            toolCalls: (toolCalls && toolCalls.length > 0) ? toolCalls : parsedToolCalls,
            usage: {
                promptTokens: data.usage?.prompt_tokens,
                completionTokens: data.usage?.completion_tokens,
                totalTokens: data.usage?.total_tokens,
            },
        };
    }
}