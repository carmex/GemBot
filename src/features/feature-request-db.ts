import Database from 'better-sqlite3';
import path from 'path';

// Determine the correct directory for the database
const dbPath = path.join(__dirname, '..', '..', 'feature_requests.db');

const db = new Database(dbPath);

export interface FeatureRequestData {
    formatted_timestamp?: string; // ISO string
    slack_msg_ts: string;
    channel_id: string;
    username: string;
    user_id?: string;
    repo_name: string;
    repo_path?: string;
    request_text: string;
    plan_thoughts?: string;
    final_plan?: string;
    implementation_thoughts?: string;
    final_summary?: string;
    state?: string;
    pr_url?: string;
    last_updated?: string;
}

/**
 * Initializes the database and creates the feature_requests table if it doesn't exist.
 */
export function initFeatureRequestDb(): void {
    try {
        console.log(`[FeatureRequestDB] Initializing database at path: ${dbPath}`);
        db.exec(`
      CREATE TABLE IF NOT EXISTS feature_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        formatted_timestamp TEXT,
        slack_msg_ts TEXT UNIQUE,
        channel_id TEXT,
        username TEXT,
        user_id TEXT,
        repo_name TEXT,
        repo_path TEXT,
        request_text TEXT,
        plan_thoughts TEXT,
        final_plan TEXT,
        implementation_thoughts TEXT,
        final_summary TEXT,
        state TEXT,
        pr_url TEXT,
        last_updated DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `);

        // Migration: Add new columns if they don't exist
        const columns = [
            { name: 'user_id', type: 'TEXT' },
            { name: 'channel_id', type: 'TEXT' },
            { name: 'repo_path', type: 'TEXT' },
            { name: 'state', type: 'TEXT' },
            { name: 'pr_url', type: 'TEXT' }
        ];

        for (const col of columns) {
            try {
                db.exec(`ALTER TABLE feature_requests ADD COLUMN ${col.name} ${col.type};`);
                console.log(`[FeatureRequestDB] Migration: Added ${col.name} column to feature_requests table`);
            } catch (error: any) {
                // Ignore error if column already exists
                if (!error.message.includes('duplicate column name')) {
                    console.warn(`[FeatureRequestDB] Migration warning for ${col.name}: ${error.message}`);
                }
            }
        }

        console.log(`[FeatureRequestDB] Database initialized successfully`);
    } catch (error) {
        console.error(`[FeatureRequestDB] Error initializing database:`, error);
    }
}

/**
 * Creates a new feature request record.
 */
export function createFeatureRequest(data: FeatureRequestData): void {
    try {
        const stmt = db.prepare(`
            INSERT INTO feature_requests (
                formatted_timestamp, slack_msg_ts, channel_id, username, user_id, repo_name, request_text, last_updated
            ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        `);
        stmt.run(
            new Date().toISOString(),
            data.slack_msg_ts,
            data.channel_id,
            data.username,
            data.user_id || null,
            data.repo_name,
            data.request_text
        );
        console.log(`[FeatureRequestDB] Created new request for thread ${data.slack_msg_ts}`);
    } catch (error) {
        console.error(`[FeatureRequestDB] Error creating feature request:`, error);
    }
}

/**
 * Updates an existing feature request record.
 */
export function updateFeatureRequest(slack_msg_ts: string, data: Partial<FeatureRequestData>): void {
    try {
        const fields: string[] = [];
        const values: any[] = [];

        if (data.plan_thoughts !== undefined) {
            fields.push('plan_thoughts = ?');
            values.push(data.plan_thoughts);
        }
        if (data.final_plan !== undefined) {
            fields.push('final_plan = ?');
            values.push(data.final_plan);
        }
        if (data.implementation_thoughts !== undefined) {
            fields.push('implementation_thoughts = ?');
            values.push(data.implementation_thoughts);
        }
        if (data.final_summary !== undefined) {
            fields.push('final_summary = ?');
            values.push(data.final_summary);
        }
        if (data.repo_path !== undefined) {
            fields.push('repo_path = ?');
            values.push(data.repo_path);
        }
        if (data.state !== undefined) {
            fields.push('state = ?');
            values.push(data.state);
        }
        if (data.pr_url !== undefined) {
            fields.push('pr_url = ?');
            values.push(data.pr_url);
        }

        if (fields.length === 0) return;

        fields.push("last_updated = datetime('now', 'localtime')");
        values.push(slack_msg_ts);

        const stmt = db.prepare(`
            UPDATE feature_requests
            SET ${fields.join(', ')}
            WHERE slack_msg_ts = ?
        `);

        stmt.run(...values);
        console.log(`[FeatureRequestDB] Updated request for thread ${slack_msg_ts}`);
    } catch (error) {
        console.error(`[FeatureRequestDB] Error updating feature request:`, error);
    }
}

/**
 * Retrieves all open feature requests (those not in COMPLETED or ABORTED state).
 */
export function getOpenFeatureRequests(): FeatureRequestData[] {
    try {
        const stmt = db.prepare(`
            SELECT * FROM feature_requests 
            WHERE state IS NULL OR (state != 'COMPLETED' AND state != 'ABORTED')
        `);
        return stmt.all() as FeatureRequestData[];
    } catch (error) {
        console.error(`[FeatureRequestDB] Error fetching open feature requests:`, error);
        return [];
    }
}
