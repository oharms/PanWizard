# Greetings

## What This Is

A two-function Node.js library — `greet(name)` and `farewell(name)` — used as a fixed,
deterministic seed for PAN's behavioural harness. Small enough that an executor cannot
get lost in it, real enough that an executor has something to build, test and commit.

## Core Value

Every plan in this project has one observable outcome (a function and its test), so a
run either produced the artifact or it did not.

## Constraints

- Zero dependencies. Tests use `node --test` only.
- Plain CommonJS.
