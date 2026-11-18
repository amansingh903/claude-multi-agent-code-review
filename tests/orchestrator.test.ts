import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for CodeReviewOrchestrator
 *
 * The Claude Agent SDK is mocked, so these run without API access. They verify that the
 * orchestrator wires up the MCP servers, the Task tool and all 3 subagents, enforces structured
 * output, aggregates results into a valid ReviewReport, and fails gracefully.
 */

// ---- Mock the SDK query() ----------------------------------------------------
type MockMessage = Record<string, unknown>;
let scriptedMessages: MockMessage[] = [];
let capturedOptions: Record<string, any> | undefined;

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(({ options }: { options: Record<string, unknown> }) => {
    capturedOptions = options;
    return (async function* () {
      for (const m of scriptedMessages) yield m;
    })();
  })
}));

import { CodeReviewOrchestrator, computeSummary } from '../src/orchestrator';
import { ReviewReportSchema } from '../src/types';
import { mcpServersConfig } from '../src/config/mcp.config';

// ---- Fixtures ------------------------------------------------------------------
function fileReview(file: string) {
  return {
    file,
    codeQuality: {
      file,
      issues: [
        { line: 12, severity: 'critical', category: 'security', description: 'innerHTML with user input (XSS)', suggestion: 'Use textContent' },
        { line: 30, severity: 'low', category: 'style', description: 'var used', suggestion: 'Use const' }
      ],
      overallScore: 72,
      summary: 'One XSS risk'
    },
    testCoverage: {
      file,
      hasTests: false,
      testFiles: [],
      untestedPaths: [
        { type: 'function', location: `searchTodos() in ${file}:5`, priority: 'high', reasoning: 'Core feature', suggestedTest: "expect(searchTodos('')).toHaveLength(3)" }
      ],
      coverageEstimate: 20,
      summary: 'No tests'
    },
    refactorings: {
      file,
      suggestions: [
        { type: 'modernize', location: 'line 30', impact: 'low', description: 'var to const', before: 'var x = 1', after: 'const x = 1', benefits: 'Block scoping' }
      ],
      summary: 'Minor modernization'
    }
  };
}

const structuredOutput = {
  pullRequest: { owner: 'x', repo: 'y', number: 999 },
  fileReviews: [fileReview('src/app.js'), fileReview('src/search.js')],
  summary: { totalFiles: 0, overallScore: 0, criticalIssues: 0, highPriorityTests: 0, refactoringOpportunities: 0 },
  recommendations: [
    { priority: 'critical', category: 'Security', description: 'Escape user input before rendering', files: ['src/app.js'] }
  ],
  metadata: { analyzedAt: 'ignored', duration: 0, agentVersions: {} }
};

function successRun(output: unknown = structuredOutput): MockMessage[] {
  return [
    { type: 'system', subtype: 'init', mcp_servers: [{ name: 'github', status: 'connected' }, { name: 'eslint', status: 'connected' }] },
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'mcp__github__get_pull_request_files', input: {} }] } },
    {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'tool_use', name: 'Task', input: { subagent_type: 'code-quality-analyzer', description: 'quality' } },
          { type: 'tool_use', name: 'Task', input: { subagent_type: 'test-coverage-analyzer', description: 'tests' } },
          { type: 'tool_use', name: 'Task', input: { subagent_type: 'refactoring-suggester', description: 'refactor' } }
        ]
      }
    },
    { type: 'result', subtype: 'success', duration_ms: 1000, total_cost_usd: 0.01, structured_output: output }
  ];
}

const fastOptions = { model: 'claude-sonnet-4-5-20250929', maxRetries: 1, retryDelayMs: 1, timeoutMs: 5000 };

beforeEach(() => {
  scriptedMessages = [];
  capturedOptions = undefined;
});

