/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 * Centralized data directory management for persistent databases and state files.
 */

import * as fs from 'fs';
import * as path from 'path';

const migratedFiles = new Set<string>();

/**
 * Returns the resolved base directory for persistent state files (SQLite databases, JSON configs, etc.).
 * Defaults to the DATA_DIR environment variable if set, otherwise `<project_root>/data`.
 */
export function getDataDir(): string {
    const envDir = process.env.DATA_DIR;
    const baseDir = envDir && envDir.trim().length > 0
        ? path.resolve(envDir)
        : path.resolve(__dirname, '..', '..', 'data');

    if (!fs.existsSync(baseDir)) {
        try {
            fs.mkdirSync(baseDir, { recursive: true });
        } catch (err) {
            console.error(`[DataDir] Failed to create directory ${baseDir}:`, err);
        }
    }
    return baseDir;
}

/**
 * Resolves the absolute path to a file within the persistent data directory.
 * If the file does not exist in the data directory but exists in the legacy root directory,
 * it is automatically migrated (copied) to preserve existing state.
 */
export function getDataPath(filename: string): string {
    const dataDir = getDataDir();
    const targetPath = path.join(dataDir, filename);

    // Auto-migrate from legacy project root on first access during process lifetime
    if (!migratedFiles.has(filename)) {
        migratedFiles.add(filename);
        if (!fs.existsSync(targetPath)) {
            const legacyRootPath = path.resolve(__dirname, '..', '..', filename);
            try {
                if (fs.existsSync(legacyRootPath) && fs.statSync(legacyRootPath).isFile()) {
                    // Ensure any nested directory in targetPath exists
                    const targetDir = path.dirname(targetPath);
                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, { recursive: true });
                    }
                    fs.copyFileSync(legacyRootPath, targetPath);
                    console.log(`[DataDir] Migrated legacy file ${filename} to ${targetPath}`);
                }
            } catch (err) {
                console.error(`[DataDir] Failed to auto-migrate ${filename}:`, err);
            }
        }
    }

    return targetPath;
}
