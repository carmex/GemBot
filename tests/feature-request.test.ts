import child_process from 'child_process';
import path from 'path';
import Database from 'better-sqlite3';
import { FeatureRequestHandler } from '../src/features/feature-request';
import { createFeatureRequest } from '../src/features/feature-request-db';

const dbPath = path.join(__dirname, '..', 'feature_requests.db');
const db = new Database(dbPath);

function getDbRecord(threadTs: string): any {
    return db.prepare('SELECT * FROM feature_requests WHERE slack_msg_ts = ?').get(threadTs);
}

function cleanupTestRecords() {
    db.prepare("DELETE FROM feature_requests WHERE slack_msg_ts LIKE 'test-thread-%' OR slack_msg_ts = '999999.111' OR slack_msg_ts = '123456.789'").run();
}

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

    if (!sayMessage.includes("Reply with 'nevermind' or 'cancel' to abort")) {
        console.error(`FAILED: Expected prompt to advertise cancellation, got '${sayMessage}'`);
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

function testIsCancelCommandHelper() {
    console.log("Running isCancelCommand helper test...");
    const mockApp: any = { client: { chat: { postMessage: async () => {} } } };
    const handler = new FeatureRequestHandler(mockApp);

    const validCommands = [
        'nevermind',
        'never mind',
        'nvm',
        'cancel',
        'abort',
        'stop',
        'quit',
        'exit',
        'Nevermind',
        'NEVER MIND!',
        '  nvm?  ',
        'abort.',
        'stop!!!'
    ];

    for (const cmd of validCommands) {
        if (!handler.isCancelCommand(cmd)) {
            console.error(`FAILED: isCancelCommand should return true for '${cmd}'`);
            process.exit(1);
        }
    }

    const invalidCommands = [
        'Add nevermind command to settings',
        'nevermind and continue',
        'please stop doing that',
        '',
        'approve',
        'revise the plan'
    ];

    for (const cmd of invalidCommands) {
        if (handler.isCancelCommand(cmd)) {
            console.error(`FAILED: isCancelCommand should return false for '${cmd}'`);
            process.exit(1);
        }
    }

    console.log("PASSED: testIsCancelCommandHelper passed.");
}

async function testCancellationAwaitingRequest() {
    console.log("Running cancellation in AWAITING_REQUEST test...");

    let spawnCalled = false;
    const originalSpawn = child_process.spawn;
    (child_process as any).spawn = (...args: any[]) => {
        spawnCalled = true;
        return originalSpawn.apply(child_process, args as any);
    };

    try {
        const mockApp: any = { client: { chat: { postMessage: async () => {} } } };
        const handler = new FeatureRequestHandler(mockApp);

        let sayMessage = "";
        const sayMock: any = async (msg: any) => {
            sayMessage = typeof msg === 'string' ? msg : msg.text;
        };

        const threadTs = "test-thread-awaiting-cancel-1";
        const mockEvent = {
            ts: threadTs,
            channel: "C99999",
            user: "U99999"
        };
        const mockClient = {
            users: {
                info: async () => ({ ok: true, user: { name: 'testuser' } })
            }
        };

        // Initialize session in AWAITING_REQUEST
        await handler.handleRequest(mockEvent, mockClient, sayMock);

        // User responds with "nevermind"
        await handler.handleMessage({
            thread_ts: threadTs,
            user: "U99999",
            text: "nevermind"
        }, mockClient, sayMock);

        // 1. Assert DB record is updated to ABORTED
        const record = getDbRecord(threadTs);
        if (!record || record.state !== 'ABORTED') {
            console.error(`FAILED: Expected DB record state 'ABORTED', got '${record?.state}'`);
            process.exit(1);
        }

        // 2. Assert session is deleted from memory
        const sessions = (handler as any).sessions;
        if (sessions.has(threadTs)) {
            console.error(`FAILED: Expected session for ${threadTs} to be deleted from memory`);
            process.exit(1);
        }

        // 3. Assert cancellation acknowledgment is sent
        if (!sayMessage.includes("No problem, feature request workflow cancelled.")) {
            console.error(`FAILED: Expected cancellation acknowledgment, got: '${sayMessage}'`);
            process.exit(1);
        }

        // 4. Assert child process spawn is never called
        if (spawnCalled) {
            console.error(`FAILED: child_process.spawn should not have been called`);
            process.exit(1);
        }

        console.log("PASSED: cancellation in AWAITING_REQUEST verified.");
    } finally {
        (child_process as any).spawn = originalSpawn;
    }
}

async function testCancellationAwaitingApproval() {
    console.log("Running cancellation in AWAITING_APPROVAL test...");

    const cancelSynonyms = ["never mind", "cancel", "nvm", "abort"];

    for (let i = 0; i < cancelSynonyms.length; i++) {
        const synonym = cancelSynonyms[i];
        let spawnCalled = false;
        const originalSpawn = child_process.spawn;
        (child_process as any).spawn = (...args: any[]) => {
            spawnCalled = true;
            return originalSpawn.apply(child_process, args as any);
        };

        try {
            const mockApp: any = { client: { chat: { postMessage: async () => {} } } };
            const handler = new FeatureRequestHandler(mockApp);

            let sayMessage = "";
            const sayMock: any = async (msg: any) => {
                sayMessage = typeof msg === 'string' ? msg : msg.text;
            };

            const threadTs = `test-thread-approval-cancel-${i}`;
            const mockClient = {
                users: { info: async () => ({ ok: true, user: { name: 'testuser' } }) }
            };

            // Set up DB record
            createFeatureRequest({
                slack_msg_ts: threadTs,
                channel_id: 'C12345',
                username: 'testuser',
                user_id: 'U99999',
                repo_name: 'gembot',
                repo_path: process.cwd(),
                state: 'AWAITING_APPROVAL'
            });

            // Set up session
            (handler as any).sessions.set(threadTs, {
                state: 'AWAITING_APPROVAL',
                repoName: 'gembot',
                repoPath: process.cwd(),
                userId: 'U99999',
                channelId: 'C12345',
                planText: 'Some plan'
            });

            // User sends cancel synonym
            await handler.handleMessage({
                thread_ts: threadTs,
                user: "U99999",
                text: synonym
            }, mockClient, sayMock);

            // 1. Assert DB state is updated to ABORTED
            const record = getDbRecord(threadTs);
            if (!record || record.state !== 'ABORTED') {
                console.error(`FAILED: Expected DB record state 'ABORTED' for synonym '${synonym}', got '${record?.state}'`);
                process.exit(1);
            }

            // 2. Assert session deleted from memory
            if ((handler as any).sessions.has(threadTs)) {
                console.error(`FAILED: Expected session for ${threadTs} to be deleted from memory`);
                process.exit(1);
            }

            // 3. Assert plan revision spawn is not triggered
            if (spawnCalled) {
                console.error(`FAILED: spawn should not be called when aborting in AWAITING_APPROVAL`);
                process.exit(1);
            }

            // 4. Assert response message
            if (!sayMessage.includes("Feature request workflow has been aborted.")) {
                console.error(`FAILED: Expected abort message for '${synonym}', got: '${sayMessage}'`);
                process.exit(1);
            }
        } finally {
            (child_process as any).spawn = originalSpawn;
        }
    }

    console.log("PASSED: cancellation in AWAITING_APPROVAL verified for all synonyms.");
}

async function testCancellationDuringImplementation() {
    console.log("Running cancellation during IMPLEMENTING test...");

    const mockApp: any = { client: { chat: { postMessage: async () => {} } } };
    const handler = new FeatureRequestHandler(mockApp);

    let sayMessage = "";
    const sayMock: any = async (msg: any) => {
        sayMessage = typeof msg === 'string' ? msg : msg.text;
    };

    const threadTs = "test-thread-implementing-cancel";
    const mockClient = {
        users: { info: async () => ({ ok: true, user: { name: 'testuser' } }) }
    };

    let killCalled = false;
    let killSignal = "";
    const mockActiveProcess: any = {
        killed: false,
        kill: (signal?: string) => {
            killCalled = true;
            killSignal = signal || 'SIGTERM';
            mockActiveProcess.killed = true;
            return true;
        }
    };

    createFeatureRequest({
        slack_msg_ts: threadTs,
        channel_id: 'C12345',
        username: 'testuser',
        user_id: 'U99999',
        repo_name: 'gembot',
        repo_path: process.cwd(),
        state: 'IMPLEMENTING'
    });

    (handler as any).sessions.set(threadTs, {
        state: 'IMPLEMENTING',
        repoName: 'gembot',
        repoPath: process.cwd(),
        userId: 'U99999',
        channelId: 'C12345',
        activeProcess: mockActiveProcess
    });

    // User sends "nevermind"
    await handler.handleMessage({
        thread_ts: threadTs,
        user: "U99999",
        text: "nevermind"
    }, mockClient, sayMock);

    // 1. Assert active process received .kill()
    if (!killCalled) {
        console.error("FAILED: Active process kill() was not called");
        process.exit(1);
    }
    if (killSignal !== 'SIGTERM') {
        console.error(`FAILED: Expected kill signal 'SIGTERM', got '${killSignal}'`);
        process.exit(1);
    }

    // 2. Assert DB record is ABORTED
    const record = getDbRecord(threadTs);
    if (!record || record.state !== 'ABORTED') {
        console.error(`FAILED: Expected DB record state 'ABORTED', got '${record?.state}'`);
        process.exit(1);
    }

    // 3. Assert session is aborted and deleted from memory
    if ((handler as any).sessions.has(threadTs)) {
        console.error(`FAILED: Expected session for ${threadTs} to be deleted from memory`);
        process.exit(1);
    }

    // 4. Assert response message
    if (!sayMessage.includes("Running operation terminated. Feature request workflow has been aborted.")) {
        console.error(`FAILED: Expected termination message, got: '${sayMessage}'`);
        process.exit(1);
    }

    console.log("PASSED: cancellation during IMPLEMENTING verified.");
}

async function testRegressionRegularFeatureRequest() {
    console.log("Running regression test for regular feature request with 'nevermind' substring...");

    let spawnedCommand = "";
    const originalSpawn = child_process.spawn;

    (child_process as any).spawn = (command: string, args: string[], options: any) => {
        if (command === 'agy' || command === 'gemini') {
            spawnedCommand = command;

            const fakeChild: any = {
                stdout: { on: () => {} },
                stderr: { on: () => {} },
                on: () => {}
            };
            return fakeChild;
        }
        return originalSpawn(command, args, options);
    };

    try {
        const mockApp: any = { client: { chat: { postMessage: async () => {} } } };
        const handler = new FeatureRequestHandler(mockApp);

        let sayMessage = "";
        const sayMock: any = async (msg: any) => {
            sayMessage = typeof msg === 'string' ? msg : msg.text;
        };

        const threadTs = "test-thread-regression-regular";
        const mockClient = {
            users: { info: async () => ({ ok: true, user: { name: 'testuser' } }) }
        };

        createFeatureRequest({
            slack_msg_ts: threadTs,
            channel_id: 'C12345',
            username: 'testuser',
            user_id: 'U99999',
            repo_name: 'gembot',
            repo_path: process.cwd(),
            state: 'AWAITING_REQUEST'
        });

        (handler as any).sessions.set(threadTs, {
            state: 'AWAITING_REQUEST',
            repoName: 'gembot',
            repoPath: process.cwd(),
            userId: 'U99999',
            channelId: 'C12345'
        });

        // User sends request that contains "nevermind" in sentence
        await handler.handleMessage({
            thread_ts: threadTs,
            user: "U99999",
            text: "Add nevermind command to settings"
        }, mockClient, sayMock);

        // Assert agy command was spawned
        if (spawnedCommand !== 'agy') {
            console.error(`FAILED: Expected 'agy' to be spawned, got '${spawnedCommand}'`);
            process.exit(1);
        }

        // Assert DB record updated to IMPLEMENTING
        const record = getDbRecord(threadTs);
        if (!record || record.state !== 'IMPLEMENTING') {
            console.error(`FAILED: Expected DB record state 'IMPLEMENTING', got '${record?.state}'`);
            process.exit(1);
        }

        // Assert session state is IMPLEMENTING
        const session = (handler as any).sessions.get(threadTs);
        if (!session || session.state !== 'IMPLEMENTING') {
            console.error(`FAILED: Expected session state 'IMPLEMENTING', got '${session?.state}'`);
            process.exit(1);
        }

        // Assert say message confirms starting implementation
        if (!sayMessage.includes("Starting implementation...")) {
            console.error(`FAILED: Expected starting implementation message, got: '${sayMessage}'`);
            process.exit(1);
        }

        console.log("PASSED: regular feature request regression test passed.");
    } finally {
        (child_process as any).spawn = originalSpawn;
    }
}

async function runAllTests() {
    try {
        cleanupTestRecords();
        testIsCancelCommandHelper();
        await testHandleRequestAutoSelectGembot();
        await testFeatureRequestAgyIntegration();
        await testCancellationAwaitingRequest();
        await testCancellationAwaitingApproval();
        await testCancellationDuringImplementation();
        await testRegressionRegularFeatureRequest();
        console.log("\nALL FEATURE REQUEST TESTS PASSED!");
    } finally {
        cleanupTestRecords();
    }
    process.exit(0);
}

runAllTests().catch(err => {
    console.error(err);
    process.exit(1);
});
