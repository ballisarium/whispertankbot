import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNextRunDelayMs,
  parseAdminIds,
  parseSendAt,
  validateTimezone,
} from '../src/helpers/config.js';

test('falls back to ADMIN_ID when ADMIN_IDS contains no ids', () => {
  assert.deepEqual(parseAdminIds({ ADMIN_IDS: ' , ', ADMIN_ID: ' 123 ' }), ['123']);
});

test('parses invalid stats send time as 09:00', () => {
  assert.deepEqual(parseSendAt('wrong'), { hours: 9, minutes: 0 });
});

test('validates timezone and falls back to UTC', () => {
  assert.equal(validateTimezone('Europe/Kyiv'), 'Europe/Kyiv');
  assert.equal(validateTimezone('No/Such_Zone'), 'UTC');
});

test('computes next stats run in the requested timezone, not host timezone', () => {
  const beforeNineKyiv = new Date('2026-06-17T05:30:00.000Z');
  const afterNineKyiv = new Date('2026-06-17T06:30:00.000Z');

  assert.equal(getNextRunDelayMs('Europe/Kyiv', '09:00', beforeNineKyiv), 30 * 60 * 1000);
  assert.equal(getNextRunDelayMs('Europe/Kyiv', '09:00', afterNineKyiv), 23.5 * 60 * 60 * 1000);
});
