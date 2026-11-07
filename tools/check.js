'use strict';
// Static checks: JS syntax, local asset references, version consistency.
// Usage: node tools/check.js

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const failures = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(PUBLIC).concat(walk(path.join(ROOT, 'tools')));

for (const file of files.filter(f => f.endsWith('.js'))) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failures.push('syntax: ' + path.relative(ROOT, file) + '\n' + (r.stderr || '').trim());
  }
}

// Every local href/src in index.html must exist.
const htmlPath = path.join(PUBLIC, 'index.html');
if (!fs.existsSync(htmlPath)) {
  failures.push('missing public/index.html');
} else {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(m => m[1])
    .filter(u => !/^(?:https?:|data:|#|mailto:)/.test(u));
  for (const ref of refs) {
    const target = path.resolve(PUBLIC, ref.split(/[?#]/)[0]);
    if (!fs.existsSync(target)) failures.push('missing asset: ' + ref + ' (referenced by index.html)');
  }
}

// TS.VERSION must match package.json.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const config = fs.readFileSync(path.join(PUBLIC, 'js', 'config.js'), 'utf8');
const versionMatch = config.match(/VERSION\s*=\s*'([^']+)'/);
if (!versionMatch) failures.push('TS.VERSION not found in public/js/config.js');
else if (versionMatch[1] !== pkg.version) {
  failures.push('version mismatch: package.json ' + pkg.version + ' vs TS.VERSION ' + versionMatch[1]);
}

if (failures.length) {
  console.error('CHECK FAILED');
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log('CHECK OK (' + files.length + ' files scanned)');
