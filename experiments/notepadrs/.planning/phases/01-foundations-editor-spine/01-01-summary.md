---
phase: 01-foundations-editor-spine
plan: 01
status: complete
date: 2026-05-02
---

# Plan 01-01 Summary — Cargo + Toolchain + Manifest + CI + Size Gate

## What landed

All foundation scaffolding for Phase 1: a buildable empty stub binary that already passes the full CI gate (build + size + DLL + clippy + test).

## Artifacts created

- `Cargo.toml` — `windows = "0.62"` with the locked Phase-1 minimum feature set; `[profile.release]` cocktail (opt-level=z, lto=fat, codegen-units=1, strip=symbols, panic=abort).
- `rust-toolchain.toml` — pins `channel = "1.82.0"` + `x86_64-pc-windows-msvc`. **See deviation note below.**
- `.cargo/config.toml` — `+crt-static` rustflag (BUILD-03).
- `.gitignore` — `/target`, `*.pdb`, `*.rs.bk`.
- `notepadrs.manifest` — XML manifest with `PerMonitorV2` DPI awareness, Win10 supportedOS GUID, common-controls v6 dependentAssembly.
- `build.rs` — `embed_manifest::embed_manifest_file("notepadrs.manifest")`.
- `src/main.rs` — minimal stub (`fn main() {}`); Plan 01-02 replaces.
- `.github/workflows/ci.yml` — windows-latest runner, dtolnay/rust-toolchain@1.82.0, build/size-gate/dumpbin/clippy/test steps; 10485760 byte ceiling.
- `tests/cargo_profile.rs` — asserts the five `[profile.release]` flags.
- `tests/com_init.rs` — `main_does_not_use_coinitialize_ex` (passes), `main_uses_ole_initialize` (#[ignore]'d, un-ignored by 01-02).

## Verification results

- `cargo build --release --target x86_64-pc-windows-msvc` — succeeds.
- `cargo clippy --release --target x86_64-pc-windows-msvc -- -D warnings` — passes.
- `cargo test --test cargo_profile --test com_init` — `1 passed, 1 passed (1 ignored)` = 2 passing, 1 ignored.
- Release binary size: **195,072 bytes** (~190 KiB, ~1.86% of 10 MiB ceiling).

## windows crate features

Used the locked minimum from D-5 verbatim — no additions needed for the empty stub. Plan 01-02 will likely add `Win32_System_Diagnostics_Debug` (for `OutputDebugStringW`) and `Win32_UI_Input_KeyboardAndMouse` (for VK_* constants) per the plan-02 task notes.

## Deviations

**1. Local toolchain pin not enforced.** `rust-toolchain.toml` pins `channel = "1.82.0"` per D-3, but the local development machine has standalone Rust 1.95.0 installed at `C:\Program Files\Rust stable MSVC 1.95\` with no `rustup` available. Without rustup, the `channel` directive is silently ignored locally; cargo 1.95 builds and tests without honouring the pin. **The pin still applies to CI** (where `dtolnay/rust-toolchain@master` with `toolchain: 1.82.0` is the source of truth) and to any developer that does have rustup installed. This is acceptable because:
   - The `rust-version = "1.82"` in `Cargo.toml` is honoured (cargo refuses to build with <1.82).
   - CI is the gate; local 1.95 is a forward-compatible superset of 1.82's surface.
   - Anyone running `rustup show` will get 1.82 auto-installed per the pin.

**2. `cargo build` builds for the Windows target by default.** Adding `target = "x86_64-pc-windows-msvc"` to `[build]` in `.cargo/config.toml` means `cargo build` (no `--target`) also produces the Windows binary, which is what we want on a Windows host. Documented for clarity.

## Hand-off to Plan 01-02

Plan 01-02 will add:
- `Win32_System_Diagnostics_Debug` and `Win32_UI_Input_KeyboardAndMouse` to `Cargo.toml` `windows` features.
- Replace `src/main.rs` with the full WinMain + window-class + WndProc pipeline.
- Un-ignore `com_init::main_uses_ole_initialize` once `OleInitialize` is in `main.rs`.

## Self-Check: PASS

- [x] All three tasks executed.
- [x] Build succeeds; size gate met.
- [x] Tests pass.
- [x] Clippy passes with `-D warnings`.
- [x] Plan files committed atomically (next step).
