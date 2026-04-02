import type { RegisteredGroup } from './types.js';

export function shouldQueueFollowUpForNextTurn(
  group: RegisteredGroup,
): boolean {
  return (
    (group.agentType ?? 'claude-code') === 'claude-code' &&
    group.containerConfig?.providerPreset === 'ollama'
  );
}
