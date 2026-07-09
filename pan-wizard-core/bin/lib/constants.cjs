/**
 * Constants — Shared path constants, file patterns, and regex patterns
 *
 * All hardcoded strings that appear across multiple modules are centralized here.
 * Import from this module instead of using inline string literals.
 */

// ─── Directory names ─────────────────────────────────────────────────────────

const PLANNING_DIR = '.planning';
const PHASES_DIR = 'phases';
const MILESTONES_DIR = 'milestones';
const CODEBASE_DIR = 'codebase';
const QUICK_DIR = 'quick';

// ─── File names ──────────────────────────────────────────────────────────────

const STATE_FILE = 'state.md';
const ROADMAP_FILE = 'roadmap.md';
const CONFIG_FILE = 'config.json';
const PROJECT_FILE = 'project.md';
const REQUIREMENTS_FILE = 'requirements.md';
const PAUSE_FILE = 'pause.md';
const PATTERNS_FILE = 'patterns.md';
const SESSION_HISTORY_FILE = 'session-history.md';
const LEARNINGS_FILE = 'learnings.md';

// ─── File suffixes ───────────────────────────────────────────────────────────

const PLAN_SUFFIX = '-plan.md';
const SUMMARY_SUFFIX = '-summary.md';
const CONTEXT_SUFFIX = '-context.md';
const RESEARCH_SUFFIX = '-research.md';
const VERIFICATION_SUFFIX = '-verification.md';
const UAT_SUFFIX = '-uat.md';
const VALIDATION_SUFFIX = '-validation.md';

// ─── File matching helpers ───────────────────────────────────────────────────

/** Check if a filename is a plan file (plan.md or *-plan.md) */
function isPlanFile(f) {
  return f.endsWith(PLAN_SUFFIX) || f === 'plan.md';
}

/** Check if a filename is a summary file (summary.md or *-summary.md) */
function isSummaryFile(f) {
  return f.endsWith(SUMMARY_SUFFIX) || f === 'summary.md';
}

/** Check if a filename is a research file (research.md or *-research.md) */
function isResearchFile(f) {
  return f.endsWith(RESEARCH_SUFFIX) || f === 'research.md';
}

/** Check if a filename is a context file (context.md or *-context.md) */
function isContextFile(f) {
  return f.endsWith(CONTEXT_SUFFIX) || f === 'context.md';
}

/** Check if a filename is a verification file (verification.md or *-verification.md) */
function isVerificationFile(f) {
  return f.endsWith(VERIFICATION_SUFFIX) || f === 'verification.md';
}

// ─── Plan/Summary ID extraction ──────────────────────────────────────────────

/**
 * Extract the plan ID from a plan filename.
 * e.g. "01-plan.md" → "01", "plan.md" → ""
 */
function getPlanId(filename) {
  return filename.replace(PLAN_SUFFIX, '').replace('plan.md', '');
}

/**
 * Extract the summary ID from a summary filename.
 * e.g. "01-summary.md" → "01", "summary.md" → ""
 */
function getSummaryId(filename) {
  return filename.replace(SUMMARY_SUFFIX, '').replace('summary.md', '');
}

// ─── Regex patterns (precompiled) ────────────────────────────────────────────

/** Match a phase header in roadmap.md: ## Phase 01: Name */
const PHASE_HEADER_RE = /#{2,4}\s*Phase\s+(\d+[A-Z]?(?:\.\d+)*)\s*:\s*([^\n]+)/gi;

/** Match a phase directory name: "01-setup-auth" → ["01", "setup-auth"] */
const PHASE_DIR_RE = /^(\d+[A-Z]?(?:\.\d+)*)-?(.*)/i;

/** Match a phase number with optional letter and decimals: "03A.1.2" */
const PHASE_NUM_RE = /^(\d+)([A-Z])?((?:\.\d+)*)/i;

/** Match a bold markdown field: **Field Name:** value */
const FIELD_VALUE_RE = /\*\*([^:*]+):\*\*\s*(.+)/;

/** Match an archive directory: "v0.1.0-phases" */
const ARCHIVE_DIR_RE = /^v[\d.]+-phases$/;

/** Match a milestone version in text: "v1.0" */
const MILESTONE_VERSION_RE = /v(\d+\.\d+)/;

// ─── Focus enums ────────────────────────────────────────────────────────────

/** Valid priority levels for focus commands (P0 = highest urgency) */
const PRIORITY_LEVELS = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

/** Valid effort sizes for focus commands */
const EFFORT_SIZES = ['XS', 'S', 'M', 'L', 'XL'];

/** Effort-to-points mapping for capacity budgeting */
const EFFORT_POINTS = { XS: 1, S: 2, M: 4, L: 10, XL: 20 };

