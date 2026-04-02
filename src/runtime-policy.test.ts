import { describe, expect, it } from 'vitest';

import { shouldQueueFollowUpForNextTurn } from './runtime-policy.js';
import type { RegisteredGroup } from './types.js';

describe('shouldQueueFollowUpForNextTurn', () => {
  it('returns true for Ollama-backed Claude rooms', () => {
    const group: RegisteredGroup = {
      name: 'Claude',
      folder: 'claude',
      trigger: '@claude',
      added_at: '2026-04-02T00:00:00.000Z',
      agentType: 'claude-code',
      containerConfig: {
        providerPreset: 'ollama',
      },
    };

    expect(shouldQueueFollowUpForNextTurn(group)).toBe(true);
  });

  it('returns false for Anthropic-backed Claude rooms', () => {
    const group: RegisteredGroup = {
      name: 'Claude',
      folder: 'claude',
      trigger: '@claude',
      added_at: '2026-04-02T00:00:00.000Z',
      agentType: 'claude-code',
      containerConfig: {
        providerPreset: 'anthropic',
      },
    };

    expect(shouldQueueFollowUpForNextTurn(group)).toBe(false);
  });
});
