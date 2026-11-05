import test from 'node:test';
import assert from 'node:assert/strict';
test('schedule format accepts a conventional GitHub repository', () => {
  const valid = /^([\w.-]+)\/([\w.-]+)$/.test('octocat/hello-world');
  assert.equal(valid, true);
});
test('schedule format rejects an incomplete repository', () => {
  const valid = /^([\w.-]+)\/([\w.-]+)$/.test('octocat');
  assert.equal(valid, false);
});
