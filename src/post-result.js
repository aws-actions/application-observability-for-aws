#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');

/**
 * Redact credential material from text before it is posted publicly to GitHub.
 *
 * Defense-in-depth: the investigation result is written to a public issue/PR
 * comment. Even with prompt-injection surface constrained, the agent's output
 * should never echo secrets (e.g. AWS keys, GitHub tokens) back into the repo.
 */
function redactSecrets(text) {
  if (!text) return text;

  let redacted = text;
  const PLACEHOLDER = '[REDACTED]';

  // 1) Exact-value redaction of the secrets this action runs with. Highest
  //    confidence (no false positives). Short values are skipped so unrelated
  //    text is never mangled.
  const secretEnvVars = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'GITHUB_TOKEN',
    'GITHUB_PERSONAL_ACCESS_TOKEN',
  ];
  for (const name of secretEnvVars) {
    const value = process.env[name];
    if (value && value.length >= 12) {
      redacted = redacted.split(value).join(PLACEHOLDER);
    }
  }

  // 2) Pattern-based redaction for common credential formats.
  const patterns = [
    /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA|ACCA)[0-9A-Z]{16}\b/g, // AWS access key IDs
    /\bgh[opsur]_[A-Za-z0-9]{20,}\b/g,        // GitHub tokens (ghp_/gho_/ghs_/ghu_/ghr_)
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,      // GitHub fine-grained PATs
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g, // PEM private keys
  ];
  for (const re of patterns) {
    redacted = redacted.replace(re, PLACEHOLDER);
  }

  return redacted;
}

/**
 * Detect an interim "waiting on a background/exploration agent" placeholder that
 * some models emit when they delegate work to a background subagent and end the
 * main turn before the real answer is ready.
 */
function isBackgroundAgentPlaceholder(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return /waiting on the background\b[\s\S]*\bagent\b/.test(t) ||
         t.includes('background exploration agent');
}

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

    // Guard against posting an interim placeholder as the final answer.
    // Some models delegate to a background/exploration subagent and end the
    // main turn with text like "Waiting on the background exploration agent to
    // finish before responding...". If that placeholder is captured as the
    // result, surface a clear status instead of a misleading "complete" answer.
    // Root-cause fix: set CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1 on the
    // Claude step so the investigation runs synchronously.
    if (isBackgroundAgentPlaceholder(result)) {
      core.warning('Result looks like a background-agent placeholder, not a final answer. ' +
        'Set CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1 on the Claude step to keep the run synchronous.');
      result = '⚠️ The investigation did not return a final result (the model deferred to a ' +
        'background exploration agent that did not complete in this run). ' +
        'Check the workflow logs for details, then re-trigger.';
    }

    // Ensure result starts with the required marker
    const resultMarker = '🎯 **Application observability for AWS Investigation Result**';
    if (!result.trim().startsWith(resultMarker)) {
      core.info('Result does not start with required marker, adding it');
      result = `${resultMarker}\n\n${result}`;
    }

    // Defense-in-depth: strip any credential material before posting publicly.
    result = redactSecrets(result);

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

    // Debug logging for comment body content
    core.debug(`Full comment body:\n${commentBody}`);

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

module.exports = { run, redactSecrets, isBackgroundAgentPlaceholder };
