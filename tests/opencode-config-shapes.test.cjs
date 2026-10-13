/**
 * OpenCode config in both shapes (R47).
 *
 * OpenCode 2 reads the v1 `permission` object and `mcp.<name>` servers, but a user
 * may convert their opencode.json to the v2 shapes: an ordered `permissions[]` of
 * {action, resource, effect} and servers nested under `mcp.servers`. PAN keeps
 * writing v1 into a v1 or new file. In a converted file it updates the native
 * entries and never adds a legacy key beside one, and uninstall strips PAN's
 * entries from both shapes.
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../bin/install-lib.cjs');
const { installInto, cleanup } = require('./helpers.cjs');

const PAN_PATH = '/proj/.opencode/pan-wizard-core/*';
const ENTRY = { type: 'local', command: ['node', '/x/server.cjs'], environment: {} };

describe('permissions — v1 stays v1, v2 stays v2', () => {
  test('a new file gets the v1 permission object', () => {
    const { config, modified, shape } = lib.addOpencodePermissions({}, PAN_PATH);
    assert.equal(shape, 'v1');
    assert.equal(modified, true);
    assert.deepEqual(config.permission, { read: { [PAN_PATH]: 'allow' }, external_directory: { [PAN_PATH]: 'allow' } });
    assert.equal('permissions' in config, false);
  });

  test('a v2 file gets rules in its permissions array and no legacy object; a repeat adds nothing', () => {
    const user = { action: 'shell', resource: '*', effect: 'ask' };
    const first = lib.addOpencodePermissions({ permissions: [user] }, PAN_PATH);
    assert.equal(first.shape, 'v2');
    assert.equal('permission' in first.config, false, 'never a legacy key beside the native one');
    assert.deepEqual(first.config.permissions, [user,
      { action: 'read', resource: PAN_PATH, effect: 'allow' },
      { action: 'external_directory', resource: PAN_PATH, effect: 'allow' }]);
    const again = lib.addOpencodePermissions(first.config, PAN_PATH);
    assert.equal(again.modified, false);
    assert.equal(again.config.permissions.length, 3);
  });

  test('strip removes PAN entries from both shapes, keeps the user\'s, and drops emptied containers', () => {
    const cfg = {
      permission: { read: { [PAN_PATH]: 'allow', '/mine/*': 'allow' }, external_directory: { '~/.config/opencode/pan-wizard/*': 'allow' } },
      permissions: [{ action: 'shell', resource: '*', effect: 'ask' }, { action: 'read', resource: PAN_PATH, effect: 'allow' }],
    };
    const { config, modified } = lib.stripOpencodePermissions(cfg);
    assert.equal(modified, true);
    assert.deepEqual(config.permission, { read: { '/mine/*': 'allow' } });
    assert.deepEqual(config.permissions, [{ action: 'shell', resource: '*', effect: 'ask' }]);
    const onlyPan = lib.stripOpencodePermissions({ permissions: [{ action: 'read', resource: PAN_PATH, effect: 'allow' }] });
    assert.equal('permissions' in onlyPan.config, false);
  });

  test('strip on a config with nothing of PAN\'s changes nothing', () => {
    const cfg = { permissions: [{ action: 'shell', resource: '*', effect: 'ask' }], theme: 'x' };
    assert.equal(lib.stripOpencodePermissions(cfg).modified, false);
  });
});

describe('MCP — mcp.pan in v1, mcp.servers.pan in v2, never both', () => {
  test('v1: the server goes under mcp', () => {
    const c = lib.mergeMcpRegistration({ mcp: { other: { type: 'local', command: ['x'] } } }, 'opencode', ENTRY);
    assert.deepEqual(Object.keys(c.mcp).sort(), ['other', 'pan']);
  });

  test('v2: the native entry is updated and a stale legacy mcp.pan is removed', () => {
    const c = lib.mergeMcpRegistration({ mcp: { pan: { type: 'local', command: ['old'] }, servers: { pan: { type: 'local', command: ['stale'] }, mine: { type: 'remote', url: 'u' } } } }, 'opencode', ENTRY);
    assert.deepEqual(c.mcp.servers.pan, ENTRY);
    assert.equal('pan' in c.mcp, false, 'no legacy key beside the native one');
    assert.ok(c.mcp.servers.mine);
  });

  test('a v1 server that happens to be named "servers" is not mistaken for v2', () => {
    const c = lib.mergeMcpRegistration({ mcp: { servers: { type: 'local', command: ['x'] } } }, 'opencode', ENTRY);
    assert.deepEqual(c.mcp.pan, ENTRY);
  });

  test('strip removes mcp.servers.pan and mcp.pan, keeps foreign servers, drops emptied containers', () => {
    const both = lib.stripMcpRegistration({ mcp: { pan: ENTRY, servers: { pan: ENTRY, mine: { type: 'remote', url: 'u' } } } }, 'opencode');
    assert.equal(both.removed, true);
    assert.deepEqual(both.config, { mcp: { servers: { mine: { type: 'remote', url: 'u' } } } });
    const only = lib.stripMcpRegistration({ mcp: { servers: { pan: ENTRY } } }, 'opencode');
    assert.deepEqual(only.config, {});
  });

  test('other runtimes are untouched by the v2 rule', () => {
    const c = lib.mergeMcpRegistration({ mcpServers: { servers: {} } }, 'claude', ENTRY);
    assert.deepEqual(c.mcpServers.pan, ENTRY);
  });
});

describe('a real install on a config the user converted to v2', () => {
  test('reinstall adds no legacy keys; uninstall leaves only the user\'s entries', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ocv2-'));
    try {
      assert.ok(installInto(dir, ['--opencode', '--local']).success);
      const file = path.join(dir, '.opencode', 'opencode.json');
      const v1 = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.ok(v1.permission && v1.mcp && v1.mcp.pan, 'a fresh install writes v1');
      // The user converts the file to the v2 shapes and adds their own entries.
      const panPath = Object.keys(v1.permission.read)[0];
      const v2 = {
        permissions: [{ action: 'shell', resource: '*', effect: 'ask' },
          { action: 'read', resource: panPath, effect: 'allow' }, { action: 'external_directory', resource: panPath, effect: 'allow' }],
        mcp: { servers: { pan: v1.mcp.pan, mine: { type: 'remote', url: 'https://example.com/mcp' } } },
      };
      fs.writeFileSync(file, JSON.stringify(v2, null, 2));
      assert.ok(installInto(dir, ['--opencode', '--local']).success);
      const after = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal('permission' in after, false, 'no legacy permission object');
      assert.equal('pan' in after.mcp, false, 'no legacy mcp.pan');
      assert.ok(after.mcp.servers.pan);
      assert.equal(after.permissions.filter((r) => r.resource === panPath).length, 2, 'no duplicate rules');
      assert.ok(installInto(dir, ['--opencode', '--local', '--uninstall']).success);
      const left = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.deepEqual(left, { permissions: [{ action: 'shell', resource: '*', effect: 'ask' }], mcp: { servers: { mine: { type: 'remote', url: 'https://example.com/mcp' } } } });
    } finally { cleanup(dir); }
  });
});
