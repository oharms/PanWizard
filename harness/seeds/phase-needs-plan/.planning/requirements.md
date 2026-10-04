# Requirements

## v1.0 Requirements

- **REQ-01** — `greet(name)` returns `Hello, <name>!` and is covered by a test.
- **REQ-02** — `farewell(name)` returns `Goodbye, <name>.` and is covered by a test.
- **REQ-03** — The library supports greetings in English, French, German and Spanish, through the i18n catalogue, with tests for each documented case.
- **REQ-04** — Errors from the i18n catalogue name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-05** — The library supports formal and informal forms per locale, through the register switch, with tests for each documented case.
- **REQ-06** — Errors from the register switch name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-07** — The library supports given and family names in each locale's order, through the name order rules, with tests for each documented case.
- **REQ-08** — Errors from the name order rules name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-09** — The library supports Dr, Prof and the locale equivalents, through the title table, with tests for each documented case.
- **REQ-10** — Errors from the title table name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-11** — The library supports greetings to groups of people, through the plural rules, with tests for each documented case.
- **REQ-12** — Errors from the plural rules name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-13** — The library supports good morning, afternoon and evening by local clock, through the clock source, with tests for each documented case.
- **REQ-14** — Errors from the clock source name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-15** — The library supports the recipient's time zone, not the server's, through the zone database, with tests for each documented case.
- **REQ-16** — Errors from the zone database name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-17** — The library supports seasonal greetings on public holidays, through the holiday calendar, with tests for each documented case.
- **REQ-18** — Errors from the holiday calendar name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-19** — The library supports a `greet` command with flags for locale and register, through the argument parser, with tests for each documented case.
- **REQ-20** — Errors from the argument parser name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-21** — The library supports per-user defaults in a config file, through the config loader, with tests for each documented case.
- **REQ-22** — Errors from the config loader name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-23** — The library supports a JSON endpoint returning greetings, through the HTTP server, with tests for each documented case.
- **REQ-24** — Errors from the HTTP server name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-25** — The library supports per-client limits on the API, through the token bucket, with tests for each documented case.
- **REQ-26** — Errors from the token bucket name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-27** — The library supports API keys for the endpoint, through the key store, with tests for each documented case.
- **REQ-28** — Errors from the key store name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-29** — The library supports who asked for which greeting, when, through the append-only log, with tests for each documented case.
- **REQ-30** — Errors from the append-only log name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-31** — The library supports request counts and latency, through the metrics registry, with tests for each documented case.
- **REQ-32** — Errors from the metrics registry name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-33** — The library supports cache rendered greetings by locale and name, through the LRU cache, with tests for each documented case.
- **REQ-34** — Errors from the LRU cache name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-35** — The library supports user-defined greeting templates, through the template engine, with tests for each documented case.
- **REQ-36** — Errors from the template engine name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-37** — The library supports escape user input in templates, through the escaping rules, with tests for each documented case.
- **REQ-38** — Errors from the escaping rules name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-39** — The library supports greet a CSV of names, through the CSV reader, with tests for each documented case.
- **REQ-40** — Errors from the CSV reader name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-41** — The library supports greet a stream of names line by line, through the line reader, with tests for each documented case.
- **REQ-42** — Errors from the line reader name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-43** — The library supports third-party greeting styles, through the plugin loader, with tests for each documented case.
- **REQ-44** — Errors from the plugin loader name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-45** — The library supports reference docs generated from the code, through the doc generator, with tests for each documented case.
- **REQ-46** — Errors from the doc generator name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-47** — The library supports publish to the npm registry, through the release script, with tests for each documented case.
- **REQ-48** — Errors from the release script name the input that failed and the rule it broke, so a caller can fix the call without reading the source.
- **REQ-49** — The library supports anonymous usage counts, off by default, through the consent flag, with tests for each documented case.
- **REQ-50** — Errors from the consent flag name the input that failed and the rule it broke, so a caller can fix the call without reading the source.

## Traceability

| Requirement | Phase | Plan | Status |
|---|---|---|---|
| REQ-01 | 1 | 01-01 | Pending |
| REQ-02 | 1 | 01-02 | Pending |
| REQ-03 | 2 | — | Pending |
| REQ-04 | 2 | — | Pending |
| REQ-05 | 3 | — | Pending |
| REQ-06 | 3 | — | Pending |
| REQ-07 | 4 | — | Pending |
| REQ-08 | 4 | — | Pending |
| REQ-09 | 5 | — | Pending |
| REQ-10 | 5 | — | Pending |
| REQ-11 | 6 | — | Pending |
| REQ-12 | 6 | — | Pending |
| REQ-13 | 7 | — | Pending |
| REQ-14 | 7 | — | Pending |
| REQ-15 | 8 | — | Pending |
| REQ-16 | 8 | — | Pending |
| REQ-17 | 9 | — | Pending |
| REQ-18 | 9 | — | Pending |
| REQ-19 | 10 | — | Pending |
| REQ-20 | 10 | — | Pending |
| REQ-21 | 11 | — | Pending |
| REQ-22 | 11 | — | Pending |
| REQ-23 | 12 | — | Pending |
| REQ-24 | 12 | — | Pending |
| REQ-25 | 13 | — | Pending |
| REQ-26 | 13 | — | Pending |
| REQ-27 | 14 | — | Pending |
| REQ-28 | 14 | — | Pending |
| REQ-29 | 15 | — | Pending |
| REQ-30 | 15 | — | Pending |
| REQ-31 | 16 | — | Pending |
| REQ-32 | 16 | — | Pending |
| REQ-33 | 17 | — | Pending |
| REQ-34 | 17 | — | Pending |
| REQ-35 | 18 | — | Pending |
| REQ-36 | 18 | — | Pending |
| REQ-37 | 19 | — | Pending |
| REQ-38 | 19 | — | Pending |
| REQ-39 | 20 | — | Pending |
| REQ-40 | 20 | — | Pending |
| REQ-41 | 21 | — | Pending |
| REQ-42 | 21 | — | Pending |
| REQ-43 | 22 | — | Pending |
| REQ-44 | 22 | — | Pending |
| REQ-45 | 23 | — | Pending |
| REQ-46 | 23 | — | Pending |
| REQ-47 | 24 | — | Pending |
| REQ-48 | 24 | — | Pending |
| REQ-49 | 25 | — | Pending |
| REQ-50 | 25 | — | Pending |
