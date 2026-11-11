/*
 * GemBot: Slack Event Deduplication Middleware
 * Prevents multiple responses caused by Slack retries (e.g. Socket Mode or HTTP timeout re-deliveries).
 */

import { Middleware, AnyMiddlewareArgs } from '@slack/bolt';

export interface DeduplicationOptions {
    ttlMs?: number;
    maxEntries?: number;
}

export class EventDeduplicator {
    private cache: Map<string, number> = new Map();
    private ttlMs: number;
    private maxEntries: number;

    constructor(options: DeduplicationOptions = {}) {
        this.ttlMs = options.ttlMs ?? 10 * 60 * 1000; // 10 minutes default TTL
        this.maxEntries = options.maxEntries ?? 5000;
    }

    /**
     * Checks if the event key has been seen recently.
     * Returns true if duplicate, false if new (and caches it).
     */
    public isDuplicate(key: string): boolean {
        const now = Date.now();
        this.cleanup(now);

        const timestamp = this.cache.get(key);
        if (timestamp !== undefined && now - timestamp < this.ttlMs) {
            return true;
        }

        // Evict oldest entry if at capacity
        if (this.cache.size >= this.maxEntries) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(key, now);
        return false;
    }

    private cleanup(now: number) {
        if (this.cache.size > 100) {
            for (const [key, ts] of this.cache.entries()) {
                if (now - ts >= this.ttlMs) {
                    this.cache.delete(key);
                } else {
                    // Map preserves insertion order, so early entries expire first
                    break;
                }
            }
        }
    }

    public clear(): void {
        this.cache.clear();
    }

    public get size(): number {
        return this.cache.size;
    }
}

/**
 * Extracts a unique string key for deduplicating incoming Slack events.
 */
export function extractEventKey(args: any): string | null {
    const { body, event, message } = args;

    // 1. Authoritative Slack Events API event_id (globally unique per event across retries)
    if (body?.event_id) {
        return `event:${body.event_id}`;
    }

    // 2. Channel + Message Timestamp for message / app_mention events
    const channel = event?.channel || message?.channel || body?.event?.channel || body?.channel_id;
    const ts = event?.ts || message?.ts || body?.event?.ts || event?.event_ts;
    if (channel && ts) {
        return `msg:${channel}:${ts}`;
    }

    // 3. Trigger ID for interactive actions / slash commands
    if (body?.trigger_id) {
        return `trigger:${body.trigger_id}`;
    }

    return null;
}

/**
 * Checks whether an incoming request is marked by Slack as a retry.
 */
export function isSlackRetry(context: any): boolean {
    if (!context) return false;
    const retryNum = context.retryNum;
    if (retryNum !== undefined && retryNum !== null) {
        const parsed = Number(retryNum);
        return !isNaN(parsed) && parsed > 0;
    }
    return false;
}

/**
 * Creates global Bolt middleware that drops duplicate Slack deliveries and retries.
 */
export function createDeduplicationMiddleware(
    options: DeduplicationOptions = {},
    deduplicator: EventDeduplicator = new EventDeduplicator(options)
): Middleware<AnyMiddlewareArgs> {
    return async (args: any) => {
        const { context, next } = args;

        // 1. Drop explicit Slack retries (X-Slack-Retry-Num > 0 or retry_attempt > 0)
        if (isSlackRetry(context)) {
            console.warn(
                `[Deduplication] Dropping retry event (retryNum: ${context.retryNum}, reason: ${context.retryReason || 'unknown'})`
            );
            if (typeof args.ack === 'function') {
                await args.ack();
            }
            return;
        }

        // 2. Check for duplicate event based on unique event identifier
        const eventKey = extractEventKey(args);
        if (eventKey) {
            if (deduplicator.isDuplicate(eventKey)) {
                console.warn(`[Deduplication] Dropping duplicate event with key: ${eventKey}`);
                if (typeof args.ack === 'function') {
                    await args.ack();
                }
                return;
            }
        }

        await next();
    };
}
