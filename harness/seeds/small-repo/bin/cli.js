#!/usr/bin/env node
'use strict';
const { add } = require('../src/math.js');
const { greet } = require('../src/greet.js');
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'add') { process.stdout.write(String(add(Number(rest[0]), Number(rest[1]))) + '\n'); }
else if (cmd === 'greet') { process.stdout.write(greet(rest[0] || 'world') + '\n'); }
else { process.stderr.write('usage: tiny add <a> <b> | tiny greet <name>\n'); process.exit(2); }
