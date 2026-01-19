import { App, SayFn } from '@slack/bolt';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as cron from 'node-cron';
import { initFeatureRequestDb, createFeatureRequest, updateFeatureRequest, getOpenFeatureRequests } from './feature-request-db';

enum FeatureRequestState {
    SELECTING_REPO = 'SELECTING_REPO',
    AWAITING_REQUEST = 'AWAITING_REQUEST',
    IMPLEMENTING = 'IMPLEMENTING', // Running first gemini command
    REVISING = 'REVISING',         // Revising the plan based on feedback
    AWAITING_APPROVAL = 'AWAITING_APPROVAL',
    FINALIZING = 'FINALIZING',     // Running second gemini command
    MONITORING_PR = 'MONITORING_PR',
    COMPLETED = 'COMPLETED',
    ABORTED = 'ABORTED',
}

interface FeatureRequestSession {
    state: FeatureRequestState;
    repoName?: string;
    repoPath?: string;
    requestText?: string;
    planText?: string;
    userId?: string;
    username?: string;
    channelId?: string;
    prUrl?: string;
}

export class FeatureRequestHandler {
    // Hardcoded repo mapping as requested
    private repoMap: Record<string, string> = {
        'gisbot': '/app/mnt/repos/gisbot',
        'gembot': '/app/mnt/repos/GemBot',
    };

    // Tracks active sessions by thread ID
    private sessions: Map<string, FeatureRequestSession> = new Map();

    constructor(private app: App) {
        initFeatureRequestDb();
        this.loadActiveSessions();
        this.startPrMonitoring();
    }

    private loadActiveSessions() {
        try {
            const openRequests = getOpenFeatureRequests();
            for (const req of openRequests) {
                this.sessions.set(req.slack_msg_ts, {
                    state: (req.state as FeatureRequestState) || FeatureRequestState.AWAITING_REQUEST,
                    repoName: req.repo_name,
                    repoPath: req.repo_path,
                    requestText: req.request_text,
                    planText: req.final_plan,
                    userId: req.user_id,
                    username: req.username,
                    channelId: req.channel_id,
                    prUrl: req.pr_url
                });
            }
            console.log(`[FeatureRequest] Loaded ${openRequests.length} active sessions from DB`);
        } catch (error) {
            console.error(`[FeatureRequest] Error loading active sessions:`, error);
        }
    }

    private startPrMonitoring() {
        // Run every 5 minutes
        cron.schedule('*/5 * * * *', async () => {
            console.log('[FeatureRequest] Checking PR statuses...');
            for (const [threadTs, session] of this.sessions.entries()) {
                if (session.state === FeatureRequestState.MONITORING_PR && session.prUrl) {
                    await this.checkPrStatus(threadTs, session);
                }
            }
        });
    }

