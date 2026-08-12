/*
 * GemBot: An intelligent Slack assistant with AI capabilities.
 * Copyright (C) 2025 David Lott
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import fetch from 'node-fetch';
import { fetchStockNews } from './finnhub-api';

// Curated static dataset of 30+ verified famous quotes with author attribution
export const FAMOUS_QUOTES: { text: string; author: string }[] = [
    { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
    { text: "In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
    { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
    { text: "You will face many defeats in life, but never let yourself be defeated.", author: "Maya Angelou" },
    { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
    { text: "Be yourself; everyone else is already taken.", author: "Oscar Wilde" },
    { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
    { text: "Do what you can, with what you have, where you are.", author: "Theodore Roosevelt" },
    { text: "Life is what happens when you're busy making other plans.", author: "John Lennon" },
    { text: "Spread love everywhere you go. Let no one ever come to you without leaving happier.", author: "Mother Teresa" },
    { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
    { text: "Tell me and I forget. Teach me and I remember. Involve me and I learn.", author: "Benjamin Franklin" },
    { text: "It is during our darkest moments that we must focus to see the light.", author: "Aristotle" },
    { text: "Whoever is happy will make others happy too.", author: "Anne Frank" },
    { text: "Do not go where the path may lead, go instead where there is no path and leave a trail.", author: "Ralph Waldo Emerson" },
    { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
    { text: "Whether you think you can or you think you can't, you're right.", author: "Henry Ford" },
    { text: "I have learned over the years that when one's mind is made up, this diminishes fear.", author: "Rosa Parks" },
    { text: "I alone cannot change the world, but I can cast a stone across the waters to create many ripples.", author: "Mother Teresa" },
    { text: "Strive not to be a success, but rather to be of value.", author: "Albert Einstein" },
    { text: "Two roads diverged in a wood, and I—I took the one less traveled by, And that has made all the difference.", author: "Robert Frost" },
    { text: "I attribute my success to this: I never gave or took any excuse.", author: "Florence Nightingale" },
    { text: "The most difficult thing is the decision to act, the rest is merely tenacity.", author: "Amelia Earhart" },
    { text: "Everything you've ever wanted is on the other side of fear.", author: "George Addair" },
    { text: "We become what we think about.", author: "Earl Nightingale" },
    { text: "An unexamined life is not worth living.", author: "Socrates" },
    { text: "Eighty percent of success is showing up.", author: "Woody Allen" },
    { text: "Your time is limited, so don't waste it living someone else's life.", author: "Steve Jobs" },
    { text: "Winning isn't everything, but wanting to win is.", author: "Vince Lombardi" },
    { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
    { text: "Everything has beauty, but not everyone sees it.", author: "Confucius" },
    { text: "Happiness is not something ready made. It comes from your own actions.", author: "Dalai Lama" }
];

// Offline fallback trivia dataset
export const FALLBACK_TRIVIA: string[] = [
    "Honey never spoils. Archaeologists have found pots of honey in ancient Egyptian tombs that are over 3,000 years old and still edible.",
    "A day on Venus is longer than a year on Venus.",
    "Bananas are berries, but strawberries are not.",
    "Octopuses have three hearts and blue blood.",
    "Wombat poop is cube-shaped, which stops it from rolling away.",
    "The shortest war in history lasted 38 minutes, between Britain and Zanzibar in 1896.",
    "A flock of crows is known as a murder.",
    "Sea otters hold hands while sleeping to keep from drifting apart.",
    "Cowboy hats were originally designed to scoops up water for drinking.",
    "The Eiffel Tower can be 15 cm taller during the summer due to thermal expansion."
];

// Offline fallback news headlines
export const FALLBACK_NEWS: string[] = [
    "Tech Sector Resilience: AI and cloud computing investments continue to drive market innovation.",
    "Global Clean Energy Adoption Reaches Record Highs Across Major Economies.",
    "Market Outlook: Central banks signal steady interest rate trajectory amid stabilizing inflation.",
    "Space Exploration Milestone: Commercial satellites launch next-generation Earth observation network.",
    "Quantum Computing Advancement: Breakthrough reported in error-mitigation quantum algorithms."
];

// Offline fallback historical events
export const FALLBACK_HISTORY: { year: number; event: string }[] = [
    { year: 1969, event: "Apollo 11 astronaut Neil Armstrong became the first human to walk on the Moon." },
    { year: 1981, event: "IBM introduced the IBM Personal Computer (Model 5150), ushering in the PC era." },
    { year: 1908, event: "Henry Ford's Model T was produced for the first time, revolutionizing transport." },
    { year: 1991, event: "The World Wide Web became publicly available on the internet." },
    { year: 1928, event: "Alexander Fleming discovered penicillin, founding modern antibiotics." }
];

// Curated daily recipes dataset
export const CURATED_RECIPES: { name: string; description: string; steps: string }[] = [
    {
        name: "Quick Garlic Butter Shrimp Pasta",
        description: "A savory 15-minute pasta dish with garlic, butter, and juicy shrimp.",
        steps: "Boil pasta. Sauté minced garlic and shrimp in butter for 3 mins. Toss pasta in garlic butter with parmesan & parsley."
    },
    {
        name: "Avocado & Poached Egg Toast",
        description: "Classic nutritious breakfast with creamy mashed avocado and runny egg.",
        steps: "Toast sourdough bread. Mash avocado with lemon juice, salt, and pepper. Top with a 4-minute poached egg and chili flakes."
    },
    {
        name: "Mediterranean Chickpea Salad",
        description: "Refreshing, protein-packed salad with cucumbers, tomatoes, and feta.",
        steps: "Combine canned chickpeas, diced cucumber, cherry tomatoes, and kalamata olives. Toss with olive oil, lemon, and crumbled feta."
    },
    {
        name: "Honey Soy Glazed Salmon",
        description: "Sweet and savory pan-seared salmon fillet.",
        steps: "Whisk soy sauce, honey, minced ginger, and garlic. Sear salmon in a hot skillet 4 mins per side, glaze with sauce until sticky."
    },
    {
        name: "10-Minute Peanut Noodle Bowl",
        description: "Rich and creamy Asian-inspired cold noodles.",
        steps: "Whisk peanut butter, soy sauce, lime juice, and hot water. Toss with cooked ramen or udon noodles and sliced scallions."
    }
];

/**
 * Executes a promise with a maximum timeout (default 3 seconds).
 * Returns fallback value if timeout occurs or exception is thrown.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
    });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timer!);
        return result;
    } catch {
        clearTimeout(timer!);
        return fallback;
    }
}

/**
 * Category 1: Today's Top News
 */
