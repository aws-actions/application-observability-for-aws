# Security

This document outlines key security considerations when using the Application observability for AWS GitHub Action.

## Access Control

- This action can only be triggered by users with **write access or above**.
- The `allowed_non_write_users` parameter can be used to grant access to users who don't have write permissions. **⚠️ WARNING: this is a significant security risk and should be used with extreme caution** as it bypasses the security mechanism that prevents outside users from triggering this action.
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

This action processes user-provided content (issues, PRs, comments) using AI. **Malicious actors may attempt to inject hidden instructions** through HTML comments, markdown hidden text, or zero-width Unicode characters to manipulate the AI's behavior. To mitigate this risk, the action includes built-in protections: comment timestamp filtering (excludes comments edited after trigger), repository scope restriction (AI analyzes target repository only), sensitive data redaction (AI instructed not to output credentials), and output sanitization before posting to GitHub.

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
