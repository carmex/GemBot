/*
 * GemBot: Quote Sorting Test Suite
 */

import { FormattedQuoteResult, StockQuote } from '../src/types';

function sortQuoteResults(results: FormattedQuoteResult[]): FormattedQuoteResult[] {
    if (results.length <= 1) {
        return results;
    }
    return [...results].sort((a, b) => {
        const aVal = (typeof a.sortPercentChange === 'number' && !isNaN(a.sortPercentChange)) ? a.sortPercentChange : -Infinity;
        const bVal = (typeof b.sortPercentChange === 'number' && !isNaN(b.sortPercentChange)) ? b.sortPercentChange : -Infinity;
        return bVal - aVal;
    });
}

function calculateSortDetails(quote: StockQuote | null, ticker: string): FormattedQuoteResult {
    if (!quote) {
        return {
            ticker,
            text: `*${ticker}*: No price data found`,
            isError: true,
        };
    }

    const { price, change, percentChange } = quote;
    let totalPercentChange = quote.totalPercentChange;

    if (totalPercentChange === undefined) {
        const prevClose = price - change;
        if (prevClose !== 0) {
            if (quote.postMarketPrice !== undefined) {
                totalPercentChange = ((quote.postMarketPrice - prevClose) / prevClose) * 100;
            } else if (quote.preMarketPrice !== undefined) {
                totalPercentChange = ((quote.preMarketPrice - prevClose) / prevClose) * 100;
            }
        }
    }

    let sortPercentChange: number;
    if (totalPercentChange !== undefined && !isNaN(totalPercentChange)) {
        sortPercentChange = totalPercentChange;
    } else {
        sortPercentChange = percentChange;
    }

    return {
        ticker,
        text: `*${ticker}*: $${price.toFixed(2)} (${percentChange}%)`,
        percentChange,
        totalPercentChange,
        sortPercentChange,
    };
}

