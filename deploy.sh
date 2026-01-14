#!/bin/bash

# Deployment Script for Slack AI Bot
# Intended to be run by GitHub Actions Self-Hosted Runner

set -e # Exit immediately if a command exits with a non-zero status

echo "🚀 [Deploy] Starting deployment process..."

# 0. Pre-flight checks
echo "🔍 [Deploy] Checking environment..."
if ! command -v docker-compose &> /dev/null; then
    echo "❌ [Error] docker-compose could not be found. Is it installed?"
    exit 1
fi

if ! docker info > /dev/null 2>&1; then
    echo "❌ [Error] Cannot connect to Docker daemon. Check permissions (is user in 'docker' group?) or if Docker is running."
    exit 1
fi


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

# 2. Build and start the containers
echo "📦 [Deploy] Building and revisiting containers..."
# --remove-orphans cleans up containers for services not defined in the Compose file
docker compose up -d --build --remove-orphans

# 2. Cleanup old images
echo "🧹 [Deploy] Cleaning up unused data..."
docker system prune -f

# 3. Status check
echo "✅ [Deploy] Deployment successful! Service is up."
docker compose ps
