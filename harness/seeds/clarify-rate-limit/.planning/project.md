# Quotes API

## What This Is

A small Node.js HTTP API (`node:http`, no framework) that serves stock quotes to partner
apps, used as a fixed seed for PAN's behavioural harness. Its one phase adds rate limiting
and leaves the policy to the user on purpose, so `/pan:discuss-phase` has something to clarify.

## Core Value

One noisy partner cannot slow the API down for everyone else.
