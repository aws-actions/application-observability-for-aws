const { run } = require('../src/init');
const fs = require('fs');
const path = require('path');

// Mock process.exit
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});

// Mock @actions/core
jest.mock('@actions/core', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
}));

// Mock @actions/github with mutable context
const mockContext = {
  repo: { owner: 'test-owner', repo: 'test-repo' },
  runId: '123456',
  payload: {
    repository: {
      name: 'test-repo',
      default_branch: 'main',
      html_url: 'https://github.com/test-owner/test-repo'
    },
    comment: {
      id: 123,
      body: '@awsapm analyze this',
      user: { login: 'test-user' }
    },
    issue: {
      number: 1,
      pull_request: null
    }
  },
  eventName: 'issue_comment',
  actor: 'test-user'
};

const mockOctokit = {
  rest: {
    repos: {
      get: jest.fn().mockResolvedValue({
        data: { default_branch: 'main' }
      }),
      getBranch: jest.fn(),
      getCollaboratorPermissionLevel: jest.fn().mockResolvedValue({
        data: { permission: 'write' }
      }),
      listLanguages: jest.fn().mockResolvedValue({
        data: { JavaScript: 100 }
      }),
    },
    git: {
      createRef: jest.fn(),
    },
    issues: {
      createComment: jest.fn().mockResolvedValue({
        data: { id: 456 }
      }),
      listComments: jest.fn().mockResolvedValue({
        data: []
      }),
    },
    pulls: {
      get: jest.fn(),
      listFiles: jest.fn(),
    },
    reactions: {
      createForIssueComment: jest.fn(),
    },
  },
};

jest.mock('@actions/github', () => ({
  get context() {
    return mockContext;
  },
  getOctokit: jest.fn(() => mockOctokit)
}));

const core = require('@actions/core');

