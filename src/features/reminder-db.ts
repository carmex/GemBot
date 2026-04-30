import Database from 'better-sqlite3';
import path from 'path';

// Determine the correct directory for the database
const dbPath = path.join(__dirname, '..', '..', 'reminders.db');

const db = new Database(dbPath);

export interface ReminderData {
    user_id: string;
    channel_id: string;
    thread_ts?: string;
    message: string;
    remind_at: string; // ISO 8601 string
}

export interface Reminder extends ReminderData {
    id: number;
    status: 'PENDING' | 'SENT' | 'CANCELLED';
    created_at: string;
}

/**
 * Initializes the database and creates the reminders table if it doesn't exist.
 */
export function initReminderDb(): void {
    try {
        console.log(`[ReminderDB] Initializing database at path: ${dbPath}`);
        db.exec(`
            CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                thread_ts TEXT,
                message TEXT NOT NULL,
                remind_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'PENDING',
                created_at DATETIME DEFAULT (datetime('now'))
            )
        `);
        console.log(`[ReminderDB] Database initialized successfully`);
    } catch (error) {
        console.error(`[ReminderDB] Error initializing database:`, error);
    }
}

/**
 * Creates a new pending reminder.
 * @param data The reminder data.
 * @returns The ID of the newly created reminder.
 */
export function createReminder(data: ReminderData): number | bigint {
    try {
        const stmt = db.prepare(`
            INSERT INTO reminders (user_id, channel_id, thread_ts, message, remind_at, status)
            VALUES (?, ?, ?, ?, ?, 'PENDING')
        `);
        const result = stmt.run(data.user_id, data.channel_id, data.thread_ts || null, data.message, data.remind_at);
        console.log(`[ReminderDB] Created reminder ${result.lastInsertRowid} for user ${data.user_id} at ${data.remind_at}`);
        return result.lastInsertRowid;
    } catch (error) {
        console.error(`[ReminderDB] Error creating reminder:`, error);
        throw error;
    }
}

/**
 * Retrieves all PENDING reminders where remind_at is in the past.
 * @returns An array of due reminders.
 */
export function getDueReminders(): Reminder[] {
    try {
        // Use datetime() for comparison to ensure correct date-time handling
        const stmt = db.prepare(`
            SELECT * FROM reminders 
            WHERE status = 'PENDING' AND datetime(remind_at) <= datetime('now')
        `);
        return stmt.all() as Reminder[];
    } catch (error) {
        console.error(`[ReminderDB] Error getting due reminders:`, error);
        return [];
    }
}

/**
 * Marks a reminder as SENT.
 * @param id The ID of the reminder to mark as sent.
 */
export function markReminderAsSent(id: number): void {
    try {
        const stmt = db.prepare(`
            UPDATE reminders SET status = 'SENT' WHERE id = ?
        `);
        stmt.run(id);
        console.log(`[ReminderDB] Marked reminder ${id} as SENT`);
    } catch (error) {
        console.error(`[ReminderDB] Error marking reminder as sent:`, error);
    }
}
