# ADR-0030: `.planning/` Concurrency Hardening — Advisory Locks + Atomic Writes

## Status
Accepted — v1 (best-effort) shipped 2026-06-11: `lock.cjs` primitive (`withFileLock`, `writeFileAtomic`) wired into `writeStateMd()`. Wider adoption and strict mode are the documented escalation path below.

## Context

PAN was designed for one agent driving one project. The fleet/agent-teams era breaks that assumption: parallel exec waves, hierarchical orchestration (`pan-conductor`), and background loops can all touch `.planning/` concurrently. The exposure classes:

1. **Lost updates** — `state.md`, `roadmap.md`, `requirements.md` are read-modify-write: two agents read, both write, one update vanishes. `state.md` is the hottest (every phase/plan transition).
2. **Torn reads** — a reader catches a half-written file. PAN already hardened readers (`readStateSafe`, null-checked parses), but the write side could still produce the torn state being defended against.
3. **Append races** — `tokens.jsonl`, bus channels. Single `appendFileSync` calls of one line are effectively atomic on local filesystems; lowest risk, no change needed now.

Constraints: zero runtime dependencies, synchronous CJS call sites, cross-platform (Windows/NTFS + POSIX), and — critically — **no new failure mode for the single-agent majority**.

## Decision

Ship `lock.cjs` with two primitives, applied incrementally:

1. **`writeFileAtomic(path, content)`** — temp file + rename, same directory. Readers never observe a partial file. (Windows rename-over-open-handle refusal falls back to a direct write, preserving today's semantics at worst.)
2. **`withFileLock(path, fn, opts)`** — advisory `<path>.lock` via atomic exclusive-create (`wx` flag), bounded retry with synchronous sleep (`Atomics.wait` — no busy-wait), and stale-lock stealing (default 10 s — a crashed holder must not deadlock the project).

**v1 semantics are best-effort:** when the lock cannot be acquired within the retry budget (default ~1 s), the critical section runs *unlocked* — exactly today's behavior. Concurrent fleets get lost-update protection in the overwhelmingly common case; single-agent users see zero behavioral change and zero new errors. The return value reports `locked: false` so future callers can escalate.

**First adopter:** `writeStateMd()` — every state.md write now serializes behind `state.md.lock` and lands atomically.

### Escalation path (not yet scheduled)

- Adopt the lock in the other RMW writers (roadmap, requirements, milestone files) — mechanical now that the primitive exists.
- **Strict mode** behind `.planning/config.json → concurrency.strict`: lock timeout returns `{error: 'lock_timeout'}` instead of falling back, for fleets that prefer failing loudly to last-write-wins.
- Merge semantics (CRDT-ish section merging) were considered and rejected for now: PAN's files are human-readable markdown with section structure, and a wrong automatic merge is worse than a lost update that `validate consistency` can detect. Revisit only with evidence of real-world contention that locking doesn't solve.

## Consequences

**Positive.** Lost-update and torn-write protection for the hottest file with zero dependencies and zero behavior change for existing users; a reusable primitive the remaining writers can adopt mechanically; stale-steal means crashed agents never wedge a project.

**Negative / risks.** Advisory locks only bind cooperating writers — direct `fs.writeFileSync` calls bypass them (the module-decomposition work makes such sites easy to find). Best-effort fallback means a pathological 40-writer pileup can still lose an update; that is the strict-mode trade, deliberately deferred. Lock files in `.planning/` are transient litter if a process is SIGKILLed mid-hold — bounded by the 10 s stale steal.
