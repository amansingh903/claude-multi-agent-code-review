---
name: typescript-patterns
description: Analyzes TypeScript code for type safety, idiomatic patterns, and common typing mistakes
---

# TypeScript Patterns Analyzer

Expert in TypeScript type safety and idiomatic patterns. Use this checklist when reviewing .ts/.tsx files.

## Type Safety
- Avoid `any`; prefer `unknown` plus narrowing (`typeof`, `in`, type guards)
- No non-null assertions (`value!`) without a clear guarantee; prefer optional chaining or explicit checks
- Enable and respect `strict`; flag code that only compiles because of loose settings
- Type function return values on exported/public APIs
- Avoid unsafe casts (`as unknown as T`); validate external data (API responses, JSON) at runtime, e.g. with Zod

## Idiomatic Patterns
- Discriminated unions for state (`{ status: 'loading' } | { status: 'error'; error: string }`) instead of many optional flags
- `readonly` and `as const` for data that must not change
- Utility types (`Partial`, `Pick`, `Omit`, `Record`) instead of duplicating shapes
- `enum` vs union of string literals: prefer string literal unions unless a runtime object is needed
- Exhaustive `switch` with a `never` check in the default branch
- Use `interface` for object shapes that are extended; `type` for unions and compositions

## Common Mistakes
- `catch (e)` treated as `Error` without narrowing (`e instanceof Error`)
- Optional properties used without undefined checks
- Async functions returning `Promise<any>`
- Index access without `noUncheckedIndexedAccess` awareness (`arr[0]` may be undefined)
- Overloaded functions where a union parameter would do

## Severity Guidelines
- high: `any` or unsafe casts on external/untrusted data, unchecked nulls on main paths
- medium: missing return types on exported APIs, non-exhaustive unions
- low: style-level typing improvements

## Output
For each finding give the line, what is unsafe or non-idiomatic, and the typed alternative as a short code snippet.
