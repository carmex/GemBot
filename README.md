# GemBot: Your Intelligent Slack Assistant

GemBot is a powerful, AI-driven Slack bot built with TypeScript and the Slack Bolt framework. It integrates with Google Gemini for advanced language understanding and Vertex AI for image generation, along with various financial APIs to bring real-time data directly into your Slack workspace.

## Core Features

-   **🤖 Conversational AI**: Mention the bot in a channel to start a new conversation, or mention it in a thread to have it join with context.
-   **🎨 Image Generation**: Create stunning images directly in Slack with `!image` powered by Google's Imagen 4 model.
-   **📈 Comprehensive Market Data**: Get real-time stock/crypto quotes, charts, news, and fundamental data from Finnhub and Alpha Vantage.
-   **Watchlist Management**: Track your stock portfolio with a personal watchlist.
-   **⏰ Scheduled-actions**: Delivers a daily morning greeting with the latest market news.
-   **🔒 Secure & Configurable**: Manages all API keys and secrets securely using environment variables.
-   **🎭 RPG Mode**: Act as a Game Master or a player in a role-playing game channel.

## Interactive RPG Mode

GemBot includes a unique and powerful interactive Role-Playing Game (RPG) mode that allows users to play collaborative storytelling games directly within a Slack channel.

### How It Works

The RPG mode has two distinct personalities:

-   **Game Master (GM) Mode** (`!gembot rpg gm`): In this mode, the bot takes on the role of a storyteller and referee. It describes the world, controls non-player characters (NPCs), presents challenges, and reacts to the players' actions. It will respond to every message in the channel to advance the game.
-   **Player Mode** (`!gembot rpg player`): In this mode, the bot joins the game as a player character. It will only respond when mentioned directly, acting as another member of the party.

### The Context File: A Persistent Memory

What makes GemBot's RPG mode special is its use of a persistent, channel-specific context file (`rpg-context-[channel-id].json`). This file acts as a dynamic and evolving "memory" or "character sheet" for the game.

-   The AI has been given a special tool, `update_rpg_context`, which it uses to **automatically update this JSON file** after its turn.
-   This allows the bot to maintain stateful awareness of the game. It can track changing character stats, manage inventory, remember key plot points, and evolve the world based on player decisions. For example, if a player finds a "healing potion," the AI will add it to the inventory in the JSON file. When the player uses it, the AI will remove it.

This autonomous context management creates a seamless and dynamic RPG experience without requiring players to manually track every detail.

### Getting Started with an RPG

1.  Enable RPG mode in a channel: `!gembot rpg gm`
2.  Tell the bot what type of game you would like to play. Add as much detail as you like, or leave it up to the bot to craft a world for you. Add any special rules you would like it to follow and it will all be tracked automatically in the context file.
3.  Start playing! The bot will guide the story. Use the `!roll` command for dice rolls (e.g., `!roll 1d20+4`).

-   **View Character Stats**:
    -   `!rpgstats [character_name]` - Displays the character sheet for a given player. If no name is provided, it shows the sheet for the user calling the command.

## Financial Features

