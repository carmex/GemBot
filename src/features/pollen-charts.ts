/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 * Copyright (C) 2025 David Lott
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { PollenData } from '../types';

/**
 * Generates a comparative line chart for pollen data.
 * @param zipCode The zip code for the data.
 * @param data The array of PollenData objects.
 * @returns A promise that resolves to a Buffer containing the PNG image.
 */
export async function generatePollenChart(zipCode: string, data: PollenData[]): Promise<Buffer> {
    const width = 800;
    const height = 400;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

    // Reverse data if it's from newest to oldest to show correctly on chart
    const sortedData = [...data].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const labels = sortedData.map(item => {
        const date = new Date(item.timestamp);
        return `${date.getMonth() + 1}/${date.getDate()}`;
    });

    const configuration: any = {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Grass Pollen',
                    data: sortedData.map(item => item.grass_pollen),
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    tension: 0.1,
                    fill: false
                },
                {
                    label: 'Tree Pollen',
                    data: sortedData.map(item => item.tree_pollen),
                    borderColor: 'rgb(255, 159, 64)',
                    backgroundColor: 'rgba(255, 159, 64, 0.2)',
                    tension: 0.1,
                    fill: false
                },
                {
                    label: 'Weed Pollen',
                    data: sortedData.map(item => item.weed_pollen),
                    borderColor: 'rgb(153, 102, 255)',
                    backgroundColor: 'rgba(153, 102, 255, 0.2)',
                    tension: 0.1,
                    fill: false
                }
            ]
        },
        options: {
            responsive: false,
            plugins: {
                title: {
                    display: true,
                    text: `30-Day Pollen History for Zip Code: ${zipCode}`
                }
            },
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Date'
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Pollen Count'
                    },
                    beginAtZero: true
                }
            }
        }
    };

    return chartJSNodeCanvas.renderToBuffer(configuration);
}
