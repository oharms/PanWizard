'use strict';

const { output, error, isGitRepo, execGit, loadConfig } = require('./core.cjs');
const { runCommitSafetyChecks, VALID_COMMIT_TYPES } = require('./commands.cjs');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentBranch(cwd) {
  const r = execGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.exitCode === 0 ? r.stdout : null;
}

function getBranchList(cwd, remote) {
  const args = remote
    ? ['branch', '-r', '--format=%(refname:short)']
    : ['branch', '--format=%(refname:short)'];
  const r = execGit(cwd, args);
  if (r.exitCode !== 0) return [];
  return r.stdout.split('\n').map(s => s.trim()).filter(Boolean);
}

function getTagList(cwd, pattern) {
  const args = pattern ? ['tag', '-l', pattern] : ['tag', '-l'];
  const r = execGit(cwd, args);
  if (r.exitCode !== 0) return [];
  return r.stdout.split('\n').map(s => s.trim()).filter(Boolean);
}

function _notGitRepo(raw) {
  output({ error: 'not_a_git_repo', hint: 'Run git init to initialize a repository' }, raw, 'not a git repo');
}

function _noRemote(remote, raw) {
  output({ error: 'no_remote', remote, hint: 'Add a remote with: git remote add origin <url>' }, raw, 'no remote');
}

// ─── Subcommands ─────────────────────────────────────────────────────────────

function cmdGitCommit(cwd, opts, raw) {
  if (!isGitRepo(cwd)) { _notGitRepo(raw); return; }
  const { type, message, all, amend, force, files } = opts || {};
  if (type && !VALID_COMMIT_TYPES.includes(type)) {
    error('Invalid commit type: ' + type + '. Valid: ' + VALID_COMMIT_TYPES.join(', '));
  }
  if (!message && !amend) { error('--message required (or use --amend)'); }

  if (all) execGit(cwd, ['add', '.']);
  else if (files && files.length > 0) {
    for (const f of files) execGit(cwd, ['add', f]);
  }

  const config = loadConfig(cwd);
  const safety = runCommitSafetyChecks(cwd, config, force);
  if (safety.blocked) {
    output({ committed: false, reason: safety.reason, safety_checks: safety.safetyChecks, hint: safety.hint }, raw, 'blocked');
    return;
  }

  const finalMessage = type ? type + ': ' + message : message;
  const commitArgs = amend ? ['commit', '--amend', '--no-edit'] : ['commit', '-m', finalMessage];
  const r = execGit(cwd, commitArgs);
  if (r.exitCode !== 0) {
    if (r.stdout.includes('nothing to commit') || r.stderr.includes('nothing to commit')) {
      output({ committed: false, reason: 'nothing_to_commit' }, raw, 'nothing to commit');
      return;
    }
    output({ committed: false, reason: 'commit_failed', detail: r.stderr }, raw, 'commit failed');
    return;
  }
  const hash = execGit(cwd, ['rev-parse', '--short', 'HEAD']).stdout || null;
  output({ committed: true, hash, type: type || null, safety_checks: safety.safetyChecks }, raw, hash);
}

function cmdGitBranch(cwd, sub, opts, raw) {
  if (!isGitRepo(cwd)) { _notGitRepo(raw); return; }
  const { name, phase, force } = opts || {};

  if (sub === 'current') {
    const branch = getCurrentBranch(cwd);
    output({ branch }, raw, branch || 'unknown');
    return;
  }
  if (sub === 'list') {
    const branches = getBranchList(cwd, false);
    output({ branches, count: branches.length }, raw, branches.join('\n'));
    return;
  }
  if (sub === 'create') {
    const branchName = name || (phase ? 'pan/phase-' + phase : null);
    if (!branchName) { error('--name or --phase required for branch create'); }
    const r = execGit(cwd, ['checkout', '-b', branchName]);
    if (r.exitCode !== 0) {
      output({ created: false, branch: branchName, detail: r.stderr }, raw, 'failed');
      return;
    }
    output({ created: true, branch: branchName }, raw, branchName);
    return;
  }
  if (sub === 'switch') {
    if (!name) { error('--name required for branch switch'); }
    const r = execGit(cwd, ['checkout', name]);
    if (r.exitCode !== 0) {
      output({ switched: false, branch: name, detail: r.stderr }, raw, 'failed');
      return;
    }
    output({ switched: true, branch: name }, raw, name);
    return;
  }
  if (sub === 'delete') {
    if (!name) { error('--name required for branch delete'); }
    const flag = force ? '-D' : '-d';
    const r = execGit(cwd, ['branch', flag, name]);
    if (r.exitCode !== 0) {
      output({ deleted: false, branch: name, detail: r.stderr, hint: force ? null : 'Use --force to delete unmerged branches' }, raw, 'failed');
      return;
    }
    output({ deleted: true, branch: name }, raw, name);
    return;
  }
  error('Unknown branch subcommand. Available: create, switch, list, delete, current');
}

