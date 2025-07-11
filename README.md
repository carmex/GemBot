# GemBot: Your Intelligent Slack Assistant

GemBot is a powerful, AI-driven Slack bot built with TypeScript and the Slack Bolt framework. It integrates with Google Gemini for advanced language understanding and Vertex AI for image generation, along with various financial APIs to bring real-time data directly into your Slack workspace.

## Core Features

-   **🤖 Conversational AI**: Mention the bot in a channel to start a new conversation, or mention it in a thread to have it join with context.
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

-   `@<BotName> <prompt>`: Mention the bot in a channel to start a new threaded conversation, or in an existing thread to have it join with context.
-   `!image <prompt>`: Generates an image based on your text prompt using Imagen 4.
-   `!gembot on`: Enable Gembot in the current thread.
-   `!gembot off`: Disable Gembot in the current thread.

### RPG Mode
- `!gembot rpg <gm|player|off|status>`: Manage RPG mode for this channel.
  - `gm`: The bot acts as the Game Master, responding to every message.
  - `player`: The bot acts as a player, only responding when @-mentioned.
  - `off`: Disables RPG mode in the channel.
  - `status`: Checks the current RPG mode status for the channel.
- `!roll <dice>`: Rolls dice using standard dice notation (e.g., `1d20`, `2d6+3`).

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

### Usage Tracking
The bot tracks usage of the LLM and image generation features. You can check your usage with the following commands. The costs shown are estimates only and should not be used for billing purposes.

- `!usage`: Show your usage statistics for today.
- `!usage YYYY-MM-DD`: Show your usage statistics for a specific date.
- `!usage all`: Show a detailed, day-by-day breakdown of your entire usage history.
- `!usage total`: Show a lifetime summary of your usage statistics.
- `!usage @user`: Show another user's usage statistics for today.
- `!usage @user YYYY-MM-DD`: Show another user's usage statistics for a specific date.

## Deployment

### Basic Method
After building the project (`npm run build`), you can run the bot directly with Node.js:
```bash
npm run start
```
This is suitable for development and basic use, but the bot will stop if you close your terminal or if it encounters a crash.

### Production (Recommended)
For production, it is recommended to use [PM2](https://pm2.keymetrics.io/), a process manager for Node.js applications. This will ensure the bot automatically restarts if it crashes and handles logging.

#### Installation

First, install PM2 globally:
```bash
npm install pm2 -g
```

### Running the Bot

The project includes an `ecosystem.config.js` file to simplify running the application with PM2.

1.  **Build the TypeScript code:**
    ```bash
    npm run build
    ```
    This will compile the TypeScript source files from `src/` into JavaScript files in the `dist/` directory.

2.  **Start the bot with PM2:**
    ```bash
    pm2 start ecosystem.config.js
    ```
    PM2 will now run the bot in the background according to the settings in the configuration file.

### Managing the Bot

Here are some common PM2 commands to manage your bot:

-   **List running processes:**
    ```bash
    pm2 list
    ```

-   **Monitor logs in real-time:**
    ```bash
    pm2 logs slack-ai-bot
    ```

-   **View detailed information:**
    ```bash
    pm2 monit
    ```

-   **Stop the bot:**
    ```bash
    pm2 stop slack-ai-bot
    ```

-   **Restart the bot:**
    ```bash
    pm2 restart slack-ai-bot
    ```

-   **Delete the process from PM2's list:**
    ```bash
    pm2 delete slack-ai-bot
    ```


## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## License

MIT License - see LICENSE file for details 