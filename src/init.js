#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');

/**
 * Initialize the Application observability for AWS action by checking trigger conditions and creating initial tracking comment
 */
async function run() {
  try {
    // Get GitHub context
    const context = github.context;
    const payload = context.payload;

    // Get inputs
    const botName = process.env.BOT_NAME || '@awsapm';
    const branchPrefix = process.env.BRANCH_PREFIX || 'awsapm/';
    const targetBranch = process.env.TARGET_BRANCH || '';
    const allowedNonWriteUsers = process.env.ALLOWED_NON_WRITE_USERS || '';
    const customPrompt = process.env.CUSTOM_PROMPT || '';
    const testMode = process.env.TEST_MODE || 'false';

    // Function to check for bot name trigger phrase
    // Must contain "@awsapm" prefix (case-insensitive)
    // Note: Phrases like "@awsapm-prod", "@awsapm-staging" are also valid.
    function containsTriggerPhrase(text) {
      if (!text) return false;
      return text.toLowerCase().includes('@awsapm');
    }

    // Check if trigger phrase is present in the event
    let containsTrigger = false;
    let triggerText = '';
    let commentId = null;
    let issueNumber = null;
    let isPR = false;
    let isEditEvent = false;
    let triggerUsername = '';

    if (context.eventName === 'issue_comment') {
      const comment = payload.comment;
      if (comment && comment.body && containsTriggerPhrase(comment.body)) {
        containsTrigger = true;
        triggerText = comment.body;
        commentId = comment.id;
        issueNumber = payload.issue.number;
        isPR = !!payload.issue.pull_request;
        isEditEvent = payload.action === 'edited';
        triggerUsername = comment.user?.login || 'unknown';
      }
    } else if (context.eventName === 'pull_request_review_comment') {
      const comment = payload.comment;
      if (comment && comment.body && containsTriggerPhrase(comment.body)) {
        containsTrigger = true;
        triggerText = comment.body;
        commentId = comment.id;
        issueNumber = payload.pull_request.number;
        isPR = true;
        isEditEvent = payload.action === 'edited';
        triggerUsername = comment.user?.login || 'unknown';
      }
    } else if (context.eventName === 'issues') {
      const issue = payload.issue;
      if (issue && ((issue.body && containsTriggerPhrase(issue.body)) ||
                    (issue.title && containsTriggerPhrase(issue.title)))) {
        containsTrigger = true;
        triggerText = issue.body || issue.title;
        issueNumber = issue.number;
        isPR = false;
        isEditEvent = payload.action === 'edited';
        triggerUsername = issue.user?.login || 'unknown';
        // For 'issues' event, there's no comment - the trigger is in the issue body/title itself
        // We still want to search for existing result comments when editing
        commentId = null; // Explicitly set to null for clarity
      }
    } else if (testMode === 'true') {
      // In test mode, always trigger and use custom prompt
      containsTrigger = true;
      triggerText = customPrompt;
      triggerUsername = 'integration-test';
    }

    // Set output for action.yml to check
    core.setOutput('contains_trigger', containsTrigger.toString());

    if (!containsTrigger) {
      return;
    }

    // Setup GitHub token with intelligent resolution (including GitHub App support)
    let githubToken = process.env.OVERRIDE_GITHUB_TOKEN;
    let tokenSource = 'custom';

    if (!githubToken) {
      githubToken = process.env.DEFAULT_WORKFLOW_TOKEN;
      tokenSource = 'default';
    }

    if (!githubToken) {
      throw new Error('GitHub token is required');
    }

    // Create Octokit instance
    const octokit = github.getOctokit(githubToken);

    // Check user permissions
    const hasPermissions = await checkUserPermissions(octokit, context, issueNumber, allowedNonWriteUsers);
    if (!hasPermissions) {
      core.setOutput('contains_trigger', 'false');
      return;
    }

    // Add immediate eye reaction to show the action is triggered
    if (commentId) {
      try {
        await octokit.rest.reactions.createForIssueComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          comment_id: commentId,
          content: 'eyes',
        });
      } catch (error) {
        core.warning(`Failed to add reaction: ${error.message}`);
      }
    }

    // Get repository default branch if not specified
    let actualTargetBranch = targetBranch;
    if (!actualTargetBranch) {
      const repo = await octokit.rest.repos.get({
        owner: context.repo.owner,
        repo: context.repo.repo,
      });
      actualTargetBranch = repo.data.default_branch;
    }

    // Create branch name for this execution
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const awsapmBranch = `${branchPrefix}${context.runId}-${timestamp}`;

    // Create or reuse tracking comment
    let awsapmCommentId = null;
    if (issueNumber) {
      try {
        // If this is an edit event, search for existing result comment to reuse
        if (isEditEvent) {
          const { data: comments } = await octokit.rest.issues.listComments({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: issueNumber,
            per_page: 100,
          });

          let existingComment = null;

          if (commentId) {
            // For issue_comment events: Find the result comment after the specific trigger comment
            const triggerCommentIndex = comments.findIndex(c => c.id == commentId);

            if (triggerCommentIndex !== -1) {
              existingComment = comments
                .slice(triggerCommentIndex + 1) // Start from next comment after trigger
                .find(c =>
                  c.body && c.body.includes('Application observability for AWS Investigation')
                );
            } else {
              core.warning(`Trigger comment ID ${commentId} not found in comments list. Creating new comment.`);
            }
          } else {
            // For issues events: Find the first result comment
            existingComment = comments.find(c =>
              c.body && c.body.includes('Application observability for AWS Investigation')
            );
          }

          if (existingComment) {
            awsapmCommentId = existingComment.id;

            // Update it to show re-investigating status
            const reinvestigateBody = `🔄 **Application observability for AWS Investigation Re-investigating...**\n\n` +
              `Request updated by @${triggerUsername}.\n\n` +
              `Updated request:\n> ${triggerText.substring(0, 300)}${triggerText.length > 300 ? '...' : ''}\n\n` +
              `⏳ Investigation in progress - [View workflow run](${context.payload.repository.html_url}/actions/runs/${context.runId})`;

            await octokit.rest.issues.updateComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              comment_id: awsapmCommentId,
              body: reinvestigateBody,
            });
          }
        }

        // Create new tracking comment if not reusing
        if (!awsapmCommentId) {
          const commentBody = `🔍 **Application observability for AWS Investigation Started**\n\n` +
            `I'm analyzing this ${isPR ? 'PR' : 'issue'}...\n\n` +
            `⏳ Investigation in progress - [View workflow run](${context.payload.repository.html_url}/actions/runs/${context.runId})`;

          const comment = await octokit.rest.issues.createComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: issueNumber,
            body: commentBody,
          });

          awsapmCommentId = comment.data.id;
        }
      } catch (error) {
        core.error(`Failed to create/update tracking comment: ${error.message}`);
      }
    }

    // Create prompt file
    const promptDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'awsapm-prompts');
    if (!fs.existsSync(promptDir)) {
      fs.mkdirSync(promptDir, { recursive: true });
    }

    const promptFile = path.join(promptDir, 'awsapm-prompt.txt');

    // Get repository info for prompt generation
    let repoInfo;
    try {
      repoInfo = await getBasicRepoInfo(context, githubToken);
    } catch (repoError) {
      core.warning(`Failed to fetch repository info: ${repoError.message}`);
      repoInfo = {
        primaryLanguage: 'Unknown',
        description: 'Repository information unavailable',
        size: 0,
        fileCount: 'Unknown',
        topics: []
      };
    }

    // Remove bot name from the user's request
    const cleanedUserRequest = triggerText.replace(new RegExp(botName, 'gi'), '').trim();

    if (testMode === 'true') {
      // for integration test, use custom prompt directly
      try {
        fs.writeFileSync(promptFile, customPrompt);
      } catch (error) {
        core.error(`Failed to write custom prompt to file: ${error.message}`);
        process.exit(1);
      }
    } else {
      // Use the dynamic prompt generation with PR context
      const { createGeneralPrompt } = require('./prompt-builder');

      try {
        const finalPrompt = await createGeneralPrompt(context, repoInfo, cleanedUserRequest, githubToken, awsapmBranch);
        fs.writeFileSync(promptFile, finalPrompt);
      } catch (promptError) {
        core.error(`Failed to generate dynamic prompt: ${promptError.message}`);
        // Fallback to basic prompt if dynamic generation fails
        let fallbackPrompt = '';
        if (customPrompt) {
          fallbackPrompt = customPrompt + '\n\n';
        }
        fallbackPrompt += `Please analyze this ${isPR ? 'pull request' : 'issue'} using AI Agent for insights.\n\n`;
        fallbackPrompt += `Original request: ${cleanedUserRequest}\n\n`;
        fallbackPrompt += `Context: This is a ${context.eventName} event in ${context.repo.owner}/${context.repo.repo}`;

        fs.writeFileSync(promptFile, fallbackPrompt);
      }
    }

    // Set outputs
    core.setOutput('GITHUB_TOKEN', githubToken);
    core.setOutput('AWSAPM_BRANCH', awsapmBranch);
    core.setOutput('TARGET_BRANCH', actualTargetBranch);
    core.setOutput('awsapm_comment_id', awsapmCommentId);
    core.setOutput('issue_number', issueNumber);
    core.setOutput('is_pr', isPR);
    core.setOutput('trigger_text', triggerText);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Init step failed: ${errorMessage}`);
    core.setFailed(`Init step failed with error: ${errorMessage}`);
    process.exit(1);
  }
}

/**
 * Check if user has write or admin permissions to the repository
 */
async function checkUserPermissions(octokit, context, issueNumber, allowedNonWriteUsers) {
  const testMode = process.env.TEST_MODE || 'false';
  if (testMode === 'true') {
    return true;
  }

  const actor = context.actor;
  core.debug(`Checking permissions for actor: ${actor}`);

  try {
    // Check permissions directly using the permission endpoint
    const response = await octokit.rest.repos.getCollaboratorPermissionLevel({
      owner: context.repo.owner,
      repo: context.repo.repo,
      username: actor,
    });

    const permissionLevel = response.data.permission;

    if (permissionLevel === 'admin' || permissionLevel === 'write') {
      return true;
    }

    // Check if user is in allowedNonWriteUsers list
    if (allowedNonWriteUsers) {
      const allowedUsers = allowedNonWriteUsers.split(',').map(u => u.trim()).filter(Boolean);

      // Check for wildcard (allow all users)
      if (allowedUsers.includes('*')) {
        return true;
      }

      // Check if actor is in the allowed list
      if (allowedUsers.includes(actor)) {
        return true;
      }
    }

    // User doesn't have sufficient permissions
    core.warning(`Actor ${actor} has insufficient permissions: ${permissionLevel}`);

    // Post explanatory comment
    if (issueNumber) {
      try {
        const commentBody = `🚫 **Application observability for AWS Investigation - Access Denied**\n\n` +
          `Sorry @${actor}, you don't have sufficient permissions to use this bot.\n\n` +
          `**Required:** Write or Admin access to this repository\n` +
          `**Your level:** ${permissionLevel}\n\n` +
          `Please contact a repository maintainer if you believe this is an error.`;

        await octokit.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issueNumber,
          body: commentBody,
        });
        core.debug('Posted access denied comment');
      } catch (commentError) {
        core.error(`Failed to post access denied comment: ${commentError.message}`);
      }
    }

    return false;
  } catch (error) {
    core.error(`Failed to check permissions: ${error}`);
    throw new Error(`Failed to check permissions for ${actor}: ${error}`);
  }
}

/**
 * Get basic repository information for prompt generation
 */
async function getBasicRepoInfo(context, githubToken) {
  try {
    const octokit = github.getOctokit(githubToken);

    const { data: repo } = await octokit.rest.repos.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
    });

    // Get repository languages
    const { data: languages } = await octokit.rest.repos.listLanguages({
      owner: context.repo.owner,
      repo: context.repo.repo,
    });

    const primaryLanguage = Object.keys(languages)[0] || 'Unknown';

    return {
      primaryLanguage,
      description: repo.description,
      size: repo.size,
      fileCount: 'Unknown', // GitHub API doesn't provide file count directly
      topics: repo.topics || []
    };
  } catch (error) {
    core.warning(`Could not fetch repository info: ${error.message}`);
    return {
      primaryLanguage: 'Unknown',
      description: 'Repository information unavailable',
      size: 0,
      fileCount: 'Unknown',
      topics: []
    };
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };