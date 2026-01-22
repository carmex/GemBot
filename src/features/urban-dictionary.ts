import fetch from 'node-fetch';

export interface UrbanDefinition {
    word: string;
    definition: string;
    example: string;
    thumbs_up: number;
    thumbs_down: number;
    permalink: string;
}

interface UrbanResponse {
    list: UrbanDefinition[];
}

/**
 * Fetches definitions from Urban Dictionary for a given term.
 * @param term The search term.
 * @returns Top 3 definitions sorted by popularity.
 */
export async function fetchUrbanDefinitions(term: string): Promise<UrbanDefinition[]> {
    const url = `https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Urban Dictionary API error: ${response.statusText}`);
        }
        
        const data = (await response.json()) as UrbanResponse;
        
        if (!data.list || data.list.length === 0) {
            return [];
        }
        
        // Sort by thumbs_up in descending order and take the top 3
        return data.list
            .sort((a, b) => b.thumbs_up - a.thumbs_up)
            .slice(0, 3);
    } catch (error) {
        console.error('Error fetching Urban Dictionary definitions:', error);
        throw error;
    }
}
