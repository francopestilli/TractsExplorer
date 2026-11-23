import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const TEView = require('../../static/view-state.js');
TEView.init(JSON.parse(readFileSync(new URL('../../data/lookups.json', import.meta.url), 'utf8')).view);
const config = JSON.parse(readFileSync(new URL('../../data/config.json', import.meta.url), 'utf8'));
const cfg = { thresholds: config.thresholds, defaultThreshold: config.defaultThreshold };

test('parse basic with value-normalised threshold', () => {
  assert.deepEqual(TEView.parse('?thr=0.15&tab=tract&tract=leftArc', '', cfg),
    { thr: 'thr-15', tab: 'tract', tract: 'leftArc' });
});

test('thr accepts folder and default', () => {
  assert.equal(TEView.parse('?thr=thr-15_5clusters', '', cfg).thr, 'thr-15_5clusters');
  assert.equal(TEView.parse('?thr=default', '', cfg).thr, 'thr-15');
  assert.equal(TEView.parse('?thr=0.2', '', cfg).thr, 'thr-20');
});

test('invalid values are dropped', () => {
  assert.deepEqual(TEView.parse('?thr=0.99&cluster=-2&view=sideways&tract=<b>', '', cfg), {});
});

test('hash sets tab only if query has none', () => {
  assert.deepEqual(TEView.parse('', '#matrix', cfg), { tab: 'matrix' });
  assert.equal(TEView.parse('?tab=tract', '#matrix', cfg).tab, 'tract');
});

test('round trip', () => {
  const p = { thr: 'thr-10', tab: 'cluster', cluster: 3, section: 'networks', atlas: 'TY7', view: 'lateral-left' };
  assert.deepEqual(TEView.parse(TEView.toQuery(p), '', cfg), p);
  assert.equal(TEView.toQuery(p), '?thr=thr-10&tab=cluster&cluster=3&section=networks&view=lateral-left&atlas=TY7');
  assert.equal(TEView.toQuery({}), '');
});

test('fromUrl', () => {
  const base = 'https://brainlife.io/tractexplorer/explorer.html';
  assert.deepEqual(TEView.fromUrl(base + '?cluster=2', base, cfg), { cluster: 2 });
  assert.equal(TEView.fromUrl('https://other.org/tractexplorer/explorer.html?cluster=2', base, cfg), null);
  assert.equal(TEView.fromUrl('https://evil.example/explorer.html?cluster=2', base, cfg), null);
  assert.equal(TEView.fromUrl('https://brainlife.io/tractexplorer/index.html', base, cfg), null);
  assert.equal(TEView.fromUrl('not a url', base, cfg), null);
});
