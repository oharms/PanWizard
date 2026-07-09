---
title: "whoocache — file-based LRU cache with TTL and concurrent-access locking"
created: "2026-05-02"
created_by: oharms
runtime_preference: claude
budget: 40
priority: medium
---

# Idea: whoocache — durable LRU+TTL cache for CLIs

A zero-dependency Node.js library + thin CLI that gives any tool a persistent on-disk key/value cache with TTL and an LRU eviction policy, safe under concurrent multi-process access. Think `redis` but you do not run a server — it is just a directory of files plus a tiny index.

## Problem

Many small CLIs end up reinventing caching: `~/.tool-cache.json`, ad-hoc lockfiles, and "ah, two processes raced and corrupted the cache" bugs. PAN already has the same shape in three places (`pan-update-check.json`, `bridge/available-tools.json`, hooks output) — none share a primitive. A small, correct, file-based cache is structurally meaningful: it exercises **state**, **concurrency**, **time**, and **eviction** — none of which prior `whoo*` experiments have stressed.

## Success Criteria

- **SC-1:** Library API: `cache.get(key)`, `cache.set(key, value, {ttlMs})`, `cache.delete(key)`, `cache.list()`, `cache.clear()`. All synchronous. Returns `undefined` for misses and expired entries.
- **SC-2:** Persistence: cache dir is `~/.whoocache/<namespace>/` by default; index file `index.json` tracks `{key, file, size, last_access, expires_at}`. Values are stored in separate files (binary-safe via base64 if not UTF-8 strings).
- **SC-3:** TTL: entries with `expires_at < now()` are treated as misses. `cache.list()` excludes expired entries by default; `--include-expired` shows them. Expired entries are lazily purged on next `set`/`get` of any key.
- **SC-4:** LRU eviction: cache enforces `--max-bytes` (default 50MB) and `--max-entries` (default 1000). On `set`, if over either cap, evict by `last_access ascending` until under cap.
- **SC-5:** Concurrency: two parallel `cache.set()` calls from different processes do NOT corrupt the index. Implemented with `O_EXCL` lockfile + retry, or `fs.openSync(..., 'wx')`. Crash mid-write must leave index recoverable (write to `.tmp`, fsync, rename).
- **SC-6:** CLI: `whoocache get|set|delete|list|clear` mirrors the API. `set` reads value from stdin if `--stdin`, or `--value <str>`. `list --json` for machine output.
- **SC-7:** ≥12 tests: get-miss, set-then-get, expiration boundary (now-1ms vs now+1ms), LRU eviction order, max-bytes eviction, max-entries eviction, parallel set from two child processes (no corruption), crash recovery (kill mid-write, reopen, verify index consistent), namespace isolation, binary value round-trip, TTL=0 vs TTL=Infinity, clear.
- **SC-8:** Dogfood: replace the ad-hoc `~/.claude/cache/pan-update-check.json` write in PAN's `pan-check-update.js` hook with a `whoocache` call (in a fork) and confirm same behavior.

## Scope

| In Scope | Out of Scope |
|----------|--------------|
| Synchronous API + thin CLI | Async/Promise API, streaming values |
| File-per-value + central index | Single-file storage (sqlite-like) |
| O_EXCL lockfile concurrency | OS-level file locks (flock) |
| LRU + TTL eviction | LFU, ARC, or 2Q eviction policies |
| String + binary values | Auto-serialize complex objects (caller does JSON.stringify) |
| Namespaced caches | Multi-namespace queries |
| Crash-safe atomic writes | Distributed sync, replication |

## Constraints

- **Tech stack:** Node.js >= 16, zero runtime deps. Pure builtins (`fs`, `path`, `os`, `crypto` for key hashing, `node:test`, `node:assert/strict`, `node:child_process` for parallel-process tests).
- **Performance:** `get` for a hot key in <1ms; `set` of 1KB value in <5ms; full LRU pass over 1000 entries in <50ms.
- **Concurrency contract:** two writers retrying with random backoff <100ms must both succeed within 1s on a 4-CPU machine.
- **Cross-platform:** Windows-safe — no `fs.flock`, no symlinks. Use rename-based atomicity.
- **Behavior on lock contention:** retry with exponential backoff capped at 10 attempts; final failure throws `LockTimeoutError` with the held lockfile path.

## Reference material

- PAN's `pan-wizard-core/bin/lib/state.cjs` `readStateSafe()` — race-condition-safe file read pattern
- PAN's `pan-wizard-core/bin/lib/commands.cjs` `cmdScaffold` — `wx` flag for atomic exclusive create
- PAN's `hooks/pan-check-update.js` — current ad-hoc cache it could replace
- PAN's `pan-wizard-core/bin/lib/bridge.cjs` — another candidate consumer (`available-tools.json`)

## Notes

- **Decision principle:** correctness > features. A 200-line cache that survives `kill -9` mid-write is better than a 1000-line cache with race conditions.
- **Eat-our-own-dogfood marker:** done when a parallel-process test (two child processes both calling `set` 1000 times into shared cache) finishes with a consistent index AND zero lost writes detected by post-run audit.
- **Promote-worthy findings expected:** atomic file-write pattern (write to `.tmp`, fsync, rename), retry-with-backoff loop shape, parallel-process test fixture pattern (PAN doesn't have one yet), index recovery after crash.
- **Wave hint:** Plan 01 = synchronous API + index format + basic TTL + tests. Plan 02 = LRU eviction + concurrency + crash recovery + multi-process tests. Plan 03 = CLI wrapper + dogfood test.
