import { config } from '../config';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';
import { fetchStockCandles } from './finnhub-api';

export interface Candle {
    t: number;
    c: number;
}

export async function getStockCandles(ticker: string, range: string = '1y'): Promise<Candle[]> {
    const to = Math.floor(Date.now() / 1000);
    let from: number;
    let resolution: string = 'D';

    switch (range) {
        case '1w':
            from = to - (7 * 24 * 60 * 60);
            resolution = '60';
            break;
        case '1m':
            from = to - (31 * 24 * 60 * 60);
            resolution = 'D';
            break;
        case '3m':
            from = to - (93 * 24 * 60 * 60);
            resolution = 'D';
            break;
        case '6m':
            from = to - (186 * 24 * 60 * 60);
            resolution = 'D';
            break;
        case '1y':
            from = to - (365 * 24 * 60 * 60);
            resolution = 'D';
            break;
        case '5y':
            from = to - (5 * 365 * 24 * 60 * 60);
            resolution = 'W';
            break;
        case 'my':
            from = 0; // All time
            resolution = 'M';
            break;
        default:
            from = to - (365 * 24 * 60 * 60);
            resolution = 'D';
            break;
    }

    const data = await fetchStockCandles(ticker, resolution, from, to);

    if (!data || !data.c || !data.t) {
        return [];
    }

    const candles: Candle[] = data.t.map((time, index) => ({
        t: time * 1000, // Convert to ms
        c: data.c[index]
    }));

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