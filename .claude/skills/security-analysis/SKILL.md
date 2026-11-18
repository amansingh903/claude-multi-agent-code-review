---
name: security-analysis
description: Security-focused review covering OWASP Top 10 risks, secret handling, input validation and secure coding in JS/TS
---

# Security Analysis

Security reviewer for web and Node.js code. Apply to EVERY changed code file.

## Injection (OWASP A03)
- SQL/NoSQL built with string concatenation or template literals -> use parameterized queries
- `eval`, `new Function`, `setTimeout(string)`, `child_process.exec` with user input
- Path traversal: user input in `fs` paths without normalization and allow-listing

## Cross-Site Scripting
- `innerHTML`, `outerHTML`, `document.write`, `insertAdjacentHTML` with unescaped data
- React `dangerouslySetInnerHTML`, Vue `v-html` with user content
- Building HTML strings from user input (e.g. search terms echoed into the page)

## Secrets and Sensitive Data (A02)
- Hardcoded API keys, tokens, passwords, or private keys in source
- Secrets or PII written to logs, `console.log`, or error messages
- Sensitive data stored in `localStorage`/`sessionStorage` (e.g. tokens, payment info)

## Access Control and Business Logic (A01, A04)
- Premium/paid features gated only on the client (e.g. `if (user.isPremium)` in browser code)
- Missing authorization checks on state-changing actions
- Trusting client-supplied prices, plan IDs, or user IDs
- Payment/subscription flows without server-side verification

## Input Validation
- No validation or length limits on user input
- Regex built from user input (ReDoS) or catastrophic patterns
- `JSON.parse` on untrusted data without try/catch and schema validation

## Dependencies and Configuration (A05, A06)
- Insecure defaults (CORS `*`, disabled TLS verification, debug mode)
- Use of deprecated or known-vulnerable APIs

## Severity Guidelines
- critical: exploitable injection/XSS, hardcoded secrets, client-only paywall/auth bypass
- high: sensitive data exposure, missing authorization on actions
- medium: missing input validation, weak error handling that leaks details
- low: defense-in-depth improvements

## Output
For each finding report the line, the vulnerability class (e.g. "XSS via innerHTML"), the attack scenario in one sentence, and the secure fix with a code snippet. Use category "security".