describe('init', () => {
  let originalEnv;
  let tempDir;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.clearAllMocks();
    mockExit.mockClear();

    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'init-test-'));

    // Reset mock context to default state
    mockContext.eventName = 'issue_comment';
    mockContext.runId = '123456';
    mockContext.payload = {
      repository: {
        name: 'test-repo',
        default_branch: 'main',
        html_url: 'https://github.com/test-owner/test-repo'
      },
      comment: {
        id: 123,
        body: '@awsapm analyze this',
        user: { login: 'test-user' }
      },
      issue: {
        number: 1,
        pull_request: null
      }
    };

    // Set up environment
    process.env.RUNNER_TEMP = tempDir;
    process.env.BOT_NAME = '@awsapm';
    process.env.DEFAULT_WORKFLOW_TOKEN = 'test-token';
    process.env.GITHUB_RUN_ID = '123456';
  });

  afterEach(() => {
    process.env = originalEnv;

    // Cleanup temp files
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('trigger detection', () => {
    test('detects trigger when bot name mentioned', async () => {
      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });

    test('skips execution when bot name not mentioned', async () => {
      mockContext.payload.comment.body = 'Regular comment without mention';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'false');
    });

    test('handles different bot names', async () => {
      process.env.BOT_NAME = '@mybot';
      process.env.DEFAULT_WORKFLOW_TOKEN = 'test-token';
      mockContext.payload.comment.body = '@mybot help me';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });

    test('case insensitive bot name matching', async () => {
      mockContext.payload.comment.body = '@AwsApm analyze this';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });
  });

  describe('prompt creation', () => {
    test('creates prompt directory', async () => {
      await run();

      const promptDir = path.join(tempDir, 'awsapm-prompts');
      expect(fs.existsSync(promptDir)).toBe(true);
    });

    test('creates prompt file with user request', async () => {
      await run();

      const promptFile = path.join(tempDir, 'awsapm-prompts', 'awsapm-prompt.txt');
      expect(fs.existsSync(promptFile)).toBe(true);

      const content = fs.readFileSync(promptFile, 'utf8');
      expect(content).toContain('analyze this');
    });

    test('removes bot name from prompt', async () => {
      await run();

      const promptFile = path.join(tempDir, 'awsapm-prompts', 'awsapm-prompt.txt');
      const content = fs.readFileSync(promptFile, 'utf8');

      expect(content).not.toContain('@awsapm');
    });

    test('handles multiline comments', async () => {
      mockContext.payload.comment.body = `@awsapm
Line 1
Line 2`;

      await run();

      const promptFile = path.join(tempDir, 'awsapm-prompts', 'awsapm-prompt.txt');
      const content = fs.readFileSync(promptFile, 'utf8');

      expect(content).toContain('Line 1');
      expect(content).toContain('Line 2');
    });
  });

  describe('branch creation', () => {
    test('creates unique branch name', async () => {
      await run();

      expect(core.setOutput).toHaveBeenCalledWith(
        'AWSAPM_BRANCH',
        expect.stringContaining('awsapm/')
      );
    });

    test('includes run ID in branch name', async () => {
      mockContext.runId = '789';

      await run();

      const outputs = core.setOutput.mock.calls;
      const branchCall = outputs.find(call => call[0] === 'AWSAPM_BRANCH');

      expect(branchCall[1]).toContain('789');
    });

    test('uses branch prefix from environment', async () => {
      process.env.BRANCH_PREFIX = 'mybot/';

      await run();

      const outputs = core.setOutput.mock.calls;
      const branchCall = outputs.find(call => call[0] === 'AWSAPM_BRANCH');

      expect(branchCall[1].startsWith('mybot/')).toBe(true);
    });
  });

  describe('comment tracking', () => {
    test('creates tracking comment and sets output', async () => {
      mockOctokit.rest.issues.createComment.mockResolvedValue({
        data: { id: 456 }
      });

      await run();

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('awsapm_comment_id', 456);
    });

    test('tracking comment contains processing message', async () => {
      await run();

      const call = mockOctokit.rest.issues.createComment.mock.calls[0];
      const commentBody = call[0].body;

      expect(commentBody).toContain('Investigation');
    });

    test('tracking comment includes workflow link', async () => {
      await run();

      const call = mockOctokit.rest.issues.createComment.mock.calls[0];
      const commentBody = call[0].body;

      expect(commentBody).toContain('View workflow run');
    });
  });

  describe('GitHub token handling', () => {
    test('uses provided GitHub token', async () => {
      process.env.OVERRIDE_GITHUB_TOKEN = 'custom-token';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('GITHUB_TOKEN', 'custom-token');
    });

    test('falls back to default token', async () => {
      delete process.env.OVERRIDE_GITHUB_TOKEN;

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('GITHUB_TOKEN', 'test-token');
    });
  });

  describe('target branch', () => {
    test('uses provided target branch', async () => {
      process.env.TARGET_BRANCH = 'develop';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('TARGET_BRANCH', 'develop');
    });

    test('falls back to repository default branch', async () => {
      delete process.env.TARGET_BRANCH;

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('TARGET_BRANCH', 'main');
    });
  });

  describe('permissions', () => {
    test('allows users with write access', async () => {
      // Default behavior should allow
      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });

    test('allows users in allowed list', async () => {
      process.env.ALLOWED_NON_WRITE_USERS = 'user1,test-user,user2';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });
  });

  describe('outputs', () => {
    test('sets all required outputs', async () => {
      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', expect.any(String));
      expect(core.setOutput).toHaveBeenCalledWith('GITHUB_TOKEN', expect.any(String));
      expect(core.setOutput).toHaveBeenCalledWith('AWSAPM_BRANCH', expect.any(String));
      expect(core.setOutput).toHaveBeenCalledWith('TARGET_BRANCH', expect.any(String));
    });
  });

  describe('error handling', () => {
    test('handles API errors gracefully', async () => {
      mockOctokit.rest.issues.createComment.mockRejectedValue(new Error('API error'));

      await run();

      expect(core.error).toHaveBeenCalled();
    });

    test('logs errors when comment creation fails', async () => {
      mockOctokit.rest.issues.createComment.mockRejectedValue(new Error('Comment creation failed'));

      await run();

      expect(core.error).toHaveBeenCalledWith(expect.stringContaining('tracking comment'));
    });

    test('throws error when no GitHub token available', async () => {
      delete process.env.DEFAULT_WORKFLOW_TOKEN;
      delete process.env.OVERRIDE_GITHUB_TOKEN;

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('GitHub token'));
    });

    test('handles reaction creation failure gracefully', async () => {
      mockOctokit.rest.reactions.createForIssueComment.mockRejectedValue(new Error('Reaction failed'));

      await run();

      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to add reaction'));
    });
  });

  describe('event type handling', () => {
    test('handles pull_request_review_comment event', async () => {
      mockContext.eventName = 'pull_request_review_comment';
      mockContext.payload = {
        repository: mockContext.payload.repository,
        comment: {
          id: 789,
          body: '@awsapm review this code',
          user: { login: 'test-user' }
        },
        pull_request: {
          number: 456
        },
        action: 'created'
      };

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
      expect(mockOctokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 789 })
      );
    });

    test('detects edit action for pull_request_review_comment', async () => {
      mockContext.eventName = 'pull_request_review_comment';
      mockContext.payload = {
        repository: mockContext.payload.repository,
        comment: {
          id: 789,
          body: '@awsapm review this code',
          user: { login: 'test-user' }
        },
        pull_request: {
          number: 456
        },
        action: 'edited'
      };

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });

    test('handles issues event with trigger in body', async () => {
      mockContext.eventName = 'issues';
      mockContext.payload = {
        repository: mockContext.payload.repository,
        issue: {
          number: 789,
          body: '@awsapm help with this issue',
          title: 'Test Issue',
          user: { login: 'test-user' }
        },
        action: 'opened'
      };

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });

    test('handles issues event with trigger in title', async () => {
      mockContext.eventName = 'issues';
      mockContext.payload = {
        repository: mockContext.payload.repository,
        issue: {
          number: 789,
          body: 'Issue description',
          title: '@awsapm Test Issue',
          user: { login: 'test-user' }
        },
        action: 'opened'
      };

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });

    test('detects edit action for issues event', async () => {
      mockContext.eventName = 'issues';
      mockContext.payload = {
        repository: mockContext.payload.repository,
        issue: {
          number: 789,
          body: '@awsapm help with this issue',
          title: 'Test Issue',
          user: { login: 'test-user' }
        },
        action: 'edited'
      };

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });
  });

  describe('permission checking', () => {
    test('sets contains_trigger to false when user lacks permissions', async () => {
      mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValueOnce({
        data: { permission: 'read' }
      });

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'false');
    });

    test('allows user with write permission', async () => {
      mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValueOnce({
        data: { permission: 'write' }
      });

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });

    test('allows user with admin permission', async () => {
      mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValueOnce({
        data: { permission: 'admin' }
      });

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
    });

    test('allows specific user in ALLOWED_NON_WRITE_USERS list', async () => {
      process.env.ALLOWED_NON_WRITE_USERS = 'test-user,another-user';
      mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValueOnce({
        data: { permission: 'read' }
      });

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
      delete process.env.ALLOWED_NON_WRITE_USERS;
    });

    test('allows all users when wildcard (*) is used', async () => {
      process.env.ALLOWED_NON_WRITE_USERS = '*';
      mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValueOnce({
        data: { permission: 'read' }
      });

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('contains_trigger', 'true');
      delete process.env.ALLOWED_NON_WRITE_USERS;
    });

    test('posts access denied comment when permissions insufficient', async () => {
      mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValueOnce({
        data: { permission: 'read' }
      });

      await run();

      expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Access Denied')
        })
      );
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('insufficient permissions'));
    });

    test('handles comment post error when access denied', async () => {
      mockOctokit.rest.repos.getCollaboratorPermissionLevel.mockResolvedValueOnce({
        data: { permission: 'read' }
      });
      mockOctokit.rest.issues.createComment.mockRejectedValueOnce(new Error('API error'));

      await run();

      expect(core.error).toHaveBeenCalledWith(expect.stringContaining('Failed to post access denied comment'));
    });
  });

  describe('token handling', () => {
    test('uses OVERRIDE_GITHUB_TOKEN when available', async () => {
      process.env.OVERRIDE_GITHUB_TOKEN = 'override-token';
      process.env.DEFAULT_WORKFLOW_TOKEN = 'default-token';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('GITHUB_TOKEN', 'override-token');
    });

    test('falls back to DEFAULT_WORKFLOW_TOKEN', async () => {
      delete process.env.OVERRIDE_GITHUB_TOKEN;
      process.env.DEFAULT_WORKFLOW_TOKEN = 'default-token';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('GITHUB_TOKEN', 'default-token');
    });
  });

  describe('target branch handling', () => {
    test('uses default branch when TARGET_BRANCH not specified', async () => {
      delete process.env.TARGET_BRANCH;
      mockOctokit.rest.repos.get.mockResolvedValue({
        data: { default_branch: 'develop' }
      });

      await run();

      expect(mockOctokit.rest.repos.get).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('TARGET_BRANCH', 'develop');
    });

    test('uses TARGET_BRANCH from environment when specified', async () => {
      process.env.TARGET_BRANCH = 'feature-branch';

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('TARGET_BRANCH', 'feature-branch');
    });
  });

  describe('edit event handling', () => {
    test('updates existing comment when edit action is detected', async () => {
      mockContext.payload.action = 'edited';
      mockContext.payload.comment.body = '@awsapm updated request';
      mockContext.payload.comment.id = 123; // Trigger comment ID

      // Mock listComments to return the trigger comment followed by the result comment
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 123, // Trigger comment (the one being edited)
            body: '@awsapm updated request'
          },
          {
            id: 999, // Result comment that comes after trigger
            body: '🔍 **Application observability for AWS Investigation Started**\nOld content'
          }
        ]
      });

      mockOctokit.rest.issues.updateComment = jest.fn().mockResolvedValue({
        data: { id: 999 }
      });

      await run();

      expect(mockOctokit.rest.issues.listComments).toHaveBeenCalled();
      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({
          comment_id: 999,
          body: expect.stringContaining('Re-investigating')
        })
      );
    });

    test('finds existing comment with Complete marker', async () => {
      mockContext.payload.action = 'edited';
      mockContext.payload.comment.id = 123; // Trigger comment ID

      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 123, // Trigger comment
            body: '@awsapm analyze this'
          },
          {
            id: 888, // Result comment after trigger
            body: '✅ **Application observability for AWS Investigation Complete**\nResults here'
          }
        ]
      });

      mockOctokit.rest.issues.updateComment = jest.fn().mockResolvedValue({
        data: { id: 888 }
      });

      await run();

      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 888 })
      );
    });

    test('finds existing comment with Failed marker', async () => {
      mockContext.payload.action = 'edited';
      mockContext.payload.comment.id = 123; // Trigger comment ID

      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 123, // Trigger comment
            body: '@awsapm analyze this'
          },
          {
            id: 777, // Result comment after trigger
            body: '❌ **Application observability for AWS Investigation Failed**\nError details'
          }
        ]
      });

      mockOctokit.rest.issues.updateComment = jest.fn().mockResolvedValue({
        data: { id: 777 }
      });

      await run();

      expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 777 })
      );
    });

    test('truncates long trigger text in reinvestigate message', async () => {
      const longText = '@awsapm ' + 'a'.repeat(400);
      mockContext.payload.action = 'edited';
      mockContext.payload.comment.body = longText;
      mockContext.payload.comment.id = 123; // Trigger comment ID

      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 123, // Trigger comment
            body: longText
          },
          {
            id: 666, // Result comment after trigger
            body: 'Application observability for AWS Investigation Started'
          }
        ]
      });

      mockOctokit.rest.issues.updateComment = jest.fn().mockResolvedValue({
        data: { id: 666 }
      });

      await run();

      const updateCall = mockOctokit.rest.issues.updateComment.mock.calls[0][0];
      expect(updateCall.body).toContain('...');
    });
  });
});