function cmdGitPush(cwd, opts, raw) {
  if (!isGitRepo(cwd)) { _notGitRepo(raw); return; }
  const remote = (opts && opts.remote) || 'origin';
  const branch = (opts && opts.branch) || getCurrentBranch(cwd);
  const force = opts && opts.force;

  const remotes = execGit(cwd, ['remote']).stdout.split('\n').map(s => s.trim()).filter(Boolean);
  if (!remotes.includes(remote)) { _noRemote(remote, raw); return; }

  const pushArgs = ['push', remote, branch];
  if (force) pushArgs.splice(1, 0, '--force');

  const r = execGit(cwd, pushArgs);
  if (r.exitCode !== 0) {
    output({ pushed: false, remote, branch, detail: r.stderr }, raw, 'push failed');
    return;
  }
  output({ pushed: true, remote, branch, force: !!force }, raw, remote + '/' + branch);
}

function cmdGitStatus(cwd, opts, raw) {
  if (!isGitRepo(cwd)) { _notGitRepo(raw); return; }
  const branch = getCurrentBranch(cwd);
  const r = execGit(cwd, ['status', '--porcelain']);
  if (r.exitCode !== 0) {
    output({ error: 'status_failed', detail: r.stderr }, raw, 'status failed');
    return;
  }
  const lines = r.stdout ? r.stdout.split('\n').filter(Boolean) : [];
  let staged = 0, unstaged = 0, untracked = 0;
  for (const line of lines) {
    const xy = line.slice(0, 2);
    if (xy[0] !== ' ' && xy[0] !== '?') staged++;
    if (xy[1] !== ' ' && xy[1] !== '?') unstaged++;
    if (xy === '??') untracked++;
  }
  output({ branch, clean: lines.length === 0, staged_count: staged, unstaged_count: unstaged, untracked_count: untracked, files: lines }, raw, branch + (lines.length === 0 ? ' (clean)' : ' (' + lines.length + ' changes)'));
}

function cmdGitLog(cwd, opts, raw) {
  if (!isGitRepo(cwd)) { _notGitRepo(raw); return; }
  const count = (opts && opts.count) ? parseInt(opts.count, 10) : 10;
  const r = execGit(cwd, ['log', '--oneline', '-' + count]);
  if (r.exitCode !== 0) {
    output({ error: 'log_failed', detail: r.stderr }, raw, 'log failed');
    return;
  }
  const commits = (r.stdout || '').split('\n').filter(Boolean).map(line => {
    const spaceIdx = line.indexOf(' ');
    return { hash: line.slice(0, spaceIdx), message: line.slice(spaceIdx + 1) };
  });
  output({ commits, total: commits.length }, raw, commits.map(c => c.hash + ' ' + c.message).join('\n'));
}

function cmdGitStash(cwd, sub, opts, raw) {
  if (!isGitRepo(cwd)) { _notGitRepo(raw); return; }
  const name = opts && opts.name;
  const index = opts && opts.index;

  if (sub === 'save') {
    const args = name ? ['stash', 'push', '-m', name] : ['stash', 'push'];
    const r = execGit(cwd, args);
    if (r.exitCode !== 0) { output({ stashed: false, detail: r.stderr }, raw, 'stash failed'); return; }
    output({ stashed: true, name: name || null }, raw, 'stashed');
    return;
  }
  if (sub === 'pop') {
    const args = index != null ? ['stash', 'pop', 'stash@{' + index + '}'] : ['stash', 'pop'];
    const r = execGit(cwd, args);
    if (r.exitCode !== 0) { output({ popped: false, detail: r.stderr }, raw, 'pop failed'); return; }
    output({ popped: true }, raw, 'popped');
    return;
  }
  if (sub === 'list') {
    const r = execGit(cwd, ['stash', 'list']);
    const entries = (r.stdout || '').split('\n').filter(Boolean);
    output({ stashes: entries, count: entries.length }, raw, entries.join('\n') || 'no stashes');
    return;
  }
  if (sub === 'drop') {
    const args = index != null ? ['stash', 'drop', 'stash@{' + index + '}'] : ['stash', 'drop'];
    const r = execGit(cwd, args);
    if (r.exitCode !== 0) { output({ dropped: false, detail: r.stderr }, raw, 'drop failed'); return; }
    output({ dropped: true }, raw, 'dropped');
    return;
  }
  error('Unknown stash subcommand. Available: save, pop, list, drop');
}

