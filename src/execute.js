#!/usr/bin/env node

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const { AmazonQCLIExecutor } = require('./executors/amazonq-cli-executor');

/**
 * Main entry point for Application observability for AWS investigation
 */
async function run() {
  try {
    core.info('Starting Application observability for AWS investigation...');

    const context = github.context;

    // Read the prompt file
    const promptFile = process.env.INPUT_PROMPT_FILE;
    if (!promptFile || !fs.existsSync(promptFile)) {
      throw new Error('Prompt file not found');
    }

    const promptContent = fs.readFileSync(promptFile, 'utf8');

    // Print the full prompt content for debugging
    core.debug(promptContent);

    // Create output directory
    const outputDir = path.join(process.env.RUNNER_TEMP || '/tmp', 'awsapm-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Run Amazon Q Developer CLI investigation
    let investigationResult = '';
    let rawOutput = '';

    try {
      core.info('Running Amazon Q Developer CLI investigation...');
      const executor = new AmazonQCLIExecutor(null);

      executor.onRawOutput = (output) => {
        rawOutput = output;
      };

      investigationResult = await executor.execute(promptContent);
      core.info('Amazon Q Developer CLI investigation completed');
    } catch (error) {
      core.error(`Amazon Q Developer CLI failed: ${error.message}`);

      // Return the actual error message
      investigationResult = `❌ **Amazon Q Investigation Failed**

**Error:** ${error.message}

**User Request:** ${promptContent}

Please check the workflow logs for more details and ensure proper authentication is configured.`;
    }

    // Save the response with unique run ID to avoid conflicts on self-hosted runners
    const runId = process.env.GITHUB_RUN_ID || Date.now();
    const responseFile = path.join(outputDir, `awsapm-response-${runId}.txt`);
    fs.writeFileSync(responseFile, investigationResult);

    // Save raw output for integration test validation
    const rawOutputFile = path.join(outputDir, 'awsapm-raw-output.txt');
    fs.writeFileSync(rawOutputFile, rawOutput || 'No raw output captured');

    // Set outputs
    core.setOutput('execution_file', responseFile);
    core.setOutput('conclusion', 'success');

    core.info('Investigation completed');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Investigation failed: ${errorMessage}`);
    core.setFailed(`Investigation failed with error: ${errorMessage}`);

    // Still try to set some outputs for error handling
    core.setOutput('conclusion', 'failure');
    core.setOutput('error_message', errorMessage);

    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
