# GemBot: Your Intelligent Slack Assistant

GemBot is a powerful, AI-driven Slack bot built with TypeScript and the Slack Bolt framework. It integrates with Google Gemini for advanced language understanding and Vertex AI for image generation, along with various financial APIs to bring real-time data directly into your Slack workspace.

## Core Features

-   **🤖 Conversational AI**: Mention the bot or use `!gem` in a thread to have a natural conversation. The bot maintains context within a thread.
-   **🎨 Image Generation**: Create stunning images directly in Slack with `!image` powered by Google's Imagen 4 model.
-   **📈 Comprehensive Market Data**: Get real-time stock/crypto quotes, charts, news, and fundamental data from Finnhub and Alpha Vantage.
-   **Watchlist Management**: Track your stock portfolio with a personal watchlist.
-   **⏰ Scheduled-actions**: Delivers a daily morning greeting with the latest market news.
-   **🔒 Secure & Configurable**: Manages all API keys and secrets securely using environment variables.

## Prerequisites

-   Node.js (v16 or higher)
-   npm or yarn
-   A Slack workspace where you can install apps
-   Google Cloud account with a project set up
-   API keys for:
    -   Google Gemini
    -   Finnhub
    -   Alpha Vantage

## Setup

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/carmex/GemBot.git
    cd GemBot
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Create a Slack App**
    -   Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app "From scratch".
    -   Go to **OAuth & Permissions** and add the following Bot Token Scopes:
        -   `app_mentions:read`
        -   `chat:write`
        -   `commands`
        -   `files:write`
    -   Go to **Socket Mode** and enable it.
    -   Go to **Basic Information**, scroll down to "App-Level Tokens", and generate a new token with the `connections:write` scope.
    -   Install the app to your workspace.

4.  **Set up Google Cloud & APIs**
    -   Go to the [Google Cloud Console](https://console.cloud.google.com/).
    -   Enable the **Vertex AI API** for your project.
    -   Create a **Service Account** with the `Vertex AI User` role.
    -   Create a JSON key for this service account and download it.
    -   Enable the **Gemini API**. You can get an API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

5.  **Configure Environment Variables**
    -   Rename the `gcloud-credentials.json.example` file you downloaded to `gcloud-credentials.json` and place it in the root of the project.
    -   Copy the example environment file:
        ```bash
        cp env.example .env
        ```
    -   Edit the `.env` file and fill in all the required tokens and API keys from the previous steps.

    ```dotenv
    # Slack API credentials
    SLACK_BOT_TOKEN=xoxb-your-bot-token
    SLACK_SIGNING_SECRET=your-signing-secret-from-basic-info-page
    SLACK_APP_TOKEN=xapp-your-app-token
    
    # Gemini API Key for !gem command
    GEMINI_API_KEY=your-gemini-api-key
    
    # Google Cloud project details for !image command
    GCLOUD_PROJECT=your-gcloud-project-id
    GCLOUD_LOCATION=us-central1
    GOOGLE_APPLICATION_CREDENTIALS=./gcp-credentials.json
    
    # Finnhub API Key for !q command
    FINNHUB_API_KEY=your-finnhub-api-key
    
    # Alpha Vantage API Key for !q and !chart commands
    ALPHA_VANTAGE_API_KEY=your-alpha-vantage-api-key
    ```

## Development

**Start the bot:**
```bash
npm run dev
```
The bot will connect to Slack and be ready for commands.

## Available Commands

### AI & Fun

-   `!gem <prompt>`: Starts a new threaded conversation with the Gemini AI.
-   `@<BotName> <prompt>`: Mention the bot in an existing thread to have it join the conversation with context.
-   `!image <prompt>`: Generates an image based on your text prompt using Imagen 4.

### Stocks & Crypto

-   `!q <TICKER...>`: Get a real-time stock quote.
-   `!cq <TICKER...>`: Get a real-time crypto quote (e.g., `!cq BTC ETH`).
-   `!chart <TICKER> [range]`: Generates a stock chart. Ranges: `1m`, `3m`, `6m`, `1y`, `5y`.
-   `!stats <TICKER...>`: Get key statistics for a stock (Market Cap, 52-week high/low).
-   `!earnings <TICKER>`: Get upcoming earnings dates.
-   `!stocknews`: Fetches the latest general stock market news.
-   `!cryptonews`: Fetches the latest cryptocurrency news.

### Watchlist

-   `!watchlist`: View your current stock watchlist with P/L.
-   `!watch <TICKER> [date] [price] [shares]`: Add a stock to your watchlist.
-   `!unwatch <TICKER>`: Remove a stock from your watchlist.

## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## License

MIT License - see LICENSE file for details 