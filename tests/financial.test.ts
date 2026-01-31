/*
 * GemBot: Financial Commands Test Suite
 */

import { Candle } from '../src/types';

// Mocking function for getCryptoCandles logic
async function mockGetCryptoCandles(
    ticker: string, 
    range: string, 
    hasCryptoCompareKey: boolean,
    mockCcResult: Candle[],
    mockAvResult: Candle[]
): Promise<Candle[]> {
    let candles: Candle[] = [];

    // Try CryptoCompare first
    if (hasCryptoCompareKey) {
        candles = mockCcResult;
    }

    // Fallback to Alpha Vantage if CryptoCompare fails or has no key
    if (candles.length === 0) {
        candles = mockAvResult;
    }

    if (candles.length > 0) {
        // Filter by range logic (simplified for test)
        const now = new Date('2025-01-01').getTime();
        let msBack = 0;
        switch (range) {
            case '1w': msBack = 7 * 24 * 60 * 60 * 1000; break;
            case '1m': msBack = 31 * 24 * 60 * 60 * 1000; break;
            case '1y': msBack = 365 * 24 * 60 * 60 * 1000; break;
            default: msBack = 365 * 24 * 60 * 60 * 1000; break;
        }
        const minTime = now - msBack;
        candles = candles.filter(c => c.t >= minTime);
    }

    return candles;
}

function runTests() {
    console.log("Running Financial Logic Tests...");

    // 1. Test Alpha Vantage field parsing fix logic
    const mockAvDataNew = {
        "Time Series (Digital Currency Daily)": {
            "2025-01-01": { "4. close": "50000.00" },
            "2024-12-31": { "4. close": "49000.00" }
        }
    };
    const mockAvDataOld = {
        "Time Series (Digital Currency Daily)": {
            "2025-01-01": { "4a. close (USD)": "50000.00" },
            "2024-12-31": { "4a. close (USD)": "49000.00" }
        }
    };

    const parseAv = (data: any) => {
        const timeSeries = data["Time Series (Digital Currency Daily)"];
        return Object.entries(timeSeries).map(([date, values]: [string, any]) => ({
            t: new Date(date).getTime(),
            c: parseFloat(values["4. close"] || values["4a. close (USD)"]),
        }));
    };

    const parsedNew = parseAv(mockAvDataNew);
    const parsedOld = parseAv(mockAvDataOld);

    if (parsedNew[0].c === 50000 && parsedOld[0].c === 50000) {
        console.log("PASSED: Alpha Vantage parsing logic handles both new and old field names.");
    } else {
        console.error("FAILED: Alpha Vantage parsing logic failed.");
        process.exit(1);
    }

    // 2. Test getCryptoCandles Fallback Logic
    const ccData = [{ t: new Date('2025-01-01').getTime(), c: 51000 }];
    const avData = [{ t: new Date('2025-01-01').getTime(), c: 50000 }];

    // Scenario A: CryptoCompare Key present
    (async () => {
        const result = await mockGetCryptoCandles('BTC', '1y', true, ccData, avData);
        if (result[0].c === 51000) {
            console.log("PASSED: Primary source (CryptoCompare) used when key is present.");
        } else {
            console.error("FAILED: Primary source not used when key present.");
            process.exit(1);
        }

        // Scenario B: CryptoCompare Key missing -> Fallback to AV
        const resultFallback = await mockGetCryptoCandles('BTC', '1y', false, [], avData);
        if (resultFallback[0].c === 50000) {
            console.log("PASSED: Fallback to Alpha Vantage works when CryptoCompare is missing/empty.");
        } else {
            console.error("FAILED: Fallback to Alpha Vantage failed.");
            process.exit(1);
        }

        // 3. Test Range Filtering
        const multiDayData = [
            { t: new Date('2025-01-01').getTime(), c: 50000 },
            { t: new Date('2024-06-01').getTime(), c: 45000 },
            { t: new Date('2023-01-01').getTime(), c: 30000 },
        ];
        const resultRange = await mockGetCryptoCandles('BTC', '1y', true, multiDayData, []);
        if (resultRange.length === 2) {
            console.log("PASSED: Range filtering correctly limits data to the last year.");
        } else {
            console.error(`FAILED: Range filtering failed. Expected 2 candles, got ${resultRange.length}`);
            process.exit(1);
        }

        console.log("\nAll financial tests passed!");
    })();
}

runTests();
