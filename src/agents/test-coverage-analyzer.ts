import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/test-coverage-analyzer.prompt.js';

/**
 * Test Coverage Analyzer
 * Finds untested functions/branches and proposes concrete test cases.
 */
export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Test coverage specialist. Use to evaluate whether the changed code in a pull request is ' +
    'tested, estimate coverage, find untested functions, branches and edge cases, and suggest ' +
    'specific test cases with meaningful assertions.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  model: 'inherit',
  tools: ['Read', 'Grep', 'Glob', 'Skill', 'mcp__github__get_file_contents']
};