/** Focus execution modes */
const FOCUS_MODES = ['bugfix', 'balanced', 'features', 'full'];

/** Focus execution tiers */
const FOCUS_TIERS = { MICRO: 'MICRO', STANDARD: 'STANDARD', FULL: 'FULL' };

/** Focus directory under .planning */
const FOCUS_DIR = 'focus';

/** Focus auto-run state file */
const AUTO_RUN_FILE = 'auto-run.json';

/** Focus auto-runner categories */
const FOCUS_CATEGORIES = ['cleanup', 'tests', 'stability', 'features', 'docs', 'optimize', 'prompts', 'security', 'distill'];

/**
 * Focus auto-runner work sources (ADR-0031):
 *  - scan:    category-scoped code scan (default; today's behavior)
 *  - backlog: rank actionable items from roadmap.md / requirements.md
 */
const FOCUS_SOURCES = ['scan', 'backlog'];

/** Category → priority index range (indices into PRIORITY_LEVELS) */
const CATEGORY_PRIORITY_RANGE = {
  cleanup:   { min: 3, max: 5 },  // P3-P5
  tests:     { min: 2, max: 5 },  // P2-P5
  stability: { min: 0, max: 2 },  // P0-P2
  features:  { min: 3, max: 5 },  // P3-P5
  docs:      { min: 5, max: 6 },  // P5-P6
  optimize:  { min: 1, max: 4 },  // P1-P4
  prompts:   { min: 0, max: 6 },  // P0-P6 (all priorities — prompt order is authoritative)
  security:  { min: 0, max: 2 },  // P0-P2 (critical/high/medium only — low/info skipped)
  distill:   { min: 1, max: 5 },  // P1-P5 (AI bloat: structural quality, not safety-critical)
};

/** Category → default mode + budget */
const CATEGORY_DEFAULTS = {
  cleanup:   { mode: 'balanced', budget: 50 },
  tests:     { mode: 'balanced', budget: 50 },
  stability: { mode: 'bugfix',   budget: 40 },
  features:  { mode: 'features', budget: 50 },
  docs:      { mode: 'balanced', budget: 30 },
  optimize:  { mode: 'balanced', budget: 50 },
  prompts:   { mode: 'balanced', budget: 100 },
  security:  { mode: 'bugfix',   budget: 40 },
  distill:   { mode: 'balanced', budget: 50 },
};

/** Doc files to scan for staleness (focus sync) */
const DOC_SYNC_FILES = ['README.md', 'docs/DEVELOPMENT.md', 'docs/CLI-REFERENCE.md', 'docs/USER-GUIDE.md', 'docs/ARCHITECTURE.md'];

/** Old→new command name mapping for detecting stale docs */
const COMMAND_RENAME_MAP = {
  'execute-phase': 'exec-phase',
  'verify-work': 'verify-phase',
  'list-phase-assumptions': 'assumptions',
  'add-tests': 'phase-tests',
  'context-budget': 'phase-budget',
  'pause-work': 'pause',
  'resume-work': 'resume',
  'set-profile': 'profile',
  'new-milestone': 'milestone-new',
  'complete-milestone': 'milestone-done',
  'audit-milestone': 'milestone-audit',
  'plan-milestone-gaps': 'milestone-gaps',
};

/** Default max cycles for auto-runner */
const DEFAULT_MAX_CYCLES = 10;

/** Default cumulative budget cap for auto-runner */
const DEFAULT_TOTAL_BUDGET = 500;

// ─── Standards ──────────────────────────────────────────────────────────────

const STANDARDS_FILE = 'standards.md';

/** Standards categories */
const STANDARDS_CATEGORIES = ['security', 'accessibility', 'quality', 'architecture', 'process'];

