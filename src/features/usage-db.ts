/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 * Copyright (C) 2025 David Lott
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import {Low} from 'lowdb';
import {JSONFile} from 'lowdb/node';
import path from 'path';

interface DailyUsage {
    date: string; // YYYY-MM-DD
    imageInvocations: number;
    llmInvocations: number;
    totalPromptTokens: number;
    totalResponseTokens: number;
    totalTokens: number;
    lastUpdated: string;
}

interface UserUsage {
    id: string;
    days: Record<string, DailyUsage>; // key is date string
}

interface UsageData {
    users: UserUsage[];
}

// Path to the JSON file
const dbPath = path.join(__dirname, '../../usage.json');

// Configure lowdb
const adapter = new JSONFile<UsageData>(dbPath);
const db = new Low<UsageData>(adapter, {users: []});

// --- Database Initialization ---
export async function initUsageDb() {
    await db.read();
    db.data ||= {users: []};
    await db.write();
    console.log('[UsageDB] Usage database initialized.');
}

// --- Helper Functions ---
async function findUser(userId: string): Promise<UserUsage | undefined> {
    await db.read();
    return db.data?.users.find(u => u.id === userId);
}

async function createUser(userId: string): Promise<UserUsage> {
    const newUser: UserUsage = {
        id: userId,
        days: {},
    };
    db.data?.users.push(newUser);
    await db.write();
    return newUser;
}

function getToday(): string {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getOrCreateDay(user: UserUsage, date: string): DailyUsage {
    if (!user.days[date]) {
        user.days[date] = {
            date,
            imageInvocations: 0,
            llmInvocations: 0,
            totalPromptTokens: 0,
            totalResponseTokens: 0,
            totalTokens: 0,
            lastUpdated: new Date().toISOString(),
        };
    }
    return user.days[date];
}

// --- Public API ---

/**
 * Tracks an invocation of the !image tool for a given user.
 * @param userId The Slack user ID.
 */
export async function trackImageInvocation(userId: string) {
    let user = await findUser(userId);
    if (!user) {
        user = await createUser(userId);
    }
    const today = getToday();
    const day = getOrCreateDay(user, today);
    day.imageInvocations += 1;
    day.lastUpdated = new Date().toISOString();
    await db.write();
}

interface LlmUsage {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
}

/**
 * Tracks an interaction with the LLM API for a given user.
 * @param userId The Slack user ID.
 * @param usage The usage metadata from the LLM provider.
 */
export async function trackLlmInteraction(userId: string, usage: LlmUsage) {
    let user = await findUser(userId);
    if (!user) {
        user = await createUser(userId);
    }
    const today = getToday();
    const day = getOrCreateDay(user, today);
    day.llmInvocations += 1;
    day.totalPromptTokens += usage.promptTokenCount ?? usage.prompt_tokens ?? 0;
    day.totalResponseTokens += usage.candidatesTokenCount ?? usage.completion_tokens ?? 0;
    day.totalTokens += usage.totalTokenCount ?? usage.total_tokens ?? 0;
    day.lastUpdated = new Date().toISOString();
    await db.write();
}

/**
 * Retrieves the usage statistics for a given user for a specific day (defaults to today).
 * @param userId The Slack user ID.
 * @param date Optional date string (YYYY-MM-DD). Defaults to today.
 * @returns The user's usage data for the day, or null if not found.
 */
export async function getUserUsage(userId: string, date?: string): Promise<DailyUsage | null> {
    const user = await findUser(userId);
    if (!user) return null;
    const day = user.days[date || getToday()];
    return day || null;
}

/**
 * Retrieves all daily usage stats for a user.
 */
export async function getAllUserUsage(userId: string): Promise<DailyUsage[]> {
    const user = await findUser(userId);
    if (!user) return [];
    return Object.values(user.days);
} 