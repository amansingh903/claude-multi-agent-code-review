import { query } from '@anthropic-ai/claude-agent-sdk';
import type { McpStdioServerConfig, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ReviewReportSchema, ReviewReportJSONSchema } from './types/report-types';
import type { ReviewReport } from './types/report-types';
import { mcpServersConfig, mcpAllowedTools } from './config/mcp.config.js';
import { reviewAgents, AGENT_NAMES } from './agents/index.js';
import { buildOrchestratorPrompt } from './prompts/index.js';
import { RateLimiter } from './utils/rate-limiter.js';
import type { RateLimiterConfig } from './utils/rate-limiter.js';
import { ReviewError, ErrorCodes, withRetry, withTimeout, formatError } from './utils/error-handler.js';
import { logger } from './utils/logger.js';

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  /** Model for the orchestrator; subagents inherit it. Defaults to ANTHROPIC_MODEL. */
  model?: string;
  /** Directory containing .claude/skills. Defaults to PROJECT_ROOT or cwd. */
  projectRoot?: string;
  /** Max agentic turns for the whole multi-agent run */
  maxTurns?: number;
  /** Timeout for one review attempt (ms) */
  timeoutMs?: number;
  /** Attempts for a failed review (exponential backoff between them) */
  maxRetries?: number;
  /** Base delay for retry backoff (ms) */
  retryDelayMs?: number;
  /** Rate limiter overrides */
  rateLimits?: Partial<RateLimiterConfig>;
  /** Estimated tokens per review, used by the rate limiter */
  estimatedTokens?: number;
}

/** Version tag recorded in report metadata */
const AGENT_VERSION = '1.0.0';

