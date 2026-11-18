/**
 * Model Context Protocol (MCP) server configurations
 *
 * Required MCP Servers:
 * 1. GitHub - For PR/repo operations
 * 2. ESLint - For code linting and style analysis
 *
 * Documentation:
 * - MCP Protocol: https://modelcontextprotocol.io
 * - GitHub MCP: https://github.com/github/github-mcp-server
 * - ESLint MCP: https://eslint.org/docs/latest/use/mcp
 *
 * Secrets are never hardcoded: the GitHub token is read from process.env
 * at runtime and mapped to the variable name the GitHub server expects.
 */
import type { McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';

export const mcpServersConfig: Record<'github' | 'eslint', McpStdioServerConfig> = {
  /**
   * GitHub MCP Server
   * Provides tools for GitHub API operations (PR metadata, changed files, file contents).
   * The server expects GITHUB_PERSONAL_ACCESS_TOKEN, so we map our GITHUB_TOKEN to it.
   */
  github: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      ...stringEnv(),
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || ''
    }
  },

  /**
   * ESLint MCP Server
   * Provides tools for linting and code quality analysis. No authentication needed.
   */
  eslint: {
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@eslint/mcp@latest'],
    env: {}
  }
};

/**
 * GitHub MCP tools the review needs (read-only).
 * Tool names follow the SDK convention: mcp__<server>__<tool>.
 */
export const githubTools = [
  'mcp__github__get_pull_request',
  'mcp__github__get_pull_request_files',
  'mcp__github__get_file_contents',
  'mcp__github__get_pull_request_comments',
  'mcp__github__get_pull_request_reviews',
  'mcp__github__get_pull_request_status'
] as const;

/** ESLint MCP tools (current @eslint/mcp exposes `lint-files`; older builds used `lint`). */
export const eslintTools = [
  'mcp__eslint__lint-files',
  'mcp__eslint__lint'
] as const;

/** All MCP tools the orchestrator is allowed to call. */
export const mcpAllowedTools: string[] = [...githubTools, ...eslintTools];

/**
 * Pass the parent PATH etc. through to the MCP child process so `npx` resolves,
 * keeping only defined string values (McpStdioServerConfig requires Record<string, string>).
 */
function stringEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'NODE_OPTIONS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']) {
    const value = process.env[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}
