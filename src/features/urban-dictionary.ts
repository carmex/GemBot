import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { createProvider } from './llm/provider-factory';
import { markdownToSlack } from './utils';

export interface UrbanDefinition {
    word: string;
    definition: string;
    example: string;
    thumbs_up: number;
    thumbs_down: number;
    permalink: string;
}

interface VoteData {
    up: number;
    down: number;
}

interface VoteResponse {
    votes: {
        [defid: string]: VoteData;
    };
}

/**
 * Fetches definitions from Urban Dictionary for a given term by scraping the website.
 * This is necessary because the public API currently returns 0 for vote counts.
 * @param term The search term.
 * @returns Top 3 definitions sorted by popularity.
 */
export async function fetchUrbanDefinitions(term: string): Promise<UrbanDefinition[]> {
    const baseUrl = 'https://www.urbandictionary.com';
    const url = `${baseUrl}/define.php?term=${encodeURIComponent(term)}`;
    
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`Urban Dictionary website error: ${response.statusText}`);
        }
        
        const html = await response.text();
        const dom = new JSDOM(html);
        const { document } = dom.window;
        
        const definitionElements = document.querySelectorAll('.definition');
        if (definitionElements.length === 0) {
            return [];
        }

        const body = document.querySelector('body');
        const voteSignature = body?.getAttribute('data-vote-signature');
        const voteDefidsStr = body?.getAttribute('data-vote-defids');
        const voteDefids: number[] = voteDefidsStr ? JSON.parse(voteDefidsStr) : [];

        let votes: { [defid: string]: VoteData } = {};
        if (voteSignature && voteDefids.length > 0) {
            try {
                const voteUrl = `${baseUrl}/api/vote?defids=${voteDefids.join(',')}&signature=${voteSignature}`;
                const voteResponse = await fetch(voteUrl);
                if (voteResponse.ok) {
                    const voteData = (await voteResponse.json()) as VoteResponse;
                    votes = voteData.votes;
                }
            } catch (voteError) {
                console.error('Error fetching votes from Urban Dictionary API:', voteError);
            }
        }

        const definitions: (UrbanDefinition & { defid: string })[] = [];

        definitionElements.forEach((el) => {
            const defid = el.getAttribute('data-defid') || '';
            const word = el.querySelector('.word')?.textContent?.trim() || '';
            const meaning = el.querySelector('.meaning')?.textContent?.trim() || '';
            const example = el.querySelector('.example')?.textContent?.trim() || '';
            
            if (defid && word) {
                const voteInfo = votes[defid] || { up: 0, down: 0 };
                definitions.push({
                    defid,
                    word,
                    definition: meaning,
                    example: example,
                    thumbs_up: voteInfo.up,
                    thumbs_down: voteInfo.down,
                    permalink: `${baseUrl}/define.php?term=${encodeURIComponent(word)}&defid=${defid}`
                });
            }
        });
        
        // Sort by thumbs_up in descending order and take the top 3
        return definitions
            .sort((a, b) => b.thumbs_up - a.thumbs_up)
            .slice(0, 3)
            .map(({ defid, ...rest }) => rest);
            
    } catch (error) {
        console.error('Error fetching Urban Dictionary definitions:', error);
        throw error;
    }
}

/**
 * Formats Urban Dictionary definitions into a Slack-friendly markdown string.
 */
export function formatUrbanDefinitions(searchTerm: string, definitions: UrbanDefinition[]): string {
    let responseText = `*Urban Dictionary: ${searchTerm}*\n\n`;

    for (const item of definitions) {
        // Remove Urban Dictionary cross-reference brackets [word] -> word
        const cleanDefinition = item.definition.replace(/\[/g, '').replace(/\]/g, '');
        const cleanExample = item.example.replace(/\[/g, '').replace(/\]/g, '');

        responseText += `*${item.word}*\n`;
        responseText += `${markdownToSlack(cleanDefinition)}\n`;
        if (cleanExample) {
            responseText += `_Example: ${markdownToSlack(cleanExample)}_\n`;
        }
        responseText += `👍 ${item.thumbs_up}  👎 ${item.thumbs_down}\n\n`;
    }

    return responseText.trim();
}

/**
 * Generates an image prompt depicting a visual scene based on an Urban Dictionary entry.
 * Uses LLM prompt engineering to focus on living scenes and prevent depicting the target word itself or printing the literal definition.
 */
export async function generateUrbanImagePrompt(searchTerm: string, definitions: UrbanDefinition[]): Promise<string> {
    const topDef = definitions[0];
    const primaryWord = topDef?.word || searchTerm;
    const primaryDefinition = topDef?.definition
        ? topDef.definition.replace(/\[/g, '').replace(/\]/g, '').trim()
        : primaryWord;

    const fallbackPrompt = `A vivid visual scene portraying: ${primaryDefinition}, artistic style, dynamic environment, do not include the word itself or print the literal definition in the image`;

    try {
        const provider = createProvider();
        const definitionsStr = definitions.slice(0, 3).map((d, index) => {
            const cleanDef = d.definition.replace(/\[/g, '').replace(/\]/g, '').trim();
            const cleanEx = d.example ? ` (Example: ${d.example.replace(/\[/g, '').replace(/\]/g, '').trim()})` : '';
            return `${index + 1}. ${cleanDef}${cleanEx}`;
        }).join('\n');

        const prompt = `You are an expert prompt engineer for AI image generation.
Generate a detailed image prompt depicting a living visual scene that demonstrates the slang or colloquial meaning of the term "${primaryWord}".

Urban Dictionary details:
- Term: ${primaryWord}
- Top Definitions & Examples:
${definitionsStr}

Strict Prompting Rules:
1. NEGATIVE CONSTRAINTS: ABSOLUTELY NO including the target word itself, written text of the word, or printing the literal definition in the image description.
2. POSITIVE CONSTRAINTS: Focus entirely on an action, environment, or characters actively demonstrating the concept or situation in a living, dynamic scene.
3. ARTISTIC FREEDOM: Feel free to use artistic license (cinematic, humor, surrealism, painterly, vibrant digital art, or realistic).
4. OUTPUT FORMAT: Output ONLY the raw image prompt text. Do not include quotes, intro/outro text, labels, or markdown formatting.`;

        const res = await provider.chat(prompt, { temperature: 0.7 });
        if (res && res.text) {
            let cleaned = res.text.trim();
            cleaned = cleaned.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
            cleaned = cleaned.replace(/^["']|["']$/g, '').trim();
            if (cleaned.length > 0) {
                return cleaned;
            }
        }
    } catch (err) {
        console.warn(`Failed to generate LLM urban dictionary image prompt for "${primaryWord}":`, (err as Error).message);
    }

    return fallbackPrompt;
}
