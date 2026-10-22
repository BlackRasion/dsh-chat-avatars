import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('client.js 与 src/ 拼接结果同步', () => {
  const output = execFileSync(process.execPath, ['scripts/build.mjs', '--check'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  assert.match(output, /已是最新/);
});
