import {config} from '../config';
import {fetchCompanyProfile, fetchQuote} from './finnhub-api';
import {App} from '@slack/bolt';
import {fetchStockNews} from './finnhub-api';

export const getColoredTileEmoji = (percentChange: number): string => {
    if (percentChange >= 10) return ':_charles_green5:';
    if (percentChange >= 6) return ':_charles_green4:';
    if (percentChange >= 3) return ':_charles_green3:';
    if (percentChange >= 1) return ':_charles_green2:';
    if (percentChange > 0) return ':_charles_green1:';
    if (percentChange === 0) return ':_charles_black_square:';
    if (percentChange <= -10) return ':_charles_red5:';
    if (percentChange <= -6) return ':_charles_red4:';
    if (percentChange <= -3) return ':_charles_red3:';
    if (percentChange <= -1) return ':_charles_red2:';
    if (percentChange < 0) return ':_charles_red1:';
    return ':white_square:'; // Fallback for unexpected cases
};

// Helper function to format market cap
export const formatMarketCap = (marketCap: number): string => {
    if (marketCap >= 1e12) {
        return `$${(marketCap / 1e12).toFixed(2)}T`;
    } else if (marketCap >= 1e9) {
        return `$${(marketCap / 1e9).toFixed(2)}B`;
    } else if (marketCap >= 1e6) {
        return `$${(marketCap / 1e6).toFixed(2)}M`;
    } else {
        return `$${marketCap.toFixed(2)}`;
    }
};

export async function formatQuote(ticker: string, displayName?: string): Promise<string> {
    const displayTicker = displayName || ticker;

    if (!config.finnhubApiKey) {
        return `*${displayTicker}*: No data found (API key not configured)`;
    }

    try {
        // Fetch price data from /quote
        const quote = await fetchQuote(ticker);

        if (!quote) {
            return `*${displayTicker}*: No price data found`;
        }

        const {price, change, percentChange} = quote;
        const sign = change >= 0 ? '+' : '';
        const emoji = getColoredTileEmoji(percentChange);

        let namePart: string;
        // If displayName is provided, it's a crypto quote. Just use the ticker.
        if (displayName) {
            namePart = `*${displayTicker}*`;
        } else {
            // Otherwise, it's a stock, so fetch the company profile.
            const profile = await fetchCompanyProfile(ticker);
            const companyName = profile?.name || ticker;
            namePart = `*${displayTicker}* (${companyName})`;
        }

        return `${emoji} ${namePart}: $${price.toFixed(2)} (${sign}${change.toFixed(2)}, ${sign}${percentChange.toFixed(2)}%)`;
    } catch (error) {
        console.error(`Error fetching quote for ${ticker}:`, error);
        return `*${displayTicker}*: Error fetching data`;
    }
}

// Function to send the morning greeting
export async function sendMorningGreeting(app: App, channelId: string) {
    try {
        let text = 'Good morning everyone! What are your top priorities for today?';

        if (config.finnhubApiKey) {
            const articles = await fetchStockNews();
            if (articles && articles.length > 0) {
                const formattedArticles = articles
                    .slice(0, 5)
                    .map((article: {url: string}) => `<${article.url}|.>`)
                    .join(' ');
                text += `\n\nHere are the latest general headlines: ${formattedArticles}`;
            }
        }

        await app.client.chat.postMessage({
            token: config.slack.botToken,
            channel: channelId,
            text: text,
        });

        console.log('Morning greeting sent successfully.');
    } catch (error) {
        console.error('Failed to send morning greeting:', error);
    }
} 