export async function getTopNews(): Promise<string> {
    const fetchNewsTask = (async () => {
        const news = await fetchStockNews();
        if (news && news.length > 0) {
            const article = news[Math.floor(Math.random() * Math.min(news.length, 5))];
            return `📰 *Today's Top News*: ${article.headline} - _${article.source}_ (<${article.url}|Read More>)`;
        }
        throw new Error('No news fetched');
    })();

    const fallbackArticle = FALLBACK_NEWS[Math.floor(Math.random() * FALLBACK_NEWS.length)];
    const fallbackText = `📰 *Today's Top News*: ${fallbackArticle}`;

    return withTimeout(fetchNewsTask, 3000, fallbackText);
}

/**
 * Category 2: Fun Factoid
 */
export async function getFunFact(): Promise<string> {
    const fetchFactTask = (async () => {
        const response = await fetch('https://uselessfacts.jsph.pl/api/v2/facts/random');
        if (response.ok) {
            const data = (await response.json()) as { text?: string };
            if (data?.text) {
                return `💡 *Fun Factoid*: ${data.text}`;
            }
        }
        throw new Error('Trivia API request failed');
    })();

    const fallbackTrivia = FALLBACK_TRIVIA[Math.floor(Math.random() * FALLBACK_TRIVIA.length)];
    const fallbackText = `💡 *Fun Factoid*: ${fallbackTrivia}`;

    return withTimeout(fetchFactTask, 3000, fallbackText);
}

/**
 * Category 3: Historical Fact on This Day
 */
export async function getHistoricalFact(): Promise<string> {
    const fetchHistoryTask = (async () => {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const response = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`);
        
        if (response.ok) {
            const data = (await response.json()) as { events?: { text: string; year: number }[] };
            if (data.events && data.events.length > 0) {
                const event = data.events[Math.floor(Math.random() * data.events.length)];
                return `📜 *Historical Fact on This Day*: In ${event.year}, ${event.text}`;
            }
        }
        throw new Error('Wikipedia API failed');
    })();

    const fallbackItem = FALLBACK_HISTORY[Math.floor(Math.random() * FALLBACK_HISTORY.length)];
    const fallbackText = `📜 *Historical Fact on This Day*: In ${fallbackItem.year}, ${fallbackItem.event}`;

    return withTimeout(fetchHistoryTask, 3000, fallbackText);
}

/**
 * Category 4: Recipe Ideas
 */
export async function getRecipeIdea(): Promise<string> {
    const recipe = CURATED_RECIPES[Math.floor(Math.random() * CURATED_RECIPES.length)];
    return `🍳 *Recipe Idea*: *${recipe.name}* - ${recipe.description} _Prep: ${recipe.steps}_`;
}

/**
 * Category 5: Inspirational Quote (Strictly non-AI static dataset)
 */
export async function getInspirationalQuote(): Promise<string> {
    const quote = FAMOUS_QUOTES[Math.floor(Math.random() * FAMOUS_QUOTES.length)];
    return `💬 *Inspirational Quote*: "${quote.text}" — *${quote.author}*`;
}

/**
 * Generates `n` random tidbit items (1 <= n <= 5) sampled from 5 categories.
 */
export async function generateTidbits(n: number): Promise<string> {
    const validN = Math.max(1, Math.min(5, Math.floor(n)));

    const categoryHandlers: { [key: string]: () => Promise<string> } = {
        news: getTopNews,
        fact: getFunFact,
        history: getHistoricalFact,
        recipe: getRecipeIdea,
        quote: getInspirationalQuote,
    };

    const keys = Object.keys(categoryHandlers);

    // Fisher-Yates shuffle
    for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
    }

    const selectedKeys = keys.slice(0, validN);
    const results = await Promise.all(selectedKeys.map(k => categoryHandlers[k]()));

    const header = `*Gembo's Tidbits of the Day* ☀️\n\n`;
    const body = results.map(item => `• ${item}`).join('\n\n');

    return `${header}${body}`;
}
