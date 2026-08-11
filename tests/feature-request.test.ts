import child_process from 'child_process';
import { FeatureRequestHandler } from '../src/features/feature-request';

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
        process.exit(0);
    } finally {
        (child_process as any).spawn = originalSpawn;
    }
}

testFeatureRequestAgyIntegration().catch(err => {
    console.error(err);
    process.exit(1);
});
