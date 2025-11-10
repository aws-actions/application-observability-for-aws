// Dynamic general prompt creation
const core = require('@actions/core');

/**
 * Get the trigger time from the GitHub context for security filtering
 */
function getEventTriggerTime(context) {
  if (context.eventName === 'issue_comment') {
    return context.payload.comment?.created_at;
  } else if (context.eventName === 'pull_request_review') {
    return context.payload.review?.submitted_at;
  } else if (context.eventName === 'pull_request_review_comment') {
    return context.payload.comment?.created_at;
  }
  return undefined;
}

/**
 * Filters comments to only include those that existed in their final state before the trigger time.
 * This prevents malicious actors from editing comments after the trigger to inject harmful content.
 */
function filterCommentsByTriggerTime(comments, triggerTime) {
  if (!triggerTime) return comments;

  const triggerTimestamp = new Date(triggerTime).getTime();

  return comments.filter((comment) => {
    // Comment must have been created before trigger (not at or after)
    const createdTimestamp = new Date(comment.createdAt).getTime();
    if (createdTimestamp >= triggerTimestamp) {
      return false;
    }

    // If comment has been edited, the most recent edit must have occurred before trigger
    // Use updated_at as GitHub REST API doesn't provide lastEditedAt
    if (comment.updatedAt) {
      const lastEditTimestamp = new Date(comment.updatedAt).getTime();
      if (lastEditTimestamp >= triggerTimestamp) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Get comments for conversation context with security filtering
 */
async function fetchGitHubConversation(context, githubToken) {
  try {
    if (!githubToken) {
      core.warning('No GitHub token provided for fetching comments');
      return [];
    }

    const github = require('@actions/github');
    const octokit = github.getOctokit(githubToken);

    // Get trigger time for security filtering
    const triggerTime = getEventTriggerTime(context);

    let comments = [];

    if (context.eventName === 'issue_comment' || context.eventName === 'issues') {
      // Get issue comments
      const { data: issueComments } = await octokit.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.payload.issue?.number || context.payload.pull_request?.number,
      });

      comments = issueComments.map(comment => ({
        author: comment.user.login,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        body: comment.body,
        isMinimized: false // GitHub API doesn't provide this, assume false
      }));

    } else if (context.eventName === 'pull_request_review_comment' || context.eventName === 'pull_request_review') {
      // Get PR comments (issue comments on PRs)
      const { data: issueComments } = await octokit.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.payload.pull_request.number,
      });

      // Get PR review comments
      const { data: reviewComments } = await octokit.rest.pulls.listReviewComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: context.payload.pull_request.number,
      });

      // Combine and sort by creation time
      const allComments = [
        ...issueComments.map(comment => ({
          author: comment.user.login,
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
          body: comment.body,
          type: 'issue_comment',
          isMinimized: false
        })),
        ...reviewComments.map(comment => ({
          author: comment.user.login,
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
          body: comment.body,
          type: 'review_comment',
          isMinimized: false
        }))
      ];

      // Sort by creation time
      comments = allComments.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }

    // Apply security filtering to prevent malicious comment editing
    const filteredComments = filterCommentsByTriggerTime(comments, triggerTime);
    return filteredComments;

  } catch (error) {
    core.error(`Could not fetch conversation comments: ${error.message}`);
    return [];
  }
}

/**
 * Format comments for conversation context
 */
function formatConversationHistory(comments) {
  if (!comments || comments.length === 0) {
    return "No previous comments";
  }

  return comments
    .filter(comment => !comment.isMinimized)
    .map(comment => {
      // Sanitize content (basic implementation)
      const sanitizedBody = comment.body || '';
      const formattedDate = new Date(comment.createdAt).toISOString();
      return `[${comment.author} at ${formattedDate}]: ${sanitizedBody}`;
    })
    .join('\n\n');
}

/**
 * Get PR changed files if this is a PR context
 */
async function fetchPRDiffContext(context, githubToken) {
  // Check for PR context in different event types
  const directPR = context.payload.pull_request;
  const issuePR = context.payload.issue?.pull_request;
  const isPRContext = !!(directPR || issuePR);

  if (!isPRContext) {
    return null;
  }

  // Get PR number from whichever source is available
  const prNumber = directPR?.number || (issuePR ? context.payload.issue.number : null);

  if (!prNumber) {
    return null;
  }

  try {
    if (!githubToken) {
      core.warning('No GitHub token provided for PR diff');
      return null;
    }

    // Use @actions/github instead of direct @octokit/rest to avoid ES module issues
    const github = require('@actions/github');
    const octokit = github.getOctokit(githubToken);

    const { data: files } = await octokit.rest.pulls.listFiles({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: prNumber,
    });

    const mappedFiles = files.map(file => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch
    }));

    return mappedFiles;
  } catch (error) {
    core.error(`Could not fetch PR changes: ${error.message}`);
    return null;
  }
}

/**
 * Create a general prompt based on GitHub context and repository information
 */
