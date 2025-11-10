# Application Observability for AWS Action

A GitHub Action that brings Agentic AI capabilities directly into GitHub, enabling service issue investigation with live production context, automated Application Signals enablement, and AI-powered bug fixing with live telemetry data.

This action is powered by the [AWS Application Signals MCP](https://github.com/awslabs/mcp/tree/main/src/cloudwatch-appsignals-mcp-server) and works with Amazon Q Developer CLI. When you mention `@awsapm` in GitHub issues or pull request comments, it helps you troubleshoot production issues, implement fixes, and enhance observability coverage on demand.

## ✨ Features

With a one-time setup of Application Observability for AWS Action workflow for your GitHub repository, developers can:

1. **Troubleshoot Production Issues**: Investigate and fix production problems using live telemetry and SLO data from AWS Application Signals via MCP
2. **Application Observability Enablement Assistance**: Get help enabling Application Signals with integrated Application Signals MCP and domain knowledge as context
3. **AI-Powered Analysis**: Leverage Amazon Q Developer CLI for intelligent code analysis and recommendations
4. **Automated Workflows**: Responds to `@awsapm` mentions in issues and PR comments, working around the clock

## 📋 Prerequisites

- AWS credentials with permissions for [AWS Application Signals MCP](https://github.com/awslabs/mcp/tree/main/src/cloudwatch-appsignals-mcp-server#configuration)
- GitHub token with appropriate permissions (automatically provided via `github.token`)
- Repository write access for users triggering the action

## 🚀 Quick Start

### Setup Steps (One-Time)

#### 1. Add AWS Credentials as Repository Secrets

Navigate to your repository Settings > Secrets and variables > Actions, and add:

```
AWS_ACCESS_KEY_ID         # Your AWS Access Key
AWS_SECRET_ACCESS_KEY     # Your AWS Secret Key
AWS_REGION                # Optional, defaults to us-east-1
```

These credentials will be used to set up Amazon Q Developer CLI and the APM MCP server.

#### 2. Add Workflow Configuration

Create `.github/workflows/awsapm.yml` in your repository:

```yaml
name: Application Observability

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]

jobs:
  apm-analysis:
    if: contains(github.event.comment.body, '@awsapm') || contains(github.event.issue.body, '@awsapm')
    runs-on: ubuntu-latest
    permissions:
      contents: write        # To create branches for PRs
      pull-requests: write   # To post comments on PRs
      issues: write          # To post comments on issues
      checks: write          # To create check runs with detailed results
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run AWS APM Agent
        uses: aws-actions/apm-action@v1
        with:
          aws_access_key_id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws_secret_access_key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws_region: ${{ secrets.AWS_REGION }}
```

#### 3. Start Using the Action

Simply mention `@awsapm` in any issue or pull request comment:

```
Hi @awsapm, can you check why my service is having SLO breaching?

Hi @awsapm, can you enable Application Signals for lambda-audit-service? Post a PR for the required changes.

Hi @awsapm, I want to know how many GenAI tokens have been used by my services?
```

## ⚙️ Configuration

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `bot_name` | The bot name to respond to in comments | No | `@awsapm` |
| `target_branch` | The branch to merge PRs into | No | Repository default |
| `branch_prefix` | Prefix for created branches | No | `awsapm/` |
| `github_token` | GitHub token for API calls | No | `${{ github.token }}` |
| `aws_access_key_id` | AWS Access Key for Q Developer CLI & MCP | Yes | - |
| `aws_secret_access_key` | AWS Secret Key for Q Developer CLI & MCP | Yes | - |
| `aws_session_token` | AWS session token for temporary credentials | No | - |
| `aws_region` | AWS Region | No | `us-east-1` |
| `custom_prompt` | Custom instructions for the AI agent | No | - |

### Required Permissions

The action requires:

1. **AWS Permissions**: Same as [AWS Application Signals MCP](https://github.com/awslabs/mcp/tree/main/src/cloudwatch-appsignals-mcp-server#configuration)
2. **GitHub Permissions**:
   - `contents: write` - To create branches for PRs
   - `pull-requests: write` - To post comments on PRs
   - `checks: write` - To create check runs with detailed results

### Outputs

| Output | Description |
|--------|-------------|
| `execution_file` | Path to the analysis results file |
| `branch_name` | Branch created for this execution |
| `github_token` | GitHub token used by the action |

## 📖 Documentation

Comprehensive documentation coming soon! This includes:

- Detailed configuration guide
- Authentication setup (GitHub tokens and Apps)
- MCP integration guide
- Troubleshooting common issues
- Architecture overview

## 🏗️ Architecture

This GitHub Action enables a versatile APM AI Agent within your repository that:

1. **Initialization** - Detects `@awsapm` mentions and validates permissions
2. **Context Gathering** - Collects GitHub context (issues, PRs, comments, diffs) and AWS Application Signals data
3. **AI Agent Execution** - Runs Amazon Q Developer CLI (or Claude Code/Codex) integrated with AWS Application Signals MCP
4. **Action & Response** - Posts analysis, creates branches, submits PRs, or provides troubleshooting guidance

### Integration with AWS Application Signals MCP

The action leverages the [AWS Application Signals MCP server](https://github.com/awslabs/mcp/tree/main/src/cloudwatch-appsignals-mcp-server) to provide:
- Live telemetry and SLO data from production services
- Service topology and dependency mapping
- Metrics, traces, and logs correlation
- GenAI token usage tracking and cost analysis

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT-0 License - see the [LICENSE](LICENSE) file for details.

## 🔒 Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for information on reporting security issues.

## 📞 Support

For issues and questions:
- Create a [GitHub issue](https://github.com/aws-actions/application-observability-for-aws/issues)
- Check the troubleshooting documentation (coming soon)
- Review the action logs in your workflow runs

---
