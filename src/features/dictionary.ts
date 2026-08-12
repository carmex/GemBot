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

import fetch from 'node-fetch';
import { createProvider } from './llm/provider-factory';

export interface DictionaryDefinition {
    partOfSpeech: string;
    definition: string;
    example?: string;
}

export interface DictionaryEntry {
    word: string;
    pronunciation: string;
    etymology: string;
    demonym: string;
    definitions: DictionaryDefinition[];
}

function cleanPhonetic(raw?: string): string {
    if (!raw) return '';
    return raw.replace(/^\/|\/$/g, '').trim();
}

function parseJsonFromLLM(text: string): any {
    try {
        const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        return JSON.parse(cleaned);
    } catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            try {
                return JSON.parse(text.slice(start, end + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
}

/**
 * Fetches dictionary information for a word or term.
 * Queries Free Dictionary API first, enriching with LLM for etymology/demonym.
 * Falls back to LLM generation if Free Dictionary API fails or 404s.
 */
export async function fetchDictionaryEntry(term: string): Promise<DictionaryEntry | null> {
    const word = term.trim();
    if (!word) return null;

    try {
        const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
        const response = await fetch(url);

        if (response.ok) {
            const data = (await response.json()) as any[];
            if (Array.isArray(data) && data.length > 0) {
                const item = data[0];
                let pronunciation = '';
                if (item.phonetic) {
                    pronunciation = cleanPhonetic(item.phonetic);
                } else if (Array.isArray(item.phonetics)) {
                    for (const p of item.phonetics) {
                        if (p.text) {
                            pronunciation = cleanPhonetic(p.text);
                            if (pronunciation) break;
                        }
                    }
                }
                if (!pronunciation) {
                    pronunciation = 'N/A';
                }

                const definitions: DictionaryDefinition[] = [];
                if (Array.isArray(item.meanings)) {
                    for (const meaning of item.meanings) {
                        const pos = meaning.partOfSpeech || 'noun';
                        if (Array.isArray(meaning.definitions)) {
                            for (const def of meaning.definitions) {
                                if (def.definition) {
                                    definitions.push({
                                        partOfSpeech: pos,
                                        definition: def.definition,
                                        ...(def.example ? { example: def.example } : {})
                                    });
                                }
                            }
                        }
                    }
                }

                if (definitions.length > 0) {
                    let etymology = 'N/A';
                    let demonym = 'N/A';
                    try {
                        const provider = createProvider();
                        const prompt = `Provide concise etymology and demonym for the word or term "${word}".
Return ONLY a JSON object with keys "etymology" (string) and "demonym" (string, or "N/A" if not applicable).`;
                        const res = await provider.chat(prompt, { temperature: 0.2 });
                        const parsed = parseJsonFromLLM(res.text);
                        if (parsed) {
                            if (parsed.etymology) etymology = parsed.etymology;
                            if (parsed.demonym) demonym = parsed.demonym;
                        }
                    } catch (llmErr) {
                        console.warn(`LLM enrichment failed for etymology/demonym of "${word}":`, (llmErr as Error).message);
                    }

                    return {
                        word: item.word || word,
                        pronunciation,
                        etymology,
                        demonym,
                        definitions
                    };
                }
            }
        }
    } catch (apiErr) {
        console.warn(`Free Dictionary API error for "${word}":`, (apiErr as Error).message);
    }

    // Fallback strategy: LLM provider
    try {
        const provider = createProvider();
        const prompt = `Provide dictionary information for the word or term "${word}".
Return ONLY valid JSON matching this structure:
{
  "word": "${word}",
  "pronunciation": "IPA notation string (or N/A)",
  "etymology": "historical origin/roots (or N/A)",
  "demonym": "demonym for place/people (or N/A)",
  "definitions": [
    {
      "partOfSpeech": "part of speech",
      "definition": "clear definition",
      "example": "optional example sentence"
    }
  ]
}`;
        const res = await provider.chat(prompt, { temperature: 0.2 });
        const parsed = parseJsonFromLLM(res.text);

        if (parsed && Array.isArray(parsed.definitions) && parsed.definitions.length > 0) {
            return {
                word: parsed.word || word,
                pronunciation: cleanPhonetic(parsed.pronunciation || 'N/A') || 'N/A',
                etymology: parsed.etymology || 'N/A',
                demonym: parsed.demonym || 'N/A',
                definitions: parsed.definitions.map((d: any) => ({
                    partOfSpeech: d.partOfSpeech || 'noun',
                    definition: d.definition || '',
                    ...(d.example ? { example: d.example } : {})
                })).filter((d: DictionaryDefinition) => d.definition.length > 0)
            };
        }
    } catch (llmErr) {
        console.error(`LLM fallback failed for dictionary entry of "${word}":`, (llmErr as Error).message);
    }

    return null;
}

/**
 * Generates an image prompt depicting a visual scene based on a dictionary entry.
 * Uses LLM prompt engineering to focus on living scenes and prevent depicting the target word itself or printing the literal definition.
 */
export async function generateDictionaryImagePrompt(entry: DictionaryEntry): Promise<string> {
    const primaryDefinition = entry.definitions?.[0]?.definition || entry.word || 'concept';
    const fallbackPrompt = `A vivid visual scene portraying: ${primaryDefinition}, artistic style, dynamic environment, do not include the word itself or print the literal definition in the image`;

    try {
        const provider = createProvider();
        const definitionsStr = entry.definitions && entry.definitions.length > 0
            ? entry.definitions.map(d => `(${d.partOfSpeech}) ${d.definition}`).join('; ')
            : 'No definition provided';

        const prompt = `You are an expert prompt engineer for AI image generation.
Generate a detailed image prompt depicting a living visual scene that demonstrates the meaning of the word "${entry.word}".

Word details:
- Word: ${entry.word}
- Definitions: ${definitionsStr}
${entry.etymology && entry.etymology !== 'N/A' ? `- Etymology: ${entry.etymology}\n` : ''}

Strict Prompting Rules:
1. NEGATIVE CONSTRAINTS: ABSOLUTELY NO including the target word itself, written text of the word, or printing the literal definition in the image description.
2. POSITIVE CONSTRAINTS: Focus entirely on an action, environment, or characters actively demonstrating the concept in a living, dynamic scene.
3. ARTISTIC FREEDOM: Feel free to use artistic license (cinematic, surrealism, painterly, fantasy, vibrant digital art, abstract, or realistic).
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
        console.warn(`Failed to generate LLM dictionary image prompt for "${entry.word}":`, (err as Error).message);
    }

    return fallbackPrompt;
}

