FROM node:20-bookworm-slim

# Install system dependencies required for canvas and better-sqlite3
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    python3-pip \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    git \
    procps \
    curl \
    gnupg \
    && mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install mcp --break-system-packages

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Install Gemini CLI
RUN npm install -g @google/gemini-cli

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Expose the API port
EXPOSE 3000

# Create a non-root user with UID 1001 (matching the host user)
RUN groupadd -g 1001 slackbot && \
    useradd -u 1001 -g slackbot -m slackbot && \
    chown -R slackbot:slackbot /app

# Switch to the non-root user
USER slackbot

# Start the application
CMD ["npm", "start"]
