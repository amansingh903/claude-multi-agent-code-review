import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/refactoring-suggester.prompt.js';

/**
 * Refactoring Suggester
 * Structural improvements: extract method/class, design patterns, modernization, dead code.
 */
export const refactoringSuggester: AgentDefinition = {
  description:
    'Refactoring specialist. Use to find structural improvements in pull request code: extract ' +
    'function/class candidates, design pattern opportunities, modern language features, dead or ' +
    'redundant code, each with before/after code examples.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  model: 'inherit',
  tools: ['Read', 'Grep', 'Glob', 'Skill', 'mcp__github__get_file_contents']
};
