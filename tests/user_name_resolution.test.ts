import { userManager } from '../src/features/user-manager';

async function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`FAILED: ${message}`);
        throw new Error(`Test failed: ${message}`);
    }
    console.log(`PASSED: ${message}`);
}

async function runTests() {
    console.log("Running UserManager Name Resolution Tests...");

    userManager.clearCache();

    // Mock Slack WebClient
    const mockClient: any = {
        users: {
            info: async ({ user }: { user: string }) => {
                if (user === 'U12345') {
                    return {
                        ok: true,
                        user: {
                            id: 'U12345',
                            name: 'legacy_name',
                            real_name: 'Zavier Real',
                            profile: {
                                display_name: 'z',
                                real_name: 'Zavier Profile'
                            }
                        }
                    };
                }
                if (user === 'U67890') {
                    return {
                        ok: true,
                        user: {
                            id: 'U67890',
                            name: 'legacy_name',
                            real_name: 'Zavier Real',
                            profile: {
                                display_name: '',
                                real_name: 'Zavier Profile'
                            }
                        }
                    };
                }
                if (user === 'U11111') {
                    return {
                        ok: true,
                        user: {
                            id: 'U11111',
                            name: 'legacy_name',
                            profile: {
                                display_name: ''
                            }
                        }
                    };
                }
                throw new Error('API Error');
            }
        }
    };

    // 1. Prioritize display_name over real_name
    const name1 = await userManager.getUserName('U12345', mockClient);
    await assert(name1 === 'z', "Test 1: Should prioritize display_name ('z')");

    // 2. Fallback to real_name if display_name is empty
    const name2 = await userManager.getUserName('U67890', mockClient);
    await assert(name2 === 'Zavier Real', "Test 2: Should fallback to real_name if display_name is empty");

    // 3. Fallback to username if real_name is missing
    const name3 = await userManager.getUserName('U11111', mockClient);
    await assert(name3 === 'legacy_name', "Test 3: Should fallback to username if real_name is missing");

    // 4. Fallback to User ID if API call fails
    const name4 = await userManager.getUserName('UNKNOWN', mockClient);
    await assert(name4 === 'UNKNOWN', "Test 4: Should fallback to User ID if API call fails");

    // 5. Cache resolved names
    let callCount = 0;
    const countingClient: any = {
        users: {
            info: async () => {
                callCount++;
                return {
                    ok: true,
                    user: {
                        id: 'U-CACHE',
                        profile: { display_name: 'cached-user' }
                    }
                };
            }
        }
    };

    await userManager.getUserName('U-CACHE', countingClient);
    await userManager.getUserName('U-CACHE', countingClient);
    await assert(callCount === 1, "Test 5: Should cache resolved names (callCount should be 1)");

    console.log("\nAll UserManager tests passed!");
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
