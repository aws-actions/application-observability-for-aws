const { createGeneralPrompt } = require('../src/prompt-builder');
const promptBuilder = require('../src/prompt-builder');

// Mock @actions/core to suppress warnings during tests
jest.mock('@actions/core', () => ({
  warning: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const mockContext = {
  payload: {
    repository: {
      name: 'test-repo',
      owner: { login: 'test-owner' },
      html_url: 'https://github.com/test-owner/test-repo'
    },
    issue: {
      number: 1,
      pull_request: null
    },
    pull_request: null,
    comment: {
      id: 123,
      body: '@awsapm test',
      user: { login: 'test-user' },
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z'
    }
  },
  repo: {
    owner: 'test-owner',
    repo: 'test-repo'
  },
  eventName: 'issue_comment'
};

const mockRepoInfo = {
  name: 'test-repo',
  owner: 'test-owner',
  description: 'Test repository',
  language: 'JavaScript',
  size: 1024,
  fileCount: 50,
  topics: ['test', 'javascript'],
  hasReadme: true
};

// Mock @actions/github
jest.mock('@actions/github', () => ({
  get context() {
    return mockContext;
  }
}));

describe('prompt-builder', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createGeneralPrompt', () => {
    test('includes user input in prompt', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'analyze this issue');
      expect(prompt).toContain('analyze this issue');
    });

    test('includes result marker instruction', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('🎯 **Application observability for AWS Assistant Result**');
      expect(prompt).toContain('CRITICAL!');
      expect(prompt).toContain('first line of your response');
    });

    test('includes AWS observability context', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('Application observability for AWS');
      expect(prompt).toContain('CloudWatch');
    });

    test('includes custom prompt when provided', async () => {
      process.env.CUSTOM_PROMPT = 'Focus on security vulnerabilities';
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'analyze code');
      expect(prompt).toContain('Focus on security vulnerabilities');
    });

    test('works without custom prompt', async () => {
      delete process.env.CUSTOM_PROMPT;
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0);
    });

    test('includes repository context', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('test-repo');
    });

    test('includes response guidelines', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('SHORT and CONCISE');
      expect(prompt).toContain('bullet points');
    });

    test('includes PR creation guidelines', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('When to Create Pull Requests');
      expect(prompt).toContain('fix issues');
      expect(prompt).toContain('create a PR');
      expect(prompt).toContain('Do NOT create PRs when');
    });

    test('includes MCP tool capabilities', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('CAPABILITIES');
      expect(prompt).toContain('What You CAN Do');
    });

    test('handles empty user input', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, '');
      expect(prompt).toBeDefined();
      expect(prompt).toContain('🎯 **Application observability for AWS Assistant Result**');
    });

    test('handles multiline user input', async () => {
      const userInput = `Line 1
Line 2
Line 3`;
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, userInput);
      expect(prompt).toContain('Line 1');
      expect(prompt).toContain('Line 2');
      expect(prompt).toContain('Line 3');
    });
  });

  describe('system prompt structure', () => {
    test('has clear sections', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('IMPORTANT CLARIFICATIONS');
      expect(prompt).toContain('RESPONSE FORMAT REQUIREMENTS');
      expect(prompt).toContain('CAPABILITIES');
    });

    test('includes investigation guidelines', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('AWS');
      expect(prompt).toContain('trace');
    });

    test('includes PR workflow steps', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('Step 1:');
      expect(prompt).toContain('Step 2:');
      expect(prompt).toContain('Step 3:');
      expect(prompt).toContain('create_branch');
      expect(prompt).toContain('create_or_update_file');
      expect(prompt).toContain('create_pull_request');
    });

    test('specifies response format', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('Maximum 3-5 main points');
    });
  });

  describe('custom prompt integration', () => {
    test('appends custom prompt to system instructions', async () => {
      process.env.CUSTOM_PROMPT = 'Additional instruction';
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'user query');
      const customPromptIndex = prompt.indexOf('Additional instruction');
      const userQueryIndex = prompt.indexOf('user query');
      expect(customPromptIndex).toBeGreaterThan(0);
      expect(customPromptIndex).toBeLessThan(userQueryIndex);
    });

    test('handles multiline custom prompt', async () => {
      process.env.CUSTOM_PROMPT = `Line 1 of custom
Line 2 of custom`;
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('Line 1 of custom');
      expect(prompt).toContain('Line 2 of custom');
    });

    test('handles empty custom prompt gracefully', async () => {
      process.env.CUSTOM_PROMPT = '';
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toBeDefined();
    });
  });

  describe('prompt consistency', () => {
    test('generates consistent prompt for same input', async () => {
      const prompt1 = await createGeneralPrompt(mockContext, mockRepoInfo, 'test input');
      const prompt2 = await createGeneralPrompt(mockContext, mockRepoInfo, 'test input');
      expect(prompt1).toBe(prompt2);
    });

    test('generates different prompts for different inputs', async () => {
      const prompt1 = await createGeneralPrompt(mockContext, mockRepoInfo, 'input 1');
      const prompt2 = await createGeneralPrompt(mockContext, mockRepoInfo, 'input 2');
      expect(prompt1).not.toBe(prompt2);
    });

    test('uses fallback branch name when not provided', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).toContain('awsapm-branch');
    });

    test('uses provided branch name when supplied', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test', 'test-token', 'custom-branch-123');
      expect(prompt).toContain('custom-branch-123');
      expect(prompt).not.toContain('awsapm-branch');
    });
  });

  describe('PR context handling', () => {
    test('includes PR context when available', async () => {
      const prContext = {
        ...mockContext,
        payload: {
          ...mockContext.payload,
          pull_request: {
            number: 123,
            title: 'Test PR',
            body: 'PR description',
            html_url: 'https://github.com/test-owner/test-repo/pull/123'
          }
        }
      };
      const prompt = await createGeneralPrompt(prContext, mockRepoInfo, 'test');
      expect(prompt).toBeDefined();
    });

    test('handles issue context when available', async () => {
      const issueContext = {
        ...mockContext,
        payload: {
          ...mockContext.payload,
          issue: {
            number: 456,
            title: 'Test Issue',
            body: 'Issue description',
            html_url: 'https://github.com/test-owner/test-repo/issues/456'
          }
        }
      };
      const prompt = await createGeneralPrompt(issueContext, mockRepoInfo, 'test');
      expect(prompt).toBeDefined();
    });

    test('handles missing PR and issue gracefully', async () => {
      const minimalContext = {
        ...mockContext,
        payload: {
          ...mockContext.payload,
          pull_request: null,
          issue: null
        }
      };
      const prompt = await createGeneralPrompt(minimalContext, mockRepoInfo, 'test');
      expect(prompt).toBeDefined();
      expect(prompt).toContain('test');
    });
  });

  describe('repository info handling', () => {
    test('handles minimal repo info', async () => {
      const minimalRepoInfo = {
        name: 'test-repo',
        owner: 'test-owner'
      };
      const prompt = await createGeneralPrompt(mockContext, minimalRepoInfo, 'test');
      expect(prompt).toBeDefined();
      expect(prompt).toContain('test-repo');
    });

    test('handles null repo info gracefully', async () => {
      const prompt = await createGeneralPrompt(mockContext, null, 'test');
      expect(prompt).toBeDefined();
    });

    test('handles undefined repo info gracefully', async () => {
      const prompt = await createGeneralPrompt(mockContext, undefined, 'test');
      expect(prompt).toBeDefined();
    });
  });

  describe('event type handling', () => {
    test('handles pull_request_review_comment event', async () => {
      const reviewCommentContext = {
        ...mockContext,
        eventName: 'pull_request_review_comment',
        payload: {
          ...mockContext.payload,
          comment: { body: 'Review comment' },
          pull_request: { number: 123 }
        }
      };

      const prompt = await createGeneralPrompt(reviewCommentContext, mockRepoInfo, 'test');
      expect(prompt).toContain('REVIEW_COMMENT');
      expect(prompt).toContain('PR review comment with trigger phrase');
    });

    test('handles pull_request_review event', async () => {
      const reviewContext = {
        ...mockContext,
        eventName: 'pull_request_review',
        payload: {
          ...mockContext.payload,
          review: { body: 'Approval review' },
          pull_request: { number: 123 }
        }
      };

      const prompt = await createGeneralPrompt(reviewContext, mockRepoInfo, 'test');
      expect(prompt).toContain('PR_REVIEW');
      expect(prompt).toContain('PR review with trigger phrase');
    });

    test('handles issues event', async () => {
      const issuesContext = {
        ...mockContext,
        eventName: 'issues',
        payload: {
          ...mockContext.payload,
          issue: { body: 'New issue body', number: 456 }
        }
      };

      const prompt = await createGeneralPrompt(issuesContext, mockRepoInfo, 'test');
      expect(prompt).toContain('ISSUE_CREATED');
      expect(prompt).toContain('new issue with trigger phrase in body');
    });
  });

  describe('PR diff context integration', () => {
    test('includes changed files section when PR has changes', async () => {
      const github = require('@actions/github');
      github.getOctokit = jest.fn(() => ({
        rest: {
          issues: {
            listComments: jest.fn().mockResolvedValue({ data: [] })
          },
          pulls: {
            listFiles: jest.fn().mockResolvedValue({
              data: [
                {
                  filename: 'src/test.js',
                  status: 'modified',
                  additions: 10,
                  deletions: 5,
                  patch: '@@ -1,5 +1,10 @@\n+added line'
                }
              ]
            })
          }
        }
      }));

      const prContext = {
        ...mockContext,
        repo: { owner: 'test-owner', repo: 'test-repo' },
        payload: {
          ...mockContext.payload,
          pull_request: { number: 123 }
        }
      };

      const prompt = await createGeneralPrompt(prContext, mockRepoInfo, 'test', 'test-token');
      expect(prompt).toContain('<changed_files>');
      expect(prompt).toContain('src/test.js');
      expect(prompt).toContain('modified');
      expect(prompt).toContain('Additions: +10');
      expect(prompt).toContain('Deletions: -5');
    });

    test('does not include changed files when no PR context', async () => {
      const prompt = await createGeneralPrompt(mockContext, mockRepoInfo, 'test');
      expect(prompt).not.toContain('<changed_files>');
    });
  });

  describe('getEventTriggerTime', () => {
    const { getEventTriggerTime } = require('../src/prompt-builder');

    test('returns comment created_at for issue_comment event', () => {
      const context = {
        eventName: 'issue_comment',
        payload: {
          comment: { created_at: '2025-01-01T00:00:00Z' }
        }
      };
      expect(getEventTriggerTime(context)).toBe('2025-01-01T00:00:00Z');
    });

    test('returns review submitted_at for pull_request_review event', () => {
      const context = {
        eventName: 'pull_request_review',
        payload: {
          review: { submitted_at: '2025-01-02T00:00:00Z' }
        }
      };
      expect(getEventTriggerTime(context)).toBe('2025-01-02T00:00:00Z');
    });

    test('returns comment created_at for pull_request_review_comment event', () => {
      const context = {
        eventName: 'pull_request_review_comment',
        payload: {
          comment: { created_at: '2025-01-03T00:00:00Z' }
        }
      };
      expect(getEventTriggerTime(context)).toBe('2025-01-03T00:00:00Z');
    });

    test('returns undefined for unknown event types', () => {
      const context = {
        eventName: 'push',
        payload: {}
      };
      expect(getEventTriggerTime(context)).toBeUndefined();
    });

    test('returns undefined when comment is missing', () => {
      const context = {
        eventName: 'issue_comment',
        payload: {}
      };
      expect(getEventTriggerTime(context)).toBeUndefined();
    });
  });

  describe('filterCommentsByTriggerTime', () => {
    const { filterCommentsByTriggerTime } = require('../src/prompt-builder');

    const triggerTime = '2025-01-01T12:00:00Z';

    test('returns all comments when no trigger time provided', () => {
      const comments = [
        { createdAt: '2025-01-01T10:00:00Z', body: 'Comment 1' },
        { createdAt: '2025-01-01T11:00:00Z', body: 'Comment 2' }
      ];
      expect(filterCommentsByTriggerTime(comments, null)).toEqual(comments);
    });

    test('filters out comments created at or after trigger time', () => {
      const comments = [
        { createdAt: '2025-01-01T10:00:00Z', body: 'Before' },
        { createdAt: '2025-01-01T12:00:00Z', body: 'At trigger' },
        { createdAt: '2025-01-01T13:00:00Z', body: 'After' }
      ];
      const filtered = filterCommentsByTriggerTime(comments, triggerTime);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].body).toBe('Before');
    });

    test('filters out edited comments where edit occurred at or after trigger', () => {
      const comments = [
        {
          createdAt: '2025-01-01T10:00:00Z',
          updatedAt: '2025-01-01T13:00:00Z',
          body: 'Edited after trigger'
        },
        {
          createdAt: '2025-01-01T10:00:00Z',
          updatedAt: '2025-01-01T11:00:00Z',
          body: 'Edited before trigger'
        }
      ];
      const filtered = filterCommentsByTriggerTime(comments, triggerTime);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].body).toBe('Edited before trigger');
    });

    test('includes comments without updatedAt field', () => {
      const comments = [
        { createdAt: '2025-01-01T10:00:00Z', body: 'No edit' }
      ];
      const filtered = filterCommentsByTriggerTime(comments, triggerTime);
      expect(filtered).toHaveLength(1);
    });

    test('handles empty comment array', () => {
      expect(filterCommentsByTriggerTime([], triggerTime)).toEqual([]);
    });
  });

  describe('formatConversationHistory', () => {
    const { formatConversationHistory } = require('../src/prompt-builder');

    test('returns message when no comments provided', () => {
      expect(formatConversationHistory(null)).toBe('No previous comments');
      expect(formatConversationHistory([])).toBe('No previous comments');
    });

    test('formats single comment correctly', () => {
      const comments = [
        {
          author: 'user1',
          createdAt: '2025-01-01T10:00:00Z',
          body: 'Test comment'
        }
      ];
      const formatted = formatConversationHistory(comments);
      expect(formatted).toContain('user1');
      expect(formatted).toContain('2025-01-01T10:00:00.000Z');
      expect(formatted).toContain('Test comment');
    });

    test('formats multiple comments with separator', () => {
      const comments = [
        {
          author: 'user1',
          createdAt: '2025-01-01T10:00:00Z',
          body: 'First comment'
        },
        {
          author: 'user2',
          createdAt: '2025-01-01T11:00:00Z',
          body: 'Second comment'
        }
      ];
      const formatted = formatConversationHistory(comments);
      expect(formatted).toContain('First comment');
      expect(formatted).toContain('Second comment');
      expect(formatted).toMatch(/\n\n/); // Double newline separator
    });

    test('filters out minimized comments', () => {
      const comments = [
        {
          author: 'user1',
          createdAt: '2025-01-01T10:00:00Z',
          body: 'Visible comment',
          isMinimized: false
        },
        {
          author: 'user2',
          createdAt: '2025-01-01T11:00:00Z',
          body: 'Hidden comment',
          isMinimized: true
        }
      ];
      const formatted = formatConversationHistory(comments);
      expect(formatted).toContain('Visible comment');
      expect(formatted).not.toContain('Hidden comment');
    });

    test('handles empty comment body', () => {
      const comments = [
        {
          author: 'user1',
          createdAt: '2025-01-01T10:00:00Z',
          body: ''
        }
      ];
      const formatted = formatConversationHistory(comments);
      expect(formatted).toContain('user1');
    });

    test('handles missing body field', () => {
      const comments = [
        {
          author: 'user1',
          createdAt: '2025-01-01T10:00:00Z'
        }
      ];
      const formatted = formatConversationHistory(comments);
      expect(formatted).toContain('user1');
    });
  });

  describe('fetchGitHubConversation', () => {
    const { fetchGitHubConversation } = require('../src/prompt-builder');
    let mockOctokit;

    beforeEach(() => {
      mockOctokit = {
        rest: {
          issues: {
            listComments: jest.fn()
          },
          pulls: {
            listReviewComments: jest.fn()
          }
        }
      };

      // Mock @actions/github
      jest.mock('@actions/github', () => ({
        getOctokit: jest.fn(() => mockOctokit)
      }));
    });

    test('returns empty array when no token provided', async () => {
      const result = await fetchGitHubConversation(mockContext, null);
      expect(result).toEqual([]);
    });

    test('fetches issue comments for issue_comment event', async () => {
      const mockComments = [
        {
          user: { login: 'user1' },
          created_at: '2025-01-01T10:00:00Z',
          updated_at: '2025-01-01T10:00:00Z',
          body: 'Test comment'
        }
      ];

      const github = require('@actions/github');
      github.getOctokit = jest.fn(() => ({
        rest: {
          issues: {
            listComments: jest.fn().mockResolvedValue({ data: mockComments })
          }
        }
      }));

      const issueContext = {
        ...mockContext,
        eventName: 'issue_comment',
        repo: { owner: 'test-owner', repo: 'test-repo' },
        payload: {
          ...mockContext.payload,
          issue: { number: 1 },
          comment: { created_at: '2025-01-01T12:00:00Z' }
        }
      };

      const result = await fetchGitHubConversation(issueContext, 'test-token');
      expect(result).toHaveLength(1);
      expect(result[0].author).toBe('user1');
    });

    test('fetches PR comments for pull_request_review_comment event', async () => {
      const mockIssueComments = [
        {
          user: { login: 'user1' },
          created_at: '2025-01-01T10:00:00Z',
          updated_at: '2025-01-01T10:00:00Z',
          body: 'Issue comment'
        }
      ];

      const mockReviewComments = [
        {
          user: { login: 'user2' },
          created_at: '2025-01-01T11:00:00Z',
          updated_at: '2025-01-01T11:00:00Z',
          body: 'Review comment'
        }
      ];

      const github = require('@actions/github');
      github.getOctokit = jest.fn(() => ({
        rest: {
          issues: {
            listComments: jest.fn().mockResolvedValue({ data: mockIssueComments })
          },
          pulls: {
            listReviewComments: jest.fn().mockResolvedValue({ data: mockReviewComments })
          }
        }
      }));

      const prContext = {
        ...mockContext,
        eventName: 'pull_request_review_comment',
        repo: { owner: 'test-owner', repo: 'test-repo' },
        payload: {
          ...mockContext.payload,
          pull_request: { number: 123 },
          comment: { created_at: '2025-01-01T12:00:00Z' }
        }
      };

      const result = await fetchGitHubConversation(prContext, 'test-token');
      expect(result).toHaveLength(2);
      expect(result[0].author).toBe('user1');
      expect(result[0].type).toBe('issue_comment');
      expect(result[1].author).toBe('user2');
      expect(result[1].type).toBe('review_comment');
    });

    test('fetches PR comments for pull_request_review event', async () => {
      const mockIssueComments = [];
      const mockReviewComments = [
        {
          user: { login: 'reviewer' },
          created_at: '2025-01-01T10:00:00Z',
          updated_at: '2025-01-01T10:00:00Z',
          body: 'Looks good'
        }
      ];

      const github = require('@actions/github');
      github.getOctokit = jest.fn(() => ({
        rest: {
          issues: {
            listComments: jest.fn().mockResolvedValue({ data: mockIssueComments })
          },
          pulls: {
            listReviewComments: jest.fn().mockResolvedValue({ data: mockReviewComments })
          }
        }
      }));

      const prContext = {
        ...mockContext,
        eventName: 'pull_request_review',
        repo: { owner: 'test-owner', repo: 'test-repo' },
        payload: {
          ...mockContext.payload,
          pull_request: { number: 123 },
          review: { submitted_at: '2025-01-01T12:00:00Z' }
        }
      };

      const result = await fetchGitHubConversation(prContext, 'test-token');
      expect(result).toHaveLength(1);
      expect(result[0].author).toBe('reviewer');
    });

    test('handles API errors gracefully', async () => {
      const github = require('@actions/github');
      github.getOctokit = jest.fn(() => ({
        rest: {
          issues: {
            listComments: jest.fn().mockRejectedValue(new Error('API Error'))
          }
        }
      }));

      const result = await fetchGitHubConversation(mockContext, 'test-token');
      expect(result).toEqual([]);
    });
  });

  describe('fetchPRDiffContext', () => {
    const { fetchPRDiffContext } = require('../src/prompt-builder');

    test('returns null when no PR context', async () => {
      const nonPRContext = {
        ...mockContext,
        payload: {
          ...mockContext.payload,
          pull_request: null,
          issue: { number: 1 }
        }
      };
      const result = await fetchPRDiffContext(nonPRContext, 'test-token');
      expect(result).toBeNull();
    });

    test('returns null when no token provided', async () => {
      const prContext = {
        ...mockContext,
        payload: {
          ...mockContext.payload,
          pull_request: { number: 123 }
        }
      };
      const result = await fetchPRDiffContext(prContext, null);
      expect(result).toBeNull();
    });

    test('fetches PR files when PR context available', async () => {
      const mockFiles = [
        {
          filename: 'test.js',
          status: 'modified',
          additions: 10,
          deletions: 5,
          patch: '@@ -1,5 +1,10 @@'
        }
      ];

      const github = require('@actions/github');
      github.getOctokit = jest.fn(() => ({
        rest: {
          pulls: {
            listFiles: jest.fn().mockResolvedValue({ data: mockFiles })
          }
        }
      }));

      const prContext = {
        ...mockContext,
        repo: { owner: 'test-owner', repo: 'test-repo' },
        payload: {
          ...mockContext.payload,
          pull_request: { number: 123 }
        }
      };

      const result = await fetchPRDiffContext(prContext, 'test-token');
      expect(result).toHaveLength(1);
      expect(result[0].filename).toBe('test.js');
      expect(result[0].status).toBe('modified');
    });

    test('handles API errors gracefully', async () => {
      const github = require('@actions/github');
      github.getOctokit = jest.fn(() => ({
        rest: {
          pulls: {
            listFiles: jest.fn().mockRejectedValue(new Error('API Error'))
          }
        }
      }));

      const prContext = {
        ...mockContext,
        repo: { owner: 'test-owner', repo: 'test-repo' },
        payload: {
          ...mockContext.payload,
          pull_request: { number: 123 }
        }
      };

      const result = await fetchPRDiffContext(prContext, 'test-token');
      expect(result).toBeNull();
    });

    test('detects PR from issue.pull_request field', async () => {
      const github = require('@actions/github');
      github.getOctokit = jest.fn(() => ({
        rest: {
          pulls: {
            listFiles: jest.fn().mockResolvedValue({ data: [] })
          }
        }
      }));

      const prContext = {
        ...mockContext,
        repo: { owner: 'test-owner', repo: 'test-repo' },
        payload: {
          ...mockContext.payload,
          pull_request: null,
          issue: {
            number: 123,
            pull_request: { url: 'https://github.com/test/test/pull/123' }
          }
        }
      };

      const result = await fetchPRDiffContext(prContext, 'test-token');
      expect(result).toEqual([]);
    });
  });
});
