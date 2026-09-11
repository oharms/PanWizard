'use strict';

/**
 * Artifact-first (ADR-0047 D3): pack the repository, extract the tarball, and
 * install FROM THE EXTRACTED PACKAGE — never from the source tree, never via
 * `npx <tgz>` (which exits 0 and silently does nothing with a local tarball on
 * Windows; PanLoop recorded a false pass that way once).
 *
 * The build is identified by CONTENT: package version, repo HEAD and the
 * tarball's SHA-256 all go into the run record, because the released package and
 * a branch build have shared a version string before.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function gitHead(repo) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(); }
  catch { return null; }
}

/**
 * `npm pack` the repo into `dest`, extract it fresh, return the package dir + identity.
 * @param {string} repo - absolute path of the PAN source checkout
 * @param {string} dest - run-scoped directory to pack and extract into
 */
function packAndExtract(repo, dest) {
  fs.mkdirSync(dest, { recursive: true });
  // npm is a .cmd shim on Windows — needs a shell there, and only there.
  const packOut = execFileSync('npm', ['pack', '--pack-destination', dest, '--silent'], {
    cwd: repo, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tgzName = packOut.trim().split(/\r?\n/).filter(Boolean).pop();
  const tgz = path.join(dest, tgzName);
  if (!fs.existsSync(tgz)) throw new Error(`npm pack produced no tarball at ${tgz}`);
  // Always extract into a fresh directory — tar never removes files a newer archive dropped.
  const extractDir = path.join(dest, 'extracted');
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  // Relative names from the artifact dir: GNU tar reads `D:\…` as host `D`
  // ("Cannot connect to D: resolve failed"), and bsdtar lacks --force-local.
  execFileSync('tar', ['-xzf', tgzName, '-C', 'extracted'], { cwd: dest, stdio: ['ignore', 'pipe', 'pipe'] });
  const pkgDir = path.join(extractDir, 'package');
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  return {
    tgz,
    packageDir: pkgDir,
    installer: path.join(pkgDir, 'bin', 'install.js'),
    build: { version: pkg.version, head: gitHead(repo), sha256: sha256(tgz), tarball: tgzName },
  };
}

module.exports = { packAndExtract, sha256, gitHead };
