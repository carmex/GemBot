/*
 * LLM Provider abstraction for multi-backend support (Gemini and OpenAI-compatible)
 */

import { Content, Part } from '@google/generative-ai';

export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LLMMessage {
    role: LLMRole;
    content: string;
    name?: string; // for tool messages
}

export interface LLMTool {
    name: string;
    description: string;
    // JSON Schema-like parameters object (compatible with OpenAI tools/functions and Gemini)
    parameters: Record<string, any>;
}

export interface LLMToolCall {
    name: string;
    arguments: any;
    id?: string;
}

export interface LLMToolResponse {
    name: string;
    response: any;
}

export interface LLMUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}

export interface LLMChatOptions {
    systemPrompt?: string;
    tools?: LLMTool[];
    history?: LLMMessage[] | Content[];
    temperature?: number;
    topP?: number;
    // Provider-specific passthrough
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extra?: Record<string, any>;
}

export interface LLMResult {
    text: string;
    toolCalls?: LLMToolCall[];
    usage?: LLMUsage;
}

export interface LLMProvider {
    name(): string;
    chat(question: string | Part[], options: LLMChatOptions): Promise<LLMResult>;
    countTokens(text: string | Part[]): Promise<number>;
}