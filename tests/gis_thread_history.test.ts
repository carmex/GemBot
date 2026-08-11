import { HistoryBuilder } from '../src/features/history-builder';
import { toGeminiHistory } from '../src/features/llm/providers/gemini';
import { LLMMessage } from '../src/features/llm/providers/types';

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`FAILED: ${message}`);
        throw new Error(`Test failed: ${message}`);
    }
    console.log(`PASSED: ${message}`);
}

async function runTests() {
    console.log("Running GIS Thread History Tests...");

    const mockApp: any = {};
    const mockImageGenerator: any = {
        processImagePublic: async () => ({ inlineData: { mimeType: 'image/png', data: 'fake' } })
    };
    const mockSummarizer: any = {
        loadThreadSummary: () => null
    };
    const mockConfig: any = {
        summarization: {
            maxRecentMessages: 50
        }
    };

    const historyBuilder = new HistoryBuilder(
        mockApp,
        mockImageGenerator,
        mockSummarizer,
        mockConfig
    );

    const channel = 'C_TEST';
    const threadTs = '1000.0001';
    const triggerTs = '1000.0002';
    const botUserId = 'U_BOT';

    const mockClient: any = {
        conversations: {
            replies: async ({ channel, ts }: any) => {
                return {
                    ok: true,
                    messages: [
                        {
                            ts: '1000.0001',
                            bot_id: 'B123',
                            text: 'https://example.com/cat.png'
                        },
                        {
                            ts: '1000.0002',
                            user: 'U_USER',
                            text: '<@U_BOT> tell me more about this image'
                        }
                    ]
                };
            }
        },
        users: {
            info: async () => ({ ok: false })
        }
    };

    // Call buildHistoryFromThread
    const history = await historyBuilder.buildHistoryFromThread(channel, threadTs, triggerTs, mockClient, botUserId);

    // 3. Assert history[0].role === 'user' and contains the auto-inserted user prompt
    assert(history.length >= 2, "History should have at least 2 entries");
    assert(history[0].role === 'user', "history[0].role should be 'user'");
    assert(
        !!history[0].parts[0].text?.includes('[User requested image or action]'),
        "history[0] should contain auto-inserted user prompt '[User requested image or action]'"
    );

    // 4. Assert history[1].role === 'model' containing the bot image URL text
    assert(history[1].role === 'model', "history[1].role should be 'model'");
    assert(
        history[1].parts[0].text === 'https://example.com/cat.png',
        "history[1] should contain the bot image URL text 'https://example.com/cat.png'"
    );

    // 5. Verify toGeminiHistory(history) produces valid Content[] where [0].role === 'user'
    const geminiHistory = toGeminiHistory(history);
    assert(geminiHistory.length >= 2, "toGeminiHistory output should have at least 2 entries");
    assert(geminiHistory[0].role === 'user', "geminiHistory[0].role should be 'user'");
    assert(geminiHistory[1].role === 'model', "geminiHistory[1].role should be 'model'");

    // Test secondary fail-safe in toGeminiHistory with raw model history
    const rawModelHistory: LLMMessage[] = [
        { role: 'assistant', content: 'Model initial message' }
    ];
    const fallbackHistory = toGeminiHistory(rawModelHistory);
    assert(fallbackHistory.length === 2, "fallbackHistory should have 2 entries");
    assert(fallbackHistory[0].role === 'user', "fallbackHistory[0].role should be 'user'");
    assert(fallbackHistory[0].parts[0].text === '[User request]', "fallbackHistory[0] should have '[User request]'");
    assert(fallbackHistory[1].role === 'model', "fallbackHistory[1].role should be 'model'");

    console.log("\nAll GIS Thread History tests passed!");
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
