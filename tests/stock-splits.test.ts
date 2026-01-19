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

import { Candle, Split } from '../types';

function applySplits(candles: Candle[], splits: Split[]) {
    if (!splits || splits.length === 0) return;

    for (const split of splits) {
        const splitTime = new Date(split.date).getTime();
        const ratio = split.toFactor / split.fromFactor;

        // Adjust all candles with a timestamp BEFORE the split date
        for (const candle of candles) {
            if (candle.t < splitTime) {
                candle.c /= ratio;
            }
        }
    }
}

function runTest() {
    console.log("Running Stock Split Adjustment Test...");

    // Test case: 2-for-1 split on 2024-06-01
    const candles: Candle[] = [
        { t: new Date('2024-05-31').getTime(), c: 200 }, // Before split
        { t: new Date('2024-06-01').getTime(), c: 100 }, // Day of split (should not be adjusted if split is at market open)
        { t: new Date('2024-06-02').getTime(), c: 105 }, // After split
    ];

    const splits: Split[] = [
        {
            date: '2024-06-01',
            fromFactor: 1,
            toFactor: 2,
            symbol: 'TEST'
        }
    ];

    console.log("Before adjustment:", JSON.stringify(candles));
    applySplits(candles, splits);
    console.log("After adjustment:", JSON.stringify(candles));

    // Expected: First candle should be 100 (200 / 2)
    if (candles[0].c === 100) {
        console.log("Test Passed: 2-for-1 split correctly adjusted historical price.");
    } else {
        console.error(`Test Failed: Expected 100, got ${candles[0].c}`);
        process.exit(1);
    }

    // Test case: 10-for-1 split (NVDA-style)
    const candles2: Candle[] = [
        { t: new Date('2024-01-01').getTime(), c: 1200 },
        { t: new Date('2024-06-10').getTime(), c: 120 },
    ];
    const splits2: Split[] = [
        {
            date: '2024-06-10',
            fromFactor: 1,
            toFactor: 10,
            symbol: 'NVDA'
        }
    ];

    applySplits(candles2, splits2);
    if (candles2[0].c === 120) {
        console.log("Test Passed: 10-for-1 split correctly adjusted historical price.");
    } else {
        console.error(`Test Failed: Expected 120, got ${candles2[0].c}`);
        process.exit(1);
    }
}

runTest();
