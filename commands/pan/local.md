---
name: pan:local
group: System
description: Use a coding model on your own computer for PAN's code-writing (Ollama, LM Studio)
argument-hint: "[off | status]"
allowed-tools:
  - Bash
  - AskUserQuestion
---

<objective>
Set up local executor offload in one step: find the models the user's local model server serves, pick the best one for coding, and turn offload on. Once it is on, PAN's executor hands each coding task to that model and still reviews, tests and commits the work itself (ADR-0053).

Speak to the user in plain words. Never show raw JSON, file paths under `pan-wizard-core/`, or config key names unless they ask.
</objective>

<process>

## 1. Where things stand

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs delegate status
```

**If `$ARGUMENTS` is `status`:** report it in two or three lines and stop: on or off; the model; whether it answers (`ready`); and whether the setting is for every project on this computer (`source: machine`) or only this project (`source: project`). When it is not ready, say why in plain words (the `reason`) and offer `/pan:local` to set it up.

**If `$ARGUMENTS` is `off`:** turn it off where it was turned on (`--scope project` when `source` is `project`, otherwise `--scope machine`), then confirm in one line that PAN's executor will write all code itself again:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs delegate setup --off --scope machine
```

Stop after that.

## 2. Find the models

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs delegate setup --dry-run
```

- `error: endpoint_unreachable`: the local model server is not running. Tell the user to start it (the `hint` says how), and stop.
- `error: no_models`: nothing is downloaded yet. Give the `hint` and stop.
- Otherwise `candidates` lists up to four models, best first: coding-tuned models first, then the largest context window, then the largest model. `chosen` is the first.

## 3. Ask once

Ask both questions in one AskUserQuestion call. Skip the model question when there is only one candidate.

- **Model** (header "Model"): one option per candidate, the first labelled "(Recommended)". Describe each from its fields: its size in GB, and its context window (`context`, in tokens; "server default" when null).
- **Where** (header "Where"): "Every project on this computer (Recommended)": one setting for this machine, and `/pan:new-project` keeps it. "Only this project": this project alone, which also overrides the machine setting here.

## 4. Turn it on

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs delegate setup --model "<chosen model>" --scope machine
```

Use `--scope project` for "Only this project". Then check it answers:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs delegate status
```

## 5. Tell the user

In a few short lines:
- Local coding is on with `<model>`, for every project on this computer or for this project only, and it answers (or why it does not).
- What changes: when PAN runs a plan, the coding goes to the local model. Planning, review, tests and commits stay with the main model, which checks every change before it is committed and takes a task back after three failed tries. Tasks touching login, payments, encryption, secrets or security are never handed off.
- If setup returned a `context_hint`, pass it on in plain words: a larger context window makes the local model more reliable.
- To turn it off: `/pan:local off`. To check it: `/pan:local status`.

</process>
