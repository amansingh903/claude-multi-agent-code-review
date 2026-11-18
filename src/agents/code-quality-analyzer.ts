import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/code-quality-analyzer.prompt.js';

/**
 * Code Quality Analyzer
 * Security, performance and maintainability review of changed files.
 * Tools are read-only: it can read files, search, lint, fetch PR file contents and use Skills.
 */
export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Code quality specialist. Use to analyze changed files in a pull request for security ' +
    'vulnerabilities, performance problems, bug risks and maintainability issues, reporting each ' +
    'issue with file, line number, severity and a concrete fix.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  model: 'inherit',
  tools: [
    'Read',
    'Grep',
    'Glob',
    'Skill',
    'mcp__github__get_file_contents',
    'mcp__eslint__lint-files',
    'mcp__eslint__lint'
  ]
};
