import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  buildDailyReport,
  getDailyStats,
  getStatsTimezone,
  resetStatsForTests,
  setStatsEnabled,
  setStatsTimezone,
  trackMessage,
} from '../src/helpers/stats.js';

afterEach(() => {
  resetStatsForTests();
});

test('does not collect stats while stats are disabled', async () => {
  setStatsEnabled(false);

  await trackMessage({
    dateString: '2026-06-17',
    authorId: 1,
    targetNormalized: '2',
    targetPosition: 'front',
    secretTextLength: 10,
    chatType: 'private',
  });

  const stats = await getDailyStats('2026-06-17');
  assert.equal(stats.counters.total_messages || 0, 0);
});

test('invalid stats timezone falls back without breaking tracking', async () => {
  setStatsEnabled(true);
  setStatsTimezone('No/Such_Zone');

  await trackMessage({
    dateString: '2026-06-17',
    authorId: 1,
    targetNormalized: '2',
    targetPosition: 'front',
    secretTextLength: 10,
    chatType: 'private',
  });

  const stats = await getDailyStats('2026-06-17');
  assert.equal(getStatsTimezone(), 'UTC');
  assert.equal(stats.counters.total_messages, 1);
});

test('escapes arbitrary report date text in HTML report output', async () => {
  setStatsEnabled(true);

  const report = await buildDailyReport('2026-06-17<script>');

  assert.match(report, /&lt;script&gt;/);
  assert.doesNotMatch(report, /<script>/);
});
