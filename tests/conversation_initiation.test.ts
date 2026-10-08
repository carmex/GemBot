import { HistoryBuilder } from '../src/features/history-builder';
import { toGeminiHistory } from '../src/features/llm/providers/gemini';
import { toOpenAIMessages, normalizeOpenAIMessages } from '../src/features/llm/providers/openai-compatible';
import { LLMMessage } from '../src/features/llm/providers/types';
import { Content } from '@google/generative-ai';

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`FAILED: ${message}`);
        throw new Error(`Test failed: ${message}`);
    }
    console.log(`PASSED: ${message}`);
}

async function runTests() {
    console.log('=== Running Conversation Initiation & Role Alternation Tests ===\n');

    // -------------------------------------------------------------
    // Test Case 1: Single user message history (e.g. initiating conversation in thread)
    // -------------------------------------------------------------
    console.log('--- Test Case 1: Single user message history ---');
    const singleUserMsg: LLMMessage[] = [{ role: 'user', content: 'What is 2+2?' }];
    const res1 = toGeminiHistory(singleUserMsg);
    assert(res1.length === 2, 'Single user message history should normalize to 2 turns [user, model]');
    assert(res1[0].role === 'user', 'res1[0] role should be user');
    assert(res1[0].parts[0].text === 'What is 2+2?', 'res1[0] text should match original user question');
    assert(res1[1].role === 'model', 'res1[1] role should be model');
    assert(res1[1].parts[0].text === '[Acknowledged]', 'res1[1] text should be [Acknowledged]');

    // -------------------------------------------------------------
    // Test Case 2: Multiple consecutive user messages history
    // -------------------------------------------------------------
    console.log('\n--- Test Case 2: Multiple consecutive user messages history ---');
    const multipleUserMsgs: LLMMessage[] = [
        { role: 'user', content: 'First user message' },
        { role: 'user', content: 'Second user message' },
        { role: 'user', content: 'Third user message' },
    ];
    const res2 = toGeminiHistory(multipleUserMsgs);
    assert(res2.length === 2, 'Multiple consecutive user messages should merge into 1 user turn + 1 model turn');
    assert(res2[0].role === 'user', 'res2[0] role should be user');
    assert(res2[0].parts.length === 3, 'res2[0] should contain 3 parts merged from the 3 user messages');
    assert(res2[0].parts[0].text === 'First user message', 'res2[0].parts[0] text matches first message');
    assert(res2[0].parts[1].text === 'Second user message', 'res2[0].parts[1] text matches second message');
    assert(res2[0].parts[2].text === 'Third user message', 'res2[0].parts[2] text matches third message');
    assert(res2[1].role === 'model', 'res2[1] role should be model');
    assert(res2[1].parts[0].text === '[Acknowledged]', 'res2[1] should be [Acknowledged]');

    // -------------------------------------------------------------
    // Test Case 3: Consecutive model messages
    // -------------------------------------------------------------
    console.log('\n--- Test Case 3: Consecutive model messages ---');
    const multipleModelMsgs: LLMMessage[] = [
        { role: 'assistant', content: 'Model reply 1' },
        { role: 'assistant', content: 'Model reply 2' },
    ];
    const res3 = toGeminiHistory(multipleModelMsgs);
    assert(res3.length === 2, 'Consecutive model messages should prepend 1 user turn + 1 merged model turn');
    assert(res3[0].role === 'user', 'res3[0] role should be user');
    assert(res3[0].parts[0].text === '[User request]', 'res3[0] text should be [User request]');
    assert(res3[1].role === 'model', 'res3[1] role should be model');
    assert(res3[1].parts.length === 2, 'res3[1] should contain 2 parts merged from the 2 model messages');
    assert(res3[1].parts[0].text === 'Model reply 1', 'res3[1].parts[0] text matches reply 1');
    assert(res3[1].parts[1].text === 'Model reply 2', 'res3[1].parts[1] text matches reply 2');

    // -------------------------------------------------------------
    // Test Case 4: Mixed histories ending in user turn ([user, model, user])
    // -------------------------------------------------------------
    console.log('\n--- Test Case 4: Mixed histories ending in user turn ---');
    const mixedEndingInUser: Content[] = [
        { role: 'user', parts: [{ text: 'Question 1' }] },
        { role: 'model', parts: [{ text: 'Answer 1' }] },
        { role: 'user', parts: [{ text: 'Question 2' }] },
    ];
    const res4 = toGeminiHistory(mixedEndingInUser);
    assert(res4.length === 4, 'History [user, model, user] should normalize to [user, model, user, model]');
    assert(res4[0].role === 'user' && res4[0].parts[0].text === 'Question 1', 'res4[0] matches Question 1');
    assert(res4[1].role === 'model' && res4[1].parts[0].text === 'Answer 1', 'res4[1] matches Answer 1');
    assert(res4[2].role === 'user' && res4[2].parts[0].text === 'Question 2', 'res4[2] matches Question 2');
    assert(res4[3].role === 'model' && res4[3].parts[0].text === '[Acknowledged]', 'res4[3] is [Acknowledged]');

    // -------------------------------------------------------------
    // Test Case 5: Empty and invalid histories
    // -------------------------------------------------------------
    console.log('\n--- Test Case 5: Empty and invalid histories ---');
    assert(toGeminiHistory(undefined).length === 0, 'undefined history returns empty array');
    assert(toGeminiHistory([]).length === 0, 'empty array history returns empty array');
    assert(toGeminiHistory([{ role: 'user', content: '   ' }]).length === 0, 'whitespace only message returns empty array');
    assert(toGeminiHistory([{ role: 'user', parts: [{ text: '' }] }]).length === 0, 'empty text parts returns empty array');

    const emptyAndValid: Content[] = [
        { role: 'user', parts: [{ text: '   ' }] },
        { role: 'model', parts: [{ text: 'Valid model response' }] },
    ];
    const res5 = toGeminiHistory(emptyAndValid);
    assert(res5.length === 2, 'Empty user part filtered -> only model turn -> prepended [User request]');
    assert(res5[0].role === 'user' && res5[0].parts[0].text === '[User request]', 'res5[0] is [User request]');
    assert(res5[1].role === 'model' && res5[1].parts[0].text === 'Valid model response', 'res5[1] is model response');

    // -------------------------------------------------------------
    // Test Case 6: Multimodal history (text + image inlineData)
    // -------------------------------------------------------------
    console.log('\n--- Test Case 6: Multimodal history parts preservation ---');
    const multimodalTurns: Content[] = [
        {
            role: 'user',
            parts: [
                { text: 'Look at this chart' },
                { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' } }
            ]
        },
        {
            role: 'user',
            parts: [
                { text: 'What do you think?' }
            ]
        }
    ];
    const res6 = toGeminiHistory(multimodalTurns);
    assert(res6.length === 2, 'Consecutive multimodal user turns should merge into 1 user turn + 1 model acknowledgment');
    assert(res6[0].role === 'user', 'res6[0] role should be user');
    assert(res6[0].parts.length === 3, 'res6[0] should have 3 parts (text, image, text)');
    assert(res6[0].parts[0].text === 'Look at this chart', 'res6[0].parts[0] text matches');
    assert(!!(res6[0].parts[1] as any).inlineData, 'res6[0].parts[1] image inlineData is preserved');
    assert(res6[0].parts[2].text === 'What do you think?', 'res6[0].parts[2] text matches');
    assert(res6[1].role === 'model' && res6[1].parts[0].text === '[Acknowledged]', 'res6[1] is model acknowledgment');

    // -------------------------------------------------------------
    // Test Case 7: HistoryBuilder integration with mocked Slack client
    // -------------------------------------------------------------
    console.log('\n--- Test Case 7: HistoryBuilder integration ---');
    const mockApp: any = {};
    const mockImageGenerator: any = {
        processImagePublic: async () => ({ inlineData: { mimeType: 'image/png', data: 'fake' } }),
        processImageFromUrl: async () => ({ inlineData: { mimeType: 'image/png', data: 'fake' } })
    };
    const mockSummarizer: any = {
        loadThreadSummary: () => null
    };
    const mockConfig: any = {
        summarization: { maxRecentMessages: 50 },
        channelHistoryLimit: 20
    };

    const historyBuilder = new HistoryBuilder(
        mockApp,
        mockImageGenerator,
        mockSummarizer,
        mockConfig
    );

    // Thread with only user messages (e.g. user mentions bot in an existing discussion)
    const mockThreadClient: any = {
        conversations: {
            replies: async () => ({
                ok: true,
                messages: [
                    { ts: '100.1', user: 'U1', text: 'Hey team, did anyone see the release notes?' },
                    { ts: '100.2', user: 'U2', text: 'Yes, looking at them now.' },
                    { ts: '100.3', user: 'U3', text: '<@UBOT> can you summarize this thread?' }
                ]
            })
        },
        users: {
            info: async () => ({ ok: false })
        }
    };

    const threadHistory = await historyBuilder.buildHistoryFromThread('C1', '100.1', '100.3', mockThreadClient, 'UBOT');
    assert(threadHistory.length === 2, 'threadHistory should contain the 2 prior user messages');
    const normalizedThreadHistory = toGeminiHistory(threadHistory);
    assert(normalizedThreadHistory.length === 2, 'normalizedThreadHistory should have 2 turns [user, model]');
    assert(normalizedThreadHistory[0].role === 'user', 'normalizedThreadHistory[0] is user');
    assert(normalizedThreadHistory[0].parts.length === 2, 'normalizedThreadHistory[0] has 2 parts merged');
    assert(normalizedThreadHistory[1].role === 'model', 'normalizedThreadHistory[1] is model acknowledgment');

    // Channel history starting with bot message
    const mockChannelClient: any = {
        conversations: {
            history: async () => ({
                ok: true,
                messages: [
                    { ts: '200.2', user: 'U1', text: '<@UBOT> what is next?' },
                    { ts: '200.1', bot_id: 'B1', text: 'Bot initial channel greeting' }
                ]
            })
        },
        users: {
            info: async () => ({ ok: false })
        }
    };

    const channelHistory = await historyBuilder.buildHistoryFromChannel('C1', '200.2', mockChannelClient, 'UBOT');
    assert(channelHistory.length >= 2, 'channelHistory should prepend user prompt if starting with bot message');
    assert(channelHistory[0].role === 'user', 'channelHistory[0] should be user role');
    assert(channelHistory[1].role === 'model', 'channelHistory[1] should be model role');

    const normalizedChannelHistory = toGeminiHistory(channelHistory);
    assert(normalizedChannelHistory[0].role === 'user', 'normalizedChannelHistory[0] is user');
    assert(normalizedChannelHistory[1].role === 'model', 'normalizedChannelHistory[1] is model');

    // -------------------------------------------------------------
    // Test Case 8: OpenAI-compatible messages normalization
    // -------------------------------------------------------------
    console.log('\n--- Test Case 8: OpenAI-compatible messages normalization ---');
    const openAIMsgs = normalizeOpenAIMessages([
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User msg 1' },
        { role: 'user', content: 'User msg 2' },
        { role: 'user', content: '   ' }, // empty message to filter
        { role: 'assistant', content: 'Assistant reply 1' },
        { role: 'assistant', content: 'Assistant reply 2' },
        { role: 'user', content: 'User msg 3' }
    ]);

    assert(openAIMsgs.length === 4, 'openAIMsgs should merge consecutive user/assistant and filter empty (system, user, assistant, user)');
    assert(openAIMsgs[0].role === 'system' && openAIMsgs[0].content === 'System prompt', 'openAIMsgs[0] is system');
    assert(openAIMsgs[1].role === 'user' && openAIMsgs[1].content === 'User msg 1\n\nUser msg 2', 'openAIMsgs[1] merges user msgs');
    assert(openAIMsgs[2].role === 'assistant' && openAIMsgs[2].content === 'Assistant reply 1\n\nAssistant reply 2', 'openAIMsgs[2] merges assistant replies');
    assert(openAIMsgs[3].role === 'user' && openAIMsgs[3].content === 'User msg 3', 'openAIMsgs[3] is user msg 3');

    // Test toOpenAIMessages with options.history and question
    const fullOpenAIMsgs = toOpenAIMessages('Final user question', {
        systemPrompt: 'System instructions',
        history: [
            { role: 'user', content: 'Previous user query' }
        ]
    });
    assert(fullOpenAIMsgs.length === 2, 'toOpenAIMessages should merge history user query with current question');
    assert(fullOpenAIMsgs[0].role === 'system' && fullOpenAIMsgs[0].content === 'System instructions', 'System prompt present');
    assert(fullOpenAIMsgs[1].role === 'user' && fullOpenAIMsgs[1].content === 'Previous user query\n\nFinal user question', 'User queries merged');

    console.log('\n======================================================');
    console.log('All Conversation Initiation & Alternation tests PASSED!');
    console.log('======================================================\n');
}

runTests().catch((err) => {
    console.error('Unhandled error in tests:', err);
    process.exit(1);
});
