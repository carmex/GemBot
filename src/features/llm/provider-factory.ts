/*
 * Provider factory: selects LLM provider based on configuration
 */
import {config} from '../../config';
import {LLMProvider} from './providers/types';
import {GeminiProvider} from './providers/gemini';
import {OpenAICompatibleProvider} from './providers/openai-compatible';

export function createProvider(): LLMProvider {
    const provider = config.ai.provider;
    if (provider === 'gemini') {
        if (!config.gemini.apiKey) {
            throw new Error('AI provider "gemini" selected but GEMINI_API_KEY is missing.');
        }
        return new GeminiProvider();
    }

    // openai-compatible
    if (!config.openai.baseUrl) {
        throw new Error('AI provider "openai" selected but OPENAI_BASE_URL is missing.');
    }
    return new OpenAICompatibleProvider();
}

export function providerHealth(): {ok: boolean; reason?: string} {
    try {
        createProvider();
        return {ok: true};
    } catch (e) {
        return {ok: false, reason: (e as Error).message};
    }
}