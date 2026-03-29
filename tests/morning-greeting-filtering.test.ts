/*
 * GemBot: Morning Greeting Filtering Test
 */

/**
 * Simplified article filter logic from src/features/utils.ts
 */
function filterArticles(articles: {headline: string; source: string; url: string}[]) {
    return articles.filter(
        (article: {source: string}) => article.source.toLowerCase() !== 'google news'
    );
}

function runTests() {
    console.log("Running Morning Greeting Filtering Logic Tests...");

    const mockArticles = [
        { headline: "Headline 1", source: "Reuters", url: "https://reuters.com/1" },
        { headline: "Headline 2", source: "Google News", url: "https://news.google.com/2" },
        { headline: "Headline 3", source: "GOOGLE NEWS", url: "https://news.google.com/3" },
        { headline: "Headline 4", source: "Bloomberg", url: "https://bloomberg.com/4" },
        { headline: "Headline 5", source: "google news", url: "https://news.google.com/5" },
        { headline: "Headline 6", source: "CNBC", url: "https://cnbc.com/6" },
    ];

    const filtered = filterArticles(mockArticles);

    // 1. Check if Google News is filtered out
    const hasGoogleNews = filtered.some(a => a.source.toLowerCase() === 'google news');
    if (!hasGoogleNews) {
        console.log("PASSED: Google News articles are filtered out.");
    } else {
        console.error("FAILED: Google News articles were NOT filtered out.");
        process.exit(1);
    }

    // 2. Check case insensitivity
    const expectedRemaining = ["Reuters", "Bloomberg", "CNBC"];
    const filteredSources = filtered.map(a => a.source);
    const allExpectedPresent = expectedRemaining.every(s => filteredSources.includes(s));
    
    if (filtered.length === expectedRemaining.length && allExpectedPresent) {
        console.log("PASSED: Correct articles remaining (Reuters, Bloomberg, CNBC).");
    } else {
        console.error(`FAILED: Filtering logic mismatch. Got: ${filteredSources.join(", ")}`);
        process.exit(1);
    }

    // 3. Verify result count preservation (slicing to 5 happens after filtering)
    const formattedCount = filtered.slice(0, 5).length;
    if (formattedCount === 3) {
        console.log("PASSED: Result count correctly handled after filtering.");
    } else {
        console.error(`FAILED: Expected 3 articles in slice, got ${formattedCount}`);
        process.exit(1);
    }

    console.log("\nAll morning greeting filtering tests passed!");
}

runTests();
