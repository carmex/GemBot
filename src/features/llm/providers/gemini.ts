
/*
 * GeminiProvider: adapts Google Generative AI to the LLMProvider interface
 */
import { GoogleGenerativeAI, Content, HarmCategory, HarmBlockThreshold, FunctionDeclaration, Tool, SchemaType, Part } from '@google/generative-ai';
import { config } from '../../../config';
import { LLMChatOptions, LLMMessage, LLMProvider, LLMResult, LLMTool } from './types';

function toGeminiHistory(history: LLMMessage[] | Content[] | undefined): Content[] {
    if (!history || history.length === 0) return [];
    if (history[0] && 'parts' in history[0]) {
        // Already Content[], return as is
        const contentHistory = history as Content[];
        const totalImageParts = contentHistory.reduce((acc, h) => acc + (h.parts?.filter(p => !!p.inlineData)?.length || 0), 0);
        console.log(`[Debug-Gemini] toGeminiHistory: Already Content[] with ${contentHistory.length} entries, total image parts: ${totalImageParts}`);
        return contentHistory;
    }
    // Map LLMMessage to Content
    return (history as LLMMessage[]).map((m) => {
        if (m.role === 'user') {
            return { role: 'user', parts: [{ text: m.content }] };
        } else if (m.role === 'assistant') {
            return { role: 'model', parts: [{ text: m.content }] };
        } else if (m.role === 'system') {
            // System prompt already passed separately; include as model content to keep chronology if provided
            return { role: 'model', parts: [{ text: m.content }] };
        } else if (m.role === 'tool') {
            // Provider orchestration typically injects tool results back as tool messages;
            // Gemini expects functionResponse parts in a follow-up send, but we can include as model text contextually.
            return { role: 'model', parts: [{ text: m.content }] };
        }
        return { role: 'user', parts: [{ text: m.content }] };
    });
}

function toGeminiFunctions(tools: LLMTool[] | undefined): FunctionDeclaration[] | undefined {
    if (!tools || tools.length === 0) return undefined;
    // Strictly coerce to Gemini FunctionDeclaration schema
    return tools.map((t) => {
        const params = t.parameters || {};
        const properties = params.properties || {};
        const required = params.required || [];
        return {
            name: t.name,
            description: t.description,
            parameters: {
                type: SchemaType.OBJECT,
                properties,
                required,
            },
        } as FunctionDeclaration;
    });
}

export class GeminiProvider implements LLMProvider {
    private client: GoogleGenerativeAI;

    constructor() {
        this.client = new GoogleGenerativeAI(config.gemini.apiKey);
    }

    name(): string {
        return 'gemini';
    }

    async countTokens(text: string | Part[]): Promise<number> {
        const model = this.client.getGenerativeModel({ model: config.gemini.model });
        const { totalTokens } = await model.countTokens(text);
        return totalTokens;
    }

    async chat(question: string | Part[], options: LLMChatOptions): Promise<LLMResult> {
        const systemInstruction = options.systemPrompt || '';
        const functionDeclarations = toGeminiFunctions(options.tools) || [];

        // Build tools array if any functions exist
        const tools: Tool[] | undefined =
            functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;

        const model = this.client.getGenerativeModel({
            model: config.gemini.model,
            systemInstruction,
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            ],
        });

        const geminiHistory = toGeminiHistory(options.history);
        const totalImageParts = geminiHistory.reduce((acc, h) => acc + (h.parts?.filter(p => !!p.inlineData)?.length || 0), 0);
        console.log(`[Debug-Gemini] chat: Passing history with ${geminiHistory.length} entries, ${totalImageParts} image parts to startChat`);

        const chat = model.startChat({
            tools,
            history: geminiHistory,
        });

        const questionText = typeof question === 'string' ? question : '[Multimodal Content]';
        console.log(`[Debug-Gemini] Sending message: "${questionText.substring(0, 100)}..." with history containing ${totalImageParts} image parts`);
        const result = await chat.sendMessage(question);
        console.log(`[Debug-Gemini] Response received; text preview: "${(typeof (result.response as any).text === 'function' ? (result.response as any).text().substring(0, 200) : '').replace(/\n/g, ' ')}"`);

        // Parse tool calls, if any
        const toolCalls = result.response.functionCalls()?.map((fc) => ({
            name: fc.name,
            arguments: fc.args,
        }));

        const usage = result.response.usageMetadata
            ? {
                promptTokens: result.response.usageMetadata.promptTokenCount,
                completionTokens: result.response.usageMetadata.candidatesTokenCount,
                totalTokens: result.response.usageMetadata.totalTokenCount,
            }
            : undefined;

        const text = typeof (result.response as any).text === 'function' ? (result.response as any).text() : '';

        return {
            text: text || '',
            toolCalls,
            usage,
        };
    }
}