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