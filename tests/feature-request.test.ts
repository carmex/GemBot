import child_process from 'child_process';
import { FeatureRequestHandler } from '../src/features/feature-request';

async function testHandleRequestAutoSelectGembot() {
    console.log("Running FeatureRequest handleRequest auto-select test...");

    const mockApp: any = { client: { chat: { postMessage: async () => {} } } };
    const handler = new FeatureRequestHandler(mockApp);

    let sayMessage = "";
    const sayMock: any = async (msg: any) => {
        sayMessage = typeof msg === 'string' ? msg : msg.text;
    };

    const mockEvent = {
        ts: "999999.111",
        channel: "C99999",
        user: "U99999"
    };

    const mockClient = {
        users: {
            info: async () => ({ ok: true, user: { name: 'testuser' } })
        }
    };

    await handler.handleRequest(mockEvent, mockClient, sayMock);

    // Verify session state in handler
    const sessions = (handler as any).sessions;
    const session = sessions.get("999999.111");

    if (!session) {
        console.error("FAILED: Session was not created for thread 999999.111");
        process.exit(1);
    }

    if (session.state !== 'AWAITING_REQUEST') {
        console.error(`FAILED: Expected session state 'AWAITING_REQUEST', got '${session.state}'`);
        process.exit(1);
    }

    if (session.repoName !== 'gembot') {
        console.error(`FAILED: Expected repoName 'gembot', got '${session.repoName}'`);
        process.exit(1);
    }

    if (sayMessage.includes("Please select a repository")) {
        console.error("FAILED: Say message still contains repository selection prompt!");
        process.exit(1);
    }

    if (!sayMessage.includes("Auto-selected repository: `gembot`")) {
        console.error(`FAILED: Expected say message to contain 'Auto-selected repository: \`gembot\`', got '${sayMessage}'`);
        process.exit(1);
    }

    console.log("PASSED: handleRequest auto-selects 'gembot' and enters AWAITING_REQUEST state.");
}

async function testFeatureRequestAgyIntegration() {
    console.log("Running FeatureRequest agy integration test...");

    let spawnedCommand = "";
    let spawnedArgs: string[] = [];

    // Monkey-patch child_process.spawn
    const originalSpawn = child_process.spawn;
    (child_process as any).spawn = (command: string, args: string[], options: any) => {
        if (command === 'agy' || command === 'gemini') {
            spawnedCommand = command;
            spawnedArgs = args;

            const fakeChild: any = {
                stdout: { on: (event: string, cb: Function) => { if (event === 'data') cb(Buffer.from("<<<FINAL_PLAN>>>\nTest plan")); } },
                stderr: { on: (event: string, cb: Function) => {} },
                on: (event: string, cb: Function) => {
                    if (event === 'close') {
                        setTimeout(() => cb(0), 10);
                    }
                }
            };
            return fakeChild;
        }
        return originalSpawn(command, args, options);
    };

    try {
        const mockApp: any = { client: { chat: { postMessage: async () => {} } } };
        const handler = new FeatureRequestHandler(mockApp);

        const dummySession: any = {
            state: 'AWAITING_REQUEST',
            repoName: 'gembot',
            repoPath: process.cwd(),
            userId: 'U12345',
            channelId: 'C12345'
        };

        const sayMock: any = async () => {};

        await (handler as any).handleFeatureRequestText(dummySession, "Add new feature", "123456.789", sayMock);

        if (spawnedCommand !== 'agy') {
            console.error(`FAILED: Expected command 'agy', got '${spawnedCommand}'`);
            process.exit(1);
        }

        if (!spawnedArgs.includes('--dangerously-skip-permissions')) {
            console.error(`FAILED: Expected args to include '--dangerously-skip-permissions', got`, spawnedArgs);
            process.exit(1);
        }

        if (!spawnedArgs.includes('-p')) {
            console.error(`FAILED: Expected args to include '-p', got`, spawnedArgs);
            process.exit(1);
        }

        if (!spawnedArgs.includes('--print-timeout')) {
            console.error(`FAILED: Expected args to include '--print-timeout', got`, spawnedArgs);
            process.exit(1);
        }

        console.log("PASSED: FeatureRequest handler correctly calls 'agy --print-timeout 20m --dangerously-skip-permissions -p'");
    } finally {
        (child_process as any).spawn = originalSpawn;
    }
}

async function runAllTests() {
    await testHandleRequestAutoSelectGembot();
    await testFeatureRequestAgyIntegration();
    process.exit(0);
}

runAllTests().catch(err => {
    console.error(err);
    process.exit(1);
});
