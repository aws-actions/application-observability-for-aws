#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');

/**
 * Post Claude Code execution results back to GitHub issue/PR
 * This is specifically for the Claude Code path when using claude-code-base-action
 */
async function run() {
  try {
    // Get inputs from environment
    const commentId = process.env.AWSAPM_COMMENT_ID;
    const executionFile = process.env.CLAUDE_EXECUTION_FILE;
    const githubToken = process.env.GITHUB_TOKEN;
    const repository = process.env.REPOSITORY;
    const conclusion = process.env.CLAUDE_CONCLUSION || 'unknown';

    if (!commentId) {
      core.info('No comment ID provided - skipping result posting');
      return;
    }

    if (!executionFile || !fs.existsSync(executionFile)) {
      core.warning(`Execution file not found: ${executionFile}`);

      // Post error message to GitHub
      const octokit = github.getOctokit(githubToken);
      const [owner, repo] = repository.split('/');

      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: commentId,
        body: `❌ **Investigation Failed**\n\nClaude Code execution file not found. Check the [workflow logs](${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}) for details.`
      });
      return;
    }

    // Read Claude Code execution log
    core.info(`Reading Claude execution results from: ${executionFile}`);
    const executionLogContent = fs.readFileSync(executionFile, 'utf8');

    core.info(`Total file length: ${executionLogContent.length} characters`);

    // Parse the execution log (JSON format from claude-code-base-action)
    let result = '';
    try {
      // Try to parse as JSON array first (claude-code-base-action format)
      const parsedArray = JSON.parse(executionLogContent);

      if (Array.isArray(parsedArray)) {
        core.info(`Parsed execution file as JSON array with ${parsedArray.length} items`);

        // Look for the result object (type: "result")
        for (const item of parsedArray) {
          if (item.type === 'result' && item.result) {
            result = item.result;
            core.info(`Found result in type="result" object`);
            break;
          }

          // Fallback: extract from assistant message
          if (item.type === 'assistant' && item.message && item.message.content) {
            for (const content of item.message.content) {
              if (content.type === 'text' && content.text) {
                result = content.text;
                core.info(`Found result in type="assistant" message`);
              }
            }
          }
        }
      } else {
        core.warning('Execution file is not a JSON array, trying line-by-line parsing');
        throw new Error('Not a JSON array');
      }
    } catch (parseError) {
      core.info(`JSON array parsing failed, trying line-by-line: ${parseError.message}`);

      // Fallback: try line-by-line parsing for older format
      try {
        const lines = executionLogContent.split('\n').filter(line => line.trim());
        let lastAssistantMessage = '';

        core.info(`Processing ${lines.length} lines from execution log`);

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);

            if (parsed.type === 'assistant' && parsed.message && parsed.message.content) {
              let currentMessage = '';
              for (const content of parsed.message.content) {
                if (content.type === 'text' && content.text) {
                  currentMessage += content.text;
                }
              }
              if (currentMessage.trim()) {
                lastAssistantMessage = currentMessage;
              }
            }

            if (parsed.type === 'result' && parsed.result) {
              result += parsed.result;
            }
          } catch (e) {
            // Skip non-JSON lines
          }
        }

        result = result || lastAssistantMessage;
      } catch (lineParseError) {
        core.error(`Failed to parse execution log: ${lineParseError.message}`);
        result = '⚠️ Investigation completed but no result was generated. Check the workflow logs for details.'; // Fallback to default error msg
      }
    }

    if (!result || result.trim().length === 0) {
      result = '⚠️ Investigation completed but no result was generated. Check the workflow logs for details.';
    }

    // Ensure result starts with the required marker
    const resultMarker = '🎯 **Application observability for AWS Investigation Result**';
    if (!result.trim().startsWith(resultMarker)) {
      core.info('Result does not start with required marker, adding it');
      result = `${resultMarker}\n\n${result}`;
    }

    // Debug: Log what we're posting
    core.debug(`Result length: ${result.length} characters`);
    core.debug(`First 500 chars of result: ${result.substring(0, 500)}`);

    // Post result to GitHub
    const octokit = github.getOctokit(githubToken);
    const [owner, repo] = repository.split('/');

    // Get trigger username from environment
    const triggerUsername = process.env.TRIGGER_USERNAME || 'unknown';

    // Build status footer
    const statusEmoji = conclusion === 'success' ? '✅' : '⚠️';
    const statusText = conclusion === 'success' ? 'Complete' : 'Failed';
    const workflowUrl = `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;

    const footer = `\n\n---\n\n${statusEmoji} **Status:** ${statusText}\n👤 **Requested by:** @${triggerUsername}\n🔗 **Workflow:** [View details](${workflowUrl})`;

    const commentBody = `${statusEmoji} ${result}${footer}`;

    core.info(`Updating comment ${commentId} in ${owner}/${repo}`);
    core.info(`Comment body length: ${commentBody.length} characters`);

    const response = await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: commentId,
      body: commentBody
    });

    core.info(`Successfully posted Claude results to GitHub (comment URL: ${response.data.html_url})`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Failed to post Claude results: ${errorMessage}`);
    core.setFailed(`Failed to post Claude results: ${errorMessage}`);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
