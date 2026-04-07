import fs, { promises as fsp, watch, FSWatcher } from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import { DATA_DIR, TIMEZONE } from './config.js';
import { AvailableGroup } from './container-runner.js';
import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
import { isError, isSyntaxError } from './error-utils.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroups: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
  onTasksChanged: () => void;
}

let ipcWatcherRunning = false;
let activeIpcWatchers: FSWatcher[] = [];
let fallbackScanTimer: NodeJS.Timeout | null = null;
const IPC_WATCH_FALLBACK_INTERVAL_MS = 250;

type PendingIpcState = {
  processing: boolean;
  rerun: boolean;
};

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });
  const perGroupWatchers = new Map<string, FSWatcher[]>();
  const pendingByGroup = new Map<string, PendingIpcState>();

  const rememberWatcher = (watcher: FSWatcher): void => {
    activeIpcWatchers.push(watcher);
  };

  const closeWatcher = (watcher: FSWatcher): void => {
    try {
      watcher.close();
    } catch (err) {
      logger.debug({ err }, 'IPC watcher close skipped');
    }
  };

  const moveToErrorDir = async (
    sourceGroup: string,
    file: string,
    filePath: string,
  ): Promise<void> => {
    const errorDir = path.join(ipcBaseDir, 'errors');
    await fsp.mkdir(errorDir, { recursive: true });
    await fsp
      .rename(filePath, path.join(errorDir, `${sourceGroup}-${file}`))
      .catch(() => {});
  };

  const listGroupFolders = async (): Promise<string[]> => {
    const entries = await fsp.readdir(ipcBaseDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name !== 'errors')
      .map((entry) => entry.name);
  };

  const processJsonFiles = async (
    dir: string,
    sourceGroup: string,
    label: 'message' | 'task',
    processor: (data: any) => Promise<void>,
  ): Promise<void> => {
    let files: string[];
    try {
      files = (await fsp.readdir(dir)).filter((file) => file.endsWith('.json'));
    } catch (err) {
      if (isError(err)) {
        logger.error({ err, sourceGroup }, `Error reading IPC ${label}s directory`);
        return;
      }
      throw err;
    }

    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const raw = await fsp.readFile(filePath, 'utf-8');
        const data = JSON.parse(raw);
        await processor(data);
        await fsp.unlink(filePath);
      } catch (err) {
        if (!isError(err) && !isSyntaxError(err)) throw err;
        logger.error(
          { file, sourceGroup, err },
          `Error processing IPC ${label}`,
        );
        await moveToErrorDir(sourceGroup, file, filePath);
      }
    }
  };

  const processGroup = async (sourceGroup: string): Promise<void> => {
    const state = pendingByGroup.get(sourceGroup) ?? {
      processing: false,
      rerun: false,
    };
    pendingByGroup.set(sourceGroup, state);

    if (state.processing) {
      state.rerun = true;
      return;
    }

    state.processing = true;

    try {
      do {
        state.rerun = false;

        const registeredGroups = deps.registeredGroups();
        const isMain = Object.values(registeredGroups).some(
          (group) => group.folder === sourceGroup && group.isMain,
        );
        const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
        const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

        await processJsonFiles(
          messagesDir,
          sourceGroup,
          'message',
          async (data) => {
            if (data.type !== 'message' || !data.chatJid || !data.text) return;

            const targetGroup = registeredGroups[data.chatJid];
            if (isMain || (targetGroup && targetGroup.folder === sourceGroup)) {
              await deps.sendMessage(data.chatJid, data.text);
              logger.info(
                { chatJid: data.chatJid, sourceGroup },
                'IPC message sent',
              );
              return;
            }

            logger.warn(
              { chatJid: data.chatJid, sourceGroup },
              'Unauthorized IPC message attempt blocked',
            );
          },
        );

        await processJsonFiles(tasksDir, sourceGroup, 'task', async (data) => {
          await processTaskIpc(data, sourceGroup, isMain, deps);
        });
      } while (state.rerun);
    } finally {
      state.processing = false;
    }
  };

  const enableFallbackScanning = (): void => {
    if (fallbackScanTimer) return;
    fallbackScanTimer = setInterval(() => {
      void (async () => {
        await refreshGroupWatchers();
      })();
    }, IPC_WATCH_FALLBACK_INTERVAL_MS);
  };

  const ensureGroupWatchers = async (sourceGroup: string): Promise<void> => {
    if (perGroupWatchers.has(sourceGroup)) return;

    const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
    const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');
    await Promise.all([
      fsp.mkdir(messagesDir, { recursive: true }),
      fsp.mkdir(tasksDir, { recursive: true }),
    ]);

    const watchers: FSWatcher[] = [];
    for (const dir of [messagesDir, tasksDir]) {
      let watcher: FSWatcher;
      try {
        watcher = watch(dir, { persistent: false }, (_event, filename) => {
          if (!filename || filename.endsWith('.json')) {
            void processGroup(sourceGroup);
          }
        });
      } catch (err) {
        if (isError(err)) {
          logger.error({ err, sourceGroup, dir }, 'IPC directory watch failed');
          enableFallbackScanning();
          continue;
        }
        throw err;
      }
      watcher.on('error', (err) => {
        logger.error({ err, sourceGroup, dir }, 'IPC directory watcher error');
        enableFallbackScanning();
      });
      watchers.push(watcher);
      rememberWatcher(watcher);
    }

    perGroupWatchers.set(sourceGroup, watchers);
    await processGroup(sourceGroup);
  };

  const refreshGroupWatchers = async (): Promise<void> => {
    let groupFolders: string[];
    try {
      groupFolders = await listGroupFolders();
    } catch (err) {
      if (isError(err)) {
        logger.error({ err }, 'Error reading IPC base directory');
        return;
      }
      throw err;
    }

    const activeGroups = new Set(groupFolders);

    for (const [sourceGroup, watchers] of perGroupWatchers) {
      if (activeGroups.has(sourceGroup)) continue;
      for (const watcher of watchers) closeWatcher(watcher);
      perGroupWatchers.delete(sourceGroup);
      pendingByGroup.delete(sourceGroup);
    }

    await Promise.all(
      groupFolders.map(async (sourceGroup) => {
        await ensureGroupWatchers(sourceGroup);
      }),
    );
    await Promise.all(groupFolders.map((sourceGroup) => processGroup(sourceGroup)));
  };

  let baseWatcher: FSWatcher;
  try {
    baseWatcher = watch(ipcBaseDir, { persistent: false }, () => {
      void refreshGroupWatchers();
    });
  } catch (err) {
    if (isError(err)) {
      logger.error({ err }, 'IPC base watch failed');
      enableFallbackScanning();
      void refreshGroupWatchers();
      logger.info('IPC watcher started (per-group namespaces, fs.watch)');
      return;
    }
    throw err;
  }
  baseWatcher.on('error', (err) => {
    logger.error({ err }, 'IPC base watcher error');
    enableFallbackScanning();
  });
  rememberWatcher(baseWatcher);

  void refreshGroupWatchers();
  logger.info('IPC watcher started (per-group namespaces, fs.watch)');
}