/** Built-in standards catalog */
const STANDARDS_CATALOG = {
  'owasp-top10': {
    name: 'OWASP Top 10 (2025)',
    category: 'security',
    description: 'Top 10 web application security risks',
    applicable_to: ['web', 'api', 'all'],
    level: 'foundational',
    url: 'https://owasp.org/www-project-top-ten/',
    checklist: [
      'A01: Broken Access Control — verify authorization checks on all endpoints',
      'A02: Cryptographic Failures — verify sensitive data encryption at rest and in transit',
      'A03: Injection — verify input validation and parameterized queries',
      'A04: Insecure Design — verify threat modeling and secure design patterns',
      'A05: Security Misconfiguration — verify default credentials removed, headers set',
      'A06: Vulnerable Components — verify dependency scanning, no known CVEs',
      'A07: Authentication Failures — verify MFA support, session management, credential storage',
      'A08: Software and Data Integrity — verify CI/CD pipeline integrity, signed updates',
      'A09: Logging and Monitoring — verify security events logged, alerts configured',
      'A10: SSRF — verify server-side request validation, allowlists',
    ],
  },
  'owasp-asvs-l1': {
    name: 'OWASP ASVS Level 1',
    category: 'security',
    description: 'Application Security Verification Standard — automated testing level',
    applicable_to: ['web', 'api', 'all'],
    level: 'foundational',
    url: 'https://owasp.org/www-project-application-security-verification-standard/',
    checklist: [
      'V1: Architecture — verify security architecture documentation exists',
      'V2: Authentication — verify credential storage uses approved hashing',
      'V3: Session Management — verify session tokens are random, expire, and rotate',
      'V4: Access Control — verify principle of least privilege enforced',
      'V5: Validation — verify all input validated server-side',
      'V7: Cryptography — verify no hardcoded secrets or weak algorithms',
      'V8: Data Protection — verify sensitive data classified and protected',
      'V11: HTTP Security — verify security headers set (CSP, HSTS, X-Frame)',
      'V13: API Security — verify API authentication, rate limiting, input validation',
      'V14: Configuration — verify default credentials changed, debug disabled',
    ],
  },
  'owasp-llm-top10': {
    name: 'OWASP Top 10 for LLM Applications (2025)',
    category: 'security',
    description: 'Security risks specific to LLM/AI applications',
    applicable_to: ['ai', 'llm', 'all'],
    level: 'specialized',
    url: 'https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/',
    checklist: [
      'LLM01: Prompt Injection — verify input sanitization and prompt boundaries',
      'LLM02: Sensitive Information Disclosure — verify no PII/secrets in outputs',
      'LLM03: Supply Chain — verify model and dependency provenance',
      'LLM04: Data and Model Poisoning — verify training data integrity',
      'LLM05: Improper Output Handling — verify output validation before use',
      'LLM06: Excessive Agency — verify tool-use permissions and boundaries',
      'LLM07: System Prompt Leakage — verify system prompts not extractable',
      'LLM08: Vector and Embedding Weaknesses — verify embedding pipeline security',
      'LLM09: Misinformation — verify output accuracy validation mechanisms',
      'LLM10: Unbounded Consumption — verify rate limits and resource caps',
    ],
  },
  'owasp-agentic-top10': {
    name: 'OWASP Top 10 for Agentic Applications (2026)',
    category: 'security',
    description: 'Security risks for autonomous AI agent systems',
    applicable_to: ['ai', 'agent', 'all'],
    level: 'specialized',
    url: 'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/',
    checklist: [
      'AG01: Agent Goal Hijacking — verify goal integrity and boundary enforcement',
      'AG02: Tool Misuse — verify tool permissions, input validation, output checking',
      'AG03: Privilege Escalation — verify agent runs with minimum required permissions',
      'AG04: Memory Corruption — verify agent memory integrity and poisoning resistance',
      'AG05: Inter-Agent Communication — verify secure messaging between agents',
      'AG06: Cascading Hallucination — verify cross-agent output validation',
      'AG07: Denial of Service — verify resource limits and timeout enforcement',
      'AG08: Repudiation — verify audit logging for all agent actions',
      'AG09: Data Exfiltration — verify output boundaries and data classification',
      'AG10: Uncontrolled Autonomy — verify human-in-the-loop checkpoints',
    ],
  },
  'wcag-22': {
    name: 'WCAG 2.2 (Level AA)',
    category: 'accessibility',
    description: 'Web Content Accessibility Guidelines for inclusive design',
    applicable_to: ['web', 'ui', 'all'],
    level: 'foundational',
    url: 'https://www.w3.org/TR/WCAG22/',
    checklist: [
      'Perceivable — verify text alternatives for non-text content',
      'Perceivable — verify captions/alternatives for audio and video',
      'Perceivable — verify content adaptable without loss of information',
      'Perceivable — verify sufficient color contrast (4.5:1 for text)',
      'Operable — verify all functionality available from keyboard',
      'Operable — verify no content causes seizures or physical reactions',
      'Operable — verify users can navigate and find content easily',
      'Understandable — verify text is readable and predictable',
      'Understandable — verify input assistance and error prevention',
      'Robust — verify compatibility with assistive technologies',
    ],
  },
  'nist-ssdf': {
    name: 'NIST Secure Software Development Framework',
    category: 'security',
    description: 'NIST SP 800-218 practices for secure SDLC',
    applicable_to: ['all'],
    level: 'organizational',
    url: 'https://csrc.nist.gov/projects/ssdf',
    checklist: [
      'PO: Prepare — define security requirements and roles',
      'PS: Protect Software — protect all code and build components from tampering',
      'PW: Produce Well-Secured Software — design and code with security in mind',
      'PW: Produce — review and test code for vulnerabilities before release',
      'RV: Respond to Vulnerabilities — monitor, triage, and remediate discovered flaws',
    ],
  },
  'iso-25010': {
    name: 'ISO/IEC 25010 Software Quality Model',
    category: 'quality',
    description: 'Eight quality characteristics for software product quality',
    applicable_to: ['all'],
    level: 'organizational',
    url: 'https://iso25000.com/index.php/en/iso-25000-standards/iso-25010',
    checklist: [
      'Functional Suitability — verify completeness, correctness, and appropriateness',
      'Performance Efficiency — verify time behavior, resource utilization, and capacity',
      'Compatibility — verify co-existence and interoperability',
      'Usability — verify learnability, operability, and error protection',
      'Reliability — verify maturity, availability, fault tolerance, and recoverability',
      'Security — verify confidentiality, integrity, non-repudiation, and accountability',
      'Maintainability — verify modularity, reusability, analysability, and testability',
      'Portability — verify adaptability, installability, and replaceability',
    ],
  },
  'stride': {
    name: 'STRIDE Threat Modeling',
    category: 'security',
    description: 'Systematic threat identification across six categories',
    applicable_to: ['all'],
    level: 'foundational',
    url: 'https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats',
    checklist: [
      'Spoofing — verify authentication mechanisms prevent identity impersonation',
      'Tampering — verify integrity checks protect data and code from modification',
      'Repudiation — verify audit logging provides non-repudiation',
      'Information Disclosure — verify sensitive data protected in transit and at rest',
      'Denial of Service — verify rate limiting, resource caps, and graceful degradation',
      'Elevation of Privilege — verify least privilege and proper authorization boundaries',
    ],
  },
  'cwe-top25': {
    name: 'CWE Top 25 Most Dangerous Software Weaknesses',
    category: 'security',
    description: 'MITRE\'s most critical software weaknesses by prevalence and severity',
    applicable_to: ['all'],
    level: 'foundational',
    url: 'https://cwe.mitre.org/top25/',
    checklist: [
      'CWE-787/CWE-125: Memory Safety — verify bounds checking on all buffer operations',
      'CWE-79: XSS — verify output encoding and Content-Security-Policy',
      'CWE-89: SQL Injection — verify parameterized queries exclusively',
      'CWE-416/CWE-476: Use-After-Free/Null Deref — verify pointer and reference safety',
      'CWE-20: Improper Input Validation — verify all inputs validated and sanitized',
      'CWE-78: OS Command Injection — verify no shell metacharacter injection possible',
      'CWE-22: Path Traversal — verify path normalization and boundary enforcement',
      'CWE-352: CSRF — verify anti-CSRF tokens on state-changing requests',
      'CWE-434: Unrestricted Upload — verify file type and size validation',
      'CWE-862/CWE-863: Missing Authorization — verify access control on all resources',
    ],
  },
  'soc2-dev': {
    name: 'SOC 2 Development Controls',
    category: 'process',
    description: 'Software development practices for SOC 2 compliance',
    applicable_to: ['all'],
    level: 'organizational',
    url: 'https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2',
    checklist: [
      'Change Management — verify all changes tracked in version control with approval',
      'Code Review — verify peer review required before merge',
      'Testing — verify automated test suite runs on every change',
      'Vulnerability Management — verify dependency scanning and remediation process',
      'Incident Response — verify documented process for security incidents',
      'Access Control — verify least-privilege access to code repositories and infrastructure',
    ],
  },
  'togaf-adm': {
    name: 'TOGAF Architecture Development Method',
    category: 'architecture',
    description: 'Enterprise architecture governance framework',
    applicable_to: ['enterprise', 'all'],
    level: 'organizational',
    url: 'https://www.opengroup.org/togaf',
    checklist: [
      'Architecture Vision — verify stakeholders and scope are defined',
      'Business Architecture — verify business capabilities mapped to system features',
      'Information Systems Architecture — verify data and application architecture documented',
      'Technology Architecture — verify infrastructure and deployment architecture documented',
      'Opportunities and Solutions — verify transition architectures and implementation plan',
      'Architecture Governance — verify compliance review process established',
    ],
  },
  'conventional-commits': {
    name: 'Conventional Commits',
    category: 'process',
    description: 'Structured commit message specification for automated changelogs',
    applicable_to: ['all'],
    level: 'foundational',
    url: 'https://www.conventionalcommits.org/',
    checklist: [
      'Format — verify commits use type(scope): description format',
      'Types — verify correct type used (feat, fix, docs, test, refactor, chore)',
      'Breaking Changes — verify BREAKING CHANGE footer or ! after type for breaking changes',
      'Scope — verify scope identifies the component or module affected',
    ],
  },
};

