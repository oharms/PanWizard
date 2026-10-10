# Roadmap: Greetings

## Overview

Twenty-five phases; phase 1 (two functions) is next. The seed for PAN's behavioural harness: the whole
project is complete when both functions exist with passing tests and the phase is verified.

## Phases

- [ ] **Phase 1: Greetings** - Implement `greet` and `farewell` with tests
- [ ] **Phase 2: Locales** - greetings in English, French, German and Spanish
- [ ] **Phase 3: Formal register** - formal and informal forms per locale
- [ ] **Phase 4: Name formatting** - given and family names in each locale's order
- [ ] **Phase 5: Titles** - Dr, Prof and the locale equivalents
- [ ] **Phase 6: Pluralisation** - greetings to groups of people
- [ ] **Phase 7: Time of day** - good morning, afternoon and evening by local clock
- [ ] **Phase 8: Time zones** - the recipient's time zone, not the server's
- [ ] **Phase 9: Holidays** - seasonal greetings on public holidays
- [ ] **Phase 10: CLI** - a `greet` command with flags for locale and register
- [ ] **Phase 11: Config file** - per-user defaults in a config file
- [ ] **Phase 12: HTTP API** - a JSON endpoint returning greetings
- [ ] **Phase 13: Rate limits** - per-client limits on the API
- [ ] **Phase 14: Auth** - API keys for the endpoint
- [ ] **Phase 15: Audit log** - who asked for which greeting, when
- [ ] **Phase 16: Metrics** - request counts and latency
- [ ] **Phase 17: Caching** - cache rendered greetings by locale and name
- [ ] **Phase 18: Templates** - user-defined greeting templates
- [ ] **Phase 19: Template safety** - escape user input in templates
- [ ] **Phase 20: Batch mode** - greet a CSV of names
- [ ] **Phase 21: Streaming** - greet a stream of names line by line
- [ ] **Phase 22: Plugins** - third-party greeting styles
- [ ] **Phase 23: Docs site** - reference docs generated from the code
- [ ] **Phase 24: Packaging** - publish to the npm registry
- [ ] **Phase 25: Telemetry opt-in** - anonymous usage counts, off by default

## Phase Details

### Phase 1: Greetings
**Goal:** Ship the two library functions with passing `node --test` coverage.
**Depends on:** Nothing (first phase)
**Requirements:** REQ-01, REQ-02
**Success Criteria** (what must be TRUE):
  1. `require('./src/greet.js').greet('Ada')` returns `Hello, Ada!`
  2. `require('./src/farewell.js').farewell('Ada')` returns `Goodbye, Ada.`
  3. `npm test` passes with a test for each function
**Plans:** 2 plans

Plans:
- [ ] 01-01: Implement greet with its test
- [ ] 01-02: Implement farewell with its test, exported alongside greet

### Phase 2: Locales
**Goal:** Support greetings in English, French, German and Spanish.
**Depends on:** Phase 1
**Requirements:** REQ-03, REQ-04
**Success Criteria** (what must be TRUE):
  1. The i18n catalogue handles greetings in English, French, German and Spanish, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Locales builds on the i18n catalogue. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 3: Formal register
**Goal:** Support formal and informal forms per locale.
**Depends on:** Phase 2
**Requirements:** REQ-05, REQ-06
**Success Criteria** (what must be TRUE):
  1. The register switch handles formal and informal forms per locale, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Formal register builds on the register switch. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 4: Name formatting
**Goal:** Support given and family names in each locale's order.
**Depends on:** Phase 3
**Requirements:** REQ-07, REQ-08
**Success Criteria** (what must be TRUE):
  1. The name order rules handles given and family names in each locale's order, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Name formatting builds on the name order rules. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 5: Titles
**Goal:** Support Dr, Prof and the locale equivalents.
**Depends on:** Phase 4
**Requirements:** REQ-09, REQ-10
**Success Criteria** (what must be TRUE):
  1. The title table handles Dr, Prof and the locale equivalents, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Titles builds on the title table. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 6: Pluralisation
**Goal:** Support greetings to groups of people.
**Depends on:** Phase 5
**Requirements:** REQ-11, REQ-12
**Success Criteria** (what must be TRUE):
  1. The plural rules handles greetings to groups of people, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Pluralisation builds on the plural rules. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 7: Time of day
**Goal:** Support good morning, afternoon and evening by local clock.
**Depends on:** Phase 6
**Requirements:** REQ-13, REQ-14
**Success Criteria** (what must be TRUE):
  1. The clock source handles good morning, afternoon and evening by local clock, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Time of day builds on the clock source. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 8: Time zones
**Goal:** Support the recipient's time zone, not the server's.
**Depends on:** Phase 7
**Requirements:** REQ-15, REQ-16
**Success Criteria** (what must be TRUE):
  1. The zone database handles the recipient's time zone, not the server's, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Time zones builds on the zone database. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 9: Holidays
**Goal:** Support seasonal greetings on public holidays.
**Depends on:** Phase 8
**Requirements:** REQ-17, REQ-18
**Success Criteria** (what must be TRUE):
  1. The holiday calendar handles seasonal greetings on public holidays, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Holidays builds on the holiday calendar. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 10: CLI