/** Tools that would let an automated reviewer change the world; never allowed. */
const DISALLOWED_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch'];

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  private readonly model: string;
  private readonly projectRoot: string;
  private readonly maxTurns: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly estimatedTokens: number;
  private readonly rateLimiter: RateLimiter;

  constructor(options: OrchestratorOptions = {}) {
    const model = options.model ?? process.env.ANTHROPIC_MODEL;
    if (!model) {
      throw new ReviewError(
        'ANTHROPIC_MODEL is not set. Add e.g. ANTHROPIC_MODEL=claude-sonnet-4-5-20250929 to .env',
        ErrorCodes.INVALID_CONFIG
      );
    }
    this.model = model;
    this.projectRoot = options.projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd();
    this.maxTurns = options.maxTurns ?? 60;
    this.timeoutMs = options.timeoutMs ?? 20 * 60 * 1000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 5000;
    this.estimatedTokens = options.estimatedTokens ?? 50_000;
    this.rateLimiter = new RateLimiter(options.rateLimits);
  }

  /** Read-only view of the effective configuration (useful for tests and logging) */
  getConfig() {
    return {
      model: this.model,
      projectRoot: this.projectRoot,
      maxTurns: this.maxTurns,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      rateLimits: this.rateLimiter.getConfig()
    };
  }

  /**
   * Build the SDK query options: MCP servers, Task tool, registered subagents, structured output.
   */
  buildQueryOptions(): Options {
    // Strip the $schema marker; the SDK expects the bare JSON schema object
    const { $schema: _ignored, ...schema } = ReviewReportJSONSchema as Record<string, unknown>;

    return {
      model: this.model,
      cwd: this.projectRoot,
      // Load .claude/skills from the project so subagents can invoke Skills
      settingSources: ['project'],
      mcpServers: mcpServersConfig as Record<string, McpStdioServerConfig>,
      agents: reviewAgents,
      // Task spawns subagents; Skill loads skills; the rest are read-only + MCP tools
      allowedTools: ['Task', 'Skill', 'Read', 'Grep', 'Glob', ...mcpAllowedTools],
      disallowedTools: DISALLOWED_TOOLS,
      // Headless CI/CD run: 'dontAsk' never prompts and denies any tool that is not
      // pre-approved in allowedTools, so the permission model stays enforced.
      permissionMode: 'dontAsk',
      maxTurns: this.maxTurns,
      outputFormat: {
        type: 'json_schema',
        schema
      },
      stderr: (data: string) => logger.debug(`[sdk] ${data.trim()}`)
    };
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startedAt = Date.now();
    logger.info(`Starting review of ${owner}/${repo}#${prNumber} with model ${this.model}`);

    await this.rateLimiter.acquire(this.estimatedTokens);
    try {
      const raw = await withRetry(
        () =>
          withTimeout(
            () => this.runReview(owner, repo, prNumber),
            this.timeoutMs,
            `Review of ${owner}/${repo}#${prNumber} timed out after ${this.timeoutMs / 1000}s`
          ),
        this.maxRetries,
        this.retryDelayMs
      );

      return this.finalizeReport(raw, owner, repo, prNumber, Date.now() - startedAt);
    } finally {
      this.rateLimiter.release();
    }
  }

  /**
   * One attempt: stream the multi-agent query and return its structured output.
   */
  private async runReview(owner: string, repo: string, prNumber: number): Promise<unknown> {
    const invokedAgents = new Set<string>();
    const prompt = buildOrchestratorPrompt(owner, repo, prNumber);

    for await (const message of query({ prompt: singleMessage(prompt), options: this.buildQueryOptions() })) {
      this.logMessage(message, invokedAgents);

      if (message.type === 'result') {
        if (message.subtype === 'success') {
          const missing = AGENT_NAMES.filter(name => !invokedAgents.has(name));
          if (missing.length > 0) {
            logger.warn(`Subagents not invoked: ${missing.join(', ')}`);
          }
          if (message.structured_output === undefined || message.structured_output === null) {
            throw new ReviewError(
              'The orchestrator finished without structured output',
              ErrorCodes.STRUCTURED_OUTPUT_FAILED
            );
          }
          logger.info(
            `Agents finished in ${(message.duration_ms / 1000).toFixed(1)}s ` +
            `(cost ~$${message.total_cost_usd.toFixed(4)})`
          );
          return message.structured_output;
        }

        throw new ReviewError(
          `Multi-agent review failed: ${message.subtype}`,
          message.subtype === 'error_max_structured_output_retries'
            ? ErrorCodes.STRUCTURED_OUTPUT_FAILED
            : ErrorCodes.AGENT_FAILED,
          { subtype: message.subtype }
        );
      }
    }

    throw new ReviewError('Agent stream ended without a result message', ErrorCodes.AGENT_FAILED);
  }

  /**
   * Validate with Zod and recompute deterministic fields (PR identity, summary counts, metadata)
   * so scores always reflect the aggregated findings.
   */
  finalizeReport(
    raw: unknown,
    owner: string,
    repo: string,
    prNumber: number,
    durationMs: number
  ): ReviewReport {
    const candidate = (raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}) as Record<string, unknown>;
    candidate.pullRequest = { owner, repo, number: prNumber };
    candidate.metadata = {
      analyzedAt: new Date().toISOString(),
      duration: durationMs,
      agentVersions: {
        orchestrator: this.model,
        ...Object.fromEntries(AGENT_NAMES.map(name => [name, AGENT_VERSION]))
      }
    };
    if (!Array.isArray(candidate.recommendations)) candidate.recommendations = [];
    if (!candidate.summary || typeof candidate.summary !== 'object') {
      candidate.summary = { totalFiles: 0, overallScore: 0, criticalIssues: 0, highPriorityTests: 0, refactoringOpportunities: 0 };
    }

    const parsed = ReviewReportSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ReviewError(
        `Report failed schema validation: ${parsed.error.issues
          .slice(0, 5)
          .map(i => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
        ErrorCodes.VALIDATION_FAILED,
        { issues: parsed.error.issues }
      );
    }

    const report = parsed.data;
    report.summary = computeSummary(report);
    return report;
  }

  /** Log MCP status, subagent invocations and tool calls */
  private logMessage(message: SDKMessage, invokedAgents: Set<string>): void {
    if (message.type === 'system' && message.subtype === 'init') {
      for (const server of message.mcp_servers ?? []) {
        logger.info(`MCP server '${server.name}': ${server.status}`);
        if (server.name === 'github' && server.status === 'failed') {
          throw new ReviewError(
            'GitHub MCP server failed to start; cannot fetch PR data. Check network access and GITHUB_TOKEN.',
            ErrorCodes.GITHUB_API_ERROR
          );
        }
      }
      return;
    }

    if (message.type !== 'assistant') return;
    const inSubagent = Boolean(message.parent_tool_use_id);
    const content = message.message?.content;
    if (!Array.isArray(content)) return;

    for (const block of content) {
      if (block.type !== 'tool_use') continue;
      if (block.name === 'Task') {
        const input = block.input as { subagent_type?: string; description?: string };
        if (input.subagent_type) invokedAgents.add(input.subagent_type);
        logger.info(`→ Invoking subagent: ${input.subagent_type ?? 'unknown'} (${input.description ?? 'task'})`);
      } else {
        logger.debug(`${inSubagent ? '  [subagent] ' : ''}tool: ${block.name}`);
      }
    }
  }
}

/** Backwards-friendly alias matching the guide's naming */
export { CodeReviewOrchestrator as Orchestrator };

/**
 * Deterministic summary computed from the aggregated findings.
 * overallScore = 60% average code quality + 40% average estimated coverage.
 */
export function computeSummary(report: ReviewReport): ReviewReport['summary'] {
  const reviews = report.fileReviews;
  const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

  const quality = avg(reviews.map(r => r.codeQuality.overallScore));
  const coverage = avg(reviews.map(r => r.testCoverage.coverageEstimate));

  return {
    totalFiles: reviews.length,
    overallScore: reviews.length ? Math.round(quality * 0.6 + coverage * 0.4) : 0,
    criticalIssues: reviews.reduce(
      (n, r) => n + r.codeQuality.issues.filter(i => i.severity === 'critical').length,
      0
    ),
    highPriorityTests: reviews.reduce(
      (n, r) => n + r.testCoverage.untestedPaths.filter(p => p.priority === 'critical' || p.priority === 'high').length,
      0
    ),
    refactoringOpportunities: reviews.reduce((n, r) => n + r.refactorings.suggestions.length, 0)
  };
}

/**
 * Streaming input mode (async generator), the recommended pattern for MCP + subagents.
 */
async function* singleMessage(text: string) {
  yield {
    type: 'user' as const,
    message: { role: 'user' as const, content: text },
    parent_tool_use_id: null,
    session_id: 'code-review-session'
  };
}

export { formatError };
