import { resolvePreferredOllamaModel } from './model-switch.js';
import { startRemoteControl } from './remote-control.js';
import type { RegisteredGroup } from './types.js';
import { getClaudeAuthStatus } from './claude-auth.js';
import { logger } from './logger.js';

const RECOVERY_POLL_MS = 5000;
const RECOVERY_TIMEOUT_MS = 120000;

export type ClaudeRecoveryState =
  | 'healthy'
  | 'degraded'
  | 'recovering'
  | 'local-fallback';

export interface ClaudeRecoverySnapshot {
  state: ClaudeRecoveryState;
  targetChatJid: string | null;
  recoveryUrl: string | null;
  lastAuthFailure: string | null;
  lastAuthFailureAt: string | null;
  lastRecoveredAt: string | null;
  lastFallbackAt: string | null;
}

interface ClaudeAuthRecoveryDeps {
  getRegisteredGroups: () => Record<string, RegisteredGroup>;
  notifyChat: (chatJid: string, text: string) => Promise<void>;
  activateLocalFallback: (chatJid: string) => Promise<boolean>;
}

export function isClaudeAuthFailure(error?: string | null): boolean {
  return Boolean(
    error &&
    /(not logged in|please run \/login|authentication_failed|oauth token.*expired|expired oauth token)/i.test(
      error,
    ),
  );
}

export class ClaudeAuthRecoveryService {
  private snapshot: ClaudeRecoverySnapshot = {
    state: 'healthy',
    targetChatJid: null,
    recoveryUrl: null,
    lastAuthFailure: null,
    lastAuthFailureAt: null,
    lastRecoveredAt: null,
    lastFallbackAt: null,
  };

  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private recoveringForChat: string | null = null;
  private recoverySequence = 0;

  constructor(private readonly deps: ClaudeAuthRecoveryDeps) {}

  getSnapshot(): ClaudeRecoverySnapshot {
    return { ...this.snapshot };
  }

  private getNotifyChatJid(chatJid: string): string {
    const groups = this.deps.getRegisteredGroups();
    const mainEntry = Object.entries(groups).find(([, group]) => group.isMain);
    return mainEntry?.[0] || chatJid;
  }

