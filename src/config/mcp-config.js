/**
 * Centralized MCP configuration management for Amazon Q CLI
 * Provides a single source of truth for MCP configurations
 */
class MCPConfigManager {
  constructor() {
  }

  /**
   * Get AWS CloudWatch Application Signals MCP server configuration
   */
  getApplicationSignalsServerConfig() {
    return {
      command: "uvx",
      args: ["awslabs.cloudwatch-appsignals-mcp-server@latest"],
      env: {
        MCP_RUN_FROM: "awsapm-gh"
      },
      transportType: "stdio"
    };
  }

  /**
   * Get GitHub MCP server configuration (Docker-based)
   */
  getGitHubServerConfig(token) {
    return {
      command: "docker",
      args: [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "-e",
        "GITHUB_HOST",
        "ghcr.io/github/github-mcp-server:sha-efef8ae"
      ],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: token,
        GITHUB_HOST: process.env.GITHUB_SERVER_URL || "https://github.com"
      },
      transportType: "stdio"
    };
  }

  /**
   * Get list of AWS CloudWatch Application Signals MCP tools for auto-approval
   */
  getApplicationSignalsToolsList() {
    return [
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__list_monitored_services",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__get_service_detail",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__list_service_operations",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__list_slis",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__list_slos",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__get_slo",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__search_transaction_spans",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__query_sampled_traces",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__query_service_metrics",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__audit_services",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__audit_slos",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__audit_service_operations",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__get_enablement_guide",
      "mcp__awslabs_cloudwatch-appsignals-mcp-server__analyze_canary_failures"
    ];
  }

  /**
   * Get list of GitHub MCP tools for auto-approval
   */
  getGitHubToolsList() {
    return [
      "mcp__github__create_pull_request",
      "mcp__github__create_or_update_file",
      "mcp__github__push_files",
      "mcp__github__get_file",
      "mcp__github__create_branch",
      "mcp__github__list_files",
      "mcp__github__get_file_contents"
    ];
  }

  /**
   * Build complete MCP configuration for Amazon Q CLI
   * @returns {object} MCP configuration object
   */
  buildMCPConfig() {
    const config = { mcpServers: {} };

    // Add AWS CloudWatch Application Signals MCP server if credentials available
    if (this.hasAWSCredentials()) {
      const applicationSignalsConfig = this.getApplicationSignalsServerConfig();

      // Amazon Q CLI format
      config.mcpServers["awslabs.cloudwatch-appsignals-mcp"] = {
        ...applicationSignalsConfig,
        autoApprove: this.getApplicationSignalsToolsList(),
        disabled: false
      };
    }

    // Add GitHub MCP server if token available
    if (this.hasGitHubToken()) {
      const githubConfig = this.getGitHubServerConfig(process.env.GITHUB_TOKEN);

      config.mcpServers.github = {
        ...githubConfig,
        autoApprove: this.getGitHubToolsList(),
        disabled: false
      };
    }

    return config;
  }

  /**
   * Check if AWS credentials are available
   */
  hasAWSCredentials() {
    return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  }

  /**
   * Check if GitHub token is available
   */
  hasGitHubToken() {
    return !!process.env.GITHUB_TOKEN;
  }

  /**
   * Get AWS environment variables for MCP server
   */
  // TODO: support IAM role consumed by aws-actions/configure-aws-credentials
  getAWSEnvVars() {
    return {
      aws_access_key_id: process.env.AWS_ACCESS_KEY_ID,
      aws_secret_access_key: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_REGION: process.env.AWS_REGION || 'us-east-1'
    };
  }
}

module.exports = { MCPConfigManager };