    private async checkPrStatus(threadTs: string, session: FeatureRequestSession) {
        if (!session.prUrl) return;

        try {
            // Use gh pr view <URL> --json state
            const child = spawn('gh', ['pr', 'view', session.prUrl, '--json', 'state'], {
                shell: false
            });

            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (data) => stdout += data.toString());
            child.stderr.on('data', (data) => stderr += data.toString());

            child.on('error', (err) => {
                console.error(`[FeatureRequest] Failed to spawn gh for ${session.prUrl}:`, err);
            });

            child.on('close', async (code) => {
                if (code === 0) {
                    try {
                        const { state } = JSON.parse(stdout);
                        console.log(`[FeatureRequest] PR ${session.prUrl} state: ${state}`);

                        if (state === 'MERGED' || state === 'CLOSED') {
                            const message = state === 'MERGED' 
                                ? `🎉 Good news! Your Pull Request has been *MERGED*! \nURL: ${session.prUrl}`
                                : `Your Pull Request has been *CLOSED* without merging.\nURL: ${session.prUrl}`;

                            await this.app.client.chat.postMessage({
                                channel: session.channelId!,
                                thread_ts: threadTs,
                                text: message
                            });

                            session.state = FeatureRequestState.COMPLETED;
                            updateFeatureRequest(threadTs, { state: FeatureRequestState.COMPLETED });
                            this.sessions.delete(threadTs);
                        }
                    } catch (e) {
                        console.error(`[FeatureRequest] Error parsing gh output for ${session.prUrl}. Output: ${stdout}`, e);
                    }
                } else {
                    console.error(`[FeatureRequest] gh pr view failed for ${session.prUrl} with code ${code}. Stderr: ${stderr}`);
                }
            });
        } catch (error) {
            console.error(`[FeatureRequest] Error monitoring PR ${session.prUrl}:`, error);
        }
    }

    public isFeatureRequestThread(threadTs: string): boolean {
        return this.sessions.has(threadTs);
    }

    public async handleRequest(event: any, client: any, say: SayFn) {
        // Start a new flow
        // If message is in a thread, use that thread. If not, the reply starts a new thread.
        const threadTs = event.thread_ts || event.ts;
        const channelId = event.channel;

        // If existing session, maybe reset or ignore? 
        // User requirements say "any further requests to this thread should respond with a message to start a new feature request"
        // But if they explicitly say "@Gembot feature request", maybe we should reset?
        // let's assume valid start triggers a new flow or resets if explicitly called.

        const repos = Object.keys(this.repoMap);

        // Fetch user info for DB
        let username = 'unknown';
        try {
            const userRes = await client.users.info({ user: event.user });
            if (userRes.ok && userRes.user) {
                username = userRes.user.name || userRes.user.real_name || 'unknown';
            }
        } catch (e) {
            console.error('Error fetching user info:', e);
        }

        this.sessions.set(threadTs, {
            state: FeatureRequestState.SELECTING_REPO,
            userId: event.user,
            username: username,
            channelId: channelId
        });

        await say({
            text: `Sure, I can help with that. Please select a repository from the following list:\n${repos.map(r => `• ${r}`).join('\n')}`,
            thread_ts: event.ts, // Always reply to the initial message content or thread
        });
    }

    public async handleMessage(event: any, client: any, say: SayFn) {
        const threadTs = event.thread_ts;
        if (!threadTs) return; // Should not happen if isFeatureRequestThread returned true

        const session = this.sessions.get(threadTs);
        if (!session) return;

        // Authorization check: Only the initiator can interact with the workflow
        if (session.userId && event.user !== session.userId) {
            await say({
                text: `Sorry, only the user who initiated this request (<@${session.userId}>) can interact with this workflow.`,
                thread_ts: threadTs
            });
            return;
        }

        const text = event.text.trim();

        switch (session.state) {
            case FeatureRequestState.SELECTING_REPO:
                this.handleRepoSelection(session, text, threadTs, say);
                break;
            case FeatureRequestState.AWAITING_REQUEST:
                this.handleFeatureRequestText(session, text, threadTs, say);
                break;
            case FeatureRequestState.AWAITING_APPROVAL:
                this.handlePlanAction(session, event.user, text, threadTs, say);
                break;
            case FeatureRequestState.MONITORING_PR:
                await say({ 
                    text: `I'm currently monitoring your PR: ${session.prUrl}. I'll notify you here once it's merged or closed.`, 
                    thread_ts: threadTs 
                });
                break;
            case FeatureRequestState.IMPLEMENTING:
            case FeatureRequestState.REVISING:
            case FeatureRequestState.FINALIZING:
                await say({ text: "I'm currently running a command, please wait...", thread_ts: threadTs });
                break;
            default:
                // Workflow ended
                await say({ text: "This feature request workflow is complete. Please start a new one request.", thread_ts: threadTs });
                break;
        }
    }

    private async handleRepoSelection(session: FeatureRequestSession, text: string, threadTs: string, say: SayFn) {
        const repoName = text.toLowerCase(); // simplified matching
        if (this.repoMap[repoName]) {
            session.repoName = repoName;
            session.repoPath = this.repoMap[repoName];

            // Verify path exists
            if (!fs.existsSync(session.repoPath)) {
                await say({
                    text: `Error: The configured path for \`${repoName}\` does not exist on the server: \`${session.repoPath}\`. Please contact the administrator.`,
                    thread_ts: threadTs
                });
                this.sessions.delete(threadTs);
                return;
            }

            session.state = FeatureRequestState.AWAITING_REQUEST;
            
            // Persist repo path update
            updateFeatureRequest(threadTs, { repo_path: session.repoPath });

            await say({
                text: `Selected repository: \`${repoName}\`. What is your feature request?`,
                thread_ts: threadTs
            });
        } else {
            const repos = Object.keys(this.repoMap);
            await say({
                text: `I don't recognize that repository. Please select one of the following:\n${repos.map(r => `• ${r}`).join('\n')}`,
                thread_ts: threadTs
            });
        }
    }

    private async handleFeatureRequestText(session: FeatureRequestSession, text: string, threadTs: string, say: SayFn) {
        session.requestText = text;
        session.state = FeatureRequestState.IMPLEMENTING;

        await say({
            text: "Acknowledged. Starting implementation... (this may take a while)",
            thread_ts: threadTs
        });

        // Spawn gemini command
        const command = 'gemini';
        const args = [
            '-y',
            '-p',
            `create an implementation plan for modifying this codebase with the feature request below. start by making sure you have the lastest code from master (or main, whichever applicable) branch (fetch and pull). The plan should be detailed enough to be used by a coding agent to implement the feature. State what files will be modified, added, or deleted. State the dependencies of the feature. When you have finished your investigation and are ready to present the plan, print the exact string <<<FINAL_PLAN>>> on a new line, followed by the plan formatted in Slack mrkdwn format. don't change any code! feature: ${text}`
        ];

        // Persist initial request
        createFeatureRequest({
            slack_msg_ts: threadTs,
            channel_id: session.channelId || 'unknown',
            username: session.username || 'unknown',
            user_id: session.userId,
            repo_name: session.repoName || 'unknown',
            request_text: text
        });

        this.runShellCommand(command, args, session.repoPath!, threadTs, say, (output) => {
            // Parse output for <<<FINAL_PLAN>>>
            const delimiter = '<<<FINAL_PLAN>>>';
            let planThoughts = output;
            let finalPlan = output;

            if (output.includes(delimiter)) {
                const parts = output.split(delimiter);
                planThoughts = parts[0].trim();
                finalPlan = parts[1].trim();
            } else {
                // Fallback if tag missing
                planThoughts = "No thoughts captured (tag missing)";
            }

            // Store DB
            updateFeatureRequest(threadTs, {
                plan_thoughts: planThoughts,
                final_plan: finalPlan
            });

            session.planText = finalPlan; // Use trimmed plan for next step logic

            session.state = FeatureRequestState.AWAITING_APPROVAL;
            say({
                text: `Implementation Request Complete. Output:\n\`\`\`${finalPlan}\`\`\`\n\nPlease reply with "approve" to proceed to the next step (merging/PR logic), "abort" to cancel the request, or provide feedback to revise the plan.`,
                thread_ts: threadTs
            });
        });
    }

    private async handlePlanAction(session: FeatureRequestSession, userId: string, text: string, threadTs: string, say: SayFn) {
        const lowerText = text.toLowerCase();

        if (lowerText === 'approve') {
            // Reinforce authorization check for approval
            if (session.userId && userId !== session.userId) {
                await say({
                    text: `Sorry, only the initiator (<@${session.userId}>) can approve this request.`,
                    thread_ts: threadTs
                });
                return;
            }

            session.state = FeatureRequestState.FINALIZING;
            await say({
                text: "Approved. Proceeding with finalization (merge/PR)...",
                thread_ts: threadTs
            });

            const command = 'gemini';
            const planText = session.planText || "No previous output captured.";
            const args = [
                '-y',
                '-p',
                `Please implement the plan below on the codebase in this current directory.

**Phase 1: Setup & Strategy**
1.  Ensure the repo is clean and up to date with the default branch (main or master).
2.  **Determine Contribution Strategy:** Check if you have write access to the \`origin\` remote.
    * **Scenario A (Owner/Write Access):** Create a new feature branch directly.
    * **Scenario B (No Write Access):** Ensure a fork exists (create one if needed using \`gh\`), and work on a feature branch on that fork.

**Phase 2: Implementation**
3.  Implement the changes detailed in the plan below.
4.  Run necessary build/test commands to verify your changes.

**Phase 3: Pull Request**
5.  Push your branch.
6.  Use the \`gh\` CLI to create a Pull Request against the original default branch.
    * *Important:* Ensure you use non-interactive flags for \`gh\` commands (e.g., \`--body\`, \`--title\`, \`--head\`) to prevent the process from hanging.

**Phase 4: Output & Cleanup**
7.  Once the PR is created, switch the local repo back to the default branch so it is ready for the next request.
8.  **Final Output:** When you are finished, print the exact string \`<<<FINAL_SUMMARY>>>\` on a new line. Immediately following that, provide a short summary of changes and the direct link to the PR. Do not include any other text after the summary.

**The Plan to Implement:**
${planText}`
            ];

            this.runShellCommand(command, args, session.repoPath!, threadTs, say, (output) => {
                // Parse output for <<<FINAL_SUMMARY>>>
                const delimiter = '<<<FINAL_SUMMARY>>>';
                let implThoughts = output;
                let finalSummary = output;

                if (output.includes(delimiter)) {
                    const parts = output.split(delimiter);
                    implThoughts = parts[0].trim();
                    finalSummary = parts[1].trim();
                } else {
                    implThoughts = "No thoughts captured (tag missing)";
                }

                // Store DB
                updateFeatureRequest(threadTs, {
                    implementation_thoughts: implThoughts,
                    final_summary: finalSummary
                });

                // Extract PR URL
                const prUrl = this.extractPrUrl(finalSummary);

                if (prUrl) {
                    session.prUrl = prUrl;
                    session.state = FeatureRequestState.MONITORING_PR;
                    updateFeatureRequest(threadTs, { 
                        pr_url: prUrl,
                        state: FeatureRequestState.MONITORING_PR
                    });

                    say({
                        text: `Implementation Complete. I've detected a Pull Request: ${prUrl}\n\nI will monitor this PR and notify you here when it is merged or closed.`,
                        thread_ts: threadTs
                    });
                } else {
                    // Workflow end if no PR found
                    session.state = FeatureRequestState.COMPLETED;
                    updateFeatureRequest(threadTs, { state: FeatureRequestState.COMPLETED });
                    this.sessions.delete(threadTs); // Cleanup session
                    say({
                        text: `Workflow Complete. Output:\n\`\`\`${finalSummary}\`\`\`\n\nThis workflow is now closed.`,
                        thread_ts: threadTs
                    });
                }
            });

        } else if (lowerText === 'abort') {
            updateFeatureRequest(threadTs, { state: FeatureRequestState.ABORTED });
            this.sessions.delete(threadTs);
            await say({
                text: "Feature request workflow has been aborted.",
                thread_ts: threadTs
            });
        } else {
            // Feedback - trigger revision
            session.state = FeatureRequestState.REVISING;
            await say({
                text: "Acknowledged. Revising implementation plan based on your feedback... (this may take a while)",
                thread_ts: threadTs
            });

            const command = 'gemini';
            const args = [
                '-y',
                '-p',
                `You are an expert software architect. Below is an initial feature request, a proposed implementation plan, and user feedback on that plan.

Please provide an updated implementation plan that incorporates the user's feedback.

**Initial Feature Request:**
${session.requestText}

**Current Implementation Plan:**
${session.planText}

**User Feedback:**
${text}

Follow the same format as before: perform any necessary investigation without changing code, and when ready, print the exact string <<<FINAL_PLAN>>> on a new line, followed by the updated plan in Slack mrkdwn format. don't change any code!`
            ];

            this.runShellCommand(command, args, session.repoPath!, threadTs, say, (output) => {
                // Parse output for <<<FINAL_PLAN>>>
                const delimiter = '<<<FINAL_PLAN>>>';
                let planThoughts = output;
                let finalPlan = output;

                if (output.includes(delimiter)) {
                    const parts = output.split(delimiter);
                    planThoughts = parts[0].trim();
                    finalPlan = parts[1].trim();
                } else {
                    // Fallback if tag missing
                    planThoughts = "No thoughts captured (tag missing)";
                }

                // Store DB
                updateFeatureRequest(threadTs, {
                    plan_thoughts: planThoughts,
                    final_plan: finalPlan
                });

                session.planText = finalPlan; // Use trimmed plan for next step logic

                session.state = FeatureRequestState.AWAITING_APPROVAL;
                say({
                    text: `Revised Implementation Plan:\n\`\`\`${finalPlan}\`\`\`\n\nPlease reply with "approve" to proceed, "abort" to cancel, or provide further feedback to revise the plan again.`,
                    thread_ts: threadTs
                });
            });
        }
    }

    private extractPrUrl(text: string): string | undefined {
        // Regex to match GitHub PR URL
        const prRegex = /https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/;
        const match = text.match(prRegex);
        return match ? match[0] : undefined;
    }

    private runShellCommand(command: string, args: string[], cwd: string, threadTs: string, say: SayFn, onComplete: (output: string) => void) {
        // Sanitize input to avoid shell syntax errors if shell=true, but better to use shell=false if possible.
        // On Windows, 'gemini' might be a batch file, so shell=true is often needed unless we call 'gemini.cmd'.
        // Assuming 'gemini' is in PATH.

        const isWindows = process.platform === 'win32';
        const shell = true; // defaulting to true for PATH resolution convenience, but we MUST sanitize args.

        // Actually, if we use shell: true, we must escape quotes. 
        // A safer bet is to use shell: false and append .cmd if on windows
        // Let's try shell: false and see if it works. If not, we might need a fallback.
        // User path is linux-like (/home/...) but OS is windows. This is confusing. 
        // If they are in WSL, shell: true (sh) is fine but need escaping.
        // The error "/bin/sh: 1: Syntax error" proves they are hitting a unix shell. 
        // So we just need to escape the quotes in the prompt.

        // Escape check: replace " with \"
        // But for /bin/sh, simple arguments in spawn with shell:false are BEST.
        // Let's force shell: false which is standard for node apps avoiding this exact issue.
        // Only downside: might not find 'gemini' if it's a script/alias. 
        // If command fails with ENOENT, we can try with shell: true as fallback? No, let's fix the command name.

        const commandName = (isWindows && command === 'gemini') ? 'gemini.cmd' : command;

        console.log(`[FeatureRequest] Spawning ${commandName} in ${cwd}`);

        const child = spawn(commandName, args, {
            cwd: cwd,
            shell: false, // Changed to false to avoid quoting issues
            env: process.env // Ensure PATH is passed
        });

        let stdoutData = '';
        let stderrData = '';

        child.stdout.on('data', (data) => {
            stdoutData += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderrData += data.toString();
        });

        child.on('close', (code) => {
            console.log(`[FeatureRequest] Command finished with code ${code}`);
            const output = (stdoutData + '\n' + stderrData).trim();

            if (code !== 0) {
                say({
                    text: `Command failed with exit code ${code}.\nOutput:\n\`\`\`${output}\`\`\``,
                    thread_ts: threadTs
                });
            }

            onComplete(output);
        });

        child.on('error', (err) => {
            console.error(`[FeatureRequest] Spawn error:`, err);
            say({
                text: `Failed to spawn command: ${err.message}`,
                thread_ts: threadTs
            });
        });
    }
}