**Goal:** Support a `greet` command with flags for locale and register.
**Depends on:** Phase 9
**Requirements:** REQ-19, REQ-20
**Success Criteria** (what must be TRUE):
  1. The argument parser handles a `greet` command with flags for locale and register, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** CLI builds on the argument parser. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 11: Config file
**Goal:** Support per-user defaults in a config file.
**Depends on:** Phase 10
**Requirements:** REQ-21, REQ-22
**Success Criteria** (what must be TRUE):
  1. The config loader handles per-user defaults in a config file, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Config file builds on the config loader. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 12: HTTP API
**Goal:** Support a JSON endpoint returning greetings.
**Depends on:** Phase 11
**Requirements:** REQ-23, REQ-24
**Success Criteria** (what must be TRUE):
  1. The HTTP server handles a JSON endpoint returning greetings, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** HTTP API builds on the HTTP server. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 13: Rate limits
**Goal:** Support per-client limits on the API.
**Depends on:** Phase 12
**Requirements:** REQ-25, REQ-26
**Success Criteria** (what must be TRUE):
  1. The token bucket handles per-client limits on the API, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Rate limits builds on the token bucket. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 14: Auth
**Goal:** Support API keys for the endpoint.
**Depends on:** Phase 13
**Requirements:** REQ-27, REQ-28
**Success Criteria** (what must be TRUE):
  1. The key store handles API keys for the endpoint, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Auth builds on the key store. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 15: Audit log
**Goal:** Support who asked for which greeting, when.
**Depends on:** Phase 14
**Requirements:** REQ-29, REQ-30
**Success Criteria** (what must be TRUE):
  1. The append-only log handles who asked for which greeting, when, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Audit log builds on the append-only log. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 16: Metrics
**Goal:** Support request counts and latency.
**Depends on:** Phase 15
**Requirements:** REQ-31, REQ-32
**Success Criteria** (what must be TRUE):
  1. The metrics registry handles request counts and latency, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Metrics builds on the metrics registry. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 17: Caching
**Goal:** Support cache rendered greetings by locale and name.
**Depends on:** Phase 16
**Requirements:** REQ-33, REQ-34
**Success Criteria** (what must be TRUE):
  1. The LRU cache handles cache rendered greetings by locale and name, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Caching builds on the LRU cache. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 18: Templates
**Goal:** Support user-defined greeting templates.
**Depends on:** Phase 17
**Requirements:** REQ-35, REQ-36
**Success Criteria** (what must be TRUE):
  1. The template engine handles user-defined greeting templates, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Templates builds on the template engine. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 19: Template safety
**Goal:** Support escape user input in templates.
**Depends on:** Phase 18
**Requirements:** REQ-37, REQ-38
**Success Criteria** (what must be TRUE):
  1. The escaping rules handles escape user input in templates, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Template safety builds on the escaping rules. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 20: Batch mode
**Goal:** Support greet a CSV of names.
**Depends on:** Phase 19
**Requirements:** REQ-39, REQ-40
**Success Criteria** (what must be TRUE):
  1. The CSV reader handles greet a CSV of names, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Batch mode builds on the CSV reader. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 21: Streaming
**Goal:** Support greet a stream of names line by line.
**Depends on:** Phase 20
**Requirements:** REQ-41, REQ-42
**Success Criteria** (what must be TRUE):
  1. The line reader handles greet a stream of names line by line, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Streaming builds on the line reader. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 22: Plugins
**Goal:** Support third-party greeting styles.
**Depends on:** Phase 21
**Requirements:** REQ-43, REQ-44
**Success Criteria** (what must be TRUE):
  1. The plugin loader handles third-party greeting styles, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Plugins builds on the plugin loader. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 23: Docs site
**Goal:** Support reference docs generated from the code.
**Depends on:** Phase 22
**Requirements:** REQ-45, REQ-46
**Success Criteria** (what must be TRUE):
  1. The doc generator handles reference docs generated from the code, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Docs site builds on the doc generator. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 24: Packaging
**Goal:** Support publish to the npm registry.
**Depends on:** Phase 23
**Requirements:** REQ-47, REQ-48
**Success Criteria** (what must be TRUE):
  1. The release script handles publish to the npm registry, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Packaging builds on the release script. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.

### Phase 25: Telemetry opt-in
**Goal:** Support anonymous usage counts, off by default.
**Depends on:** Phase 24
**Requirements:** REQ-49, REQ-50
**Success Criteria** (what must be TRUE):
  1. The consent flag handles anonymous usage counts, off by default, covered by a `node --test` test for each case the roadmap names
  2. Every function this phase adds rejects input it cannot handle with a clear error, and a test shows it
  3. The public entry point exports what this phase adds, and the README documents it with one example
  4. `npm test` passes, and no earlier phase's test changes to make it pass
**Plans:** TBD

**Notes:** Telemetry opt-in builds on the consent flag. Keep it in its own module so later phases can replace it without touching the greeting functions themselves. Open questions are settled in this phase's context.md before planning.
