import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStartRemoteControl = vi.fn();
const mockEnsureOllamaServerRunning = vi.fn();
const mockResolvePreferredOllamaModel = vi.fn(() => 'qwen-test');
const mockGetClaudeAuthStatus = vi.fn();

vi.mock('./remote-control.js', () => ({
  startRemoteControl: (...args: unknown[]) => mockStartRemoteControl(...args),
}));

vi.mock('./model-switch.js', () => ({
  ensureOllamaServerRunning: (...args: unknown[]) =>
    mockEnsureOllamaServerRunning(...args),
  resolvePreferredOllamaModel: () => mockResolvePreferredOllamaModel(),
}));

vi.mock('./claude-auth.js', () => ({
  getClaudeAuthStatus: (...args: unknown[]) => mockGetClaudeAuthStatus(...args),
}));

import { ClaudeAuthRecoveryService } from './claude-auth-recovery.js';
import type { RegisteredGroup } from './types.js';

const baseGroup: RegisteredGroup = {
  name: 'Claude Room',
  folder: 'claude-room',
  trigger: '@claude',
  added_at: '2026-04-07T00:00:00.000Z',
  agentType: 'claude-code',
};

describe('ClaudeAuthRecoveryService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockStartRemoteControl.mockResolvedValue({
      ok: true,
      url: 'https://claude.ai/code?bridge=test',
    });
    mockEnsureOllamaServerRunning.mockResolvedValue({ ok: true, started: false });
    mockGetClaudeAuthStatus.mockReturnValue({
      mode: 'oauth',
      tokenStatus: 'missing',
    });
  });

  it('does not run fallback after poll-based recovery succeeds', async () => {
    const notifyChat = vi.fn(async () => {});
    const activateLocalFallback = vi.fn(async () => true);
    const service = new ClaudeAuthRecoveryService({
      getRegisteredGroups: () => ({ 'dc:main': { ...baseGroup, isMain: true } }),
      notifyChat,
      activateLocalFallback,
    });

    await service.handleAuthFailure(baseGroup, 'dc:group', 'not logged in');
    mockGetClaudeAuthStatus.mockReturnValue({
      mode: 'oauth',
      tokenStatus: 'valid',
    });

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(120000);

    expect(service.getSnapshot().state).toBe('healthy');
    expect(activateLocalFallback).not.toHaveBeenCalled();
  });

  it('ignores successful runs from unrelated chats while another recovery is active', async () => {
    const service = new ClaudeAuthRecoveryService({
      getRegisteredGroups: () => ({ 'dc:main': { ...baseGroup, isMain: true } }),
      notifyChat: vi.fn(async () => {}),
      activateLocalFallback: vi.fn(async () => true),
    });

    await service.handleAuthFailure(baseGroup, 'dc:group-a', 'not logged in');
    mockGetClaudeAuthStatus.mockReturnValue({
      mode: 'oauth',
      tokenStatus: 'valid',
    });

    await service.noteSuccessfulClaudeRun(baseGroup, 'dc:group-b');

    expect(service.getSnapshot().state).toBe('recovering');
  });
});
