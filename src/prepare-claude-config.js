#!/usr/bin/env node

const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const { MCPConfigManager } = require('./config/mcp-config');

/**
 * Prepare Claude Code configuration files for claude-code-base-action
 * This script generates:
 * 1. MCP servers configuration JSON file
 * 2. Allowed tools list for Claude
 * 3. Outputs for claude-code-base-action to consume
 */
async function run() {
  try {
    core.info('Preparing Claude Code configuration...');

    // Keep the headless investigation synchronous by default. Newer models may
    // delegate to a built-in background "Explore" subagent and end the main
    // turn with a placeholder ("Waiting on the background exploration agent to
    // finish..."), which the downstream action would then capture and post as
    // the result. Exporting this env var here propagates it (via $GITHUB_ENV)
    // to the subsequent claude-code-base-action step in the same job, so the
    // fix applies even if the workflow author never sets it. An explicit value
    // set by the user (at workflow/job level) is respected and not overridden.
    if (!process.env.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS) {
      core.exportVariable('CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS', '1');
      core.info('Defaulting CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1 for a synchronous investigation');
    }

    const outputDir = process.env.OUTPUT_DIR || path.join(process.env.RUNNER_TEMP || '/tmp', 'awsapm-prompts');
    const promptFile = process.env.INPUT_PROMPT_FILE;

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Verify prompt file exists
    if (!promptFile || !fs.existsSync(promptFile)) {
      throw new Error(`Prompt file not found: ${promptFile}`);
    }
    core.info(`Prompt file found: ${promptFile}`);

    // Build MCP configuration for Claude
    const mcpManager = new MCPConfigManager();
    const mcpConfig = mcpManager.buildMCPConfig();

    // Log configuration summary
    if (mcpManager.hasAWSCredentials()) {
      core.info('AWS credentials found - CloudWatch MCPs configured');
    } else {
      core.warning('No AWS credentials found - CloudWatch MCPs disabled');
    }

    const serverCount = Object.keys(mcpConfig.mcpServers).length;
    core.info(`MCP servers configured: ${serverCount}`);

    // Write MCP config to JSON file.
    // This file contains credential material for the MCP servers, so:
    //  - it is written to the runner temp dir (OUTPUT_DIR), OUTSIDE the repo
    //    workspace, which the agent's path-scoped Read/Grep/Glob tools cannot
    //    reach, and the agent is not granted broad shell read commands; and
    //  - it is created with owner-only (0600) permissions as defense in depth.
    const mcpConfigFile = path.join(outputDir, 'mcp-servers.json');
    fs.writeFileSync(mcpConfigFile, JSON.stringify(mcpConfig, null, 2), { mode: 0o600 });

    // Get allowed tools for Claude
    const allowedTools = mcpManager.getAllowedToolsForClaude();

    // Set outputs for claude-code-base-action
    core.setOutput('prompt_file', promptFile);
    core.setOutput('mcp_config_file', mcpConfigFile);
    core.setOutput('allowed_tools', allowedTools);

    core.info('Configuration prepared successfully');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Failed to prepare Claude config: ${errorMessage}`);
    core.setFailed(`Failed to prepare Claude config: ${errorMessage}`);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
