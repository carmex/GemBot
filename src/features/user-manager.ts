import { WebClient } from '@slack/web-api';

/**
 * UserManager centralizes user profile fetching and caching.
 * It provides a consistent name resolution strategy based on Slack's UI recommendations.
 */
export class UserManager {
    private static instance: UserManager;
    private nameCache: Map<string, string> = new Map();

    private constructor() {}

    /**
     * Gets the singleton instance of UserManager.
     */
    public static getInstance(): UserManager {
        if (!UserManager.instance) {
            UserManager.instance = new UserManager();
        }
        return UserManager.instance;
    }

    /**
     * Resolves a Slack user ID to a preferred name.
     * Priority: 
     * 1. Display Name (nickname/name in Slack)
     * 2. Real Name (full/legal name)
     * 3. Username (legacy/internal handle)
     * 4. User ID (fallback if API call fails)
     * 
     * @param userId The Slack user ID (e.g., U12345)
     * @param client The Slack WebClient instance
     * @returns The resolved name
     */
    public async getUserName(userId: string, client: WebClient): Promise<string> {
        if (this.nameCache.has(userId)) {
            return this.nameCache.get(userId)!;
        }

        try {
            const result = await client.users.info({ user: userId });
            if (result.ok && result.user) {
                const user = result.user;
                
                // Priority resolution
                const displayName = user.profile?.display_name;
                const realName = user.real_name || user.profile?.real_name;
                const username = user.name;

                const resolvedName = (displayName && displayName.trim() !== '') 
                    ? displayName 
                    : (realName || username || userId);
                
                this.nameCache.set(userId, resolvedName);
                return resolvedName;
            }
        } catch (error) {
            console.error(`[UserManager] Error fetching user info for ${userId}:`, error);
        }

        return userId; // Fallback to User ID if API call fails or user not found
    }

    /**
     * Clears the name cache.
     */
    public clearCache(): void {
        this.nameCache.clear();
    }
}

export const userManager = UserManager.getInstance();
