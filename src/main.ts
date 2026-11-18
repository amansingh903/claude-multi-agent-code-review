import * as dotenv from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator } from './utils/report-generator.js';
import { formatError, isReviewError, ErrorCodes } from './utils/error-handler.js';

// Load environment variables
dotenv.config();

const USAGE = 'Usage: npm run dev -- <owner> <repo> <pr-number>\n' +
  'Example: npm run dev -- udacity cd14715-simple-todo-app 1';

/** Print a friendly error and exit (no stack traces for users) */
function fail(message: string): never {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main(): Promise<void> {
  // ---- 1. Validate command line arguments ----
  const [owner, repo, prStr] = process.argv.slice(2);

  if (!owner || !repo || !prStr) {
    fail(`Missing arguments.\n${USAGE}`);
  }

  const prNumber = Number.parseInt(prStr, 10);
  if (!/^\d+$/.test(prStr) || !Number.isInteger(prNumber) || prNumber <= 0) {
    fail(`PR number must be a positive integer, got "${prStr}".\n${USAGE}`);
  }

  // ---- 2. Validate authentication (Anthropic API key OR AWS Bedrock) ----
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasAwsCreds = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

  if (hasAnthropicKey) {
    console.log('🔐 Using Anthropic API authentication');
  } else if (hasAwsCreds) {
    if (!process.env.AWS_REGION) {
      fail('AWS credentials found but AWS_REGION is not set. Add e.g. AWS_REGION=us-east-1 to .env');
    }
    console.log('🔐 Using AWS Bedrock authentication');
  } else {
    fail(
      'No authentication configured. Set ONE of:\n' +
      '  • ANTHROPIC_API_KEY=sk-ant-...   (Anthropic API; already set in the Vocareum workspace)\n' +
      '  • AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION   (AWS Bedrock)'
    );
  }

  // ---- 3. Validate model ----
  if (!process.env.ANTHROPIC_MODEL) {
    fail(
      'ANTHROPIC_MODEL is not set. Add it to .env:\n' +
      '  • Anthropic API: ANTHROPIC_MODEL=claude-sonnet-4-5-20250929\n' +
      '  • AWS Bedrock:   ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0'
    );
  }

  if (!process.env.GITHUB_TOKEN) {
    console.warn('⚠️  GITHUB_TOKEN not set: public repos still work, but GitHub rate limits are much lower.');
  }

  console.log(`🔍 Reviewing ${owner}/${repo} PR #${prNumber}...`);

  try {
    // ---- 4. Run the multi-agent review ----
    const orchestrator = new CodeReviewOrchestrator();
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    // ---- 5. Generate reports in all three formats ----
    const generator = new ReportGenerator();
    const reportsDir = path.resolve(process.env.PROJECT_ROOT ?? process.cwd(), 'reports');
    await mkdir(reportsDir, { recursive: true });

    const baseName = `${owner}_${repo}_${prNumber}`;
    const outputs: Array<[string, string]> = [
      [`${baseName}.json`, generator.generateJSONReport(report)],
      [`${baseName}.md`, generator.generateMarkdownReport(report)],
      [`${baseName}.html`, generator.generateHTMLReport(report)]
    ];

    for (const [fileName, content] of outputs) {
      await writeFile(path.join(reportsDir, fileName), content, 'utf8');
    }

    const { summary } = report;
    console.log('\n✅ Review complete');
    console.log(`   Files reviewed: ${summary.totalFiles} | Overall score: ${summary.overallScore}/100`);
    console.log(`   Critical issues: ${summary.criticalIssues} | High-priority tests: ${summary.highPriorityTests} | Refactorings: ${summary.refactoringOpportunities}`);
    console.log('\n📄 Reports saved:');
    for (const [fileName] of outputs) console.log(`   ${path.join(reportsDir, fileName)}`);
  } catch (error) {
    const hint = isReviewError(error)
      ? {
          [ErrorCodes.AGENT_TIMEOUT]: 'The review took too long. Try again, or try a smaller PR.',
          [ErrorCodes.RETRY_EXHAUSTED]: 'All attempts failed. Check your network, API key and GITHUB_TOKEN, then retry.',
          [ErrorCodes.VALIDATION_FAILED]: 'The agents returned an incomplete report. Re-running usually fixes this.',
          [ErrorCodes.GITHUB_API_ERROR]: 'Could not reach GitHub. Check GITHUB_TOKEN and that the PR exists.'
        }[error.code as string]
      : undefined;
    fail(`Review failed: ${formatError(error)}${hint ? `\n   💡 ${hint}` : ''}`);
  }
}

main().catch(error => fail(`Unexpected error: ${formatError(error)}`));
