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
    - The runner cleans the workspace frequently, so **do not** leave your `.env` file in the `_work` folder.
    - **Recommended**: Save your `.env` file in your user's home directory as `~/slack-bot.env`.
      ```bash
      # On your server
      cp .env ~/slack-bot.env
      ```
    - The deployment script is configured to automatically look for `~/slack-bot.env` and copy it into place during deployment.

## Security - CRITICAL (Public Repos)

If your repository is **Public**, you MUST configure the following setting to prevent malicious code from forks running on your server:
cd 
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

You can view the deployment logs in the **Actions** tab on your GitHub repository.

## Troubleshooting

### Error: "Process completed with exit code 1"
If the deployment fails immediately, it is likely a permission issue with Docker. The runner user needs to be in the `docker` group to run commands without `sudo`.

**Fix:**
Run this on your Linux server:
```bash
sudo usermod -aG docker $USER
```
Then, **restart the runner service** for the changes to take effect:
```bash
sudo ./svc.sh stop
sudo ./svc.sh start
```
