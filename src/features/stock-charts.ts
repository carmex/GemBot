import fetch from 'node-fetch';
import { config } from '../config';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';
import { sleep } from './utils';
import { Candle, Split } from '../types';
import { fetchStockSplits, fetchStockCandles, fetchCryptoCandles } from './alphavantage-api';
import { fetchCryptoCompareCandles } from './cryptocompare-api';

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

export async function getStockCandles(ticker: string, range: string = '1y'): Promise<Candle[]> {
    let candles = await fetchStockCandles(ticker, range);

    if (candles.length > 0) {
        // Apply split adjustments
        const startDate = new Date(candles[0].t).toISOString().split('T')[0];
        const endDate = new Date().toISOString().split('T')[0];
        const splits = await fetchStockSplits(ticker, startDate, endDate);
        if (splits && splits.length > 0) {
            applySplits(candles, splits);
        }

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
            case 'my': msBack = Infinity; break;
            default: msBack = 365 * 24 * 60 * 60 * 1000; break;
        }
        const minTime = now - msBack;
        candles = candles.filter(c => c.t >= minTime);
    }

    return candles;
}

export async function getCryptoCandles(ticker: string, range: string = '1y'): Promise<Candle[]> {
    let candles: Candle[] = [];

    // Try CryptoCompare first
    if (config.cryptoCompareApiKey) {
        candles = await fetchCryptoCompareCandles(ticker, range);
    }

    // Fallback to Alpha Vantage if CryptoCompare fails or has no key
    if (candles.length === 0) {
        candles = await fetchCryptoCandles(ticker);
    }

    if (candles.length > 0) {
        // Filter by range (important for Alpha Vantage fallback which returns all data)
        const now = Date.now();
        let msBack = 0;
        switch (range) {
            case '1w': msBack = 7 * 24 * 60 * 60 * 1000; break;
            case '1m': msBack = 31 * 24 * 60 * 60 * 1000; break;
            case '3m': msBack = 93 * 24 * 60 * 60 * 1000; break;
            case '6m': msBack = 186 * 24 * 60 * 60 * 1000; break;
            case '1y': msBack = 365 * 24 * 60 * 60 * 1000; break;
            case '5y': msBack = 5 * 365 * 24 * 60 * 60 * 1000; break;
            case 'my': msBack = Infinity; break;
            default: msBack = 365 * 24 * 60 * 60 * 1000; break;
        }
        const minTime = now - msBack;
        candles = candles.filter(c => c.t >= minTime);
    }

    return candles;
}

export interface ComparisonData {
    ticker: string;
    data: Candle[];
}

export async function generateChart(
    mainTicker: string,
    mainData: Candle[],
    comparisons: ComparisonData[] = []
): Promise<Buffer> {
    const width = 800;
    const height = 400;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: '#ffffff' });

    const isComparison = comparisons.length > 0;
    const mainBaseline = mainData.length > 0 ? mainData[0].c : 0;

    const lastPrice = mainData.length > 0 ? mainData[mainData.length - 1].c : 0;
    const firstPrice = mainData.length > 0 ? mainData[0].c : 0;
    const isUp = lastPrice >= firstPrice;
    const mainColor = isUp ? 'rgb(75, 192, 192)' : 'rgb(255, 99, 132)';

    const comparisonColors = [
        'rgb(54, 162, 235)',   // Blue
        'rgb(255, 159, 64)',   // Orange
        'rgb(153, 102, 255)',  // Purple
        'rgb(255, 205, 86)',   // Yellow
        'rgb(201, 203, 207)',  // Grey
        'rgb(0, 163, 0)',      // Green
        'rgb(163, 0, 0)',      // Red
    ];

    // Date alignment
    const allTimestamps = new Set<number>();
    mainData.forEach(d => allTimestamps.add(d.t));
    for (const comp of comparisons) {
        comp.data.forEach(d => allTimestamps.add(d.t));
    }
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);
    const labels = sortedTimestamps.map(t => new Date(t).toLocaleDateString());

    const datasets: any[] = [
        {
            label: isComparison ? `${mainTicker} % Change` : `${mainTicker} Closing Price`,
            data: sortedTimestamps.map(t => {
                const candle = mainData.find(d => d.t === t);
                if (!candle) return null;
                if (isComparison && mainBaseline !== 0) {
                    return ((candle.c - mainBaseline) / mainBaseline) * 100;
                }
                return candle.c;
            }),
            borderColor: mainColor,
            backgroundColor: mainColor + '33',
            fill: !isComparison, // Only fill if not comparing
            pointRadius: 0,
            tension: 0.4,
            spanGaps: true,
        }
    ];

    for (let i = 0; i < comparisons.length; i++) {
        const comp = comparisons[i];
        const color = comparisonColors[i % comparisonColors.length];
        const baseline = comp.data.length > 0 ? comp.data[0].c : 0;

        datasets.push({
            label: `${comp.ticker} % Change`,
            data: sortedTimestamps.map(t => {
                const candle = comp.data.find(d => d.t === t);
                if (!candle) return null;
                if (baseline !== 0) {
                    return ((candle.c - baseline) / baseline) * 100;
                }
                return candle.c;
            }),
            borderColor: color,
            backgroundColor: color + '33',
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
                        callback: (value: any) => isComparison ? value + '%' : '$' + value,
                    },
                    grid: {
                        color: (context: any) => {
                            if (isComparison && context.tick.value === 0) {
                                return 'rgba(0, 0, 0, 0.5)';
                            }
                            return 'rgba(0, 0, 0, 0.1)';
                        }
                    }
                },
            },
            plugins: {
                legend: {
                    display: isComparison,
                },
            },
        },
    };
    return await chartJSNodeCanvas.renderToBuffer(configuration);
}