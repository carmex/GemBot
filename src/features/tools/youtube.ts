import fetch from 'node-fetch';
import { config } from '../../config';

export interface YouTubeSearchResult {
    videoId: string;
    title: string;
    description: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails: any;
}

export interface YouTubeTranscriptItem {
    text: string;
    start: number;
    duration: number;
}

/**
 * Service for native YouTube operations bypassing broken MCP servers
 */
export class YouTubeService {
    private static apiKey = config.search.googleApiKey;

    /**
     * Search for videos on YouTube using the Data API v3
     */
    static async searchVideos(query: string, maxResults: number = 5): Promise<YouTubeSearchResult[]> {
        if (!this.apiKey) {
            throw new Error('YouTube API key (GOOGLE_API_KEY) is not configured.');
        }

        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&maxResults=${maxResults}&type=video&key=${this.apiKey}`;
        
        const response = await fetch(url);
        if (!response.ok) {
            const error: any = await response.json();
            throw new Error(`YouTube Search API error: ${error.error?.message || response.statusText}`);
        }

        const data: any = await response.json();
        return (data.items || []).map((item: any) => ({
            videoId: item.id.videoId,
            title: item.snippet.title,
            description: item.snippet.description,
            channelTitle: item.snippet.channelTitle,
            publishedAt: item.snippet.publishedAt,
            thumbnails: item.snippet.thumbnails
        }));
    }

    /**
     * Get detailed information about a YouTube video
     */
    static async getVideo(videoId: string): Promise<any> {
        if (!this.apiKey) {
            throw new Error('YouTube API key (GOOGLE_API_KEY) is not configured.');
        }

        const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${videoId}&key=${this.apiKey}`;
        
        const response = await fetch(url);
        if (!response.ok) {
            const error: any = await response.json();
            throw new Error(`YouTube Videos API error: ${error.error?.message || response.statusText}`);
        }

        const data: any = await response.json();
        if (!data.items || data.items.length === 0) {
            throw new Error(`Video not found: ${videoId}`);
        }

        return data.items[0];
    }

    /**
     * Get the transcript of a YouTube video by scraping the player data
     * This bypasses the need for the broken youtube-transcript package
     */
    static async getTranscript(videoId: string, lang: string = 'en'): Promise<YouTubeTranscriptItem[]> {
        try {
            // 1. Fetch the video page to get the initial player response
            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            const response = await fetch(videoUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept-Language': `${lang},en;q=0.9`
                }
            });
            const html = await response.text();

            // 2. Extract the player response which contains captions
            let playerResponse: any;
            const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]+?})\s*;\s*(?:var\s+meta|<\/script|\n)/);
            
            if (playerResponseMatch) {
                playerResponse = JSON.parse(playerResponseMatch[1]);
            } else {
                // Fallback: try to find the captions object directly if the above fails
                const captionsMatch = html.match(/"captions":\s*({[\s\S]+?}),\s*"videoDetails"/);
                if (captionsMatch) {
                    playerResponse = { captions: JSON.parse(captionsMatch[1]) };
                }
            }

            if (!playerResponse || !playerResponse.captions || !playerResponse.captions.playerCaptionsTracklistRenderer) {
                throw new Error('Could not find captions in YouTube page. Transcripts might be disabled for this video.');
            }

            return this.fetchTranscriptFromRenderer(playerResponse.captions.playerCaptionsTracklistRenderer, lang);
        } catch (error) {
            throw new Error(`Failed to get transcript: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private static async fetchTranscriptFromRenderer(renderer: any, targetLang: string): Promise<YouTubeTranscriptItem[]> {
        if (!renderer || !renderer.captionTracks || renderer.captionTracks.length === 0) {
            throw new Error('No caption tracks found for this video.');
        }

        // Find the best matching track
        let track = renderer.captionTracks.find((t: any) => t.languageCode === targetLang);
        if (!track) {
            track = renderer.captionTracks[0]; // Fallback to first available
        }

        const transcriptUrl = `${track.baseUrl}&fmt=srv3`;
        const transcriptResponse = await fetch(transcriptUrl, {
            headers: {
                'Referer': 'https://www.youtube.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            }
        });
        
        if (!transcriptResponse.ok) {
            throw new Error(`Failed to fetch transcript data: ${transcriptResponse.statusText}`);
        }

        const body = await transcriptResponse.text();
        if (!body || body.trim() === '' || body.includes('timedtext')) {
            console.warn(`[YouTube] Empty or invalid transcript body for ${transcriptUrl}`);
            return [];
        }

        // Parse srv3 XML format manually
        const regex = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]+?)<\/text>/g;
        const items: YouTubeTranscriptItem[] = [];
        let match;
        while ((match = regex.exec(body)) !== null) {
            items.push({
                start: parseFloat(match[1]),
                duration: parseFloat(match[2]),
                text: match[3]
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/\n/g, ' ')
                    .trim()
            });
        }

        return items;
    }
}
