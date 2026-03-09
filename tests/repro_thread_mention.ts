
import { registerEventListeners } from '../src/listeners/events';
import { AIHandler } from '../src/features/ai-handler';

async function runReproduction() {
    console.log("Running Reproduction: Thread Mention Issue...");

    let appMentionHandler: any = null;
    let messageHandler: any = null;

    const mockApp: any = {
        event: (name: string, handler: any) => {
            if (name === 'app_mention') appMentionHandler = handler;
        },
        message: (middleware: any, handler: any) => {
            messageHandler = handler;
        }
    };

    const mockAIHandler: any = {
        enabledChannels: new Set(),
        rpgEnabledChannels: new Map(),
        disabledThreads: new Set(),
        lastWarningTimestamp: new Map(),
        historyBuilder: {
            buildHistoryFromThread: async () => []
        },
        processAIQuestion: async () => ({ text: 'Mock Response' }),
        loadThreadSummary: () => null,
        saveThreadSummary: () => {}
    };

    // Register handlers
    registerEventListeners(mockApp, mockAIHandler);

    if (!appMentionHandler || !messageHandler) {
        console.error("FAILED: Handlers not registered correctly");
        process.exit(1);
    }

    const channel = 'C123';
    const threadTs = '1234567890.000001';
    const messageTs = '1234567890.000002';
    const botUserId = 'U_BOT';
    const user = 'U_USER';
    const text = `<@${botUserId}> hello in thread`;

    let sayCalls: any[] = [];
    const mockSay = async (args: any) => { sayCalls.push(args); };
    const mockClient: any = {
        reactions: { add: async () => {} }
    };

    // 1. Simulate message event first (the "thief" that steals the ts)
    console.log("Simulating 'message' event first...");
    await messageHandler({
        message: {
            channel,
            ts: messageTs,
            thread_ts: threadTs,
            user,
            text
        },
        context: { botUserId },
        say: mockSay,
        client: mockClient
    });

    console.log(`'say' calls after message event: ${sayCalls.length}`);

    // 2. Simulate 'app_mention' event (the "rightful" handler)
    console.log("Simulating 'app_mention' event second...");
    await appMentionHandler({
        event: {
            channel,
            ts: messageTs,
            thread_ts: threadTs,
            user,
            text
        },
        context: { botUserId },
        say: mockSay,
        client: mockClient
    });

    console.log(`'say' calls after app_mention event: ${sayCalls.length}`);

    if (sayCalls.length === 0) {
        console.log("\nSUCCESS: Reproduced the bug! No response was sent.");
    } else {
        console.log(`\nFAILURE: Response was sent (${sayCalls.length} calls). Could not reproduce.`);
    }
}

runReproduction().catch(err => {
    console.error(err);
    process.exit(1);
});
