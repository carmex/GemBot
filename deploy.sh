#!/bin/bash

# Deployment Script for Slack AI Bot
# Intended to be run by GitHub Actions Self-Hosted Runner

set -e # Exit immediately if a command exits with a non-zero status

echo "🚀 [Deploy] Starting deployment process..."

# 1. Build and start the containers
echo "📦 [Deploy] Building and revisiting containers..."
# --remove-orphans cleans up containers for services not defined in the Compose file
docker-compose up -d --build --remove-orphans

# 2. Cleanup old images
echo "🧹 [Deploy] Cleaning up unused data..."
docker system prune -f

# 3. Status check
echo "✅ [Deploy] Deployment successful! Service is up."
docker-compose ps
