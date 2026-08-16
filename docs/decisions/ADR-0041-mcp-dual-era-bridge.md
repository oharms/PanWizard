# ADR-0041: PAN-Z MCP bridge is dual-era — support the 2026-07-28 stateless spec alongside the legacy handshake

## Status

Accepted — 2026-08-03. Prompted by the MCP `2026-07-28` specification, the first revision to make the protocol stateless.

> **Relocated 2026-08-12 — the decision stands, the path changed.** This ADR was written when the bridge was `pan-zcode/mcp/server.cjs`, an experimental-preview component. It now lives at **`pan-wizard-core/mcp/server.cjs`**, shipped with the engine to every install and every runtime, with `pan-zcode/` as one consumer rather than its owner. Nothing in the Decision or Consequences below is altered by the move — the dual-era design, `SUPPORTED_VERSIONS_LIST`, the `_meta` gating, and the "never claim a version you don't speak" rule all carry over verbatim. Read every `pan-zcode/mcp/…` path below as `pan-wizard-core/mcp/…`. Rationale for promoting it, and the plan it belongs to, are in [ECOSYSTEM-REVIEW-2026-08.md](../ECOSYSTEM-REVIEW-2026-08.md) §3.3.
>
> One correction worth carrying, since the review that drove the move first got it wrong: the pre-move engine-path resolution (`join(__dirname,'..','..','pan-wizard-core','bin',…)`) was **not** a bug the relocation fixed — from the new directory it resolves identically. It was merely over-specified. See the comment on `defaultPanToolsPath()`.

## Context

The MCP `2026-07-28` spec is the largest revision since launch. It removes the `initialize`/`initialized` handshake and makes the protocol **stateless**: every request now declares its protocol version, client identity, and capabilities in `_meta` (`io.modelcontextprotocol/protocolVersion`, `…/clientInfo`, `…/clientCapabilities`). It adds a mandatory `server/discover` RPC (servers **MUST** implement it), a required `resultType` field on every result (`"complete"` | `"input_required"`), and a stateless version-negotiation error, `UnsupportedProtocolVersionError` (`-32022`), whose `data` lists the versions the server supports.

The PAN-Z bridge (`mcp/server.cjs`) is a **stdio** JSON-RPC server. Before this change it advertised at most `2025-06-18` and only spoke the `initialize` handshake. Two facts shaped the decision:

1. **Almost none of the "breaking" surface touches a stdio server.** The stateless rewrite's headline items — removal of `Mcp-Session-Id`, `Mcp-Method`/`Mcp-Name` routing headers, load-balancer affinity, SSE resumability — are all Streamable-HTTP transport concerns. The stdio transport is unchanged: still newline-delimited JSON-RPC over stdin/stdout.
2. **The spec builds in backward compatibility on purpose.** Clients **MUST** treat a result with no `resultType` as `"complete"`, and the versioning page defines a `server/discover` stdio probe precisely so a modern (or dual-era) client can detect a legacy server and fall back. The compatibility matrix shows a **modern-only client against a legacy-only server *fails*** on stdio unless the server answers the probe.

The real dependency is what z.ai's ZCode harness speaks — which can only be confirmed on a real install (the pending M0 verify spike). The safe move is to make the bridge tolerant of both eras so the answer to "which era does ZCode use?" does not become a go/no-go blocker.

## Decision

Make the bridge a **dual-era server**. Detect era per request by the presence of `_meta['io.modelcontextprotocol/protocolVersion']`:

- **Legacy path (no `_meta` version):** unchanged. Answer the `initialize` handshake, echoing a legacy version (never the modern `2026-07-28` — a handshake cannot select a stateless-era revision), falling back to `2025-06-18`. Results keep their pre-2026 shape (no `resultType`).
- **Modern path (`_meta` version present):** if the requested version is not in `SUPPORTED_VERSIONS_LIST`, return `UnsupportedProtocolVersionError` (`-32022`) with `data: { supported, requested }`. Otherwise serve the request and stamp `resultType: "complete"` on the result.
- **`server/discover`** is always implemented (both eras can reach it). It returns a `DiscoverResult`: `supportedVersions`, `capabilities`, `_meta['io.modelcontextprotocol/serverInfo']`, `instructions`, and the `ttlMs`/`cacheScope` caching hints.

`SUPPORTED_VERSIONS_LIST = ['2026-07-28', '2025-06-18', '2025-03-26', '2024-11-05']`. Gating modern behavior on the `_meta` field keeps every existing legacy-era code path — and its tests — byte-for-byte unchanged.

Deliberately **not** adopted (out of scope for a stdio tool/resource bridge, consistent with the bridge's scope boundary): MRTR (the bridge has no sampling/elicitation/roots), `subscriptions/listen`, the HTTP auth hardening (CIMD, RFC 9207 — stdio servers take credentials from the environment), and strict enforcement of the modern required `_meta` fields beyond the protocol version (leniency keeps a partial client working; revisit if a real client depends on it).

## Consequences

- A modern or dual-era ZCode client can discover the bridge and negotiate a version instead of failing on stdio; a legacy client is entirely unaffected.
- The M0 verify spike gains a concrete checkpoint (README "Still pending — M0"): confirm which era ZCode uses and that its declared version is supported.
- New protocol revisions are a one-line change: add the version to `SUPPORTED_VERSIONS_LIST` **once its method shapes are actually implemented** — the bridge must never claim a version it doesn't speak.
- Because modern behavior is gated on `_meta`, the legacy contract cannot regress silently; a test asserts legacy results still omit `resultType`.

## References

- MCP `2026-07-28` spec: [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog), [versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), [server/discover](https://modelcontextprotocol.io/specification/2026-07-28/server/discover).
- `pan-zcode/mcp/server.cjs`, `tests/pan-zcode-mcp.test.cjs` (dual-era suite), `pan-zcode/README.md` (M0 checkpoint), `pan-zcode/KNOWN-BETA-RISKS.md`.
- Related: the bridge's scope boundary (tool/resource exposure only, no session state) in `pan-zcode/README.md`.
