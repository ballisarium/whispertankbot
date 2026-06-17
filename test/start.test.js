import assert from 'node:assert/strict';
import test from 'node:test';
import { handleStatsCommand } from '../src/handlers/start.js';

test('stats command rejects invalid date before building report', async () => {
  const replies = [];
  let buildCalled = false;
  const ctx = {
    from: { id: 1, language_code: 'en' },
    message: { text: '/stats 2026-99-99<script>' },
    reply: async (text, options) => replies.push({ text, options }),
  };

  await handleStatsCommand(ctx, true, async () => {
    buildCalled = true;
    return 'report';
  });

  assert.equal(buildCalled, false);
  assert.equal(replies[0]?.text, 'usage: /stats YYYY-MM-DD');
});
