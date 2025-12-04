const { MCPConfigManager } = require('../src/config/mcp-config');

describe('MCPConfigManager', () => {
  let manager;
  let originalEnv;

  beforeEach(() => {
    manager = new MCPConfigManager();
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    test('creates instance', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('buildMCPConfig', () => {
    test('includes ApplicationSignals server when AWS credentials present', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';

      const config = manager.buildMCPConfig();

      expect(config.mcpServers['applicationsignals']).toBeDefined();
      expect(config.mcpServers['applicationsignals'].command).toBe('uvx');
    });

    test('includes CloudWatch server when enabled and credentials present', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';
      process.env.ENABLE_CLOUDWATCH_MCP = 'true';

      const config = manager.buildMCPConfig();

      expect(config.mcpServers['awslabs.cloudwatch-mcp-server']).toBeDefined();
      expect(config.mcpServers['awslabs.cloudwatch-mcp-server'].command).toBe('uvx');
      expect(config.mcpServers['awslabs.cloudwatch-mcp-server'].args).toContain('awslabs.cloudwatch-mcp-server@latest');
    });

    test('excludes CloudWatch server when ENABLE_CLOUDWATCH_MCP is false', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';
      process.env.ENABLE_CLOUDWATCH_MCP = 'false';

      const config = manager.buildMCPConfig();

      expect(config.mcpServers['awslabs.cloudwatch-mcp-server']).toBeUndefined();
    });

    test('excludes CloudWatch server when ENABLE_CLOUDWATCH_MCP is missing', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';
      delete process.env.ENABLE_CLOUDWATCH_MCP;

      const config = manager.buildMCPConfig();

      expect(config.mcpServers['awslabs.cloudwatch-mcp-server']).toBeUndefined();
    });

    test('excludes CloudWatch server when credentials missing even if enabled', () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      process.env.ENABLE_CLOUDWATCH_MCP = 'true';

      const config = manager.buildMCPConfig();

      expect(config.mcpServers['awslabs.cloudwatch-mcp-server']).toBeUndefined();
    });

    test('includes GitHub server when token is present', () => {
      process.env.GITHUB_TOKEN = 'ghp_test123';

      const config = manager.buildMCPConfig();

      expect(config.mcpServers.github).toBeDefined();
      expect(config.mcpServers.github.command).toBe('docker');
      expect(config.mcpServers.github.args).toContain('ghcr.io/github/github-mcp-server:sha-efef8ae');
    });

    test('returns empty mcpServers when no credentials', () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.GITHUB_TOKEN;

      const config = manager.buildMCPConfig();

      expect(config.mcpServers).toEqual({});
    });

    test('GitHub server has autoApprove list', () => {
      process.env.GITHUB_TOKEN = 'ghp_test123';

      const config = manager.buildMCPConfig();

      expect(config.mcpServers.github.autoApprove).toBeDefined();
      expect(Array.isArray(config.mcpServers.github.autoApprove)).toBe(true);
      expect(config.mcpServers.github.autoApprove.length).toBeGreaterThan(0);
    });

    test('passes GitHub token to GitHub server env', () => {
      process.env.GITHUB_TOKEN = 'ghp_test123';

      const config = manager.buildMCPConfig();

      expect(config.mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp_test123');
    });

    test('GitHub server includes GITHUB_HOST env var', () => {
      process.env.GITHUB_TOKEN = 'ghp_test123';
      process.env.GITHUB_SERVER_URL = 'https://github.enterprise.com';

      const config = manager.buildMCPConfig();

      const githubEnv = config.mcpServers.github.env;
      expect(githubEnv.GITHUB_HOST).toBe('https://github.enterprise.com');
    });
  });

  describe('hasAWSCredentials', () => {
    test('returns true when credentials present', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';

      expect(manager.hasAWSCredentials()).toBe(true);
    });

    test('returns false when credentials missing', () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;

      expect(manager.hasAWSCredentials()).toBe(false);
    });

    test('returns false when only access key present', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      delete process.env.AWS_SECRET_ACCESS_KEY;

      expect(manager.hasAWSCredentials()).toBe(false);
    });
  });

  describe('hasCloudWatchAccess', () => {
    test('returns true when ENABLE_CLOUDWATCH_MCP is true and credentials present', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';
      process.env.ENABLE_CLOUDWATCH_MCP = 'true';

      expect(manager.hasCloudWatchAccess()).toBe(true);
    });

    test('returns false when ENABLE_CLOUDWATCH_MCP is false', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';
      process.env.ENABLE_CLOUDWATCH_MCP = 'false';

      expect(manager.hasCloudWatchAccess()).toBe(false);
    });

    test('returns false when ENABLE_CLOUDWATCH_MCP is missing', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';
      delete process.env.ENABLE_CLOUDWATCH_MCP;

      expect(manager.hasCloudWatchAccess()).toBe(false);
    });

    test('returns false when credentials missing even if enabled', () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      process.env.ENABLE_CLOUDWATCH_MCP = 'true';

      expect(manager.hasCloudWatchAccess()).toBe(false);
    });
  });

  describe('hasGitHubToken', () => {
    test('returns true when token present', () => {
      process.env.GITHUB_TOKEN = 'ghp_test123';

      expect(manager.hasGitHubToken()).toBe(true);
    });

    test('returns false when token missing', () => {
      delete process.env.GITHUB_TOKEN;

      expect(manager.hasGitHubToken()).toBe(false);
    });
  });

  describe('server configuration getters', () => {
    test('getApplicationSignalsServerConfig returns valid config', () => {
      const config = manager.getApplicationSignalsServerConfig();

      expect(config.command).toBe('uvx');
      expect(config.args).toBeDefined();
      expect(Array.isArray(config.args)).toBe(true);
      expect(config.transportType).toBe('stdio');
      expect(config.env.MCP_RUN_FROM).toBe('awsapm-gh');
    });

    test('getCloudWatchServerConfig returns valid config', () => {
      const config = manager.getCloudWatchServerConfig();

      expect(config.command).toBe('uvx');
      expect(config.args).toEqual(['awslabs.cloudwatch-mcp-server@latest']);
      expect(config.transportType).toBe('stdio');
      expect(config.env.MCP_RUN_FROM).toBe('awsapm-gh');
    });

    test('getGitHubServerConfig returns Docker config', () => {
      const config = manager.getGitHubServerConfig('test-token');

      expect(config.command).toBe('docker');
      expect(config.args).toContain('run');
      expect(config.args).toContain('-i');
      expect(config.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('test-token');
    });
  });

  describe('tool lists', () => {
    test('getApplicationSignalsToolsList returns array', () => {
      const tools = manager.getApplicationSignalsToolsList();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0]).toContain('mcp__applicationsignals__');
    });

    test('getCloudWatchToolsList returns array with 11 tools', () => {
      const tools = manager.getCloudWatchToolsList();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBe(11);
      expect(tools).toContain('mcp__awslabs_cloudwatch-mcp-server__get_metric_metadata');
      expect(tools).toContain('mcp__awslabs_cloudwatch-mcp-server__get_metric_data');
      expect(tools).toContain('mcp__awslabs_cloudwatch-mcp-server__analyze_metric');
      expect(tools).toContain('mcp__awslabs_cloudwatch-mcp-server__execute_log_insights_query');
    });

    test('getGitHubToolsList returns array', () => {
      const tools = manager.getGitHubToolsList();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools).toContain('mcp__github__create_pull_request');
    });
  });

  describe('getAWSEnvVars', () => {
    test('returns AWS environment variables', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';
      process.env.AWS_REGION = 'us-west-2';

      const envVars = manager.getAWSEnvVars();

      expect(envVars.aws_access_key_id).toBe('AKIATEST123');
      expect(envVars.aws_secret_access_key).toBe('secretkey');
      expect(envVars.AWS_REGION).toBe('us-west-2');
    });

    test('uses default region when not specified', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';
      delete process.env.AWS_REGION;

      const envVars = manager.getAWSEnvVars();

      expect(envVars.AWS_REGION).toBe('us-east-1');
    });
  });

  describe('getAllowedToolsForClaude', () => {
    test('returns base file operation tools when no credentials', () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.GITHUB_TOKEN;
      process.env.GITHUB_WORKSPACE = '/workspace/repo';

      const allowedTools = manager.getAllowedToolsForClaude();

      expect(allowedTools).toContain('Read(/workspace/repo/**)');
      expect(allowedTools).toContain('Edit(/workspace/repo/**)');
      expect(allowedTools).toContain('Glob(/workspace/repo/**)');
      expect(allowedTools).toContain('Grep(/workspace/repo/**)');
      expect(allowedTools).toContain('Bash(ls:/workspace/repo/**)');
    });

    test('includes Application Signals tools when AWS credentials present', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';
      delete process.env.GITHUB_TOKEN;
      process.env.GITHUB_WORKSPACE = '/workspace/repo';

      const allowedTools = manager.getAllowedToolsForClaude();

      expect(allowedTools).toContain('mcp__applicationsignals__list_monitored_services');
      expect(allowedTools).toContain('Read(/workspace/repo/**)');
    });

    test('includes CloudWatch tools when enabled and AWS credentials present', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';
      process.env.ENABLE_CLOUDWATCH_MCP = 'true';
      delete process.env.GITHUB_TOKEN;
      process.env.GITHUB_WORKSPACE = '/workspace/repo';

      const allowedTools = manager.getAllowedToolsForClaude();

      expect(allowedTools).toContain('mcp__awslabs_cloudwatch-mcp-server__get_metric_data');
      expect(allowedTools).toContain('mcp__applicationsignals__list_monitored_services');
    });

    test('includes GitHub tools when token present', () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      process.env.GITHUB_TOKEN = 'ghp_test123';
      process.env.GITHUB_WORKSPACE = '/workspace/repo';

      const allowedTools = manager.getAllowedToolsForClaude();

      expect(allowedTools).toContain('mcp__github__create_pull_request');
      expect(allowedTools).toContain('Read(/workspace/repo/**)');
    });

    test('includes all tools when all credentials present', () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIATEST123';
      process.env.AWS_SECRET_ACCESS_KEY = 'secretkey';
      process.env.ENABLE_CLOUDWATCH_MCP = 'true';
      process.env.GITHUB_TOKEN = 'ghp_test123';
      process.env.GITHUB_WORKSPACE = '/workspace/repo';

      const allowedTools = manager.getAllowedToolsForClaude();

      // Should include base tools
      expect(allowedTools).toContain('Read(/workspace/repo/**)');
      // Should include Application Signals tools
      expect(allowedTools).toContain('mcp__applicationsignals__list_monitored_services');
      // Should include CloudWatch tools
      expect(allowedTools).toContain('mcp__awslabs_cloudwatch-mcp-server__get_metric_data');
      // Should include GitHub tools
      expect(allowedTools).toContain('mcp__github__create_pull_request');
    });

    test('uses process.cwd() when GITHUB_WORKSPACE not set', () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_WORKSPACE;

      const allowedTools = manager.getAllowedToolsForClaude();
      const cwd = process.cwd();

      expect(allowedTools).toContain(`Read(${cwd}/**)`);
      expect(allowedTools).toContain(`Bash(ls:${cwd}/**)`);
    });

    test('returns comma-separated string', () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.GITHUB_TOKEN;
      process.env.GITHUB_WORKSPACE = '/workspace/repo';

      const allowedTools = manager.getAllowedToolsForClaude();

      expect(typeof allowedTools).toBe('string');
      expect(allowedTools.includes(',')).toBe(true);

      const toolsArray = allowedTools.split(',');
      expect(toolsArray.length).toBeGreaterThan(0);
    });
  });
});