/** Project-type to recommended standards mapping */
const STANDARDS_RECOMMENDATIONS = {
  web: ['owasp-top10', 'wcag-22', 'owasp-asvs-l1'],
  api: ['owasp-top10', 'owasp-asvs-l1', 'stride'],
  ai: ['owasp-llm-top10', 'owasp-top10', 'stride'],
  agent: ['owasp-agentic-top10', 'owasp-llm-top10', 'stride'],
  enterprise: ['togaf-adm', 'iso-25010', 'owasp-top10'],
  cli: ['cwe-top25', 'stride', 'conventional-commits'],
  general: ['owasp-top10', 'stride', 'conventional-commits'],
};

/** Keywords in phase content that map to relevant standard IDs */
const PHASE_KEYWORDS_TO_STANDARDS = {
  auth: ['owasp-top10', 'owasp-asvs-l1'],
  login: ['owasp-top10', 'owasp-asvs-l1'],
  session: ['owasp-top10', 'owasp-asvs-l1'],
  password: ['owasp-top10', 'owasp-asvs-l1'],
  encrypt: ['owasp-top10', 'nist-ssdf'],
  security: ['owasp-top10', 'stride', 'nist-ssdf'],
  injection: ['owasp-top10', 'cwe-top25'],
  xss: ['owasp-top10', 'cwe-top25'],
  sql: ['owasp-top10', 'cwe-top25'],
  api: ['owasp-top10', 'owasp-asvs-l1'],
  endpoint: ['owasp-top10', 'owasp-asvs-l1'],
  accessibility: ['wcag-22'],
  a11y: ['wcag-22'],
  aria: ['wcag-22'],
  'screen reader': ['wcag-22'],
  llm: ['owasp-llm-top10'],
  'ai model': ['owasp-llm-top10'],
  prompt: ['owasp-llm-top10'],
  agent: ['owasp-agentic-top10'],
  autonomous: ['owasp-agentic-top10'],
  'tool use': ['owasp-agentic-top10'],
  architecture: ['togaf-adm', 'iso-25010'],
  governance: ['togaf-adm', 'soc2-dev'],
  compliance: ['soc2-dev', 'nist-ssdf'],
  audit: ['soc2-dev'],
  quality: ['iso-25010'],
  performance: ['iso-25010'],
  reliability: ['iso-25010'],
  threat: ['stride'],
  'threat model': ['stride'],
  commit: ['conventional-commits'],
  changelog: ['conventional-commits'],
  vulnerability: ['cwe-top25', 'owasp-top10'],
  buffer: ['cwe-top25'],
  overflow: ['cwe-top25'],
};