export function _resetIpcWatcherForTests(): void {
  for (const watcher of activeIpcWatchers) {
    try {
      watcher.close();
    } catch {
      // Ignore test cleanup failures from already-closed watchers.
    }
  }
  activeIpcWatchers = [];
  if (fallbackScanTimer) {
    clearInterval(fallbackScanTimer);
    fallbackScanTimer = null;
  }
  ipcWatcherRunning = false;
}

export async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    script?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    requiresTrigger?: boolean;
    containerConfig?: RegisteredGroup['containerConfig'];
  },
  sourceGroup: string, // Verified identity from IPC directory
  isMain: boolean, // Verified from directory path
  deps: IpcDeps,
): Promise<void> {
  const registeredGroups = deps.registeredGroups();

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.targetJid
      ) {
        // Resolve the target group from JID
        const targetJid = data.targetJid as string;
        const targetGroupEntry = registeredGroups[targetJid];

        if (!targetGroupEntry) {
          logger.warn(
            { targetJid },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const targetFolder = targetGroupEntry.folder;

        // Authorization: non-main groups can only schedule for themselves
        if (!isMain && targetFolder !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetFolder },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch (err) {
            if (!isError(err)) throw err;
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const date = new Date(data.schedule_value);
          if (isNaN(date.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = date.toISOString();
        }

        const taskId =
          data.taskId ||
          `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
        createTask({
          id: taskId,
          group_folder: targetFolder,
          chat_jid: targetJid,
          prompt: data.prompt,
          script: data.script || null,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          { taskId, sourceGroup, targetFolder, contextMode },
          'Task created via IPC',
        );
        deps.onTasksChanged();
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
          deps.onTasksChanged();
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
          deps.onTasksChanged();
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
          deps.onTasksChanged();
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'update_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (!task) {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Task not found for update',
          );
          break;
        }
        if (!isMain && task.group_folder !== sourceGroup) {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task update attempt',
          );
          break;
        }

        const updates: Parameters<typeof updateTask>[1] = {};
        if (data.prompt !== undefined) updates.prompt = data.prompt;
        if (data.script !== undefined) updates.script = data.script || null;
        if (data.schedule_type !== undefined)
          updates.schedule_type = data.schedule_type as
            | 'cron'
            | 'interval'
            | 'once';
        if (data.schedule_value !== undefined)
          updates.schedule_value = data.schedule_value;

        // Recompute next_run if schedule changed
        if (data.schedule_type || data.schedule_value) {
          const updatedTask = {
            ...task,
            ...updates,
          };
          if (updatedTask.schedule_type === 'cron') {
            try {
              const interval = CronExpressionParser.parse(
                updatedTask.schedule_value,
                { tz: TIMEZONE },
              );
              updates.next_run = interval.next().toISOString();
            } catch {
              logger.warn(
                { taskId: data.taskId, value: updatedTask.schedule_value },
                'Invalid cron in task update',
              );
              break;
            }
          } else if (updatedTask.schedule_type === 'interval') {
            const ms = parseInt(updatedTask.schedule_value, 10);
            if (!isNaN(ms) && ms > 0) {
              updates.next_run = new Date(Date.now() + ms).toISOString();
            }
          }
        }

        updateTask(data.taskId, updates);
        logger.info(
          { taskId: data.taskId, sourceGroup, updates },
          'Task updated via IPC',
        );
        deps.onTasksChanged();
      }
      break;

    case 'refresh_groups':
      // Only main group can request a refresh
      if (isMain) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await deps.syncGroups(true);
        // Write updated snapshot immediately
        const availableGroups = deps.getAvailableGroups();
        deps.writeGroupsSnapshot(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      } else {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
      }
      break;

    case 'register_group':
      // Only main group can register new groups
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        if (!isValidGroupFolder(data.folder)) {
          logger.warn(
            { sourceGroup, folder: data.folder },
            'Invalid register_group request - unsafe folder name',
          );
          break;
        }
        // Defense in depth: agent cannot set isMain via IPC
        deps.registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
          requiresTrigger: data.requiresTrigger,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}
