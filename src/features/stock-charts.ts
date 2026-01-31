import fetch from 'node-fetch';
import { config } from '../config';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';
import { sleep } from './utils';
import { Candle, Split } from '../types';
import { fetchStockSplits, fetchStockCandles, fetchCryptoCandles } from './alphavantage-api';

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
    let candles = await fetchCryptoCandles(ticker);

    if (candles.length > 0) {
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

export async function generateChart(
    mainTicker: string,
    mainData: Candle[],
    compareTicker?: string,
    compareData?: Candle[]
): Promise<Buffer> {
    const width = 800;
    const height = 400;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: '#ffffff' });

    const isComparison = !!(compareTicker && compareData && compareData.length > 0);
    const mainBaseline = mainData.length > 0 ? mainData[0].c : 0;
    const compareBaseline = (isComparison && compareData && compareData.length > 0) ? compareData[0].c : 0;

    const lastPrice = mainData[mainData.length - 1].c;
    const firstPrice = mainData[0].c;
    const isUp = lastPrice >= firstPrice;
    const mainColor = isUp ? 'rgb(75, 192, 192)' : 'rgb(255, 99, 132)';
    const compareColor = 'rgb(54, 162, 235)'; // Blue

    // Date alignment
    const allTimestamps = new Set<number>();
    mainData.forEach(d => allTimestamps.add(d.t));
    if (isComparison && compareData) {
        compareData.forEach(d => allTimestamps.add(d.t));
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

    if (isComparison && compareData && compareData.length > 0) {
        datasets.push({
            label: `${compareTicker} % Change`,
            data: sortedTimestamps.map(t => {
                const candle = compareData.find(d => d.t === t);
                if (!candle) return null;
                if (compareBaseline !== 0) {
                    return ((candle.c - compareBaseline) / compareBaseline) * 100;
                }
                return candle.c;
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