async function createAWSAPMPrompt(context, repoInfo, userRequest = '', githubToken = null, branchName = null) {
  const { eventName, payload } = context;

  // Detect PR context correctly for different event types
  const directPR = payload.pull_request;
  const issuePR = payload.issue?.pull_request;
  const isPR = !!(directPR || issuePR);

  const repository = context.repo.owner + '/' + context.repo.repo;

  // Extract trigger context and event type
  let eventType = '';
  let triggerContext = '';
  let commentBody = '';

  if (eventName === 'issue_comment') {
    eventType = isPR ? 'GENERAL_COMMENT' : 'GENERAL_COMMENT';
    triggerContext = isPR ? "issue comment with trigger phrase" : "issue comment with trigger phrase";
    commentBody = payload.comment.body;
  } else if (eventName === 'pull_request_review_comment') {
    eventType = 'REVIEW_COMMENT';
    triggerContext = "PR review comment with trigger phrase";
    commentBody = payload.comment.body;
  } else if (eventName === 'pull_request_review') {
    eventType = 'PR_REVIEW';
    triggerContext = "PR review with trigger phrase";
    commentBody = payload.review.body || '';
  } else if (eventName === 'issues') {
    eventType = 'ISSUE_CREATED';
    triggerContext = "new issue with trigger phrase in body";
    commentBody = payload.issue.body || '';
  }

  // Build comprehensive repository context
  const formattedContext = `Repository: ${repository}
Primary Language: ${repoInfo?.primaryLanguage || 'Unknown'}
Description: ${repoInfo?.description || 'No description provided'}
Size: ${repoInfo?.size || 0} KB
File Count: ${repoInfo?.fileCount || 0}
Topics: ${repoInfo?.topics?.join(', ') || 'None'}`;

  const formattedBody = userRequest || commentBody || 'No description provided';

  // Get conversation context from previous comments
  const conversationComments = await fetchGitHubConversation(context, githubToken);
  const formattedComments = formatConversationHistory(conversationComments);

  // Get PR changes if this is a PR context
  const prChanges = await fetchPRDiffContext(context, githubToken);

  // Build changed files section for PR reviews
  let changedFilesSection = '';
  if (isPR && prChanges && prChanges.length > 0) {
    changedFilesSection = `
<changed_files>
The following files were changed in this PR:

${prChanges.map(file => `
**${file.filename}** (${file.status})
- Additions: +${file.additions}
- Deletions: -${file.deletions}
${file.patch ? `
\`\`\`diff
${file.patch}
\`\`\`
` : ''}
`).join('\n')}
</changed_files>`;
  }

  // Get custom prompt from environment if provided
  const customPrompt = process.env.CUSTOM_PROMPT || '';

  // Use provided branch name or fallback to default
  const actualBranchName = branchName || 'awsapm-branch';

  // Build comprehensive prompt with repository context and PR changes
  let prompt = `You are an AI assistant designed to help with GitHub issues and pull requests. Think carefully as you analyze the context and respond appropriately.${customPrompt ? `\n\nADDITIONAL INSTRUCTIONS:\n${customPrompt}` : ''}\n\nHere's the context for your current task:

<formatted_context>
${formattedContext}
</formatted_context>

<pr_or_issue_body>
${formattedBody}
</pr_or_issue_body>

<comments>
${formattedComments}
</comments>
${changedFilesSection}

<event_type>${eventType}</event_type>
<is_pr>${isPR ? "true" : "false"}</is_pr>
<trigger_context>${triggerContext}</trigger_context>
<repository>${repository}</repository>

Your task is to analyze the context, understand the request, and provide helpful responses and/or implement code changes as needed.

IMPORTANT CLARIFICATIONS:
- When asked to "review" code, read the code and provide review feedback (do not implement changes unless explicitly asked)
- Your responses should be practical and implementation-focused
- **REPOSITORY SCOPE**: You are analyzing the repository "${repository}". Do NOT access or mention any files outside this repository, including action source code or system files.
${isPR && prChanges ? '- **FOR PR REVIEWS**: Focus ONLY on the files that were changed in this PR (listed above). Do NOT analyze the entire codebase.' : '- Analyze the codebase and provide insights based on the request'}

RESPONSE FORMAT REQUIREMENTS:
- Provide ONLY your final analysis, conclusions, and recommendations in a CONCISE format
- Be as brief as possible while maintaining clarity and usefulness
- Do NOT include process commentary like "Let me check...", "I'll help you...", "Now let me...", or "I can see that..."
- Do NOT describe your step-by-step investigation process or tool usage
- Do NOT mention creating todo lists or updating tracking items
- Do NOT mention which AI agent or tool you are (e.g., Claude Code, Amazon Q, etc.) - refer to yourself generically as "AI Agent" if needed
- Do NOT include any tool usage details, permission requests, or internal system messages
- Do NOT show JSON blocks, API calls, or technical execution details
- Focus on delivering actionable insights and concrete findings in the shortest possible format
- Use bullet points, short sentences, and clear headings
- Aim for maximum information density with minimum words

Follow these steps:

1. Understand the Request:
   - Extract the actual question or request from the trigger comment
   - Classify if it's a question, code review, implementation request, or combination
   - Assess what type of assistance is being requested

2. Gather Context:
   - Analyze the pre-fetched conversation history in the <comments> section above
   - Review the repository structure and technology stack
   - Look for relevant patterns and practices in the codebase
   - Identify areas that relate to the user's request
   - Review existing code structure and architecture
   - Consider previous conversations and context from earlier comments

3. For Issue Troubleshooting (Performance, Errors, Latency):
   - PRIORITIZE these AWS trace analysis tools:
     * mcp__awslabs_cloudwatch-appsignals-mcp-server__query_sampled_traces (detailed exception stack traces)
     * mcp__awslabs_cloudwatch-appsignals-mcp-server__search_transaction_spans (transaction-level errors and exceptions)
   - Both tools contain critical exception and error information for root cause analysis
   - Look for error patterns, exception messages, and failure points in both trace and transaction data
   - Focus on traces/transactions with errors or high latency first
   - Analyze stack traces to identify exactly where failures occur in the code
   - Use other AWS MCP tools (service metrics, SLOs) as supporting data

   IMPORTANT: For search_transaction_spans queries, use correct CloudWatch Logs syntax:
   - Filter errors with: status.code = "ERROR" (NOT attributes.status_code)
   - Get stack traces from: events.0.attributes.exception.stacktrace
   - Example query format:
     FILTER attributes.aws.local.service = "service-name" and status.code = "ERROR"
     | STATS count(*) as error_count by events.0.attributes.exception.stacktrace
     | SORT error_count desc

4. Provide Helpful Responses:

   A. For Questions and Code Reviews:
      - Provide thorough analysis and feedback
      - Look for bugs, security issues, performance problems, and other issues
      - Suggest improvements for readability and maintainability
      - Check for best practices and coding standards
      - Reference specific code sections with file paths and line numbers

   B. For Implementation Requests:
      - Analyze what needs to be implemented and provide specific recommendations
      - ONLY implement code changes if the user explicitly asks for a "fix", "implementation", or "create PR"
      - If implementing: Edit files locally using Edit/MultiEdit tools, then use GitHub MCP tools to create PRs
      - Follow existing code patterns and conventions
      - Test your changes if possible

   C. For General Analysis:
      - Identify patterns and opportunities for improvement
      - Suggest best practices for the detected tech stack
      - Provide recommendations specific to the codebase
      - Reference specific files and code sections when applicable

5. When to Create Pull Requests:
   Create pull requests and implement code changes when the user's request implies action, such as:
   - Requests to fix issues (e.g., "fix the sqs issue", "resolve the bug", "patch the vulnerability")
   - Implementation requests (e.g., "implement feature X", "add support for Y", "enable Z")
   - Direct PR requests (e.g., "create a PR", "submit a pull request", "make the changes")
   - Update/modification requests (e.g., "update the config", "change the handler", "modify the service")

   Do NOT create PRs when the user is:
   - Only asking questions (e.g., "what causes the error?", "why is this happening?")
   - Requesting analysis only (e.g., "analyze the issue", "review the code", "investigate the problem")
   - Explicitly asking NOT to implement (e.g., "just explain", "don't change anything", "analysis only")

   If implementing code changes:
   Step 1: Create branch using the EXACT branch name: "${actualBranchName}" (mcp__github__create_branch)
   Step 2: Update files on this branch (mcp__github__create_or_update_file)
   Step 3: Create PR from this branch to target branch (mcp__github__create_pull_request)

6. Deliver Results:
   - [CRITICAL!] Start your response with EXACTLY this line as the very first line:
     🎯 **Application observability for AWS Assistant Result**
   - This marker MUST be the first line of your response (no content before it)
   - Keep responses SHORT and CONCISE
   - Use bullet points and brief sentences
   - Focus on key findings and actionable next steps
   - Avoid lengthy explanations unless specifically requested
   - Maximum 3-5 main points per response

CAPABILITIES:
What You CAN Do:
- Analyze repository structure and code patterns
- Provide detailed code reviews and feedback
- Answer questions about code and provide explanations
- Suggest implementations and improvements
- Review code for bugs, performance, and best practices

What You FOCUS On:
- Understanding the user's specific request
- Providing practical, actionable advice
- Code quality and best practices
- Technology-specific recommendations
- Clear explanations and examples

Provide practical, actionable recommendations specific to this repository's technology stack and use case.`;

  return prompt;
}

module.exports = {
  createGeneralPrompt: createAWSAPMPrompt,
  // Export utility functions for testing
  getEventTriggerTime,
  filterCommentsByTriggerTime,
  fetchGitHubConversation,
  formatConversationHistory,
  fetchPRDiffContext
};