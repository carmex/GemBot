# Deployment Guide

This guide describes how to deploy the Slack AI Bot using **GitHub Actions Self-Hosted Runner**.

## Prerequisites

- **Docker** and **Docker Compose** installed on your Linux server.
- The repository pushed to GitHub.
- Access to the Linux server terminal.

## Initial Setup (One-Time)

You need to install the GitHub Actions runner agent on your Linux server. This agent connects to GitHub and listens for deployment jobs.

1.  **Get the Runner Token**:
    - Go to your GitHub Repository.
    - Click **Settings** > **Actions** > **Runners**.
    - Click **New self-hosted runner**.
    - Select **Linux**.

2.  **Install on Server**:
    - Run the commands provided by GitHub on your Linux server. They will look something like this (do NOT copy this blindly, use the one from GitHub with your unique token!):
      ```bash
      # Create a folder
      mkdir actions-runner && cd actions-runner
      
      # Download the latest runner package
      curl -o actions-runner-linux-x64-2.x.x.tar.gz -L https://github.com/actions/runner/releases/download/v2.x.x/actions-runner-linux-x64-2.x.x.tar.gz
      
      # Extract the installer
      tar xzf ./actions-runner-linux-x64-2.x.x.tar.gz
      
      # Configure the runner
      ./config.sh --url https://github.com/YourUser/YourRepo --token YOUR_TOKEN
      ```
    - When asked for runner name, you can use `linux-mint-server` or leave default.
    - When asked for labels, default is fine.

3.  **Run as a Service** (Important!):
    - Instead of just running `./run.sh`, install it as a systemd service so it runs automatically on boot.
      ```bash
      sudo ./svc.sh install
      sudo ./svc.sh start
      ```
    - Check status: `sudo ./svc.sh status`

4.  **Environment Variables**:
    - Ensure your `.env` file is present in the **root of the repository directory where the runner checks out code**.
    - *Note*: The runner will check out code into `_work/slack-ai-bot/slack-ai-bot`. You might need to place your `.env` file there manually once, or use GitHub Secrets to generate it during the build (advanced).
    - **Easier method**: Manually place the `.env` file in the `actions-runner/_work/slack-ai-bot/slack-ai-bot` folder after the first run, OR update `docker-compose.yml` to point to a fixed absolute path for the `.env` file on your server.

## Security - CRITICAL (Public Repos)

If your repository is **Public**, you MUST configure the following setting to prevent malicious code from forks running on your server:

1.  Go to your GitHub Repository.
2.  Click **Settings** > **Actions** > **General**.
3.  Scroll to **Fork pull request workflows from outside collaborators**.
4.  Select **Require approval for all outside collaborators**.

This ensures that if someone forks your repo and creates a Pull Request with malicious code, it will **NOT** run on your server until you manually approve it.

## Deploying

To deploy updates, simply commit and push to the `main` branch.

```bash
git add .
git commit -m "New features"
git push origin main
```

The runner on your server will:
1.  Pick up the job.
2.  Pull the code.
3.  Rebuild the Docker containers.
4.  Restart the service.

## monitoring

You can view the deployment logs in the **Actions** tab on your GitHub repository.
