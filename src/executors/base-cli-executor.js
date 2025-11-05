const core = require('@actions/core');
const { spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

/**
 * Base class for CLI executors
 * Implements common logic for running AI CLI tools with named pipes
 * Uses template method pattern - subclasses override specific methods
 */
class BaseCLIExecutor {
  constructor() {
    this.tempDir = process.env.RUNNER_TEMP || '/tmp';
    this.targetRepoDir = process.env.GITHUB_WORKSPACE || process.cwd();
  }

  /**
   * Get CLI-specific command name (must be overridden)
   * @returns {string} Command name (e.g., 'claude', 'q')
   */
  getCommandName() {
    throw new Error('getCommandName() must be implemented by subclass');
  }

  /**
   * Get CLI-specific command arguments (must be overridden)
   * @returns {Array<string>} Command arguments
   */
  getCommandArgs() {
    throw new Error('getCommandArgs() must be implemented by subclass');
  }

  /**
   * Get CLI-specific environment variables (must be overridden)
   * @returns {Object} Environment variables
   */
  getEnvironmentVariables() {
    return { ...process.env };
  }

  /**
   * Setup CLI-specific configuration (can be overridden)
   * @returns {Promise<string|null>} Configuration file path or null
   */
  async setupConfiguration() {
    // Default: no setup needed
    return null;
  }

  /**
   * Parse CLI output into final result (must be overridden)
   * @param {string} output Raw CLI output
   * @returns {string} Parsed result
   */
  parseOutput(output) {
    throw new Error('parseOutput() must be implemented by subclass');
  }

  /**
   * Get the working directory for CLI execution
   * @returns {string} Working directory path
   */
  getWorkingDirectory() {
    return this.targetRepoDir;
  }

  /**
   * Test if CLI command is available
   * @returns {Promise<boolean>} True if CLI is available
   */
  async testCLIAvailable() {
    const { execSync } = require('child_process');
    const commandName = this.getCommandName();

    try {
      execSync(`${commandName} --help`, {
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe'
      });
      return true;
    } catch (error) {
      throw new Error(`${commandName} CLI not found in PATH`);
    }
  }

  /**
   * Create named pipe for large prompt input
   * @param {string} pipePath Path to named pipe
   */
  async createNamedPipe(pipePath) {
    const execAsync = promisify(require('child_process').exec);

    try {
      await execAsync(`rm -f "${pipePath}"`);
    } catch (e) {
      // Ignore if file doesn't exist
    }

    await execAsync(`mkfifo "${pipePath}"`);
  }

  /**
   * Write prompt to temporary file
   * @param {string} promptContent Prompt content
   * @param {string} tempPromptFile Path to temp file
   */
  writePromptToFile(promptContent, tempPromptFile) {
    fs.writeFileSync(tempPromptFile, promptContent);
  }

  /**
   * Start process to stream prompt file to pipe
   * @param {string} tempPromptFile Path to temp file
   * @param {string} pipePath Path to named pipe
   * @returns {{catProcess: ChildProcess, pipeWriteStream: WriteStream}}
   */
  startPromptStreaming(tempPromptFile, pipePath) {
    const catProcess = spawn('cat', [tempPromptFile], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    const pipeWriteStream = fs.createWriteStream(pipePath);
    catProcess.stdout.pipe(pipeWriteStream);

    catProcess.on('error', (error) => {
      core.error(`Error reading prompt file: ${error.message}`);
      pipeWriteStream.destroy();
    });

    return { catProcess, pipeWriteStream };
  }

  /**
   * Spawn CLI process with provided configuration
   * @param {string} command CLI command name
   * @param {Array<string>} args Command arguments
   * @param {Object} env Environment variables
   * @param {string} cwd Working directory
   * @returns {ChildProcess} Spawned process
   */
  spawnCLIProcess(command, args, env, cwd) {

    return spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],  // Capture stderr for output
      cwd: cwd,
      env: env
    });
  }

  /**
   * Pipe named pipe to CLI process stdin
   * @param {string} pipePath Path to named pipe
   * @param {ChildProcess} cliProcess CLI process
   * @returns {ChildProcess} Pipe read process
   */
  connectPipeToCLI(pipePath, cliProcess) {
    const pipeReadProcess = spawn('cat', [pipePath]);
    pipeReadProcess.stdout.pipe(cliProcess.stdin);

    pipeReadProcess.on('error', (error) => {
      core.error(`Error reading from named pipe: ${error.message}`);
      cliProcess.kill('SIGTERM');
    });

    return pipeReadProcess;
  }

  /**
   * Capture CLI process output
   * @param {ChildProcess} cliProcess CLI process
   * @returns {Promise<string>} Captured output
   */
  captureOutput(cliProcess) {
    return new Promise((resolve, reject) => {
      let stdoutData = '';
      let stderrData = '';

      // Capture stdout
      cliProcess.stdout.on('data', (data) => {
        const text = data.toString();

        // Allow subclasses to customize output handling
        if (this.onOutputData) {
          this.onOutputData(text);
        } else {
          process.stdout.write(text);
        }

        stdoutData += text;
      });

      // Capture stderr
      cliProcess.stderr.on('data', (data) => {
        const text = data.toString();
        process.stderr.write(text);  // Still show in workflow logs
        stderrData += text;
      });

      cliProcess.stdout.on('error', (error) => {
        core.error(`Error reading ${this.getCommandName()} stdout: ${error.message}`);
        reject(error);
      });

      cliProcess.stderr.on('error', (error) => {
        core.error(`Error reading ${this.getCommandName()} stderr: ${error.message}`);
        reject(error);
      });

      cliProcess.on('close', (code) => {
        // Log final captured sizes
        core.debug(`[SUMMARY] Total stdout: ${stdoutData.length} chars, Total stderr: ${stderrData.length} chars`);

        // Prefer stdout if it has content (structured output), otherwise use stderr
        // Amazon Q CLI may write to either depending on version and mode
        const output = stdoutData || stderrData;
        core.debug(`[SUMMARY] Using ${stdoutData ? 'stdout' : 'stderr'} as output source`);

        if (this.onRawOutput) {
          this.onRawOutput(output);
        }

        resolve({ output, exitCode: code || 0 });
      });

      cliProcess.on('error', (error) => {
        core.error(`${this.getCommandName()} process error: ${error.message}`);
        reject(error);
      });
    });
  }

  /**
   * Cleanup processes and files
   * @param {Array<ChildProcess>} processes Processes to kill
   * @param {Array<string>} files Files to delete
   */
  async cleanup(processes, files) {
    const execAsync = promisify(require('child_process').exec);

    // Cleanup processes
    for (const proc of processes) {
      try {
        if (proc && proc.kill) {
          proc.kill('SIGTERM');
        }
      } catch (e) {
        // Process may already be dead
      }
    }

    // Cleanup files
    for (const file of files) {
      try {
        if (file.includes('pipe')) {
          await execAsync(`rm -f "${file}"`);
        } else if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Main execution method - template method pattern
   * Orchestrates the entire CLI execution workflow
   * @param {string} promptContent Prompt content to execute
   * @returns {Promise<string>} Execution result
   */
  async execute(promptContent) {
    const commandName = this.getCommandName();

    try {
      core.info(`Running ${commandName} CLI investigation...`);

      // Test if CLI is available
      await this.testCLIAvailable();

      // Setup CLI-specific configuration
      const configPath = await this.setupConfiguration();

      // Prepare file paths
      const tempPromptFile = path.join(this.tempDir, `${commandName}-prompt.txt`);
      const pipePath = path.join(this.tempDir, `${commandName}_prompt_pipe`);

      // Write prompt to file
      this.writePromptToFile(promptContent, tempPromptFile);

      // Create named pipe
      await this.createNamedPipe(pipePath);

      // Start streaming prompt to pipe
      const { catProcess, pipeWriteStream } = this.startPromptStreaming(tempPromptFile, pipePath);

      // Get command args and env
      const args = this.getCommandArgs();
      const env = this.getEnvironmentVariables();

      // Spawn CLI process
      const cliProcess = this.spawnCLIProcess(commandName, args, env, this.targetRepoDir);

      // Handle CLI process errors
      cliProcess.on('error', (error) => {
        core.error(`Error spawning ${commandName} process: ${error.message}`);
        pipeWriteStream.destroy();
        throw error;
      });

      // Connect pipe to CLI stdin
      const pipeReadProcess = this.connectPipeToCLI(pipePath, cliProcess);

      // Capture output and wait for completion (NO TIMEOUT)
      const { output, exitCode } = await this.captureOutput(cliProcess);

      // Cleanup processes and files
      const filesToClean = [pipePath, tempPromptFile];
      if (configPath) {
        filesToClean.push(configPath);
      }
      await this.cleanup([catProcess, pipeReadProcess], filesToClean);

      // Check exit code and parse output
      if (exitCode === 0) {
        core.info(`${commandName} CLI completed successfully`);
        const result = this.parseOutput(output.trim());
        return result || 'AI Agent investigation completed, but no output was generated.';
      } else {
        throw new Error(`${commandName} CLI exited with code ${exitCode}`);
      }

    } catch (error) {
      throw new Error(`${commandName} CLI execution failed: ${error.message}`);
    }
  }
}

module.exports = { BaseCLIExecutor };
