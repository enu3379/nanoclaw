import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { _initTestDatabase } from './db.js';
import { IpcDeps, processTaskIpc } from './ipc.js';
import { RegisteredGroup } from './types.js';

describe('processTaskIpc github_pr_event', () => {
  let groups: Record<string, RegisteredGroup>;
  let sendMessageMock: Mock<(jid: string, text: string) => Promise<void>>;
  let registerGroupMock: Mock<(jid: string, group: RegisteredGroup) => void>;
  let unregisterGroupMock: Mock<(jid: string, agentType: string) => void>;
  let createThreadMock: Mock<
    (parentJid: string, name: string) => Promise<string>
  >;
  let archiveThreadMock: Mock<(threadJid: string) => Promise<void>>;
  let enqueueSyntheticMessageMock: Mock<
    (chatJid: string, groupFolder: string, text: string) => void
  >;
  let syncGroupsMock: Mock<(force: boolean) => Promise<void>>;
  let writeGroupsSnapshotMock: Mock<
    (
      groupFolder: string,
      isMain: boolean,
      availableGroups: unknown[],
      registeredJids: Set<string>,
    ) => void
  >;
  let onTasksChangedMock: Mock<() => void>;
  let baseDeps: IpcDeps;

  beforeEach(() => {
    _initTestDatabase();

    groups = {
      'dc:parent-channel': {
        name: 'PR Reviews',
        folder: 'pr-reviews',
        trigger: '@claw',
        added_at: '2024-01-01',
        agentType: 'codex',
        requiresTrigger: false,
        isMain: false,
      },
    };

    sendMessageMock = vi
      .fn<(jid: string, text: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    registerGroupMock = vi.fn<(jid: string, group: RegisteredGroup) => void>(
      (jid: string, group: RegisteredGroup) => {
        groups[jid] = group;
      },
    );
    unregisterGroupMock = vi.fn<(jid: string, agentType: string) => void>(
      (jid: string) => {
        delete groups[jid];
      },
    );
    createThreadMock = vi
      .fn<(parentJid: string, name: string) => Promise<string>>()
      .mockResolvedValue('dc:new-thread-id');
    archiveThreadMock = vi
      .fn<(threadJid: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    enqueueSyntheticMessageMock =
      vi.fn<(chatJid: string, groupFolder: string, text: string) => void>();
    syncGroupsMock = vi
      .fn<(force: boolean) => Promise<void>>()
      .mockResolvedValue(undefined);
    writeGroupsSnapshotMock = vi.fn();
    onTasksChangedMock = vi.fn();

    baseDeps = {
      sendMessage: sendMessageMock,
      registeredGroups: () => groups,
      registerGroup: registerGroupMock,
      unregisterGroup: unregisterGroupMock,
      syncGroups: syncGroupsMock,
      getAvailableGroups: () => [],
      writeGroupsSnapshot: writeGroupsSnapshotMock,
      onTasksChanged: onTasksChangedMock,
      createThread: createThreadMock,
      archiveThread: archiveThreadMock,
      enqueueSyntheticMessage: enqueueSyntheticMessageMock,
    };
  });

  it('action=notify creates thread, registers group, sends message, enqueues agent', async () => {
    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'notify',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        headSha: 'abc123',
        prTitle: 'fix auth',
        branch: 'feat/fix-auth',
        author: 'enu3379',
        ciStatus: 'success',
        mergeability: 'mergeable',
        failedChecks: [],
      },
      'main',
      true,
      baseDeps,
    );

    expect(createThreadMock).toHaveBeenCalledWith(
      'dc:parent-channel',
      expect.stringContaining('PR #5'),
    );
    expect(registerGroupMock).toHaveBeenCalledWith(
      'dc:new-thread-id',
      expect.objectContaining({
        agentType: 'codex',
        requiresTrigger: false,
        isMain: false,
      }),
    );
    expect(sendMessageMock).toHaveBeenCalledWith(
      'dc:new-thread-id',
      expect.stringContaining('PR #5'),
    );
    expect(enqueueSyntheticMessageMock).toHaveBeenCalled();
  });

  it('action=notify omits analysis hint when no synthetic enqueue is configured', async () => {
    const depsWithoutSyntheticEnqueue: IpcDeps = {
      ...baseDeps,
      enqueueSyntheticMessage: undefined,
    };

    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'notify',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        headSha: 'abc123',
        ciStatus: 'success',
        mergeability: 'mergeable',
        failedChecks: [],
      },
      'main',
      true,
      depsWithoutSyntheticEnqueue,
    );

    expect(sendMessageMock).toHaveBeenCalledWith(
      'dc:new-thread-id',
      expect.not.stringContaining('Analyzing...'),
    );
  });

  it('action=notify normalizes multiline check and review text in agent prompt', async () => {
    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'notify',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        headSha: 'abc123',
        ciStatus: 'failure',
        mergeability: 'conflicting',
        failedChecks: ['ci'],
        checkResults: [
          {
            name: 'ci',
            status: 'completed',
            conclusion: 'failure',
            summary: 'first line\nsecond line',
          },
        ],
        reviews: [
          {
            author: 'reviewer',
            state: 'CHANGES_REQUESTED',
            body: 'please fix\nthis section',
          },
        ],
      },
      'main',
      true,
      baseDeps,
    );

    expect(enqueueSyntheticMessageMock).toHaveBeenCalledWith(
      'dc:new-thread-id',
      'pr-enu3379-nanoclaw-5',
      expect.stringContaining('- ci: failure — first line second line'),
    );
    expect(enqueueSyntheticMessageMock).toHaveBeenCalledWith(
      'dc:new-thread-id',
      'pr-enu3379-nanoclaw-5',
      expect.stringContaining(
        '- reviewer (CHANGES_REQUESTED): please fix this section',
      ),
    );
  });

  it('action=notify skips when fingerprint matches', async () => {
    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'notify',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        headSha: 'abc123',
        ciStatus: 'success',
        mergeability: 'mergeable',
        failedChecks: [],
      },
      'main',
      true,
      baseDeps,
    );

    sendMessageMock.mockClear();
    enqueueSyntheticMessageMock.mockClear();

    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'notify',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        headSha: 'abc123',
        ciStatus: 'success',
        mergeability: 'mergeable',
        failedChecks: [],
      },
      'main',
      true,
      baseDeps,
    );

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(enqueueSyntheticMessageMock).not.toHaveBeenCalled();
  });

  it('action=notify updates when fingerprint differs without creating a new thread', async () => {
    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'notify',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        headSha: 'abc123',
        ciStatus: 'failure',
        mergeability: 'unknown',
        failedChecks: ['lint'],
      },
      'main',
      true,
      baseDeps,
    );

    sendMessageMock.mockClear();
    createThreadMock.mockClear();

    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'notify',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        headSha: 'def456',
        ciStatus: 'success',
        mergeability: 'mergeable',
        failedChecks: [],
      },
      'main',
      true,
      baseDeps,
    );

    expect(createThreadMock).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalled();
  });

  it('action=notify updates when workflow run changes with same fingerprint fields', async () => {
    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'notify',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        headSha: 'abc123',
        workflowRunId: 100,
        ciStatus: 'success',
        mergeability: 'mergeable',
        failedChecks: [],
      },
      'main',
      true,
      baseDeps,
    );

    sendMessageMock.mockClear();

    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'notify',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        headSha: 'abc123',
        workflowRunId: 101,
        ciStatus: 'success',
        mergeability: 'mergeable',
        failedChecks: [],
      },
      'main',
      true,
      baseDeps,
    );

    expect(sendMessageMock).toHaveBeenCalled();
  });

  it('action=closed archives thread and unregisters group idempotently', async () => {
    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'notify',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        headSha: 'abc',
        ciStatus: 'success',
        mergeability: 'mergeable',
        failedChecks: [],
      },
      'main',
      true,
      baseDeps,
    );

    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'closed',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        merged: true,
      },
      'main',
      true,
      baseDeps,
    );

    expect(unregisterGroupMock).toHaveBeenCalled();
    expect(archiveThreadMock).toHaveBeenCalledWith('dc:new-thread-id');
  });

  it('action=notify creates a new thread when previous one was archived', async () => {
    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'notify',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        headSha: 'abc',
        ciStatus: 'success',
        mergeability: 'mergeable',
        failedChecks: [],
      },
      'main',
      true,
      baseDeps,
    );

    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'closed',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        merged: false,
      },
      'main',
      true,
      baseDeps,
    );

    createThreadMock.mockResolvedValueOnce('dc:replacement-thread');

    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'notify',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        headSha: 'def',
        workflowRunId: 102,
        ciStatus: 'success',
        mergeability: 'mergeable',
        failedChecks: [],
      },
      'main',
      true,
      baseDeps,
    );

    expect(registerGroupMock).toHaveBeenCalledWith(
      'dc:replacement-thread',
      expect.objectContaining({ folder: 'pr-enu3379-nanoclaw-5' }),
    );
    expect(sendMessageMock).toHaveBeenCalledWith(
      'dc:replacement-thread',
      expect.stringContaining('PR #5'),
    );
  });

  it('action=closed is idempotent when thread is not found', async () => {
    await expect(
      processTaskIpc(
        {
          type: 'github_pr_event',
          action: 'closed',
          groupFolder: 'pr-reviews',
          repoFullName: 'enu3379/nanoclaw',
          prNumber: 999,
          merged: false,
        },
        'main',
        true,
        baseDeps,
      ),
    ).resolves.not.toThrow();
  });

  it('action=notify non-main group cannot notify for different groupFolder', async () => {
    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'notify',
        groupFolder: 'pr-reviews',
        repoFullName: 'enu3379/nanoclaw',
        prNumber: 5,
        headSha: 'abc',
        ciStatus: 'success',
        mergeability: 'mergeable',
        failedChecks: [],
      },
      'other-group',
      false,
      baseDeps,
    );

    expect(createThreadMock).not.toHaveBeenCalled();
    expect(registerGroupMock).not.toHaveBeenCalled();
  });

  it('action=notify group folder respects 64-char limit', async () => {
    await processTaskIpc(
      {
        type: 'github_pr_event',
        action: 'notify',
        groupFolder: 'pr-reviews',
        repoFullName:
          'very-long-organization-name/extremely-long-repository-name-that-exceeds-limits',
        prNumber: 123,
        headSha: 'abc',
        ciStatus: 'success',
        mergeability: 'mergeable',
        failedChecks: [],
      },
      'main',
      true,
      baseDeps,
    );

    const registerCall = registerGroupMock.mock.calls[0];
    const folder = registerCall[1].folder;
    expect(folder.length).toBeLessThanOrEqual(64);
    expect(folder).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
  });
});
