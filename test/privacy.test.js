import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('browser runtime has no remote data or tracking calls', () => {
  const source = read('../src/main.js') + read('../src/chess-state.js') + read('../index.html');
  assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon)\b/);
  assert.doesNotMatch(source, /https?:\/\/(?!github\.com\/dxnnystyles)/);
  assert.match(source, /localStorage/);
});

test('public project checkout contains no Studio, agent, or secret configuration files', () => {
  const forbidden = /^(AGENTS\.md|CLAUDE\.md|studio-os\.json|\.env(?:\..*)?|.*(?:PRODUCT_SPEC|CONTRIBUTIONS|studio|codex|agent).*\.(?:md|json))$/i;
  const files = [];
  function visit(path, prefix = '') {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const rel = join(prefix, entry.name); if (entry.isDirectory()) visit(join(path, entry.name), rel); else files.push(rel);
    }
  }
  visit(fileURLToPath(new URL('..', import.meta.url)));
  assert.deepEqual(files.filter((path) => forbidden.test(path)), []);
  assert.equal(files.some((path) => path.endsWith('.env')), false);
});