  private clearTimers(): void {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private setHealthy(chatJid?: string): boolean {
    if (
      chatJid &&
      this.recoveringForChat &&
      this.recoveringForChat !== chatJid
    ) {
      return false;
    }
    this.clearTimers();
    this.recoveringForChat = null;
    this.snapshot = {
      ...this.snapshot,
      state: 'healthy',
      recoveryUrl: null,
      targetChatJid: null,
      lastRecoveredAt: new Date().toISOString(),
    };
    return true;
  }

  private isActiveRecovery(chatJid: string, sequence: number): boolean {
    return (
      this.snapshot.state === 'recovering' &&
      this.recoveringForChat === chatJid &&
      this.recoverySequence === sequence
    );
  }

  async noteSuccessfulClaudeRun(
    group: RegisteredGroup,
    chatJid: string,
  ): Promise<void> {
    if (group.containerConfig?.providerPreset === 'ollama') return;
    if (this.recoveringForChat && this.recoveringForChat !== chatJid) return;
    const auth = getClaudeAuthStatus({
      providerPreset: group.containerConfig?.providerPreset,
    });
    if (auth.mode === 'oauth' && auth.tokenStatus === 'valid') {
      this.setHealthy(chatJid);
    }
  }

  async handleAuthFailure(
    group: RegisteredGroup,
    chatJid: string,
    error: string,
  ): Promise<void> {
    const notifyChatJid = this.getNotifyChatJid(chatJid);
    const failedAt = new Date().toISOString();

    this.snapshot = {
      ...this.snapshot,
      state: 'degraded',
      targetChatJid: notifyChatJid,
      lastAuthFailure: error,
      lastAuthFailureAt: failedAt,
    };

    if (this.recoveringForChat) {
      logger.warn(
        { activeChat: this.recoveringForChat, requestedChat: chatJid },
        'Claude auth recovery already in progress',
      );
      return;
    }

    this.recoveringForChat = chatJid;
    this.recoverySequence += 1;
    const sequence = this.recoverySequence;
    this.snapshot = {
      ...this.snapshot,
      state: 'recovering',
    };

    const remote = await startRemoteControl(
      'nanoclaw-auth-recovery',
      notifyChatJid,
      process.cwd(),
    );
    if (remote.ok) {
      this.snapshot = {
        ...this.snapshot,
        recoveryUrl: remote.url,
      };
      await this.deps.notifyChat(
        notifyChatJid,
        [
          '**Claude Authentication Recovery**',
          `State: \`recovering\``,
          `Failed group: \`${group.folder}\``,
          `Reason: \`${error}\``,
          'Open the link below on any device and complete the Claude login flow.',
          'Important: after browser approval, Claude may show a one-time code or a `code#state` value that must be pasted back into the waiting CLI prompt (`Paste code here if prompted >`). Browser approval alone may not finish the login.',
          remote.url,
          `NanoClaw will wait ${Math.round(RECOVERY_TIMEOUT_MS / 1000)}s before switching this group to local fallback.`,
        ].join('\n'),
      );
    } else {
      await this.deps.notifyChat(
        notifyChatJid,
        [
          '**Claude Authentication Recovery**',
          `State: \`recovering\``,
          `Failed group: \`${group.folder}\``,
          `Reason: \`${error}\``,
          `Remote Control startup failed: ${remote.error}`,
          `NanoClaw will switch this group to local fallback in ${Math.round(RECOVERY_TIMEOUT_MS / 1000)}s unless Claude auth returns.`,
        ].join('\n'),
      );
    }

    this.pollTimer = setInterval(async () => {
      try {
        if (!this.isActiveRecovery(chatJid, sequence)) return;
        const auth = getClaudeAuthStatus({
          providerPreset: group.containerConfig?.providerPreset,
        });
        if (auth.mode === 'oauth' && auth.tokenStatus === 'valid') {
          if (!this.setHealthy(chatJid)) {
            this.clearTimers();
            return;
          }
          await this.deps.notifyChat(
            notifyChatJid,
            [
              '**Claude Authentication Recovery**',
              'State: `healthy`',
              'Claude credentials are valid again. Future Claude runs will use cloud auth.',
            ].join('\n'),
          );
        }
      } catch (err) {
        if (!(err instanceof Error)) throw err;
        this.clearTimers();
        this.recoveringForChat = null;
        this.snapshot = {
          ...this.snapshot,
          state: 'degraded',
        };
        logger.error({ err, chatJid }, 'Claude auth recovery poll failed');
      }
    }, RECOVERY_POLL_MS);

    this.recoveryTimer = setTimeout(async () => {
      if (!this.isActiveRecovery(chatJid, sequence)) return;
      this.clearTimers();
      const switched = await this.deps.activateLocalFallback(chatJid);
      if (!this.isActiveRecovery(chatJid, sequence)) return;
      if (!switched) {
        this.snapshot = {
          ...this.snapshot,
          state: 'degraded',
        };
        this.recoveringForChat = null;
        await this.deps.notifyChat(
          notifyChatJid,
          [
            '**Claude Authentication Recovery**',
            'State: `degraded`',
            'Claude login timed out and NanoClaw could not switch the affected group to local fallback.',
          ].join('\n'),
        );
        return;
      }

      this.snapshot = {
        ...this.snapshot,
        state: 'local-fallback',
        lastFallbackAt: new Date().toISOString(),
      };
      this.recoveringForChat = null;
      await this.deps.notifyChat(
        notifyChatJid,
        [
          '**Claude Authentication Recovery**',
          'State: `local-fallback`',
          `Claude cloud auth did not recover in time. Switched the affected group to local Ollama fallback (\`${resolvePreferredOllamaModel() || 'default'}\`).`,
          'Return to cloud Claude manually after login is stable.',
        ].join('\n'),
      );
    }, RECOVERY_TIMEOUT_MS);
  }
}
