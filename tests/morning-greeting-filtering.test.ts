/*
 * GemBot: Morning Greeting Filtering Test
 */

import {
    filterMorningGreetingArticles,
    isGoogleNewsArticle,
    isBlacklistedArticle,
} from '../src/features/utils';

function runTests() {
    console.log("Running Morning Greeting Filtering Logic Tests...");

    // 1. Verify helper alias
    if (isBlacklistedArticle !== isGoogleNewsArticle) {
        console.error("FAILED: isBlacklistedArticle should be an alias of isGoogleNewsArticle.");
        process.exit(1);
    }
    console.log("PASSED: isBlacklistedArticle alias verified.");

    // 2. Test masked Google News articles where source is 'Reuters' or 'Bloomberg' but URL is news.google.com
    const maskedGoogleNewsArticles = [
        {
            headline: "Iran urges US to accept proposal - Reuters",
            source: "Reuters",
            url: "https://news.google.com/rss/articles/CBMipwFBVV95cUxOWUh3Z1JyMmU4SkJ4ZXQ4Y0VaN3RMS1Vtcmg4S1lDMGlvUG1GeVY3Q1pkaWltSG5yOWhmcTBnNkk4U0ZiTVREVzd3RVRZNjZJTjhaTkg5bTFGX0J2Q0JzTUI4UlZIWmxHMmRDeVRRODZRYU1mbkNrVzFRX3piTnpDbllfUGc3NnJkSl9hWWRCQzlxZjFBYnE5bXJQMVBjMzNBUFlNcmRtcw?oc=5"
        },
        {
            headline: "Bloomberg Market Wrap",
            source: "Bloomberg",
            url: "https://news.google.com/rss/articles/CBMixgFBVV95cUxNaUsxbVVqQ0FFUl81U25IbG1NaXhrNzFqZzIzaFpRUVhKbF9rYlZoMXg1Z3NzYjR1TEtkeHNCU1BrOWs4ZXR5VHFqMTBoX3VjSV9FRV9neGVDSkdUNWIxMlNhZWRJbldocDM5Q2hiMXYxUXpHVUJqWkkyOEF5OGNBNWduQXFPMXp6VXhYRjUyNmsxaV9pbXJhS29uVGh6Tm51emp4S3YtdmI5c21HZE9HeFkycENlNGxHRUlJd29YWkxwRF85eXc?oc=5"
        },
        {
            headline: "Subdomain Google News",
            source: "AP News",
            url: "https://sub.news.google.com/articles/12345"
        },
        {
            headline: "Google News Path",
            source: "MarketWatch",
            url: "https://www.google.com/news/story?id=67890"
        }
    ];

    for (const article of maskedGoogleNewsArticles) {
        if (!isGoogleNewsArticle(article)) {
            console.error(`FAILED: Masked Google News article was NOT identified as blacklisted: ${article.url}`);
            process.exit(1);
        }
    }
    const filteredMasked = filterMorningGreetingArticles(maskedGoogleNewsArticles);
    if (filteredMasked.length !== 0) {
        console.error(`FAILED: Expected 0 articles after filtering masked Google News, got ${filteredMasked.length}`);
        process.exit(1);
    }
    console.log("PASSED: Masked Google News URLs with third-party source names are blacklisted.");

    // 3. Test articles where source is 'Google News' regardless of URL
    const googleNewsSourceArticles = [
        { headline: "Headline A", source: "Google News", url: "https://reuters.com/article/1" },
        { headline: "Headline B", source: "google news", url: "https://bloomberg.com/news/2" },
        { headline: "Headline C", source: "GOOGLE NEWS", url: "https://cnbc.com/story/3" },
    ];

    for (const article of googleNewsSourceArticles) {
        if (!isGoogleNewsArticle(article)) {
            console.error(`FAILED: 'Google News' source article was NOT blacklisted: ${article.source}`);
            process.exit(1);
        }
    }
    const filteredSource = filterMorningGreetingArticles(googleNewsSourceArticles);
    if (filteredSource.length !== 0) {
        console.error(`FAILED: Expected 0 articles for Google News sources, got ${filteredSource.length}`);
        process.exit(1);
    }
    console.log("PASSED: 'Google News' source articles are blacklisted regardless of URL.");

    // 4. Test clean articles with direct publisher URLs (must be preserved)
    const cleanArticles = [
        { headline: "Pumpkin Farm", source: "CNBC", url: "https://www.cnbc.com/make-it/2026/10/17/great-pumpkin-farm.html" },
        { headline: "OpenAI Poaches SpaceX Lead", source: "Bloomberg", url: "https://www.bloomberg.com/news/articles/2026-10-16/openai" },
        { headline: "Direct Reuters Report", source: "Reuters", url: "https://www.reuters.com/world/middle-east/story-123" },
        { headline: "WSJ Markets", source: "WSJ", url: "https://www.wsj.com/articles/markets-today-123" },
        { headline: "FT Tech", source: "Financial Times", url: "https://www.ft.com/content/abc-xyz" },
        { headline: "NYT Business", source: "The New York Times", url: "https://www.nytimes.com/2026/10/17/business/economy.html" },
        { headline: "BBC News", source: "BBC", url: "https://www.bbc.co.uk/news/business-456" },
    ];

    for (const article of cleanArticles) {
        if (isGoogleNewsArticle(article)) {
            console.error(`FAILED: Clean article was falsely blacklisted: ${article.source} - ${article.url}`);
            process.exit(1);
        }
    }
    const filteredClean = filterMorningGreetingArticles(cleanArticles);
    if (filteredClean.length !== cleanArticles.length) {
        console.error(`FAILED: Clean articles were dropped. Expected ${cleanArticles.length}, got ${filteredClean.length}`);
        process.exit(1);
    }
    console.log("PASSED: Clean direct publisher articles are preserved.");

    // 5. Test invalid or unparseable URLs (handled safely without throwing)
    const edgeCaseArticles = [
        { headline: "Malformed Not-A-Url", source: "Reuters", url: "not-a-valid-url" },
        { headline: "Empty URL", source: "Bloomberg", url: "" },
        { headline: "Undefined URL", source: "CNBC", url: undefined as any },
        { headline: "Malformed Google URL with bad port", source: "AP", url: "https://news.google.com:badport" },
        { headline: "Null article", source: undefined as any, url: undefined as any },
    ];

    try {
        const edgeResults = filterMorningGreetingArticles(edgeCaseArticles as any);
        // "Malformed Google URL with bad port" contains news.google.com, so it must be blacklisted
        const badPortIncluded = edgeResults.some(a => a && a.url && a.url.includes("badport"));
        if (badPortIncluded) {
            console.error("FAILED: Malformed news.google.com URL was not blacklisted.");
            process.exit(1);
        }
        console.log("PASSED: Malformed and unparseable URLs handled safely without exceptions.");
    } catch (err) {
        console.error("FAILED: Threw exception on malformed URLs:", err);
        process.exit(1);
    }

    // 6. Test mixed articles and result slicing verification
    // 7 clean articles + 4 masked Google News + 3 Google News source
    const mixedArticles = [
        maskedGoogleNewsArticles[0],
        cleanArticles[0], // 1. CNBC
        googleNewsSourceArticles[0],
        cleanArticles[1], // 2. Bloomberg
        maskedGoogleNewsArticles[1],
        cleanArticles[2], // 3. Reuters
        maskedGoogleNewsArticles[2],
        cleanArticles[3], // 4. WSJ
        googleNewsSourceArticles[1],
        cleanArticles[4], // 5. FT
        cleanArticles[5], // 6. NYT
        maskedGoogleNewsArticles[3],
        cleanArticles[6], // 7. BBC
        googleNewsSourceArticles[2],
    ];

    const filteredMixed = filterMorningGreetingArticles(mixedArticles);
    if (filteredMixed.length !== 7) {
        console.error(`FAILED: Expected 7 clean articles from mixed set, got ${filteredMixed.length}`);
        process.exit(1);
    }

    // Verify slicing top 5 preserves first 5 clean articles and contains NO google news
    const top5 = filteredMixed.slice(0, 5);
    if (top5.length !== 5) {
        console.error(`FAILED: Expected top 5 slice length to be 5, got ${top5.length}`);
        process.exit(1);
    }

    const hasAnyGoogle = top5.some(a => isGoogleNewsArticle(a));
    if (hasAnyGoogle) {
        console.error("FAILED: Top 5 slice contains a blacklisted Google News article.");
        process.exit(1);
    }

    const expectedHeadlines = [
        cleanArticles[0].headline,
        cleanArticles[1].headline,
        cleanArticles[2].headline,
        cleanArticles[3].headline,
        cleanArticles[4].headline,
    ];
    const top5Headlines = top5.map(a => a.headline);
    const matchesExpected = expectedHeadlines.every((h, i) => h === top5Headlines[i]);
    if (!matchesExpected) {
        console.error(`FAILED: Top 5 headlines did not match expected order. Got: ${top5Headlines.join(", ")}`);
        process.exit(1);
    }
    console.log("PASSED: Result slicing preserves top 5 valid clean articles in order.");

    console.log("\nAll morning greeting filtering tests passed successfully!");
}

runTests();
