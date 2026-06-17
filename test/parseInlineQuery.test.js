import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getBotUsername,
  parseInlineQuery,
  ParseError,
  setBotUsername,
} from '../src/helpers/parseInlineQuery.js';

test('rejects negative numeric user ids', () => {
  const parsed = parseInlineQuery('-123 secret');

  assert.equal(parsed.error, ParseError.INVALID_TARGET);
});

test('keeps large numeric user ids as exact strings', () => {
  const parsed = parseInlineQuery('9007199254740993 secret');

  assert.equal(parsed.targetType, 'id');
  assert.equal(parsed.targetNormalized, '9007199254740993');
  assert.equal(parsed.targetId, '9007199254740993');
});

test('normalizes bot username used in hints', () => {
  setBotUsername('<bad>');
  assert.equal(getBotUsername(), 'YourBot');

  setBotUsername('@ValidBot');
  assert.equal(getBotUsername(), 'ValidBot');
});