function cmdGitDiff(cwd, opts, raw) {
  if (!isGitRepo(cwd)) { _notGitRepo(raw); return; }
  const staged = opts && opts.staged;
  const file = opts && opts.file;
  const args = ['diff'];
  if (staged) args.push('--cached');
  if (file) args.push('--', file);
  const r = execGit(cwd, args);
  if (r.exitCode !== 0) { output({ error: 'diff_failed', detail: r.stderr }, raw, 'diff failed'); return; }
  const diff = r.stdout || '';
  const added = (diff.match(/^\+[^+]/gm) || []).length;
  const removed = (diff.match(/^-[^-]/gm) || []).length;
  const filesChanged = (diff.match(/^diff --git/gm) || []).length;
  output({ diff, lines_added: added, lines_removed: removed, files_changed: filesChanged }, raw, '+' + added + '/-' + removed + ' in ' + filesChanged + ' file(s)');
}

function cmdGitRollback(cwd, opts, raw) {
  if (!isGitRepo(cwd)) { _notGitRepo(raw); return; }
  const dryRun = opts && opts.dryRun;
  const requestedTag = opts && opts.tag;

  const tags = getTagList(cwd, 'pan-rollback-*');
  if (tags.length === 0) {
    output({ error: 'no_rollback_tags', hint: 'Create a snapshot with: pan-tools rollback-snapshot' }, raw, 'no rollback tags found');
    return;
  }

  const targetTag = requestedTag || tags[tags.length - 1];
  if (!tags.includes(targetTag)) {
    output({ error: 'tag_not_found', tag: targetTag, available: tags }, raw, 'tag not found');
    return;
  }

  if (!dryRun) {
    const statusR = execGit(cwd, ['status', '--porcelain']);
    if (statusR.stdout) {
      output({ error: 'dirty_working_tree', hint: 'Commit or stash changes before rollback, or use --dry-run' }, raw, 'dirty working tree');
      return;
    }
    const r = execGit(cwd, ['reset', '--hard', targetTag]);
    if (r.exitCode !== 0) {
      output({ rolled_back: false, tag: targetTag, detail: r.stderr }, raw, 'rollback failed');
      return;
    }
  }

  const hash = execGit(cwd, ['rev-parse', '--short', targetTag]).stdout || null;
  output({ rolled_back: !dryRun, tag: targetTag, hash, dry_run: !!dryRun }, raw, (dryRun ? '[dry-run] would reset to ' : 'rolled back to ') + targetTag);
}

function cmdGitTag(cwd, sub, opts, raw) {
  if (!isGitRepo(cwd)) { _notGitRepo(raw); return; }
  const name = opts && opts.name;
  const message = opts && opts.message;
  const pattern = opts && opts.pattern;

  if (sub === 'list') {
    const tags = getTagList(cwd, pattern || null);
    output({ tags, count: tags.length }, raw, tags.join('\n') || 'no tags');
    return;
  }
  if (sub === 'create') {
    if (!name) { error('--name required for tag create'); }
    // tag.gpgsign=true in user config would force signing (and fail outright
    // for lightweight tags) in non-interactive runs — PAN tags are automation
    // markers, so signing is explicitly disabled.
    const args = message
      ? ['-c', 'tag.gpgsign=false', 'tag', '-m', message, name]
      : ['-c', 'tag.gpgsign=false', 'tag', name];
    const r = execGit(cwd, args);
    if (r.exitCode !== 0) {
      output({ created: false, tag: name, detail: r.stderr }, raw, 'tag create failed');
      return;
    }
    output({ created: true, tag: name }, raw, name);
    return;
  }
  if (sub === 'delete') {
    if (!name) { error('--name required for tag delete'); }
    const r = execGit(cwd, ['tag', '-d', name]);
    if (r.exitCode !== 0) {
      output({ deleted: false, tag: name, detail: r.stderr }, raw, 'tag delete failed');
      return;
    }
    output({ deleted: true, tag: name }, raw, name);
    return;
  }
  error('Unknown tag subcommand. Available: list, create, delete');
}