/** External scanning tool recommendations per standard */
const STANDARDS_EXTERNAL_TOOLS = {
  'owasp-top10': [
    { name: 'OWASP ZAP', url: 'https://www.zaproxy.org/', description: 'Dynamic application security scanner' },
    { name: 'Semgrep', url: 'https://semgrep.dev/', description: 'Static analysis with OWASP rule packs' },
  ],
  'owasp-asvs-l1': [
    { name: 'OWASP ZAP', url: 'https://www.zaproxy.org/', description: 'Automated ASVS verification' },
    { name: 'Semgrep', url: 'https://semgrep.dev/', description: 'Static ASVS rule validation' },
  ],
  'owasp-llm-top10': [
    { name: 'Garak', url: 'https://github.com/leondz/garak', description: 'LLM vulnerability scanner' },
    { name: 'Rebuff', url: 'https://github.com/protectai/rebuff', description: 'Prompt injection detection' },
  ],
  'owasp-agentic-top10': [
    { name: 'Garak', url: 'https://github.com/leondz/garak', description: 'LLM/agent vulnerability scanner' },
  ],
  'wcag-22': [
    { name: 'axe-core', url: 'https://github.com/dequelabs/axe-core', description: 'Accessibility testing engine' },
    { name: 'Pa11y', url: 'https://pa11y.org/', description: 'Automated accessibility testing CLI' },
    { name: 'Lighthouse', url: 'https://developer.chrome.com/docs/lighthouse', description: 'Chrome accessibility audit' },
  ],
  'nist-ssdf': [
    { name: 'SonarQube', url: 'https://www.sonarsource.com/products/sonarqube/', description: 'Code quality and security platform' },
  ],
  'iso-25010': [
    { name: 'SonarQube', url: 'https://www.sonarsource.com/products/sonarqube/', description: 'Quality characteristics measurement' },
  ],
  'stride': [
    { name: 'Microsoft Threat Modeling Tool', url: 'https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool', description: 'STRIDE-based threat modeling' },
    { name: 'OWASP Threat Dragon', url: 'https://owasp.org/www-project-threat-dragon/', description: 'Open-source threat modeling' },
  ],
  'cwe-top25': [
    { name: 'Semgrep', url: 'https://semgrep.dev/', description: 'CWE-aware static analysis' },
    { name: 'CodeQL', url: 'https://codeql.github.com/', description: 'GitHub semantic code analysis' },
  ],
  'soc2-dev': [
    { name: 'Drata', url: 'https://drata.com/', description: 'Continuous SOC 2 compliance automation' },
    { name: 'Vanta', url: 'https://www.vanta.com/', description: 'Automated compliance monitoring' },
  ],
  'togaf-adm': [],
  'conventional-commits': [
    { name: 'commitlint', url: 'https://commitlint.js.org/', description: 'Commit message linting' },
    { name: 'Husky', url: 'https://typicode.github.io/husky/', description: 'Git hooks for commit validation' },
  ],
};

