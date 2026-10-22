# Tasks

## What This Is

A small Node.js library for tracking tasks: a store that persists them to a JSON file, and
reports over them. Used as the seed for the PAN Harness H10 multi-phase pair.

## Core Value

Phase 2 builds on phase 1: the reports read the tasks the store keeps, so the store's rules
must hold across restarts.

## Constraints

- Zero dependencies. Tests use `node --test` only.
- Plain CommonJS.
