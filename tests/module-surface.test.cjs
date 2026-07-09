// Compatibility harness for module decomposition (IMPROVEMENT-TODO P2,
// "Large Module Decomposition"). Pins the export surface — names AND types —
// of every core module against tests/fixtures/module-surface.json, so
// splitting a large module into submodules behind a facade is verifiably
// lossless at the API boundary. The behavioral half of the contract is the
// rest of the suite (unit + contract + scenario tests).
//
// When an export is ADDED or intentionally removed, regenerate the fixture:
//
//   node -e "const fs=require('fs');const dir='pan-wizard-core/bin/lib';const out={};for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.cjs')).sort()){const m=require('./'+dir+'/'+f);out[f]=Object.keys(m).sort().map(k=>k+':'+typeof m[k]);}fs.writeFileSync('tests/fixtures/module-surface.json',JSON.stringify(out,null,2)+'\n');"
//
// and include the fixture diff in the same commit as the API change.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const LIB_DIR = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'lib');
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'module-surface.json');

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
const libModules = fs.readdirSync(LIB_DIR).filter(f => f.endsWith('.cjs')).sort();

describe('module surface — decomposition compatibility harness', () => {
  test('fixture covers exactly the set of lib modules', () => {
    assert.deepEqual(
      Object.keys(fixture).sort(),
      libModules,
      'lib/*.cjs and the fixture disagree — new/removed module? Regenerate the fixture (see header).'
    );
  });

  for (const moduleName of libModules) {
    test(`${moduleName} export surface matches the pin`, () => {
      const mod = require(path.join(LIB_DIR, moduleName));
      const live = Object.keys(mod).sort().map(k => `${k}:${typeof mod[k]}`);
      assert.deepEqual(
        live,
        fixture[moduleName] || [],
        `${moduleName} export surface drifted — intentional API change? Regenerate the fixture (see header).`
      );
    });
  }
});