// ─── Magic number constants ──────────────────────────────────────────────────

/** Focus budget limits by mode */
const BUDGET_LIMIT_BUGFIX = 40;
const BUDGET_LIMIT_FULL = 60;

/** Focus allocation ratios */
const STABILITY_RATIO = 0.6;
const FEATURE_RATIO = 0.8;

/** Efficiency drop threshold for optimize category diminishing-returns stop */
const DIMINISHING_RETURNS_THRESHOLD = 0.3;

/** Template complexity thresholds */
const SIMPLE_TASK_THRESHOLD = 2;
const SIMPLE_FILE_THRESHOLD = 3;
const COMPLEX_TASK_THRESHOLD = 5;
const COMPLEX_FILE_THRESHOLD = 6;

/** Token estimation: average characters per token */
const CHARS_PER_TOKEN = 4;

/** Health status values for project validation */
const HEALTH_STATUS = { HEALTHY: 'healthy', DEGRADED: 'degraded', BROKEN: 'broken' };

/** Max JSON payload size before writing to tmpfile (bytes) */
const MAX_JSON_SIZE = 50000;

/** Width of progress bar in status display (character count) */
const PROGRESS_BAR_WIDTH = 10;

/** Max slug length for phase names */
const MAX_SLUG_LENGTH = 40;

/** Context window size in tokens (Claude's effective window) */
const CONTEXT_WINDOW = 200000;

/** Budget warning threshold (fraction of context window) */
const WARNING_THRESHOLD = 0.6;

/** Budget critical threshold (fraction of context window) */
const CRITICAL_THRESHOLD = 0.8;

/** Focus budget validation bounds */
const BUDGET_MIN = 5;
const BUDGET_MAX = 100;
const MAX_CYCLES_MIN = 1;
const MAX_CYCLES_MAX = 50;
const TOTAL_BUDGET_MIN = 5;
const TOTAL_BUDGET_MAX = 5000;

// Memory read/budget (ADR-0036 FW-2/FW-3): distill-and-select on the memory axis.
const MEMORY_SELECT_BUDGET_TOKENS = 2000; // per-agent cap for cue-scoped memory injection
const MEMORY_RECENCY_FLOOR = 5;           // always keep this many newest entries (recall never empty)
const MEMORY_SOFT_CAP_MULT = 2;           // soft auto-compaction trigger = DEFAULT_MAX_ENTRIES × this
const MEMORY_LOAD_WARN_TOKENS = 4000;     // memory-budget telemetry: warn threshold (absolute tokens)
const MEMORY_LOAD_CRIT_TOKENS = 8000;     // memory-budget telemetry: critical threshold (absolute tokens)
const MEMORY_LOAD_MAX_FRACTION = 0.15;    // memory-budget telemetry: max fraction of median agent input

// Hygiene — project cleanup + version alignment (docs/FIELD-HARVEST-2026-07.md follow-ups).
const HYGIENE_TRACE_RETENTION_DAYS = 30;  // trace sessions older than this are prunable…
const HYGIENE_TRACE_KEEP_MIN = 5;         // …but always keep this many newest sessions
const HYGIENE_LEDGER_SUSPECT_RATIO = 0.5; // ledger "poisoned" when suspect fraction ≥ this…
const HYGIENE_LEDGER_MIN_RECORDS = 20;    // …and it has at least this many records
const HYGIENE_TMP_AGE_MS = 60 * 60 * 1000; // .tmp orphans older than 1h are deletable

