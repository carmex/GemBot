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

import {App} from '@slack/bolt';

// Extend the App type to include our custom types
export interface SlackApp extends App {}

// Message event types
export interface MessageEvent {
    user: string;
    text: string;
    channel: string;
    ts: string;
}

// App mention event types
export interface AppMentionEvent {
    user: string;
    text: string;
    channel: string;
    ts: string;
}

// Command types
export interface CommandEvent {
    user_id: string;
    command: string;
    text: string;
    channel_id: string;
}

// Action types

export interface ActionEvent {

    user: {

        id: string;

    };

    action_id: string;

}



export interface Candle {

    t: number;

    c: number;

}



export interface Split {

    date: string;

    fromFactor: number;

    toFactor: number;

    symbol: string;

}

 