import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';

export interface UrbanDefinition {
    word: string;
    definition: string;
    example: string;
    thumbs_up: number;
    thumbs_down: number;
    permalink: string;
}

interface VoteData {
    up: number;
    down: number;
}

interface VoteResponse {
    votes: {
        [defid: string]: VoteData;
    };
}

/**
 * Fetches definitions from Urban Dictionary for a given term by scraping the website.
 * This is necessary because the public API currently returns 0 for vote counts.
 * @param term The search term.
 * @returns Top 3 definitions sorted by popularity.
 */
export async function fetchUrbanDefinitions(term: string): Promise<UrbanDefinition[]> {
    const baseUrl = 'https://www.urbandictionary.com';
    const url = `${baseUrl}/define.php?term=${encodeURIComponent(term)}`;
    
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`Urban Dictionary website error: ${response.statusText}`);
        }
        
        const html = await response.text();
        const dom = new JSDOM(html);
        const { document } = dom.window;
        
        const definitionElements = document.querySelectorAll('.definition');
        if (definitionElements.length === 0) {
            return [];
        }

        const body = document.querySelector('body');
        const voteSignature = body?.getAttribute('data-vote-signature');
        const voteDefidsStr = body?.getAttribute('data-vote-defids');
        const voteDefids: number[] = voteDefidsStr ? JSON.parse(voteDefidsStr) : [];

        let votes: { [defid: string]: VoteData } = {};
        if (voteSignature && voteDefids.length > 0) {
            try {
                const voteUrl = `${baseUrl}/api/vote?defids=${voteDefids.join(',')}&signature=${voteSignature}`;
                const voteResponse = await fetch(voteUrl);
                if (voteResponse.ok) {
                    const voteData = (await voteResponse.json()) as VoteResponse;
                    votes = voteData.votes;
                }
            } catch (voteError) {
                console.error('Error fetching votes from Urban Dictionary API:', voteError);
            }
        }

        const definitions: (UrbanDefinition & { defid: string })[] = [];

        definitionElements.forEach((el) => {
            const defid = el.getAttribute('data-defid') || '';
            const word = el.querySelector('.word')?.textContent?.trim() || '';
            const meaning = el.querySelector('.meaning')?.textContent?.trim() || '';
            const example = el.querySelector('.example')?.textContent?.trim() || '';
            
            if (defid && word) {
                const voteInfo = votes[defid] || { up: 0, down: 0 };
                definitions.push({
                    defid,
                    word,
                    definition: meaning,
                    example: example,
                    thumbs_up: voteInfo.up,
                    thumbs_down: voteInfo.down,
                    permalink: `${baseUrl}/define.php?term=${encodeURIComponent(word)}&defid=${defid}`
                });
            }
        });
        
        // Sort by thumbs_up in descending order and take the top 3
        return definitions
            .sort((a, b) => b.thumbs_up - a.thumbs_up)
            .slice(0, 3)
            .map(({ defid, ...rest }) => rest);
            
    } catch (error) {
        console.error('Error fetching Urban Dictionary definitions:', error);
        throw error;
    }
}