// Skill-Aligned Decomposition pass (ADR-0038): planner draft ↔ skill-surface alignment.
const SKILL_ALIGN_TOP_K = 3;                    // matches returned per draft task
const SKILL_ALIGN_MIN_SCORE = 1;                // minimum keyword-overlap score to count as a match
const SKILL_ALIGN_VOCAB_BUDGET_TOKENS = 1500;   // cap on the deduped vocabulary hint payload
const SKILL_ALIGN_MAX_TASKS = 50;               // larger drafts are a planning smell — split the phase
const SKILL_ALIGN_CONTENT_CAP = 700;            // chars of file head scored (≈ objective paragraph)

/** Valid conventional commit types */
const VALID_COMMIT_TYPES = ['feat', 'fix', 'docs', 'test', 'refactor', 'chore'];

/** Default sensitive file patterns for commit safety checks */
const DEFAULT_SENSITIVE_PATTERNS = ['\\.env$', '\\.pem$', '\\.key$', 'credentials', 'secret', 'password', 'token'];

// ─── Drift detection ─────────────────────────────────────────────────────────

/** Built-in drift detection rules for PAN Wizard conventions */
const BUILTIN_DRIFT_RULES = [
  { id: 'no-console-log', antiPattern: /\bconsole\.log\b/, message: 'Use output() instead of console.log', severity: 'error', fileGlob: '.cjs' },
  { id: 'no-console-error', antiPattern: /\bconsole\.error\b/, message: 'Use error() instead of console.error', severity: 'error', fileGlob: '.cjs' },
  { id: 'no-existsSync', antiPattern: /\bexistsSync\b/, message: 'Use safeReadFile() or fileAccessible() instead of existsSync', severity: 'warning', fileGlob: '.cjs' },
  { id: 'no-throw-to-user', antiPattern: /\bthrow new Error\b/, message: 'Use error() function instead of throw', severity: 'warning', fileGlob: '.cjs' },
  { id: 'no-raw-path-output', antiPattern: /output\([^)]*path\.join/, message: 'Wrap path.join() in toPosix() for output', severity: 'warning', fileGlob: '.cjs' },
];

/** Drift score verdict bands */
const DRIFT_VERDICTS = [
  { max: 0.2, verdict: 'clean' },
  { max: 0.5, verdict: 'low' },
  { max: 0.8, verdict: 'medium' },
  { max: 1.0, verdict: 'high' },
];

/** Binary file extensions to skip in drift check */
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.lock', '.map']);

/** Max files to check in a single drift-check run */
const DRIFT_MAX_FILES = 100;

/** Max file size (bytes) to check — skip files larger than this */
const DRIFT_MAX_FILE_SIZE = 102400;

/** Severity weights for drift score calculation */
const DRIFT_SEVERITY_WEIGHTS = { error: 3, warning: 1, info: 0.5 };

/** Auto-run status values */
const AUTORUN_STATUSES = {
  INITIALIZED: 'initialized',
  IN_PROGRESS: 'in_progress',
  STOPPED: 'stopped',
  COMPLETED: 'completed',
};

/** Unicode block characters for progress bar */
const FILLED_BLOCK = '\u2588';
const EMPTY_BLOCK = '\u2591';

// ─── Opus 4.7 capability thresholds ─────────────────────────────────────────
// Used by resolveModel to pick tier given cache/thinking/context hints.

/** Context estimate (tokens) above which only 1M-context models (reasoning tier) apply */
const LARGE_CONTEXT_TOKEN_THRESHOLD = 700000;
/** Context estimate below which fast tier is viable for cached + non-thinking work */
const SMALL_CONTEXT_TOKEN_THRESHOLD = 50000;
/** Files whose content is stable across agent calls in a phase — candidates for prompt caching */
const CACHEABLE_CONTEXT_FILES = [
  'project.md',
  'requirements.md',
  'roadmap.md',
  'state.md',
  'standards.md',
];
/** Default thinking budget (tokens) for verification-heavy agents */
const THINKING_BUDGETS = {
  'pan-plan-checker': 8000,
  'pan-verifier': 6000,
  'pan-integration-checker': 6000,
  'pan-reviewer': 4000,
  'pan-debugger': 8000,
  'pan-roadmapper': 4000,
  default: 2000,
};
/** Whether focus-auto should insert a thinking-gated reflection step between cycles */
const REFLECTION_THRESHOLD = {
  enabled_default: false,
  enable_on_tiers: ['reasoning'],
};

