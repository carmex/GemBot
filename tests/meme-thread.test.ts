
import { registerMemeCommands } from '../src/commands/meme';

async function runTests() {
    console.log("Running Meme Thread Awareness Tests...");

    let registeredHandlers: any[] = [];
    const mockApp: any = {
        message: (pattern: any, handler: any) => {
            registeredHandlers.push({ pattern, handler });
        }
    };

    registerMemeCommands(mockApp);

    function assert(condition: boolean, message: string) {
        if (!condition) {
            console.error(`FAILED: ${message}`);
            throw new Error(`Test failed: ${message}`);
        }
        console.log(`PASSED: ${message}`);
    }

    // Test 1: !meme list
    const listHandler = registeredHandlers.find(h => h.pattern.toString().includes('list')).handler;
    let sayArgs: any = null;
    const mockSay = async (args: any) => { sayArgs = args; };
    
    await listHandler({ 
        message: { user: 'U123', text: '!meme list', thread_ts: 'thread-123' }, 
        say: mockSay 
    });
    assert(sayArgs.thread_ts === 'thread-123', "Test 1: !meme list should include thread_ts");

    // Test 2: !meme search
    const searchHandler = registeredHandlers.find(h => h.pattern.toString().includes('search')).handler;
    sayArgs = null;
    await searchHandler({ 
        message: { user: 'U123', text: '!meme search doge', thread_ts: 'thread-456' }, 
        context: { matches: [null, 'doge'] },
        say: mockSay 
    });
    assert(sayArgs.thread_ts === 'thread-456', "Test 2: !meme search should include thread_ts");

    // Test 3: !meme <template>
    const mainHandler = registeredHandlers.find(h => h.pattern.toString() === '/^!meme\\s+(.+)$/i').handler;
    sayArgs = null;
    await mainHandler({ 
        message: { user: 'U123', text: '!meme doge wow', thread_ts: 'thread-789', channel: 'C1' }, 
        context: { matches: [null, 'doge wow'] },
        say: mockSay,
        client: { files: { uploadV2: async () => {} } }
    });
    // For main handler, it might be an object if success, or string if error (but I updated all to objects)
    assert(sayArgs.thread_ts === 'thread-789', "Test 3: main !meme should include thread_ts");

    // Test 4: No thread_ts
    sayArgs = null;
    await listHandler({ 
        message: { user: 'U123', text: '!meme list' }, 
        say: mockSay 
    });
    assert(sayArgs.thread_ts === undefined, "Test 4: Should have undefined thread_ts if not in thread");

    console.log("\nAll Meme Thread tests passed!");
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
