---
name: performance-optimization
description: Identifies performance problems in JS/TS code such as inefficient loops, redundant work, DOM thrashing, and blocking I/O
---

# Performance Optimization

Use when code contains loops, searches/filters over collections, DOM updates, or I/O.

## Algorithmic Complexity
- Nested loops over the same collection (O(n^2)) where a Map/Set lookup works
- Repeated `array.find`/`indexOf` inside loops
- Re-sorting or re-filtering the full list on every keystroke without debouncing

## Redundant Work
- Recomputing derived data instead of caching/memoizing
- Calling `JSON.parse(JSON.stringify(x))` for cloning in hot paths
- Reading `localStorage` repeatedly inside loops

## DOM and Rendering
- Updating the DOM inside loops (use DocumentFragment or batch updates)
- Re-rendering the entire list for a single change
- Layout thrashing: interleaving reads (offsetHeight) and writes (style)
- Missing debounce/throttle on input, scroll, and resize handlers

## Async and I/O
- Sequential `await` in loops where `Promise.all` is safe
- Synchronous file or network operations on the main thread
- Unbounded concurrency (no limit on parallel requests)

## Memory
- Event listeners or intervals never removed
- Growing caches/arrays without eviction

## Severity Guidelines
- high: user-visible slowness on realistic data sizes, unbounded growth
- medium: inefficiency that grows with data size
- low: micro-optimizations

## Output
For each finding give the line, the cost (e.g. "O(n^2) for each search"), and an optimized snippet. Use category "performance".