GemBot provides a suite of tools to keep you connected to the financial markets without leaving Slack. These features require API keys from [Finnhub](https://finnhub.io/) and/or [Alpha Vantage](https://www.alphavantage.co/support/#api-key).

### Market Data at a Glance

-   **Get Quotes**: Quickly retrieve real-time prices for stocks and cryptocurrencies.
    -   `!q <TICKER...>` - For stocks (e.g., `!q TSLA AAPL`)
    -   `!cq <TICKER...>` - For crypto (e.g., `!cq BTC ETH`)
-   **Key Statistics**: Get essential data points for a stock.
    -   `!stats <TICKER...>` - Shows market cap, 52-week high/low, and more.

### Visual Insights

-   **Stock Charts**: Generate and display a customizable chart for any stock.
    -   `!chart <TICKER> [range]` - Available ranges are `1m`, `3m`, `6m`, `1y` (default), and `5y`.

### Personal Portfolio Tracking

-   **Watchlist**: Maintain a personal watchlist to track the performance of your stock holdings. The bot will automatically calculate your profit and loss based on the current market price.
    -   `!watchlist` - View your current watchlist, including P/L.
    -   `!watch <TICKER> [date] [price] [shares]` - Add a new stock to your watchlist. Date, price, and shares are optional.
    -   `!unwatch <TICKER>` - Remove a stock from your watchlist.

## Prerequisites

-   Node.js (v18 or higher)
-   npm or yarn
-   A Slack workspace where you can install apps
-   A Google Cloud account with a project set up
-   API keys for:
    -   [Google Gemini](https://ai.google.dev/gemini-api/docs/api-key)
    -   [Finnhub](https://finnhub.io/) (optional, for financial data)
    -   [Alpha Vantage](https://www.alphavantage.co/support/#api-key) (optional, for financial charts)

> **⚠️ Note on API Costs:** This bot uses paid Google Cloud services, including the Gemini and Vertex AI APIs. You are responsible for all costs associated with your API usage. Depending on the models you use and your level of interaction with the bot, these costs can be substantial. Please monitor your Google Cloud billing and set up budgets and alerts to avoid unexpected charges. It is strongly recommended *not* to deploy this bot in very large Slack workspaces or in environments where the users are not trusted. For Finnhub and Alpha Vantage, free API keys are probably sufficient, but high utilization may use up your free quota.

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
    -   Navigate to **Socket Mode** and enable it.
    -   Go to **OAuth & Permissions** and add the following Bot Token Scopes:
        -   `app_mentions:read`
        -   `channels:history`
        -   `chat:write`
        -   `chat:write.public`
        -   `commands`
        -   `files:read`
        -   `files:write`
        -   `groups:history`
        -   `im:history`
        -   `mpim:history`
        -   `users:read`
    -   Go to **Basic Information**, scroll down to "App-Level Tokens", and generate a new token with the `connections:write` scope.
    -   Install the app to your workspace.

4.  **Set up Google Cloud & APIs**
    -   Go to the [Google Cloud Console](https://console.cloud.google.com/).
    -   Enable the **Vertex AI API** for your project.
    -   Create a **Service Account** with the `Vertex AI User` role.
    -   Create a JSON key for this service account, download it, and save it in the root of the project directory.
    -   Enable the **Gemini API**. You can get a Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

5.  **Configure Environment Variables**
    -   Copy the example environment file:
        ```bash
        cp env.example .env
        ```
    -   Edit the `.env` file and fill in all the required tokens and API keys from the previous steps. Make sure the `GOOGLE_APPLICATION_CREDENTIALS` variable points to the name of your downloaded service account JSON file.

    ```dotenv
    # Slack API credentials
    SLACK_BOT_TOKEN=xoxb-your-bot-token
    SLACK_SIGNING_SECRET=your-signing-secret-from-the-basic-info-page
    SLACK_APP_TOKEN=xapp-your-app-token
    
    # Gemini API Key for conversational features
    GEMINI_API_KEY=your-gemini-api-key
    
    # Google Cloud project details for !image command
    GOOGLE_APPLICATION_CREDENTIALS=./your-gcp-credentials-file.json
    
    # Vertex AI Configuration for !image generation (optional)
    VERTEX_PROJECT_ID=your-gcloud-project-id
    VERTEX_LOCATION=us-central1
    
    # Finnhub API Key for financial commands (optional)
    FINNHUB_API_KEY=your-finnhub-api-key
    
    # Alpha Vantage API Key for !chart command (optional)
    ALPHA_VANTAGE_API_KEY=your-alpha-vantage-api-key
    ```

## Development

To run the bot in development mode with hot-reloading:
```bash
npm run watch
```
The bot will connect to Slack and be ready for commands.

## Available Commands

### AI & Fun

-   `@<BotName> <prompt>`: Mention the bot in a channel to start a new threaded conversation, or in an existing thread to have it join with context.
-   `!image <prompt>`: Generates an image based on your text prompt using Imagen 4.
-   `!gembot on`: Enable Gembot in the current thread.
-   `!gembot off`: Disable Gembot in the current thread.
-   `!gembot help`: Shows a list of all available commands in a thread.

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


## Built With

*   Built with [Cursor](https://cursor.sh), the AI-first code editor.


## Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details. 