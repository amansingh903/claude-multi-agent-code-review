/**
 * Subagent exports
 */
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { codeQualityAnalyzer } from './code-quality-analyzer.js';
import { testCoverageAnalyzer } from './test-coverage-analyzer.js';
import { refactoringSuggester } from './refactoring-suggester.js';

export { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester };

/** Agent names are what the orchestrator prompt refers to when invoking subagents. */
export const AGENT_NAMES = [
  'code-quality-analyzer',
  'test-coverage-analyzer',
  'refactoring-suggester'
] as const;

export type AgentName = typeof AGENT_NAMES[number];

/** Registry passed to the SDK `agents` option. */
export const reviewAgents: Record<AgentName, AgentDefinition> = {
  'code-quality-analyzer': codeQualityAnalyzer,
  'test-coverage-analyzer': testCoverageAnalyzer,
  'refactoring-suggester': refactoringSuggester
};
