#!/usr/bin/env node

// Mock modules BEFORE requiring them
jest.mock('@actions/core');
jest.mock('@actions/github');
jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    promises: {
      access: jest.fn(),
      appendFile: jest.fn(),
      writeFile: jest.fn(),
    },
  };
});

const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');

const { run } = require('../src/post-result.js');

describe('post-result', () => {
  let originalEnv;
  const mockUpdateComment = jest.fn();

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Reset mocks
    jest.clearAllMocks();

    // Setup default mocks
    github.getOctokit.mockReturnValue({
      rest: {
        issues: {
          updateComment: mockUpdateComment,
        },
      },
    });

    mockUpdateComment.mockResolvedValue({
      data: { html_url: 'https://github.com/owner/repo/issues/1#issuecomment-123' }
    });
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('when no comment ID is provided', () => {
    it('should skip result posting', async () => {
      process.env.AWSAPM_COMMENT_ID = '';

      await run();

      expect(core.info).toHaveBeenCalledWith('No comment ID provided - skipping result posting');
      expect(mockUpdateComment).not.toHaveBeenCalled();
    });
  });

  describe('when execution file does not exist', () => {
    it('should post error message to GitHub', async () => {
      process.env.AWSAPM_COMMENT_ID = '12345';
      process.env.CLAUDE_EXECUTION_FILE = '/tmp/nonexistent.json';
      process.env.GITHUB_TOKEN = 'token';
      process.env.REPOSITORY = 'owner/repo';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.GITHUB_RUN_ID = '123';

      fs.existsSync.mockReturnValue(false);

      await run();

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Execution file not found')
      );
      expect(mockUpdateComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        comment_id: '12345',
        body: expect.stringContaining('Investigation Failed'),
      });
    });
  });

  describe('when execution file is valid JSON array', () => {
    it('should parse result from type="result" object', async () => {
      process.env.AWSAPM_COMMENT_ID = '12345';
      process.env.CLAUDE_EXECUTION_FILE = '/tmp/output.json';
      process.env.CLAUDE_CONCLUSION = 'success';
      process.env.GITHUB_TOKEN = 'token';
      process.env.REPOSITORY = 'owner/repo';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.GITHUB_RUN_ID = '123';
      process.env.TRIGGER_USERNAME = 'testuser';

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([
        { type: 'result', result: 'Test investigation result' }
      ]));

      await run();

      expect(mockUpdateComment).toHaveBeenCalledTimes(1);
      expect(mockUpdateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'owner',
          repo: 'repo',
          comment_id: '12345',
        })
      );

      const callArgs = mockUpdateComment.mock.calls[0][0];
      expect(callArgs.body).toContain('Test investigation result');
      expect(callArgs.body).toContain('✅');
      expect(callArgs.body).toContain('**Status:** Complete');
      expect(callArgs.body).toContain('**Requested by:** @testuser');
    });

    it('should parse result from assistant message', async () => {
      process.env.AWSAPM_COMMENT_ID = '12345';
      process.env.CLAUDE_EXECUTION_FILE = '/tmp/output.json';
      process.env.CLAUDE_CONCLUSION = 'failure';
      process.env.GITHUB_TOKEN = 'token';
      process.env.REPOSITORY = 'owner/repo';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.GITHUB_RUN_ID = '123';
      process.env.TRIGGER_USERNAME = 'testuser';

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Assistant message result' }
            ]
          }
        }
      ]));

      await run();

      expect(mockUpdateComment).toHaveBeenCalledTimes(1);
      expect(mockUpdateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'owner',
          repo: 'repo',
          comment_id: '12345',
        })
      );

      const callArgs = mockUpdateComment.mock.calls[0][0];
      expect(callArgs.body).toContain('Assistant message result');
      expect(callArgs.body).toContain('⚠️');
      expect(callArgs.body).toContain('**Status:** Failed');
    });
  });

  describe('when execution file is line-by-line JSON', () => {
    it('should parse result from newline-delimited format', async () => {
      process.env.AWSAPM_COMMENT_ID = '12345';
      process.env.CLAUDE_EXECUTION_FILE = '/tmp/output.json';
      process.env.CLAUDE_CONCLUSION = 'success';
      process.env.GITHUB_TOKEN = 'token';
      process.env.REPOSITORY = 'owner/repo';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.GITHUB_RUN_ID = '123';
      process.env.TRIGGER_USERNAME = 'testuser';

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        '{"type":"assistant","message":{"content":[{"type":"text","text":"Line 1"}]}}\n' +
        '{"type":"result","result":"Final result"}\n'
      );

      await run();

      expect(mockUpdateComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        comment_id: '12345',
        body: expect.stringContaining('Final result'),
      });
    });
  });

  describe('when execution file has no result', () => {
    it('should post warning message', async () => {
      process.env.AWSAPM_COMMENT_ID = '12345';
      process.env.CLAUDE_EXECUTION_FILE = '/tmp/output.json';
      process.env.CLAUDE_CONCLUSION = 'success';
      process.env.GITHUB_TOKEN = 'token';
      process.env.REPOSITORY = 'owner/repo';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.GITHUB_RUN_ID = '123';
      process.env.TRIGGER_USERNAME = 'testuser';

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([]));

      await run();

      expect(mockUpdateComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        comment_id: '12345',
        body: expect.stringContaining('Investigation completed but no result was generated'),
      });
    });
  });

  describe('error handling', () => {
    it('should handle GitHub API errors', async () => {
      process.env.AWSAPM_COMMENT_ID = '12345';
      process.env.CLAUDE_EXECUTION_FILE = '/tmp/output.json';
      process.env.CLAUDE_CONCLUSION = 'success';
      process.env.GITHUB_TOKEN = 'token';
      process.env.REPOSITORY = 'owner/repo';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.GITHUB_RUN_ID = '123';

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([
        { type: 'result', result: 'Test result' }
      ]));
      mockUpdateComment.mockRejectedValue(new Error('API Error'));

      // Mock process.exit to prevent actual exit
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

      await run();

      expect(core.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to post Claude results: API Error')
      );
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Failed to post Claude results: API Error')
      );
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
    });
  });
});
