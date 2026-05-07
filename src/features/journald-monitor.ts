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

import { spawn } from 'child_process';
import readline from 'readline';
import { App } from '@slack/bolt';
import { config } from '../config';

interface JournalEntry {
    MESSAGE: string;
    [key: string]: any;
}

interface TierListLog {
    level: string;
    event: string;
    tool: string;
    title: string;
    itemCount: number;
    tierCount: number;
    imageData: string;
}

const BASE64_START = 'BASE64_START:';
const BASE64_END = ':BASE64_END';

export function startJournaldMonitor(app: App) {
    if (!config.journaldMonitor.enabled) {
        return;
    }
    if (process.platform !== 'linux') {
        console.warn(`Journald monitor is only supported on Linux. Current platform: ${process.platform}`);
        return;
    }

    const { service, channel } = config.journaldMonitor;
    console.log(`Starting journald monitor for service: ${service}, targeting channel: ${channel}`);

    let journalctl: any;
    try {
        journalctl = spawn('journalctl', [
            '-u', service,
            '-f',
            '--all',
            '-o', 'json',
            '-n', '0'
        ]);
    } catch (spawnError) {
        console.error('Failed to spawn journalctl process:', spawnError);
        return;
    }

    // Handle spawn error (e.g. command not found)
    journalctl.on('error', (err: any) => {
        if (err.code === 'ENOENT') {
            console.error('FATAL: journalctl command not found. Please ensure systemd is installed.');
        } else {
            console.error('Error spawning journalctl:', err);
        }
        // Don't restart immediately if it failed to spawn
    });

    const rl = readline.createInterface({
        input: journalctl.stdout,
        terminal: false
    });

    let messageBuffer = '';
    let lastStreamId = '';

    rl.on('line', async (line) => {
        try {
            const entry: JournalEntry = JSON.parse(line);
            
            // Check if this is a fragment of a larger message
            const currentStreamId = entry._STREAM_ID || '';
            const isFragment = entry._LINE_BREAK === 'pipe' || entry._LINE_BREAK === 'truncate' || entry.hasOwnProperty('_LINE_BREAK');

            let rawMessage = entry.MESSAGE;
            if (Array.isArray(rawMessage)) {
                rawMessage = Buffer.from(rawMessage).toString('utf-8');
            }

            if (!rawMessage) return;

            // Reassembly logic
            if (currentStreamId && currentStreamId === lastStreamId) {
                messageBuffer += rawMessage;
            } else {
                // If we have a buffered message, try to process it before starting a new one
                if (messageBuffer) {
                    await processReassembledMessage(messageBuffer, channel, app);
                }
                messageBuffer = rawMessage;
                lastStreamId = currentStreamId;
            }

            // If this entry doesn't have a line break indicator, it's the end of a message
            if (!isFragment) {
                await processReassembledMessage(messageBuffer, channel, app);
                messageBuffer = '';
                lastStreamId = '';
            }

        } catch (error) {
            // Ignore parse errors on raw lines
        }
    });
}

async function processReassembledMessage(rawMessage: string, channel: string, app: any) {
    try {
        // Attempt to parse as JSON
        const messageObj = JSON.parse(rawMessage);
        const log = messageObj as TierListLog;

        if (log.event === 'tool_call' && log.tool === 'generate_tier_list') {
            console.log(`Debug: Reassembled tier list event (length: ${rawMessage.length})`);
            
            if (!log.imageData) return;

            const hasStart = log.imageData.includes(BASE64_START);
            const hasEnd = log.imageData.includes(BASE64_END);

            if (hasStart && hasEnd) {
                console.log(`Processing reassembled tier list image: ${log.title}`);

                const startIndex = log.imageData.indexOf(BASE64_START) + BASE64_START.length;
                const endIndex = log.imageData.indexOf(BASE64_END);
                const base64Data = log.imageData.substring(startIndex, endIndex);

                const buffer = Buffer.from(base64Data, 'base64');

                try {
                    await app.client.files.uploadV2({
                        channel_id: channel,
                        file: buffer,
                        filename: `tier-list-${Date.now()}.png`,
                        initial_comment: `🎨 *Centralized Tier List Feed*\n📌 *Title:* ${log.title}\n📦 Items: ${log.itemCount} | 📊 Tiers: ${log.tierCount}`,
                    });
                    console.log(`Successfully uploaded centralized tier list image.`);
                } catch (error) {
                    console.error('Error uploading reassembled image to Slack:', error);
                }
            }
        }
    } catch (e) {
        // Not a valid JSON or not our log, ignore
    }
}
    journalctl.stderr.on('data', (data: any) => {
        console.error(`journalctl stderr: ${data}`);
    });

    journalctl.on('exit', (code: number | null) => {
        if (code === 0) {
            console.log('journalctl process exited normally.');
        } else {
            console.warn(`journalctl process exited with code ${code}. Restarting in 10 seconds...`);
            setTimeout(() => startJournaldMonitor(app), 10000);
        }
    });
}
