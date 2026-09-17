---
status: testing
phase: 01-greetings
source: [01-01-summary.md, 01-02-summary.md]
started: 2026-09-10T18:00:00Z
updated: 2026-09-10T18:05:00Z
---

## Current Test

number: 2
name: farewell punctuation
expected: |
  farewell('Ada') returns exactly "Goodbye, Ada." (full stop, not an exclamation mark)
awaiting: complete

## Tests

### 1. greet returns the greeting
expected: `require('./src/greet.js').greet('Ada')` returns `Hello, Ada!`
result: pass

### 2. farewell punctuation
expected: `require('./src/farewell.js').farewell('Ada')` returns `Goodbye, Ada.`
result: issue
reported: "it prints Goodbye, Ada! with an exclamation mark, the roadmap says a full stop"
severity: major

## Summary

total: 2
passed: 1
issues: 1
pending: 0
skipped: 0

## Gaps

- truth: "farewell('Ada') returns 'Goodbye, Ada.'"
  status: failed
  reason: "User reported: it prints Goodbye, Ada! with an exclamation mark, the roadmap says a full stop"
  severity: major
  test: 2
  artifacts: [src/farewell.js]
  missing: []
