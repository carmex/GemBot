import { App } from '@slack/bolt';
import * as cron from 'node-cron';
import { getDueReminders, markReminderAsSent } from './reminder-db';

/**
 * Starts the background worker for reminders.
 * Runs every minute to check for due reminders and send them.
 * @param app The Slack Bolt App instance.
 */
export function startReminderWorker(app: App): void {
    console.log('[ReminderWorker] Starting reminder worker...');
    
    // Run every minute
    cron.schedule('* * * * *', async () => {
        try {
            const dueReminders = getDueReminders();
            if (dueReminders.length === 0) return;

            console.log(`[ReminderWorker] Found ${dueReminders.length} due reminders.`);

            for (const reminder of dueReminders) {
                try {
                    await app.client.chat.postMessage({
                        channel: reminder.channel_id,
                        thread_ts: reminder.thread_ts || undefined,
                        text: `Hey <@${reminder.user_id}>, here is your reminder: *${reminder.message}*`,
                    });
                    
                    markReminderAsSent(reminder.id);
                } catch (error) {
                    console.error(`[ReminderWorker] Error sending reminder ${reminder.id}:`, error);
                }
            }
        } catch (error) {
            console.error('[ReminderWorker] Error in reminder worker loop:', error);
        }
    });
    
    console.log('[ReminderWorker] Reminder worker scheduled (every minute).');
}
