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

test('accepts an id: prefixed numeric target', () => {
  const parsed = parseInlineQuery('id:123456789 secret');

  assert.equal(parsed.targetType, 'id');
  assert.equal(parsed.targetNormalized, '123456789');
  assert.equal(parsed.targetPosition, 'front');
});

test('accepts a numeric target written with an @ prefix', () => {
  const parsed = parseInlineQuery('secret @123456789');

  assert.equal(parsed.targetType, 'id');
  assert.equal(parsed.targetNormalized, '123456789');
  assert.equal(parsed.targetPosition, 'back');
});

test('rejects an id: prefixed target that is not a valid user id', () => {
  const parsed = parseInlineQuery('id:0 secret');

  assert.equal(parsed.error, ParseError.INVALID_TARGET);
});

test('resolves @me to the sender id', () => {
  const parsed = parseInlineQuery('@me note to self', { senderId: 42 });

  assert.equal(parsed.targetType, 'id');
  assert.equal(parsed.targetNormalized, '42');
  assert.equal(parsed.secretText, 'note to self');
});

test('rejects @me without a known sender', () => {
  const parsed = parseInlineQuery('@me note to self');

  assert.equal(parsed.error, ParseError.INVALID_TARGET);
});

test('normalizes bot username used in hints', () => {
  setBotUsername('<bad>');
  assert.equal(getBotUsername(), 'YourBot');

  setBotUsername('@ValidBot');
  assert.equal(getBotUsername(), 'ValidBot');
});
