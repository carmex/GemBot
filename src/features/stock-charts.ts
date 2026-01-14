import fetch from 'node-fetch';
import { config } from '../config';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';

export async function getStockCandles(ticker: string, range: string = '1y'): Promise<{ t: number; c: number }[]> {
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

    let candles = Object.entries(timeSeries)
        .map(([date, values]) => ({
            t: new Date(date).getTime(),
            c: parseFloat(values["4. close"]),
        }))
        .sort((a, b) => a.t - b.t); // oldest to newest

    // Filter by range
    const now = Date.now();
    let msBack = 0;
    switch (range) {
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

export async function generateChart(ticker: string, data: { t: number; c: number }[]): Promise<Buffer> {
    const width = 800;
    const height = 400;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: '#ffffff' });
    const lastPrice = data[data.length - 1].c;
    const firstPrice = data[0].c;
    const isUp = lastPrice >= firstPrice;
    const color = isUp ? 'rgb(75, 192, 192)' : 'rgb(255, 99, 132)';
    const configuration: ChartConfiguration = {
        type: 'line',
        data: {
            labels: data.map(d => new Date(d.t).toLocaleDateString()),
            datasets: [
                {
                    label: `${ticker} Closing Price`,
                    data: data.map(d => d.c),
                    borderColor: color,
                    backgroundColor: color + '33',
                    fill: true,
                    pointRadius: 0,
                    tension: 0.4,
                },
            ],
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
                        callback: value => '$' + value,
                    },
                },
            },
            plugins: {
                legend: {
                    display: false,
                },
            },
        },
    };
    return await chartJSNodeCanvas.renderToBuffer(configuration);
}