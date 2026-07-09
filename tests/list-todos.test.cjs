/**
 * PAN Tools Tests - list-todos command
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

/**
 * Helper: create a todo .md file in the pending directory.
 *
 * @param {string} pendingDir - Absolute path to .planning/todos/pending/
 * @param {string} filename  - File name (e.g. 'fix-login.md')
 * @param {object} fields    - { created, title, area, body }
 */
function writeTodo(pendingDir, filename, { created, title, area, body } = {}) {
  const lines = ['---'];
  if (created !== undefined) lines.push(`created: ${created}`);
  if (title !== undefined) lines.push(`title: ${title}`);
  if (area !== undefined) lines.push(`area: ${area}`);
  lines.push('---');
  if (body !== undefined) {
    lines.push('');
    lines.push(body);
  }
  fs.writeFileSync(path.join(pendingDir, filename), lines.join('\n'));
}

describe('list-todos command', () => {
  let tmpDir;
  let pendingDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // ─── 1. Empty / missing pending directory ──────────────────────────────────

  test('returns empty list when no todos exist', () => {
    // Do NOT create the pending directory at all
    const result = runPanTools('list-todos', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.equal(output.count, 0, 'count should be 0');
    assert.deepEqual(output.todos, [], 'todos should be empty array');
  });

  // ─── 2. Single pending todo ────────────────────────────────────────────────

  test('lists single pending todo', () => {
    fs.mkdirSync(pendingDir, { recursive: true });
    writeTodo(pendingDir, 'fix-login-bug.md', {
      created: '2026-01-15',
      title: 'Fix login bug',
      area: 'security',
      body: 'Description of the todo item.',
    });

    const result = runPanTools('list-todos', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.equal(output.count, 1, 'count should be 1');
    assert.equal(output.todos.length, 1, 'todos array should have 1 item');

    const todo = output.todos[0];
    assert.equal(todo.file, 'fix-login-bug.md', 'file name should match');
    assert.equal(todo.created, '2026-01-15', 'created date should match');
    assert.equal(todo.title, 'Fix login bug', 'title should match');
    assert.equal(todo.area, 'security', 'area should match');
    assert.equal(
      todo.path.replace(/\\/g, '/'),
      '.planning/todos/pending/fix-login-bug.md',
      'path should be relative using PLANNING_DIR'
    );
  });

  // ─── 3. Multiple pending todos ─────────────────────────────────────────────

  test('lists multiple pending todos', () => {
    fs.mkdirSync(pendingDir, { recursive: true });
    writeTodo(pendingDir, 'todo-alpha.md', {
      created: '2026-01-10',
      title: 'Alpha task',
      area: 'general',
    });
    writeTodo(pendingDir, 'todo-beta.md', {
      created: '2026-01-11',
      title: 'Beta task',
      area: 'performance',
    });
    writeTodo(pendingDir, 'todo-gamma.md', {
      created: '2026-01-12',
      title: 'Gamma task',
      area: 'security',
    });

    const result = runPanTools('list-todos', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.equal(output.count, 3, 'count should be 3');
    assert.equal(output.todos.length, 3, 'todos array should have 3 items');

    const titles = output.todos.map(t => t.title).sort();
    assert.deepEqual(titles, ['Alpha task', 'Beta task', 'Gamma task'], 'all titles present');
  });

  // ─── 4. Filters by area ───────────────────────────────────────────────────

  test('filters by area', () => {
    fs.mkdirSync(pendingDir, { recursive: true });
    writeTodo(pendingDir, 'sec-audit.md', {
      created: '2026-02-01',
      title: 'Security audit',
      area: 'security',
    });
    writeTodo(pendingDir, 'sec-patch.md', {
      created: '2026-02-02',
      title: 'Security patch',
      area: 'security',
    });
    writeTodo(pendingDir, 'milestone-cleanup.md', {
      created: '2026-02-03',
      title: 'Code cleanup',
      area: 'general',
    });

    const result = runPanTools('list-todos security', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.equal(output.count, 2, 'count should be 2 (security only)');
    assert.equal(output.todos.length, 2, 'todos array should have 2 items');

    for (const todo of output.todos) {
      assert.equal(todo.area, 'security', `todo "${todo.title}" should have area security`);
    }
  });

  // ─── 5. Returns all when no area filter ────────────────────────────────────

  test('returns all when no area filter', () => {
    fs.mkdirSync(pendingDir, { recursive: true });
    writeTodo(pendingDir, 'task-a.md', {
      created: '2026-03-01',
      title: 'Task A',
      area: 'security',
    });
    writeTodo(pendingDir, 'task-b.md', {
      created: '2026-03-02',
      title: 'Task B',
      area: 'performance',
    });
    writeTodo(pendingDir, 'task-c.md', {
      created: '2026-03-03',
      title: 'Task C',
      area: 'ui',
    });

    const result = runPanTools('list-todos', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.equal(output.count, 3, 'count should be 3 (all areas)');
    assert.equal(output.todos.length, 3, 'todos array should have 3 items');

    const areas = output.todos.map(t => t.area).sort();
    assert.deepEqual(areas, ['performance', 'security', 'ui'], 'all areas represented');
  });

  // ─── 6. Handles todo with missing fields ──────────────────────────────────

  test('handles todo with missing fields', () => {
    fs.mkdirSync(pendingDir, { recursive: true });

    // Write a file with no title, no area, no created -- just the frontmatter delimiters
    fs.writeFileSync(
      path.join(pendingDir, 'bare-todo.md'),
      '---\n---\nSome description without metadata.\n'
    );

    const result = runPanTools('list-todos', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.equal(output.count, 1, 'count should be 1');
    assert.equal(output.todos.length, 1, 'todos array should have 1 item');

    const todo = output.todos[0];
    assert.equal(todo.title, 'Untitled', 'missing title should default to "Untitled"');
    assert.equal(todo.area, 'general', 'missing area should default to "general"');
    assert.equal(todo.created, 'unknown', 'missing created should default to "unknown"');
  });

  // ─── 7. Ignores non-md files in pending dir ───────────────────────────────

  test('ignores non-md files in pending dir', () => {
    fs.mkdirSync(pendingDir, { recursive: true });

    // Write a .txt file that should be ignored
    fs.writeFileSync(
      path.join(pendingDir, 'notes.txt'),
      'created: 2026-01-01\ntitle: Should be ignored\narea: general\n'
    );

    // Write a .json file that should be ignored
    fs.writeFileSync(
      path.join(pendingDir, 'data.json'),
      '{"title": "Also ignored"}\n'
    );

    // Write one valid .md file
    writeTodo(pendingDir, 'real-todo.md', {
      created: '2026-01-20',
      title: 'Real todo',
      area: 'general',
    });

    const result = runPanTools('list-todos', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.equal(output.count, 1, 'count should be 1 (only .md files)');
    assert.equal(output.todos.length, 1, 'todos array should have 1 item');
    assert.equal(output.todos[0].file, 'real-todo.md', 'only the .md file should be listed');
  });
});
