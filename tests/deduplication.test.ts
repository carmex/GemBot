/*
 * GemBot: Deduplication Middleware Test Suite
 */

import {
    EventDeduplicator,
    extractEventKey,
    isSlackRetry,
    createDeduplicationMiddleware,
} from '../src/middleware/deduplication';

function assert(condition: boolean, message: string) {
    if (!condition) {
        console.error(`FAILED: ${message}`);
        throw new Error(`Test failed: ${message}`);
    }
    console.log(`PASSED: ${message}`);
}

async function runTests() {
    console.log('--- Running Deduplication Tests ---');

    // 1. EventDeduplicator basic duplicate detection
    {
        const dedup = new EventDeduplicator({ ttlMs: 1000 });
        assert(!dedup.isDuplicate('key1'), 'First occurrence of key1 should not be duplicate');
        assert(dedup.isDuplicate('key1'), 'Immediate second occurrence of key1 should be duplicate');
        assert(!dedup.isDuplicate('key2'), 'First occurrence of key2 should not be duplicate');
        assert(dedup.isDuplicate('key2'), 'Immediate second occurrence of key2 should be duplicate');
        assert(dedup.size === 2, `Cache size should be 2, got ${dedup.size}`);
    }

    // 2. EventDeduplicator TTL expiration
    {
        const dedup = new EventDeduplicator({ ttlMs: 50 });
        assert(!dedup.isDuplicate('key_expire'), 'First occurrence should not be duplicate');
        assert(dedup.isDuplicate('key_expire'), 'Second occurrence before TTL should be duplicate');
        
        await new Promise((r) => setTimeout(r, 60));
        assert(!dedup.isDuplicate('key_expire'), 'Occurrence after TTL should not be duplicate');
    }

    // 3. EventDeduplicator max capacity eviction
    {
        const dedup = new EventDeduplicator({ maxEntries: 2, ttlMs: 10000 });
        dedup.isDuplicate('a');
        dedup.isDuplicate('b');
        assert(dedup.size === 2, 'Cache size should be 2');
        dedup.isDuplicate('c'); // evicts 'a'
        assert(dedup.size === 2, 'Cache size should stay at 2 after eviction');
        assert(!dedup.isDuplicate('a'), 'Evicted entry "a" should be treated as new');
    }

    // 4. isSlackRetry
    {
        assert(isSlackRetry({ retryNum: 1 }) === true, 'retryNum: 1 should be retry');
        assert(isSlackRetry({ retryNum: '2' }) === true, 'retryNum: "2" should be retry');
        assert(isSlackRetry({ retryNum: 0 }) === false, 'retryNum: 0 should NOT be retry');
        assert(isSlackRetry({ retryNum: undefined }) === false, 'retryNum: undefined should NOT be retry');
        assert(isSlackRetry({}) === false, 'Empty context should NOT be retry');
        assert(isSlackRetry(null) === false, 'Null context should NOT be retry');
    }

    // 5. extractEventKey
    {
        // event_id priority
        const withEventId = {
            body: { event_id: 'Ev12345' },
            event: { channel: 'C123', ts: '100.001' },
        };
        assert(extractEventKey(withEventId) === 'event:Ev12345', 'Should prefer body.event_id');

        // message channel + ts
        const messageEvent = {
            body: {},
            message: { channel: 'C123', ts: '100.001' },
        };
        assert(extractEventKey(messageEvent) === 'msg:C123:100.001', 'Should extract msg:channel:ts');

        // event channel + ts
        const eventOnly = {
            event: { channel: 'C456', ts: '200.002' },
        };
        assert(extractEventKey(eventOnly) === 'msg:C456:200.002', 'Should extract event channel + ts');

        // trigger_id for slash commands
        const slashCommand = {
            body: { trigger_id: 'trig_999' },
        };
        assert(extractEventKey(slashCommand) === 'trigger:trig_999', 'Should extract trigger_id');

        // empty / unknown
        assert(extractEventKey({}) === null, 'Empty args should return null');
    }

    // 6. createDeduplicationMiddleware behavior
    {
        const dedup = new EventDeduplicator({ ttlMs: 1000 });
        const middleware = createDeduplicationMiddleware({}, dedup);

        let nextCalls = 0;
        let ackCalls = 0;

        const fakeNext = async () => {
            nextCalls++;
        };
        const fakeAck = async () => {
            ackCalls++;
        };

        // 6a. Fresh command
        await middleware({
            context: {},
            body: { event_id: 'Ev_Test1' },
            ack: fakeAck,
            next: fakeNext,
        } as any);

        assert(nextCalls === 1, `Fresh event should call next() (nextCalls = ${nextCalls})`);
        assert(ackCalls === 0, `Fresh event should not force ack in middleware (ackCalls = ${ackCalls})`);

        // 6b. Duplicate of same event (same event_id)
        await middleware({
            context: {},
            body: { event_id: 'Ev_Test1' },
            ack: fakeAck,
            next: fakeNext,
        } as any);

        assert(nextCalls === 1, `Duplicate event should NOT call next() (nextCalls = ${nextCalls})`);
        assert(ackCalls === 1, `Duplicate event should call ack() (ackCalls = ${ackCalls})`);

        // 6c. Slack retry with retryNum: 1
        await middleware({
            context: { retryNum: 1, retryReason: 'timeout' },
            body: { event_id: 'Ev_Test2' },
            ack: fakeAck,
            next: fakeNext,
        } as any);

        assert(nextCalls === 1, `Retry event should NOT call next() (nextCalls = ${nextCalls})`);
        assert(ackCalls === 2, `Retry event should call ack() (ackCalls = ${ackCalls})`);

        // 6d. Another new event with different ts
        await middleware({
            context: {},
            message: { channel: 'C1', ts: '123.456' },
            ack: fakeAck,
            next: fakeNext,
        } as any);

        assert(nextCalls === 2, `Distinct event should call next() (nextCalls = ${nextCalls})`);

        // 6e. Duplicate message in same channel with same ts (e.g. !image or gis retry)
        await middleware({
            context: {},
            message: { channel: 'C1', ts: '123.456' },
            ack: fakeAck,
            next: fakeNext,
        } as any);

        assert(nextCalls === 2, `Duplicate message ts should NOT call next() (nextCalls = ${nextCalls})`);
        assert(ackCalls === 3, `Duplicate message ts should call ack() (ackCalls = ${ackCalls})`);
    }

    console.log('--- All Deduplication Tests Passed! ---');
}

runTests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
