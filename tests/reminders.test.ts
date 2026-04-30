import { initReminderDb, createReminder, getDueReminders, markReminderAsSent } from '../src/features/reminder-db';
import path from 'path';
import fs from 'fs';

async function runTests() {
    console.log("Running Reminders Logic Tests...");

    try {
        // Initialize DB
        initReminderDb();

        // 1. Test creating a reminder
        console.log("Test 1: Creating a reminder...");
        const data1 = {
            user_id: 'U12345',
            channel_id: 'C12345',
            message: 'Future reminder',
            remind_at: new Date(Date.now() + 10000).toISOString() // 10 seconds from now
        };
        const id1 = createReminder(data1);
        if (id1) {
            console.log(`PASSED: Created reminder with ID ${id1}`);
        } else {
            console.error("FAILED: Could not create reminder");
            process.exit(1);
        }

        // 2. Test retrieving due reminders
        console.log("Test 2: Retrieving due reminders...");
        const pastDate = new Date(Date.now() - 5000).toISOString(); // 5 seconds ago
        const data2 = {
            user_id: 'U12345',
            channel_id: 'C12345',
            message: 'Due reminder',
            remind_at: pastDate
        };
        const id2 = createReminder(data2);
        
        // Wait a bit to ensure SQLite date comparison works (SQLite uses seconds)
        const due = getDueReminders();
        const found = due.find(r => r.id === Number(id2));
        if (found && found.message === 'Due reminder') {
            console.log("PASSED: Retrieved due reminder");
        } else {
            console.error("FAILED: Could not retrieve due reminder");
            console.log("Due reminders:", JSON.stringify(due, null, 2));
            process.exit(1);
        }

        // 3. Test marking as sent
        console.log("Test 3: Marking reminder as sent...");
        markReminderAsSent(Number(id2));
        const dueAfter = getDueReminders();
        const foundAfter = dueAfter.find(r => r.id === Number(id2));
        if (!foundAfter) {
            console.log("PASSED: Reminder marked as sent and no longer in due list");
        } else {
            console.error("FAILED: Reminder still in due list after marking as sent");
            process.exit(1);
        }

        console.log("\nAll reminder tests passed!");
    } catch (error) {
        console.error("An error occurred during testing:", error);
        process.exit(1);
    }
}

runTests();
