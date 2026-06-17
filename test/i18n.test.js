import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPPORTED_LANGS, t, translations, validateTranslations } from '../src/helpers/i18n.js';

test('all supported languages have complete translation keys with matching value types', () => {
  assert.deepEqual(validateTranslations(), []);
});

test('translation lookup fails loudly for unknown keys', () => {
  assert.throws(() => t('missingKey', 'en'), /Missing translation/);
});

test('all supported languages are represented in translations', () => {
  for (const lang of SUPPORTED_LANGS) {
    assert.ok(translations[lang]);
  }
});
