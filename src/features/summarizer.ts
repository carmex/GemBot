import fs from 'fs';
import { Content } from '@google/generative-ai';

export class Summarizer {
    private provider: any;
    private config: any;
    private threadSummariesFilePath: string;
    private summarizationSystemPrompt: string;

    constructor(provider: any, config: any, threadSummariesFilePath: string, summarizationSystemPrompt: string) {
        this.provider = provider;
        this.config = config;
        this.threadSummariesFilePath = threadSummariesFilePath;
        this.summarizationSystemPrompt = summarizationSystemPrompt;
    }

    public loadThreadSummary(threadId: string): any {
        if (fs.existsSync(this.threadSummariesFilePath)) {
            try {
                const data = fs.readFileSync(this.threadSummariesFilePath, 'utf-8');
                const summaries = JSON.parse(data);
                return summaries[threadId] || null;
            } catch (error) {
                console.error(`[Summary] Error loading thread summaries:`, error);
                return null;
            }
        }
        return null;
    }

    public saveThreadSummary(threadId: string, summary: string, metadata: any = {}): void {
        let summaries: { [key: string]: any } = {};
        if (fs.existsSync(this.threadSummariesFilePath)) {
            try {
                const data = fs.readFileSync(this.threadSummariesFilePath, 'utf-8');
                summaries = JSON.parse(data);
            } catch (error) {
                console.error(`[Summary] Error loading existing summaries:`, error);
            }
        }

        summaries[threadId] = {
            summary,
            lastUpdated: new Date().toISOString(),
            ...metadata
        };

        try {
            fs.writeFileSync(this.threadSummariesFilePath, JSON.stringify(summaries, null, 2), 'utf-8');
        } catch (error) {
            console.error(`[Summary] Error saving thread summary for ${threadId}:`, error);
        }
    }

    public async summarizeConversation(messages: Content[], threadId: string): Promise<string> {
        if (!messages || messages.length === 0) {
            return "No conversation history to summarize.";
        }

        // Convert messages to text format for summarization
        const conversationText = messages.map(msg => {
            const role = msg.role === 'model' ? 'Assistant' : 'User';
            const content = msg.parts?.[0]?.text || '';
            return `${role}: ${content}`;
        }).join('\n\n');

        const summaryPrompt = `${this.summarizationSystemPrompt}
${conversationText}`;

        try {
            const result = await this.provider.chat(summaryPrompt, {
                systemPrompt: "You are a helpful assistant that summarizes conversations clearly and concisely."
            });

            const summary = result.text || "Summary could not be generated.";
            console.log(`[Summary] Generated summary for thread ${threadId}: ${summary.length} characters`);

            return summary;
        } catch (error) {
            console.error(`[Summary] Error summarizing conversation for thread ${threadId}:`, error);
            return "Error generating summary.";
        }
    }

    public async summarizeText(text: string, originalQuestion: string): Promise<string> {
        // Simple character-based chunking with a safety margin.
        const chunkSize = Math.floor(this.config.openai.maxContextSize * 2.5); // 2.5 chars/token is a safer estimate
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += chunkSize) {
            chunks.push(text.substring(i, i + chunkSize));
        }

        const summaries: string[] = [];
        // Process chunks sequentially to avoid overwhelming the local server.
        for (let index = 0; index < chunks.length; index++) {
            const chunk = chunks[index];
            const prompt = `Please summarize the following text chunk:\n\n---\n${chunk}\n---`;

            try {
                const result = await this.provider.chat(prompt, {
                    systemPrompt: "You are a summarization assistant.",
                });
                summaries.push(result.text);
            } catch (e) {
                console.error(`[Summarizer] Error summarizing chunk ${index + 1}:`, e);
                // Optionally skip the chunk or add an error message.
                summaries.push(`[Error summarizing this chunk: ${(e as Error).message}]`);
            }
        }

        const combinedSummaries = summaries.join('\n\n---\n\n');
        const finalPrompt = `Based on the following summaries of a document, please provide a final answer to the user's original question.\n\nOriginal question: ${originalQuestion}\n\nSummaries:\n---\n${combinedSummaries}\n---`;

        const finalResult = await this.provider.chat(finalPrompt, {
            systemPrompt: "You are a helpful assistant that synthesizes information."
        });

        return finalResult.text;
    }
}