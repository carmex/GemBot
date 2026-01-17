import fetch from 'node-fetch';
import { config } from '../config';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';

export interface Candle {
    t: number;
    c: number;
}

export async function getStockCandles(ticker: string, range: string = '1y'): Promise<Candle[]> {
    let functionName = 'TIME_SERIES_DAILY';
    // Use Weekly for ranges >= 6m to avoid premium 'outputsize=full' requirement on Daily
    if (['6m', '1y', '5y'].includes(range)) {
        functionName = 'TIME_SERIES_WEEKLY';
    }

    // outputsize=full is premium-only now, so we omit it (defaulting to compact)
    const url = `https://www.alphavantage.co/query?function=${functionName}&symbol=${ticker}&apikey=${config.alphaVantageApiKey}`;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Alpha Vantage API request failed: ${response.statusText}`);
    }

    // Type definition for both Daily and Weekly responses
    type AlphaVantageResponse = {
        "Time Series (Daily)"?: { [key: string]: { "4. close": string } };
        "Weekly Time Series"?: { [key: string]: { "4. close": string } };
    };

    const data = (await response.json()) as AlphaVantageResponse;

    // Check for either Daily or Weekly key
    const timeSeries = data["Time Series (Daily)"] || data["Weekly Time Series"];

    if (!timeSeries) {
        console.error(`[StockCharts] No Time Series data found for ${ticker} (${functionName}). Response:`, JSON.stringify(data, null, 2));
        return [];
    }

    let candles: Candle[] = Object.entries(timeSeries)
        .map(([date, values]) => ({
            t: new Date(date).getTime(),
            c: parseFloat(values["4. close"]),
        }))
        .sort((a, b) => a.t - b.t); // oldest to newest

    // Filter by range
    const now = Date.now();
    let msBack = 0;
    switch (range) {
        case '1w': msBack = 7 * 24 * 60 * 60 * 1000; break;
        case '1m': msBack = 31 * 24 * 60 * 60 * 1000; break;
        case '3m': msBack = 93 * 24 * 60 * 60 * 1000; break;
        case '6m': msBack = 186 * 24 * 60 * 60 * 1000; break;
        case '1y': msBack = 365 * 24 * 60 * 60 * 1000; break;
        case '5y': msBack = 5 * 365 * 24 * 60 * 60 * 1000; break;
        default: msBack = 365 * 24 * 60 * 60 * 1000; break;
    }
    const minTime = now - msBack;
    candles = candles.filter(c => c.t >= minTime);

    return candles;
}

export async function generateChart(
    mainTicker: string,
    mainData: Candle[],
    compareTicker?: string,
    compareData?: Candle[]
): Promise<Buffer> {
    const width = 800;
    const height = 400;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: '#ffffff' });

    const lastPrice = mainData[mainData.length - 1].c;
    const firstPrice = mainData[0].c;
    const isUp = lastPrice >= firstPrice;
    const mainColor = isUp ? 'rgb(75, 192, 192)' : 'rgb(255, 99, 132)';
    const compareColor = 'rgb(54, 162, 235)'; // Blue

    // Date alignment
    const allTimestamps = new Set<number>();
    mainData.forEach(d => allTimestamps.add(d.t));
    if (compareData) {
        compareData.forEach(d => allTimestamps.add(d.t));
    }
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);
    const labels = sortedTimestamps.map(t => new Date(t).toLocaleDateString());

    const datasets: any[] = [
        {
            label: `${mainTicker} Closing Price`,
            data: sortedTimestamps.map(t => {
                const candle = mainData.find(d => d.t === t);
                return candle ? candle.c : null;
            }),
            borderColor: mainColor,
            backgroundColor: mainColor + '33',
            fill: !compareTicker, // Only fill if not comparing
            pointRadius: 0,
            tension: 0.4,
            spanGaps: true,
        }
    ];

    if (compareTicker && compareData && compareData.length > 0) {
        datasets.push({
            label: `${compareTicker} Closing Price`,
            data: sortedTimestamps.map(t => {
                const candle = compareData.find(d => d.t === t);
                return candle ? candle.c : null;
            }),
            borderColor: compareColor,
            backgroundColor: compareColor + '33',
            fill: false,
            pointRadius: 0,
            tension: 0.4,
            spanGaps: true,
        });
    }

    const configuration: ChartConfiguration = {
        type: 'line',
        data: {
            labels,
            datasets,
        },
        options: {
            scales: {
                x: {
                    ticks: {
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 10,
                    },
                },
                y: {
                    ticks: {
                        callback: (value: any) => '$' + value,
                    },
                },
            },
            plugins: {
                legend: {
                    display: !!(compareTicker && compareData && compareData.length > 0),
                },
            },
        },
    };
    return await chartJSNodeCanvas.renderToBuffer(configuration);
}