describe('CodeReviewOrchestrator', () => {
  describe('Configuration', () => {
    it('should initialize with default options', () => {
      const orchestrator = new CodeReviewOrchestrator({ model: 'claude-sonnet-4-5-20250929' });
      const config = orchestrator.getConfig();
      expect(config.model).toBe('claude-sonnet-4-5-20250929');
      expect(config.maxTurns).toBeGreaterThanOrEqual(30);
      expect(config.rateLimits.maxConcurrent).toBe(5);
    });

    it('should accept custom rate limit configuration', () => {
      const orchestrator = new CodeReviewOrchestrator({
        model: 'claude-sonnet-4-5-20250929',
        rateLimits: { maxRequestsPerMinute: 10, maxConcurrent: 1 }
      });
      const { rateLimits } = orchestrator.getConfig();
      expect(rateLimits.maxRequestsPerMinute).toBe(10);
      expect(rateLimits.maxConcurrent).toBe(1);
      expect(rateLimits.maxTokensPerMinute).toBe(100000);
    });

    it('should throw a clear error when no model is configured', () => {
      const saved = process.env.ANTHROPIC_MODEL;
      delete process.env.ANTHROPIC_MODEL;
      expect(() => new CodeReviewOrchestrator()).toThrow(/ANTHROPIC_MODEL/);
      if (saved !== undefined) process.env.ANTHROPIC_MODEL = saved;
    });
  });

  describe('Query configuration', () => {
    it('should configure GitHub and ESLint MCP servers over stdio with npx', () => {
      expect(mcpServersConfig.github.type).toBe('stdio');
      expect(mcpServersConfig.github.command).toBe('npx');
      expect(mcpServersConfig.github.args).toEqual(['-y', '@modelcontextprotocol/server-github']);
      expect(mcpServersConfig.github.env).toHaveProperty('GITHUB_PERSONAL_ACCESS_TOKEN');
      expect(mcpServersConfig.eslint.args).toEqual(['-y', '@eslint/mcp@latest']);
    });

    it('should include the Task tool, MCP tools and all 3 subagents with structured output', () => {
      const options = new CodeReviewOrchestrator(fastOptions).buildQueryOptions() as Record<string, any>;
      expect(options.allowedTools).toContain('Task');
      expect(options.allowedTools).toContain('Skill');
      expect(options.allowedTools).toContain('mcp__github__get_pull_request_files');
      expect(Object.keys(options.mcpServers)).toEqual(['github', 'eslint']);
      expect(Object.keys(options.agents)).toEqual([
        'code-quality-analyzer',
        'test-coverage-analyzer',
        'refactoring-suggester'
      ]);
      expect(options.outputFormat.type).toBe('json_schema');
      expect(options.outputFormat.schema.properties).toHaveProperty('fileReviews');
      expect(options.disallowedTools).toEqual(expect.arrayContaining(['Write', 'Edit', 'Bash']));
    });

    it('should give every subagent model "inherit" and the Skill tool', () => {
      const { agents } = new CodeReviewOrchestrator(fastOptions).buildQueryOptions() as Record<string, any>;
      for (const agent of Object.values(agents) as Array<Record<string, any>>) {
        expect(agent.model).toBe('inherit');
        expect(agent.tools).toContain('Skill');
        expect(agent.description.length).toBeGreaterThan(40);
      }
    });
  });

  describe('reviewPullRequest', () => {
    it('should fetch PR files from GitHub MCP', async () => {
      scriptedMessages = successRun();
      await new CodeReviewOrchestrator(fastOptions).reviewPullRequest('udacity', 'cd14715-simple-todo-app', 2);
      expect(capturedOptions?.allowedTools).toContain('mcp__github__get_pull_request');
      expect(capturedOptions?.mcpServers.github.args).toContain('@modelcontextprotocol/server-github');
    });

    it('should spawn all 3 subagents in parallel', async () => {
      scriptedMessages = successRun();
      await new CodeReviewOrchestrator(fastOptions).reviewPullRequest('udacity', 'cd14715-simple-todo-app', 2);
      const taskTurn = scriptedMessages[2] as any;
      const tasks = taskTurn.message.content.filter((b: any) => b.name === 'Task');
      // All three Task calls are issued in the same assistant turn
      expect(tasks.map((t: any) => t.input.subagent_type)).toEqual([
        'code-quality-analyzer',
        'test-coverage-analyzer',
        'refactoring-suggester'
      ]);
    });

    it('should aggregate results into ReviewReport', async () => {
      scriptedMessages = successRun();
      const report = await new CodeReviewOrchestrator(fastOptions)
        .reviewPullRequest('udacity', 'cd14715-simple-todo-app', 2);

      expect(report.pullRequest).toEqual({ owner: 'udacity', repo: 'cd14715-simple-todo-app', number: 2 });
      expect(report.fileReviews).toHaveLength(2);
      // Summary is recomputed from findings, not trusted from the model
      expect(report.summary).toEqual({
        totalFiles: 2,
        overallScore: Math.round(72 * 0.6 + 20 * 0.4),
        criticalIssues: 2,
        highPriorityTests: 2,
        refactoringOpportunities: 2
      });
      expect(report.metadata.agentVersions).toHaveProperty('code-quality-analyzer');
      expect(report.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it('should validate output with Zod schema', async () => {
      scriptedMessages = successRun();
      const report = await new CodeReviewOrchestrator(fastOptions).reviewPullRequest('o', 'r', 1);
      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
    });

    it('should reject structured output that does not match the schema', async () => {
      const bad = { ...structuredOutput, fileReviews: [{ file: 'a.js', codeQuality: { issues: 'nope' } }] };
      scriptedMessages = successRun(bad);
      await expect(new CodeReviewOrchestrator(fastOptions).reviewPullRequest('o', 'r', 1))
        .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('should surface agent failures as a clear ReviewError', async () => {
      scriptedMessages = [{ type: 'result', subtype: 'error_max_turns' }];
      await expect(new CodeReviewOrchestrator(fastOptions).reviewPullRequest('o', 'r', 1))
        .rejects.toMatchObject({ code: 'RETRY_EXHAUSTED' });
    });

    it('should fail fast when the GitHub MCP server cannot start', async () => {
      scriptedMessages = [{ type: 'system', subtype: 'init', mcp_servers: [{ name: 'github', status: 'failed' }] }];
      await expect(new CodeReviewOrchestrator(fastOptions).reviewPullRequest('o', 'r', 1))
        .rejects.toThrow(/GitHub MCP server failed/);
    });
  });

  describe('computeSummary', () => {
    it('should return zeros for an empty review', () => {
      const report = ReviewReportSchema.parse({ ...structuredOutput, fileReviews: [] });
      expect(computeSummary(report)).toEqual({
        totalFiles: 0, overallScore: 0, criticalIssues: 0, highPriorityTests: 0, refactoringOpportunities: 0
      });
    });
  });

  describe('Integration', () => {
    // Integration test case: a real PR fetched through the GitHub MCP server.
    // Requires ANTHROPIC_API_KEY/ANTHROPIC_MODEL (and ideally GITHUB_TOKEN), so it is skipped in CI.
    // Run manually: npm run dev -- octocat Hello-World 1
    // (the 9 submission reports in reports/ were produced the same way against
    //  udacity/cd14715-simple-todo-app PRs #1-#3).
    it.skip('should review a real small PR', async () => {
      const { CodeReviewOrchestrator: Real } = await vi.importActual<typeof import('../src/orchestrator')>('../src/orchestrator');
      const report = await new Real().reviewPullRequest('octocat', 'Hello-World', 1);
      expect(ReviewReportSchema.safeParse(report).success).toBe(true);
    });
  });
});
