# Slack AI Bot

A TypeScript-based Slack bot built with the Slack Bolt framework.

## Features

- 🤖 Basic message handling
- 📝 Slash commands
- 👋 App mentions
- 🔘 Interactive components
- 🔒 Environment-based configuration

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- A Slack workspace where you can install apps

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create a Slack app:**
   - Go to [api.slack.com/apps](https://api.slack.com/apps)
   - Click "Create New App" → "From scratch"
   - Give your app a name and select your workspace

3. **Configure your Slack app:**
   - Go to "OAuth & Permissions" and add these scopes:
     - `chat:write` - Send messages
     - `app_mentions:read` - Read mentions
     - `commands` - Add slash commands
   - Install the app to your workspace
   - Copy the "Bot User OAuth Token" (starts with `xoxb-`)

4. **Set up Socket Mode:**
   - Go to "Basic Information" → "App-Level Tokens"
   - Create a new token with `connections:write` scope
   - Copy the token (starts with `xapp-`)

5. **Configure environment variables:**
   ```bash
   cp env.example .env
   ```
   Then edit `.env` with your tokens:
   ```
   SLACK_BOT_TOKEN=xoxb-your-bot-token-here
   SLACK_SIGNING_SECRET=your-signing-secret-here
   SLACK_APP_TOKEN=xapp-your-app-token-here
   ```

6. **Add slash commands (optional):**
   - Go to "Slash Commands" in your Slack app settings
   - Create a new command `/ping` with description "Ping the bot"

## Development

**Start in development mode:**
```bash
npm run dev
```

**Start with auto-reload:**
```bash
npm run watch
```

**Build for production:**
```bash
npm run build
npm start
```

## Available Commands

- `npm run dev` - Start development server
- `npm run watch` - Start with auto-reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm run clean` - Clean build directory

## Project Structure

```
src/
├── index.ts      # Main application entry point
├── types.ts      # TypeScript type definitions
└── ...
```

## Features

### Message Handling
The bot responds to messages containing "hello" with a friendly greeting.

### App Mentions
When someone mentions the bot (`@your-bot-name`), it responds with a helpful message.

### Slash Commands
- `/ping` - Responds with "Pong!" and the user who sent it

### Interactive Components
The bot can handle button clicks and other interactive elements.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details 