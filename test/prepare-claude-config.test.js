#!/usr/bin/env node

// Mock modules BEFORE requiring them
jest.mock('@actions/core');
jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    promises: {
      access: jest.fn(),
      appendFile: jest.fn(),
      writeFile: jest.fn(),
    },
  };
});

const core = require('@actions/core');
const fs = require('fs');
const path = require('path');

// Mock MCPConfigManager
const mockBuildMCPConfig = jest.fn();
const mockGetAllowedToolsForClaude = jest.fn();
const mockHasAWSCredentials = jest.fn();

jest.mock('../src/config/mcp-config.js', () => ({
  MCPConfigManager: jest.fn().mockImplementation(() => ({
    buildMCPConfig: mockBuildMCPConfig,
    getAllowedToolsForClaude: mockGetAllowedToolsForClaude,
    hasAWSCredentials: mockHasAWSCredentials,
  })),
}));

const { run } = require('../src/prepare-claude-config.js');

describe('prepare-claude-config', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Reset mocks
    jest.clearAllMocks();

    // Default successful responses
    mockBuildMCPConfig.mockReturnValue({
      mcpServers: {
        applicationsignals: {},
        github: {},
      }
    });
    mockGetAllowedToolsForClaude.mockReturnValue('tool1,tool2,tool3');
    mockHasAWSCredentials.mockReturnValue(true);
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('successful configuration', () => {
    it('should prepare Claude configuration with AWS credentials', async () => {
      process.env.OUTPUT_DIR = '/tmp/test-output';
      process.env.INPUT_PROMPT_FILE = '/tmp/test-prompt.txt';
      process.env.RUNNER_TEMP = '/tmp';

      fs.existsSync.mockReturnValue(true);

      await run();

      expect(core.info).toHaveBeenCalledWith('Preparing Claude Code configuration...');
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Prompt file found'));
      expect(core.info).toHaveBeenCalledWith('AWS credentials found - CloudWatch MCPs configured');
      expect(core.info).toHaveBeenCalledWith('MCP servers configured: 2');
      expect(core.info).toHaveBeenCalledWith('Configuration prepared successfully');

      expect(core.setOutput).toHaveBeenCalledWith('prompt_file', '/tmp/test-prompt.txt');
      expect(core.setOutput).toHaveBeenCalledWith('mcp_config_file', expect.stringContaining('mcp-servers.json'));
      expect(core.setOutput).toHaveBeenCalledWith('allowed_tools', 'tool1,tool2,tool3');
    });

    it('should prepare Claude configuration without AWS credentials', async () => {
      process.env.OUTPUT_DIR = '/tmp/test-output';
      process.env.INPUT_PROMPT_FILE = '/tmp/test-prompt.txt';
      process.env.RUNNER_TEMP = '/tmp';

      fs.existsSync.mockReturnValue(true);
      mockHasAWSCredentials.mockReturnValue(false);

      await run();

      expect(core.warning).toHaveBeenCalledWith('No AWS credentials found - CloudWatch MCPs disabled');
      expect(core.info).toHaveBeenCalledWith('Configuration prepared successfully');
    });

    it('should create output directory if it does not exist', async () => {
      process.env.OUTPUT_DIR = '/tmp/test-output';
      process.env.INPUT_PROMPT_FILE = '/tmp/test-prompt.txt';

      fs.existsSync.mockReturnValueOnce(false).mockReturnValueOnce(true); // dir doesn't exist, prompt file exists

      await run();

      expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/test-output', { recursive: true });
      expect(core.info).toHaveBeenCalledWith('Configuration prepared successfully');
    });

    it('should use RUNNER_TEMP as default output directory', async () => {
      process.env.INPUT_PROMPT_FILE = '/tmp/test-prompt.txt';
      process.env.RUNNER_TEMP = '/tmp/runner';
      delete process.env.OUTPUT_DIR;

      fs.existsSync.mockReturnValue(true);

      await run();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('/tmp/runner/awsapm-prompts/mcp-servers.json'),
        expect.any(String)
      );
    });

    it('should write MCP config as formatted JSON', async () => {
      process.env.OUTPUT_DIR = '/tmp/test-output';
      process.env.INPUT_PROMPT_FILE = '/tmp/test-prompt.txt';

      const mockConfig = {
        mcpServers: {
          test: { command: 'test' }
        }
      };

      fs.existsSync.mockReturnValue(true);
      mockBuildMCPConfig.mockReturnValue(mockConfig);

      await run();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('mcp-servers.json'),
        JSON.stringify(mockConfig, null, 2)
      );
    });
  });

  describe('error handling', () => {
    it('should fail if prompt file does not exist', async () => {
      process.env.OUTPUT_DIR = '/tmp/test-output';
      process.env.INPUT_PROMPT_FILE = '/tmp/nonexistent.txt';

      fs.existsSync.mockReturnValueOnce(true).mockReturnValueOnce(false); // dir exists, prompt doesn't

      // Mock process.exit to prevent actual exit
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

      await run();

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to prepare Claude config: Prompt file not found')
      );
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Failed to prepare Claude config: Prompt file not found')
      );
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
    });

    it('should fail if prompt file is not provided', async () => {
      process.env.OUTPUT_DIR = '/tmp/test-output';
      delete process.env.INPUT_PROMPT_FILE;

      fs.existsSync.mockReturnValue(true);

      // Mock process.exit to prevent actual exit
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

      await run();

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to prepare Claude config: Prompt file not found')
      );
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
    });

    it('should handle MCP config build errors', async () => {
      process.env.OUTPUT_DIR = '/tmp/test-output';
      process.env.INPUT_PROMPT_FILE = '/tmp/test-prompt.txt';

      fs.existsSync.mockReturnValue(true);
      mockBuildMCPConfig.mockImplementation(() => {
        throw new Error('MCP build error');
      });

      // Mock process.exit to prevent actual exit
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

      await run();

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to prepare Claude config: MCP build error')
      );
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Failed to prepare Claude config: MCP build error')
      );
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
    });
  });
});
