import Database from 'better-sqlite3';
import path from 'path';

// Determine the correct directory for the database
const dbPath = path.join(__dirname, '..', '..', 'threads.db');

const db = new Database(dbPath);

/**
 * Initializes the database and creates the threads table if it doesn't exist.
 */
export function initializeThreadDatabase(): void {
  try {
    console.log(`[ThreadDB] Initializing database at path: ${dbPath}`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        thread_ts TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        history TEXT NOT NULL,
        last_updated DATETIME DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );
    `);
    console.log(`[ThreadDB] Database initialized successfully`);

    // Log current table count
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM threads');
    const result = countStmt.get() as { count: number };
    console.log(`[ThreadDB] Current thread count in database: ${result.count}`);

  } catch (error) {
    console.error(`[ThreadDB] Error initializing database:`, error);
  }
}

/**
 * Saves or updates a conversation thread's history.
 * @param thread_ts The unique timestamp of the thread.
 * @param channel_id The ID of the channel where the thread resides.
 * @param history The conversation history object.
 */
export function saveThreadHistory(thread_ts: string, channel_id: string, history: object): void {

  if (!thread_ts || !channel_id || !history) {
    console.error(`[ThreadDB] Invalid parameters - thread_ts: ${thread_ts}, channel_id: ${channel_id}, history: ${!!history}`);
    return;
  }

  try {
    const historyJson = JSON.stringify(history);

    const stmt = db.prepare(`
      INSERT INTO threads (thread_ts, channel_id, history, last_updated)
      VALUES (?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(thread_ts) DO UPDATE SET
        history = excluded.history,
        last_updated = excluded.last_updated
    `);

    const result = stmt.run(thread_ts, channel_id, historyJson);

    // Verify the save by querying back
    const verifyStmt = db.prepare('SELECT COUNT(*) as count FROM threads WHERE thread_ts = ?');
    const verifyResult = verifyStmt.get(thread_ts) as { count: number };

  } catch (error) {
    console.error(`[ThreadDB] Error saving thread history for ${thread_ts}:`, error);
  }
}

/**
 * Retrieves a conversation thread's history.
 * @param thread_ts The unique timestamp of the thread.
 * @returns The parsed conversation history object or null if not found.
 */
export function getThreadHistory(thread_ts: string): object | null {
  try {
    const stmt = db.prepare('SELECT history FROM threads WHERE thread_ts = ?');
    const row = stmt.get(thread_ts) as { history: string } | undefined;

    if (row) {
      console.log(`[ThreadDB] Found history for ${thread_ts}, JSON length: ${row.history.length}`);
      const parsed = JSON.parse(row.history);
      console.log(`[ThreadDB] Successfully parsed history with ${Array.isArray(parsed) ? parsed.length : 'unknown'} items`);
      return parsed;
    } else {
      return null;
    }
  } catch (error) {
    console.error(`[ThreadDB] Error retrieving thread history for ${thread_ts}:`, error);
    return null;
  }
}

let botSettingsTableInitialized = false;
function ensureBotSettingsTable(): void {
  if (botSettingsTableInitialized) return;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );
    `);
    botSettingsTableInitialized = true;
  } catch (error) {
    // Ignore error
  }
}

/**
 * Retrieves a bot setting by key.
 * @param key The key of the setting.
 * @returns The string value or null if not found.
 */
export function getBotSetting(key: string): string | null {
  try {
    ensureBotSettingsTable();
    const stmt = db.prepare('SELECT value FROM bot_settings WHERE key = ?');
    const row = stmt.get(key) as { value: string } | undefined;
    return row ? row.value : null;
  } catch (error) {
    console.error(`[ThreadDB] Error retrieving bot setting for ${key}:`, error);
    return null;
  }
}

/**
 * Upserts a bot setting by key.
 * @param key The key of the setting.
 * @param value The value of the setting.
 */
export function setBotSetting(key: string, value: string): void {
  try {
    ensureBotSettingsTable();
    const stmt = db.prepare(`
      INSERT INTO bot_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now', 'localtime'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now', 'localtime')
    `);
    stmt.run(key, value);
  } catch (error) {
    console.error(`[ThreadDB] Error setting bot setting for ${key}:`, error);
  }
}

/**
 * Deletes a bot setting by key.
 * @param key The key of the setting.
 */
export function deleteBotSetting(key: string): void {
  try {
    ensureBotSettingsTable();
    const stmt = db.prepare('DELETE FROM bot_settings WHERE key = ?');
    stmt.run(key);
  } catch (error) {
    console.error(`[ThreadDB] Error deleting bot setting for ${key}:`, error);
  }
}