module.exports = {
  // Directories
  PLANNING_DIR,
  PHASES_DIR,
  MILESTONES_DIR,
  CODEBASE_DIR,
  QUICK_DIR,
  // Files
  STATE_FILE,
  ROADMAP_FILE,
  CONFIG_FILE,
  PROJECT_FILE,
  REQUIREMENTS_FILE,
  PAUSE_FILE,
  PATTERNS_FILE,
  SESSION_HISTORY_FILE,
  LEARNINGS_FILE,
  // Suffixes
  PLAN_SUFFIX,
  SUMMARY_SUFFIX,
  CONTEXT_SUFFIX,
  RESEARCH_SUFFIX,
  VERIFICATION_SUFFIX,
  UAT_SUFFIX,
  VALIDATION_SUFFIX,
  // File matchers
  isPlanFile,
  isSummaryFile,
  isResearchFile,
  isContextFile,
  isVerificationFile,
  // ID extraction
  getPlanId,
  getSummaryId,
  // Regex patterns
  PHASE_HEADER_RE,
  PHASE_DIR_RE,
  PHASE_NUM_RE,
  FIELD_VALUE_RE,
  ARCHIVE_DIR_RE,
  MILESTONE_VERSION_RE,
  // Focus enums
  PRIORITY_LEVELS,
  EFFORT_SIZES,
  EFFORT_POINTS,
  FOCUS_MODES,
  FOCUS_TIERS,
  FOCUS_DIR,
  AUTO_RUN_FILE,
  FOCUS_CATEGORIES,
  FOCUS_SOURCES,
  DOC_SYNC_FILES,
  COMMAND_RENAME_MAP,
  CATEGORY_PRIORITY_RANGE,
  CATEGORY_DEFAULTS,
  DEFAULT_MAX_CYCLES,
  DEFAULT_TOTAL_BUDGET,
  // Standards
  STANDARDS_FILE,
  STANDARDS_CATEGORIES,
  STANDARDS_CATALOG,
  STANDARDS_RECOMMENDATIONS,
  PHASE_KEYWORDS_TO_STANDARDS,
  STANDARDS_EXTERNAL_TOOLS,
  // Magic numbers
  BUDGET_LIMIT_BUGFIX,
  BUDGET_LIMIT_FULL,
  STABILITY_RATIO,
  FEATURE_RATIO,
  DIMINISHING_RETURNS_THRESHOLD,
  SIMPLE_TASK_THRESHOLD,
  SIMPLE_FILE_THRESHOLD,
  COMPLEX_TASK_THRESHOLD,
  COMPLEX_FILE_THRESHOLD,
  CHARS_PER_TOKEN,
  HEALTH_STATUS,
  MAX_JSON_SIZE,
  PROGRESS_BAR_WIDTH,
  MAX_SLUG_LENGTH,
  FILLED_BLOCK,
  EMPTY_BLOCK,
  // Opus 4.7 capabilities
  LARGE_CONTEXT_TOKEN_THRESHOLD,
  SMALL_CONTEXT_TOKEN_THRESHOLD,
  CACHEABLE_CONTEXT_FILES,
  THINKING_BUDGETS,
  REFLECTION_THRESHOLD,
  CONTEXT_WINDOW,
  WARNING_THRESHOLD,
  CRITICAL_THRESHOLD,
  BUDGET_MIN,
  BUDGET_MAX,
  MAX_CYCLES_MIN,
  MAX_CYCLES_MAX,
  TOTAL_BUDGET_MIN,
  TOTAL_BUDGET_MAX,
  MEMORY_SELECT_BUDGET_TOKENS,
  MEMORY_RECENCY_FLOOR,
  MEMORY_SOFT_CAP_MULT,
  MEMORY_LOAD_WARN_TOKENS,
  MEMORY_LOAD_CRIT_TOKENS,
  MEMORY_LOAD_MAX_FRACTION,
  // Hygiene
  HYGIENE_TRACE_RETENTION_DAYS,
  HYGIENE_TRACE_KEEP_MIN,
  HYGIENE_LEDGER_SUSPECT_RATIO,
  HYGIENE_LEDGER_MIN_RECORDS,
  HYGIENE_TMP_AGE_MS,
  // Skill-Aligned Decomposition (ADR-0038)
  SKILL_ALIGN_TOP_K,
  SKILL_ALIGN_MIN_SCORE,
  SKILL_ALIGN_VOCAB_BUDGET_TOKENS,
  SKILL_ALIGN_MAX_TASKS,
  SKILL_ALIGN_CONTENT_CAP,
  // Commit
  VALID_COMMIT_TYPES,
  DEFAULT_SENSITIVE_PATTERNS,
  // Auto-run
  AUTORUN_STATUSES,
  // Drift detection
  BUILTIN_DRIFT_RULES,
  DRIFT_VERDICTS,
  BINARY_EXTENSIONS,
  DRIFT_MAX_FILES,
  DRIFT_MAX_FILE_SIZE,
  DRIFT_SEVERITY_WEIGHTS,
};
