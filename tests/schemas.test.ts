import { describe, it, expect } from 'vitest';
import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema,
  ReviewReportSchema,
  ReviewReportJSONSchema,
  CodeQualityResultJSONSchema
} from '../src/types';

const quality = {
  file: 'src/app.js',
  issues: [{ line: 3, severity: 'high', category: 'bug-risk', description: 'd', suggestion: 's' }],
  overallScore: 85,
  summary: 'ok'
};
const coverage = {
  file: 'src/app.js',
  hasTests: true,
  testFiles: ['tests/app.test.js'],
  untestedPaths: [{ type: 'branch', location: 'l', priority: 'medium', reasoning: 'r', suggestedTest: 't' }],
  coverageEstimate: 60,
  summary: 'ok'
};
const refactor = {
  file: 'src/app.js',
  suggestions: [{ type: 'simplify', location: 'l', impact: 'medium', description: 'd', before: 'b', after: 'a', benefits: 'x' }],
  summary: 'ok'
};
const report = {
  pullRequest: { owner: 'o', repo: 'r', number: 1 },
  fileReviews: [{ file: 'src/app.js', codeQuality: quality, testCoverage: coverage, refactorings: refactor }],
  summary: { totalFiles: 1, overallScore: 75, criticalIssues: 0, highPriorityTests: 0, refactoringOpportunities: 1 },
  recommendations: [{ priority: 'high', category: 'Testing', description: 'Add tests', files: ['src/app.js'] }],
  metadata: { analyzedAt: new Date().toISOString(), duration: 1200, agentVersions: { 'code-quality-analyzer': '1.0.0' } }
};

describe('Zod schemas: valid data', () => {
  it('accepts a valid CodeQualityResult', () => expect(() => CodeQualityResultSchema.parse(quality)).not.toThrow());
  it('accepts a valid TestCoverageResult', () => expect(() => TestCoverageResultSchema.parse(coverage)).not.toThrow());
  it('accepts a valid RefactoringSuggestion', () => expect(() => RefactoringSuggestionSchema.parse(refactor)).not.toThrow());
  it('accepts a valid ReviewReport', () => expect(() => ReviewReportSchema.parse(report)).not.toThrow());
});

describe('Zod schemas: invalid data', () => {
  it('rejects an unknown severity', () => {
    const bad = { ...quality, issues: [{ ...quality.issues[0], severity: 'urgent' }] };
    expect(() => CodeQualityResultSchema.parse(bad)).toThrow();
  });
  it('rejects a string line number', () => {
    const bad = { ...quality, issues: [{ ...quality.issues[0], line: '3' }] };
    expect(() => CodeQualityResultSchema.parse(bad)).toThrow();
  });
  it('rejects a missing required field', () => {
    const { summary: _s, ...bad } = coverage;
    expect(() => TestCoverageResultSchema.parse(bad)).toThrow();
  });
  it('rejects an unknown refactoring type', () => {
    const bad = { ...refactor, suggestions: [{ ...refactor.suggestions[0], type: 'rewrite' }] };
    expect(() => RefactoringSuggestionSchema.parse(bad)).toThrow();
  });
  it('rejects a report with a string PR number', () => {
    expect(() => ReviewReportSchema.parse({ ...report, pullRequest: { owner: 'o', repo: 'r', number: '1' } })).toThrow();
  });
});

describe('Zod schemas: edge cases', () => {
  it('accepts empty arrays', () => {
    expect(() => CodeQualityResultSchema.parse({ ...quality, issues: [] })).not.toThrow();
    expect(() => ReviewReportSchema.parse({ ...report, fileReviews: [], recommendations: [] })).not.toThrow();
  });
  it('accepts boundary scores 0 and 100', () => {
    expect(() => CodeQualityResultSchema.parse({ ...quality, overallScore: 0 })).not.toThrow();
    expect(() => CodeQualityResultSchema.parse({ ...quality, overallScore: 100 })).not.toThrow();
    expect(() => TestCoverageResultSchema.parse({ ...coverage, coverageEstimate: 100 })).not.toThrow();
  });
  it('rejects scores outside 0-100', () => {
    expect(() => CodeQualityResultSchema.parse({ ...quality, overallScore: 101 })).toThrow();
    expect(() => TestCoverageResultSchema.parse({ ...coverage, coverageEstimate: -1 })).toThrow();
  });
  it('accepts an empty agentVersions record', () => {
    expect(() => ReviewReportSchema.parse({ ...report, metadata: { ...report.metadata, agentVersions: {} } })).not.toThrow();
  });
});

describe('JSON schema export for SDK structured outputs', () => {
  it('produces an object schema with the report properties', () => {
    const schema = ReviewReportJSONSchema as Record<string, any>;
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata'])
    );
  });
  it('marks required properties correctly', () => {
    const schema = ReviewReportJSONSchema as Record<string, any>;
    expect(schema.required).toEqual(
      expect.arrayContaining(['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata'])
    );
    const quality = CodeQualityResultJSONSchema as Record<string, any>;
    expect(quality.required).toEqual(expect.arrayContaining(['file', 'issues', 'overallScore', 'summary']));
  });
});
