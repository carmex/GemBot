#!/bin/bash

# Deployment Script for Slack AI Bot
# Intended to be run by GitHub Actions Self-Hosted Runner

set -e # Exit immediately if a command exits with a non-zero status

echo "🚀 [Deploy] Starting deployment process..."

# 0. Pre-flight checks
echo "🔍 [Deploy] Checking environment..."
# Determine which docker compose command to use
COMPOSE_CMD=""
if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
    echo "✅ [Deploy] Using 'docker compose' (V2)"
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
    echo "✅ [Deploy] Using 'docker-compose' (V1)"
else
    echo "❌ [Error] Neither 'docker compose' nor 'docker-compose' found. Please install Docker Compose."
    exit 1
fi

if ! docker info > /dev/null 2>&1; then
    echo "❌ [Error] Cannot connect to Docker daemon. Check permissions (is user in 'docker' group?) or if Docker is running."
    exit 1
fi

# 1. Setup Environment
echo "⚙️ [Deploy] Setting up environment..."
if [ -f "$HOME/slack-bot.env" ]; then
    echo "Found persistent env file at $HOME/slack-bot.env, copying..."
    cp "$HOME/slack-bot.env" .env
elif [ -f "../../../.env" ]; then
    # Fallback: Check in the actions-runner root (3 levels up from _work/Repo/Repo) 
    echo "Found env file in runner root, copying..."
    cp "../../../.env" .env
fi

if [ ! -f ".env" ]; then
    echo "❌ [Error] .env file not found! Please place it at ~/slack-bot.env on the server."
    exit 1
fi

# Inject GitHub Token if available on host
if command -v gh >/dev/null 2>&1; then
    echo "🔑 [Deploy] Fetching GitHub token from host..."
    if GH_TOKEN=$(gh auth token 2>/dev/null); then
        echo "GITHUB_TOKEN=$GH_TOKEN" >> .env
        echo "✅ [Deploy] Injected GITHUB_TOKEN into .env"
    else
        echo "⚠️ [Deploy] 'gh' installed but not authenticated on host. Container 'gh' might fail."
    fi
else
    echo "⚠️ [Deploy] 'gh' not found on host. Container 'gh' might not be authenticated."
fi

if [ -f "$HOME/gcloud-credentials.json" ]; then
    echo "Found persistent gcloud credentials at $HOME/gcloud-credentials.json, copying..."
    cp "$HOME/gcloud-credentials.json" gcloud-credentials.json
elif [ -f "../../../gcloud-credentials.json" ]; then
    # Fallback: Check in the actions-runner root
    echo "Found gcloud credentials in runner root, copying..."
    cp "../../../gcloud-credentials.json" gcloud-credentials.json
fi

# 2. Build the containers
echo "📦 [Deploy] Building containers..."
$COMPOSE_CMD build

# FIX: Ensure gemini-config exists and is owned by the user (1001)
# We use docker to chown because the runner might not have sudo, but has docker access.
# We map the local folder to /tmp/config and chown it to 1001:1001.
echo "🔧 [Deploy] Fixing permissions for gemini-config..."
mkdir -p gemini-config
if [ -d "$HOME/.gemini" ]; then
    echo "🔑 [Deploy] Copying cached Gemini credentials from $HOME/.gemini..."
    cp -r "$HOME/.gemini/." gemini-config/ 2>/dev/null || echo "⚠️ [Deploy] Failed to copy some files (maybe permission issues?)"
else
    echo "⚠️ [Deploy] No cached Gemini credentials found in $HOME/.gemini"
fi
docker run --rm -v "$(pwd)/gemini-config:/tmp/config" node:20-bookworm-slim chown -R 1001:1001 /tmp/config

# FIX: Copy and mount 'gh' config for authentication
echo "🔧 [Deploy] Setting up GitHub CLI authentication..."
mkdir -p gh-config
rm -f gh-config/* 2>/dev/null || true
if [ -d "$HOME/.config/gh" ]; then
    echo "Found ~/.config/gh, copying..."
    cp -r "$HOME/.config/gh/"* gh-config/
elif [ -d "$HOME/.gh" ]; then
    echo "Found ~/.gh, copying..."
    cp -r "$HOME/.gh/"* gh-config/
else
    echo "⚠️ [Warning] No gh config found in $HOME/.config/gh or $HOME/.gh"
fi
# Fix permissions for gh-config (user 1001)
docker run --rm -v "$(pwd)/gh-config:/tmp/gh-config" node:20-bookworm-slim chown -R 1001:1001 /tmp/gh-config

# --remove-orphans cleans up containers for services not defined in the Compose file
echo "🚀 [Deploy] Starting containers..."
$COMPOSE_CMD up -d --remove-orphans

# 2. Cleanup old images
echo "🧹 [Deploy] Cleaning up unused data..."
docker system prune -f

# 3. Status check
echo "✅ [Deploy] Deployment successful! Service is up."
$COMPOSE_CMD ps