function cmdGitSync(cwd, opts, raw) {
  if (!isGitRepo(cwd)) { _notGitRepo(raw); return; }
  const remote = (opts && opts.remote) || 'origin';
  const branch = (opts && opts.branch) || getCurrentBranch(cwd);
  const rebase = opts && opts.rebase;

  const remotes = execGit(cwd, ['remote']).stdout.split('\n').map(s => s.trim()).filter(Boolean);
  if (!remotes.includes(remote)) { _noRemote(remote, raw); return; }

  const fetchR = execGit(cwd, ['fetch', remote]);
  if (fetchR.exitCode !== 0) {
    output({ synced: false, detail: fetchR.stderr }, raw, 'fetch failed');
    return;
  }

  const pullArgs = rebase ? ['pull', '--rebase', remote, branch] : ['pull', remote, branch];
  const pullR = execGit(cwd, pullArgs);
  if (pullR.exitCode !== 0) {
    output({ synced: false, detail: pullR.stderr }, raw, 'pull failed');
    return;
  }

  const logR = execGit(cwd, ['log', 'HEAD@{1}..HEAD', '--oneline']);
  const newCommits = (logR.stdout || '').split('\n').filter(Boolean);
  output({ synced: true, remote, branch, rebase: !!rebase, commits_received: newCommits.length }, raw, 'synced ' + newCommits.length + ' commit(s) from ' + remote + '/' + branch);
}

// ─── Top-level dispatcher ─────────────────────────────────────────────────────

function cmdGit(cwd, subcommand, args, raw) {
  const sub2 = args[1];
  const getOpt = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : def;
  };
  const hasFlag = flag => args.includes(flag);

  switch (subcommand) {
    case 'commit':
      return cmdGitCommit(cwd, {
        type: getOpt('--type', null),
        message: getOpt('--message', null),
        all: hasFlag('--all'),
        amend: hasFlag('--amend'),
        force: hasFlag('--force'),
        files: args.filter((a, i) => a !== '--type' && a !== '--message' && !a.startsWith('--') && args[i - 1] !== '--type' && args[i - 1] !== '--message'),
      }, raw);
    case 'branch':
      return cmdGitBranch(cwd, sub2, {
        name: getOpt('--name', null),
        phase: getOpt('--phase', null),
        force: hasFlag('--force'),
      }, raw);
    case 'push':
      return cmdGitPush(cwd, {
        remote: getOpt('--remote', null),
        branch: getOpt('--branch', null),
        force: hasFlag('--force'),
      }, raw);
    case 'status':
      return cmdGitStatus(cwd, {}, raw);
    case 'log':
      return cmdGitLog(cwd, { count: getOpt('--count', null) }, raw);
    case 'stash':
      return cmdGitStash(cwd, sub2, {
        name: getOpt('--name', null),
        index: getOpt('--index', null),
      }, raw);
    case 'diff':
      return cmdGitDiff(cwd, {
        staged: hasFlag('--staged'),
        file: getOpt('--file', null),
      }, raw);
    case 'rollback':
      return cmdGitRollback(cwd, {
        tag: getOpt('--tag', null),
        dryRun: hasFlag('--dry-run'),
      }, raw);
    case 'tag':
      return cmdGitTag(cwd, sub2, {
        name: getOpt('--name', null),
        message: getOpt('--message', null),
        pattern: getOpt('--pattern', null),
      }, raw);
    case 'sync':
      return cmdGitSync(cwd, {
        remote: getOpt('--remote', null),
        branch: getOpt('--branch', null),
        rebase: hasFlag('--rebase'),
      }, raw);
    default:
      error('Unknown git subcommand: ' + subcommand + '. Available: commit, branch, push, status, log, stash, diff, rollback, tag, sync');
  }
}

module.exports = {
  cmdGit,
  cmdGitCommit,
  cmdGitBranch,
  cmdGitPush,
  cmdGitStatus,
  cmdGitLog,
  cmdGitStash,
  cmdGitDiff,
  cmdGitRollback,
  cmdGitTag,
  cmdGitSync,
  getCurrentBranch,
  getBranchList,
  getTagList,
};
