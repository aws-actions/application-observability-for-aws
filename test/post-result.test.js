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

const { run, redactSecrets, isBackgroundAgentPlaceholder } = require('../src/post-result.js');

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

  describe('secret redaction', () => {
    it('redacts exact secret values known from the environment', () => {
      process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
      process.env.GITHUB_TOKEN = 'ghs_averyrealisticlookinggithubtoken123456';

      const input = 'The key is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY and token ghs_averyrealisticlookinggithubtoken123456.';
      const out = redactSecrets(input);

      expect(out).not.toContain('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
      expect(out).not.toContain('ghs_averyrealisticlookinggithubtoken123456');
      expect(out).toContain('[REDACTED]');
    });

    it('redacts credential patterns even when not in the environment', () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.GITHUB_TOKEN;

      const input = [
        'access key AKIAIOSFODNN7EXAMPLE',
        'classic token ghp_1234567890abcdefgh1234567890abcdefgh',
        'fine-grained github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz1234567890',
      ].join('\n');

      const out = redactSecrets(input);

      expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(out).not.toContain('ghp_1234567890abcdefgh1234567890abcdefgh');
      expect(out).not.toContain('github_pat_11ABCDEFG0abcdefghijkl');
      expect(out.match(/\[REDACTED\]/g)).toHaveLength(3);
    });

    it('leaves benign content untouched', () => {
      delete process.env.AWS_SECRET_ACCESS_KEY;
      process.env.GITHUB_TOKEN = 'token'; // too short to redact

      const input = '## Root Cause\n\nHigh latency in `checkout-service` (p99 2.3s). No secrets here.';
      expect(redactSecrets(input)).toBe(input);
    });

    it('handles empty/undefined input safely', () => {
      expect(redactSecrets('')).toBe('');
      expect(redactSecrets(undefined)).toBeUndefined();
    });

    it('redacts secrets from the result before posting to GitHub', async () => {
      process.env.AWSAPM_COMMENT_ID = '12345';
      process.env.CLAUDE_EXECUTION_FILE = '/tmp/output.json';
      process.env.CLAUDE_CONCLUSION = 'success';
      process.env.GITHUB_TOKEN = 'token';
      process.env.REPOSITORY = 'owner/repo';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.GITHUB_RUN_ID = '123';
      process.env.TRIGGER_USERNAME = 'testuser';
      process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([
        { type: 'result', result: 'Leaked: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }
      ]));

      await run();

      const callArgs = mockUpdateComment.mock.calls[0][0];
      expect(callArgs.body).not.toContain('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
      expect(callArgs.body).toContain('[REDACTED]');
    });
  });

  describe('background-agent placeholder guard', () => {
    it('detects the background exploration placeholder text', () => {
      expect(isBackgroundAgentPlaceholder(
        'Waiting on the background exploration agent to finish before responding with the final investigation result.'
      )).toBe(true);
      expect(isBackgroundAgentPlaceholder(
        '⚠️ Waiting for the background exploration agent.'
      )).toBe(true);
    });

    it('does not suppress a result that merely mentions background agents', () => {
      // The result is influenced by issue/comment text, so a loose match would let
      // anyone kill an investigation by getting the phrase echoed back.
      expect(isBackgroundAgentPlaceholder(
        '## Root Cause\nThe worker is waiting on the background queue.\n\n## Fix\nRestart the agent.'
      )).toBe(false);
      expect(isBackgroundAgentPlaceholder(
        'background exploration agent'
      )).toBe(false);
      expect(isBackgroundAgentPlaceholder(
        '## Analysis\nThe action disables the built-in background exploration agent via an env var, ' +
        'so the investigation stays synchronous. No further action needed.'
      )).toBe(false);
    });

    it('does not treat a long result as a placeholder even if the phrase leads it', () => {
      const long = 'Waiting on the background exploration agent was mentioned in the logs. ' +
        'x'.repeat(500);
      expect(isBackgroundAgentPlaceholder(long)).toBe(false);
    });

    it('does not flag a normal investigation result', () => {
      expect(isBackgroundAgentPlaceholder(
        '## Root Cause\n\nHigh latency in checkout-service. The agent analyzed traces.'
      )).toBe(false);
      expect(isBackgroundAgentPlaceholder('')).toBe(false);
      expect(isBackgroundAgentPlaceholder(undefined)).toBe(false);
    });

    it('posts a clear status instead of the placeholder', async () => {
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
        { type: 'result', result: 'Waiting on the background exploration agent to finish before responding with the final investigation result.' }
      ]));

      await run();

      const body = mockUpdateComment.mock.calls[0][0].body;
      expect(body).not.toContain('Waiting on the background exploration agent to finish');
      expect(body).toContain('did not return a final result');
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('background-agent placeholder')
      );
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
