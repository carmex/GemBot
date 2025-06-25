import {App} from '@slack/bolt';
import {addToWatchlist, getWatchlist, removeFromWatchlist} from '../features/watchlist-db';
import {fetchQuote, fetchCompanyProfile} from '../features/finnhub-api';
import {getColoredTileEmoji} from '../features/utils';

export const registerWatchlistCommands = (app: App) => {
    // New command handler for !watchlist
    app.message(/^!watchlist/i, async ({message, say}) => {
        if (!('user' in message) || !message.user) return;

        const userWatchlist = await getWatchlist(message.user);
        if (userWatchlist.length === 0) {
            await say({
                text: "Your watchlist is empty. Add stocks with `!watch <TICKER>`.",
            });
            return;
        }

        let totalPortfolioValue = 0;
        let totalCostBasis = 0;

        const report = await Promise.all(
            userWatchlist.map(async (item) => {
                // Fetch all data needed
                const quote = await fetchQuote(item.ticker);
                const profile = await fetchCompanyProfile(item.ticker);

                if (!quote) {
                    return `*${item.ticker}*: Could not retrieve current price.`;
                }

                // Part 1: The !q format
                const companyName = profile?.name || item.ticker;
                const {price, change, percentChange} = quote;
                const q_sign = change >= 0 ? '+' : '';
                const emoji = getColoredTileEmoji(percentChange);
                const q_part = `${emoji} *${item.ticker}* (${companyName}): $${price.toFixed(2)} (${q_sign}${change.toFixed(2)}, ${q_sign}${percentChange.toFixed(2)}%)`;

                // Part 2: The portfolio details
                const currentPrice = quote.price;
                const costBasis = item.purchasePrice * item.shares;
                const gainLoss = (currentPrice * item.shares) - costBasis;

                let gainLossPercent = 0;
                if (costBasis > 0) {
                    gainLossPercent = (gainLoss / costBasis) * 100;
                }

                const pl_sign = gainLoss >= 0 ? '+' : '';
                const portfolio_part = ` | ${item.shares} @ $${item.purchasePrice.toFixed(2)} | P/L: ${pl_sign}$${gainLoss.toFixed(2)} (${pl_sign}${gainLossPercent.toFixed(2)}%)`;

                // Update totals for summary
                totalCostBasis += costBasis;
                totalPortfolioValue += currentPrice * item.shares;

                return q_part + portfolio_part;
            })
        );

        const overallGainLoss = totalPortfolioValue - totalCostBasis;
        const overallGainLossPercent = (overallGainLoss / totalCostBasis) * 100;
        const overallSign = overallGainLoss >= 0 ? '+' : '';
        const overallEmoji = overallGainLoss >= 0 ? '🔼' : '🔽';

        const summary = `*Your Watchlist Summary* ${overallEmoji}\nOverall P/L: ${overallSign}$${overallGainLoss.toFixed(2)} (${overallSign}${overallGainLossPercent.toFixed(2)}%)\n------------------------------------`;

        await say({
            text: `${summary}\n${report.join('\n')}`,
        });
    });

    // New command handler for !watch (help)
    app.message(/^!watch$/i, async ({say}) => {
        await say({
            text: 'Usage: `!watch <TICKER> [purchase_date] [purchase_price] [shares]`\n' +
                '• `<TICKER>`: The stock symbol (e.g., AAPL).\n' +
                '• `[purchase_date]`: Optional. Date of purchase (e.g., 2023-01-15). Defaults to today.\n' +
                '• `[purchase_price]`: Optional. Price per share. Defaults to current market price.\n' +
                '• `[shares]`: Optional. Number of shares. Defaults to 1.',
        });
    });

    // New command handler for !watch (add)
    app.message(/^!watch\s+([A-Z]+)(?:\s+([\d.-]+))?(?:\s+([\d.]+))?(?:\s+(\d+))?/i, async ({message, context, say}) => {
        if (!('user' in message) || !message.user || !context.matches?.[1]) return;

        const ticker = context.matches[1].toUpperCase();
        const purchaseDateInput = context.matches[2];
        const purchasePriceInput = context.matches[3];
        const sharesInput = context.matches[4];

        let purchasePrice = purchasePriceInput ? parseFloat(purchasePriceInput) : undefined;
        const purchaseDate = purchaseDateInput ? new Date(purchaseDateInput).toLocaleDateString() : new Date().toLocaleDateString();
        const shares = sharesInput ? parseInt(sharesInput, 10) : 1;

        if (purchasePrice === undefined) {
            const quote = await fetchQuote(ticker);
            if (!quote) {
                await say({text: `Could not fetch the current price for *${ticker}*. Please provide a purchase price or try again later.`});
                return;
            }
            purchasePrice = quote.price;
        }

        await addToWatchlist({
            userId: message.user,
            ticker,
            shares,
            purchaseDate,
            purchasePrice,
        });

        await say({text: `*${ticker}* (${shares} shares) has been added to your watchlist at $${purchasePrice.toFixed(2)}/share.`});
    });

    // New command handler for !unwatch
    app.message(/^!unwatch\s+([A-Z]+)/i, async ({message, context, say}) => {
        if (!('user' in message) || !message.user || !context.matches?.[1]) return;
        const ticker = context.matches[1].toUpperCase();

        const success = await removeFromWatchlist(message.user, ticker);

        if (success) {
            await say({text: `*${ticker}* has been removed from your watchlist.`});
        } else {
            await say({text: `*${ticker}* was not found in your watchlist.`});
        }
    });
}; 