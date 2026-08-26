# Security

This document outlines key security considerations when using the Application observability for AWS GitHub Action.

## Access Control

- This action can only be triggered by users with **write access or above**.
- The `allowed_non_write_users` parameter can be used to grant access to users who don't have write permissions. **⚠️ WARNING: this is a significant security risk and should be used with extreme caution** as it bypasses the security mechanism that prevents outside users from triggering this action.
- `allowed_non_write_users` also accepts the single value `*`, which allows **any** GitHub user to trigger the action. That removes the trust boundary entirely: every protection described under [Prompt Injection Risks](#️-prompt-injection-risks) assumes a trusted user authorized the run, and with `*` nobody did. Do not use it on a public repository.
- Each invocation of the action is scoped to the repository that it is triggered in.

## GitHub Token Permissions

The action uses GitHub's `GITHUB_TOKEN` to interact with your repository (posting comments, creating branches, reading files, etc.). It operates with strict security boundaries and requires the following permissions:

- **Contents (Write)**: For reading repository files and creating branches for PRs
- **Pull Requests (Write)**: For reading PR data and posting analysis comments on pull requests
- **Issues (Write)**: For reading issue data and posting investigation results as comments
- **ID Token (Write)**: For OIDC authentication with AWS (required when using `configure-aws-credentials`)

## AWS IAM Permissions

**You need to use OpenID Connect (OIDC)** to authenticate with AWS, which provides short-lived credentials without storing long-term secrets in your repository. See the [Getting Started guide in README](README.md#-getting-started) for OIDC setup instructions.

The IAM permissions set needed for this action is provided in the [Required Permissions section of the README](https://github.com/aws-actions/application-observability-for-aws?tab=readme-ov-file#required-permissions).

- The IAM permissions list follows the **Principle of Least Privilege** to minimize the set of operations granted to the action while upholding functionality.
- **Be cautious when adding additional permissions** beyond the minimal set - each permission increases security risk.
- **Review the IAM policy regularly** to ensure no unnecessary permissions have been added.
- **Enable AWS CloudTrail** to monitor and audit all API calls made by the action.

## ⚠️ Prompt Injection Risks

This action processes user-provided content (issues, PRs, comments) using AI. **Malicious actors may attempt to inject hidden instructions** through HTML comments, markdown hidden text, or zero-width Unicode characters to manipulate the AI's behavior.

Protections fall into two groups, and the difference matters when you assess your own risk.

**Enforced in code.** These hold regardless of what the model decides to do:

- **Trust-boundary binding.** Untrusted content is pinned to the state that existed when a trusted user authorized the run. Comments are filtered by the triggering event's timestamp across `issues`, `issue_comment`, and pull request review events. The PR diff is pinned to a single commit SHA — read straight from the webhook payload for `pull_request_review_comment`, resolved once for `issue_comment` on a PR — and is omitted if the head commit is dated at or after the authorizing event. Both fail closed: with no trustworthy cutoff, the content is dropped rather than included. See [Residual risk](#residual-risk) for what this does not cover.
- **Least-privilege tooling.** File access is scoped to the repository workspace. `Bash`, `WebFetch` and `WebSearch` are denied explicitly via `disallowed_tools`, not merely left out of the allow list. Bash matters most: its arguments cannot be path-scoped, so any grant reaches every file the runner user can read.
- **Credential placement.** The generated MCP configuration holds credentials and is written to the runner temp directory, outside the workspace the agent's file tools are scoped to. It is also mode `0600`, but that is hygiene for shared runners only — the agent runs as the same OS user, so the mode grants it nothing. The path scoping and the Bash denial are what keep the file out of reach.
- **Secret redaction on the result.** Credential material is stripped before the result is posted. This is a backstop, not a boundary: it catches verbatim and base64-encoded values plus known credential shapes, but not a value the model transformed, and it only covers the comment channel — an agent holding the GitHub MCP write tools could commit instead.

**Best-effort model instructions.** These are prompt text, and prompt text is exactly what an injection attack targets. Do not rely on them as controls:

- Untrusted content is fenced in labelled sections with an instruction to treat it as data, never as instructions.
- The agent is told to analyze only the target repository, not to output credentials, and never to write to the default branch. Nothing enforces the last one: the workflow grants `contents: write` and the agent holds GitHub MCP write tools.

### Residual risk

For `issue_comment` events on a pull request the webhook payload carries no head SHA, so it is resolved after authorization. The window between a maintainer commenting and that resolution cannot be closed from inside the action. The SHA that was analyzed is recorded in the prompt so the snapshot is auditable. To eliminate the window, trigger PR reviews from `pull_request_review_comment` events instead: that payload carries the full `pull_request` object, so the head SHA is an immutable part of the authorizing event and no live lookup happens at all.

The head-commit date check that rejects a diff pushed after authorization reads the commit's own committer date. Git commit dates are supplied by the committer's machine, so a determined attacker can backdate a late push, and a contributor with a fast clock can have a legitimate commit rejected. It is a cheap tripwire that fails closed, not a boundary; the SHA pinning is what provides the guarantee.

### Mitigation Best Practices

- **Review content from external contributors** before triggering the action
- **Check for suspicious HTML comments or hidden content**
- **Use specific trigger phrases** (e.g., `@awsapm`) instead of automatic triggers
- **Monitor AI responses** for unexpected behavior
- **Never include sensitive information** in issues/PRs that trigger the action

**Note:** New prompt injection techniques may emerge. Stay vigilant and review untrusted content.


## 🔐 General Security Best Practices

### Repository Security

To prevent unauthorized changes to your workflow, we recommend the following branch protection rules at the minimum:

- **Require a pull request before merging**
- **Require a minimum number of approvals**
- **Dismiss stale approvals**
- **Require status checks to pass before merging**

Additionally, code review approvals should be limited to specific users or teams who maintain the repository.

### Workflow Security

- Pin action versions (e.g., `@v1` not `@main`) for reproducibility and security
- Review workflow changes in PRs before merging
- Monitor workflow execution logs for anomalies

### Credential Management
- Store all secrets in GitHub Secrets. **Never hardcode secrets in workflow files.**

## 🛡️ Reporting Security Issues

If you discover a security vulnerability:
1. **Do not** create a public GitHub issue
2. Contact maintainers privately (see repository for contact info)
3. Allow reasonable time for fixes before public disclosure