function runTests() {
    console.log("Running Quote Sorting and Calculation Tests...\n");

    let passedTests = 0;
    let totalTests = 0;

    function assert(condition: boolean, testName: string) {
        totalTests++;
        if (condition) {
            console.log(`PASSED: ${testName}`);
            passedTests++;
        } else {
            console.error(`FAILED: ${testName}`);
            process.exit(1);
        }
    }

    // 1. Test Descending Order by percentChange
    {
        const quotes: FormattedQuoteResult[] = [
            { ticker: 'AAPL', text: 'AAPL +1.2%', percentChange: 1.2, sortPercentChange: 1.2 },
            { ticker: 'TSLA', text: 'TSLA -2.5%', percentChange: -2.5, sortPercentChange: -2.5 },
            { ticker: 'NVDA', text: 'NVDA +5.4%', percentChange: 5.4, sortPercentChange: 5.4 },
            { ticker: 'MSFT', text: 'MSFT 0.0%', percentChange: 0.0, sortPercentChange: 0.0 },
        ];

        const sorted = sortQuoteResults(quotes);
        const order = sorted.map(q => q.ticker);
        assert(
            JSON.stringify(order) === JSON.stringify(['NVDA', 'AAPL', 'MSFT', 'TSLA']),
            "Descending Order by percentChange: [NVDA, AAPL, MSFT, TSLA]"
        );
    }

    // 2. Test Extended Hours (totalPercentChange) Precedence
    {
        // Stock A: percentChange = +1.0%, totalPercentChange = +6.0% (after post-market)
        // Stock B: percentChange = +4.0%, no extended hours (sortPercentChange = +4.0%)
        // Stock C: percentChange = +5.0%, totalPercentChange = +2.0% (after post-market drop)
        const quotes: FormattedQuoteResult[] = [
            { ticker: 'STOCK_A', text: 'STOCK_A', percentChange: 1.0, totalPercentChange: 6.0, sortPercentChange: 6.0 },
            { ticker: 'STOCK_B', text: 'STOCK_B', percentChange: 4.0, sortPercentChange: 4.0 },
            { ticker: 'STOCK_C', text: 'STOCK_C', percentChange: 5.0, totalPercentChange: 2.0, sortPercentChange: 2.0 },
        ];

        const sorted = sortQuoteResults(quotes);
        const order = sorted.map(q => q.ticker);
        assert(
            JSON.stringify(order) === JSON.stringify(['STOCK_A', 'STOCK_B', 'STOCK_C']),
            "Extended Hours Precedence: Stock A (+6.0% total) -> Stock B (+4.0%) -> Stock C (+2.0% total)"
        );
    }

    // 3. Test Single Stock Handling
    {
        const singleQuote: FormattedQuoteResult[] = [
            { ticker: 'AAPL', text: 'AAPL: $150.00 (+1.2%)', percentChange: 1.2, sortPercentChange: 1.2 }
        ];
        const sorted = sortQuoteResults(singleQuote);
        assert(
            sorted.length === 1 && sorted[0].ticker === 'AAPL' && sorted[0].text === 'AAPL: $150.00 (+1.2%)',
            "Single Stock Handling: Returns single item with identical output without reordering"
        );
    }

    // 4. Test Error / Missing Data Handling
    {
        const quotesWithErrors: FormattedQuoteResult[] = [
            { ticker: 'INVALID1', text: '*INVALID1*: No price data found', isError: true, sortPercentChange: undefined },
            { ticker: 'AAPL', text: 'AAPL', percentChange: 1.5, sortPercentChange: 1.5 },
            { ticker: 'INVALID2', text: '*INVALID2*: Error fetching data', isError: true, sortPercentChange: undefined },
            { ticker: 'GOOG', text: 'GOOG', percentChange: 3.2, sortPercentChange: 3.2 },
            { ticker: 'MSFT', text: 'MSFT', percentChange: -0.5, sortPercentChange: -0.5 },
        ];

        const sorted = sortQuoteResults(quotesWithErrors);
        const validTickers = sorted.slice(0, 3).map(q => q.ticker);
        const errorTickers = sorted.slice(3).map(q => q.ticker);

        assert(
            JSON.stringify(validTickers) === JSON.stringify(['GOOG', 'AAPL', 'MSFT']) &&
            errorTickers.includes('INVALID1') && errorTickers.includes('INVALID2'),
            "Error / Missing Data Handling: Valid stocks sorted at top, errors placed at bottom"
        );
    }

    // 5. Test Tie Breaking Stability
    {
        const tiedQuotes: FormattedQuoteResult[] = [
            { ticker: 'TIE_1', text: 'TIE_1', percentChange: 2.0, sortPercentChange: 2.0 },
            { ticker: 'TIE_2', text: 'TIE_2', percentChange: 2.0, sortPercentChange: 2.0 },
            { ticker: 'TIE_3', text: 'TIE_3', percentChange: 2.0, sortPercentChange: 2.0 },
        ];

        const sorted = sortQuoteResults(tiedQuotes);
        const order = sorted.map(q => q.ticker);
        assert(
            JSON.stringify(order) === JSON.stringify(['TIE_1', 'TIE_2', 'TIE_3']),
            "Tie Breaking: Equal percentage changes maintain deterministic stability"
        );
    }

    // 6. Test Calculation Logic for Extended Hours
    {
        // Regular price 100, change +10 (previous close = 90)
        // Post-market price = 99 -> totalPercentChange = (99 - 90)/90 * 100 = 10%
        const postQuote: StockQuote = {
            price: 100,
            change: 10,
            percentChange: 11.11,
            postMarketPrice: 99,
        };
        const resultPost = calculateSortDetails(postQuote, 'TEST_POST');
        assert(
            Math.abs((resultPost.totalPercentChange ?? 0) - 10.0) < 0.001 &&
            Math.abs((resultPost.sortPercentChange ?? 0) - 10.0) < 0.001,
            "Calculation: Post-market price computes correct totalPercentChange and sortPercentChange"
        );

        // Pre-market price = 105, regular price 100, change 0 (prev close 100) -> totalPercentChange = (105 - 100)/100 * 100 = 5%
        const preQuote: StockQuote = {
            price: 100,
            change: 0,
            percentChange: 0.0,
            preMarketPrice: 105,
        };
        const resultPre = calculateSortDetails(preQuote, 'TEST_PRE');
        assert(
            Math.abs((resultPre.totalPercentChange ?? 0) - 5.0) < 0.001 &&
            Math.abs((resultPre.sortPercentChange ?? 0) - 5.0) < 0.001,
            "Calculation: Pre-market price computes correct totalPercentChange and sortPercentChange"
        );
    }

    console.log(`\nAll ${passedTests}/${totalTests} tests passed successfully!`);
}

runTests();
