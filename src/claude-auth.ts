import fs from 'fs';
import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';
import { isErrnoException, isSyntaxError } from './error-utils.js';

export type ClaudeAuthMode = 'oauth' | 'api-key' | 'ollama' | 'missing';
export type ClaudeTokenStatus =
  | 'valid'
  | 'expired'
  | 'missing'
  | 'invalid-json';
export type ClaudeAuthSource =
  | 'home-credentials'
  | 'session-credentials'
  | 'env'
  | 'none';

interface ClaudeOauthCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface ClaudeCredentialsFile {
  claudeAiOauth?: ClaudeOauthCredentials;
}

export interface ClaudeAuthStatus {
  mode: ClaudeAuthMode;
  source: ClaudeAuthSource;
  tokenStatus: ClaudeTokenStatus;
  credentialsPath: string;
  expiresAt: string | null;
  canRefresh: boolean;
  usingEnvOverride: boolean;
}

function readClaudeEnv(): Record<string, string> {
  return {
    ...readEnvFile([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'NANOCLAW_OLLAMA_BASE_URL',
      'NANOCLAW_OLLAMA_AUTH_TOKEN',
    ]),
    ...Object.fromEntries(
      [
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
        'CLAUDE_CODE_OAUTH_TOKEN',
        'NANOCLAW_OLLAMA_BASE_URL',
        'NANOCLAW_OLLAMA_AUTH_TOKEN',
      ]
        .map((key) => [key, process.env[key]])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    ),
  };
}

export function getClaudeHomeConfigDir(): string {
  return path.join(os.homedir(), '.claude');
}

export function getClaudeCredentialsPath(
  configDir = getClaudeHomeConfigDir(),
): string {
  return path.join(configDir, '.credentials.json');
}

function readCredentialsFile(
  credentialsPath: string,
): ClaudeCredentialsFile | 'invalid-json' | undefined {
  try {
    return JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
  } catch (err) {
    if (isErrnoException(err, 'ENOENT')) return undefined;
    if (isSyntaxError(err)) return 'invalid-json';
    throw err;
  }
}

function getOauthTokenStatus(
  oauth: ClaudeOauthCredentials | undefined,
): ClaudeTokenStatus {
  if (!oauth?.accessToken) return 'missing';
  const expiresAtMs = normalizeExpiresAt(oauth.expiresAt);
  if (typeof expiresAtMs === 'number' && expiresAtMs <= Date.now()) {
    return 'expired';
  }
  return 'valid';
}

function normalizeExpiresAt(expiresAt?: number): number | undefined {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return undefined;
  }
  // Some OAuth stores use epoch seconds while others use epoch milliseconds.
  return expiresAt < 1_000_000_000_000 ? expiresAt * 1000 : expiresAt;
}

function buildOauthStatus(
  source: ClaudeAuthSource,
  credentialsPath: string,
  file: ClaudeCredentialsFile | 'invalid-json' | undefined,
  usingEnvOverride = false,
): ClaudeAuthStatus {
  if (file === 'invalid-json') {
    return {
      mode: 'oauth',
      source,
      tokenStatus: 'invalid-json',
      credentialsPath,
      expiresAt: null,
      canRefresh: false,
      usingEnvOverride,
    };
  }

  const oauth = file?.claudeAiOauth;
  const tokenStatus = getOauthTokenStatus(oauth);
  const normalizedExpiresAt = normalizeExpiresAt(oauth?.expiresAt);
  return {
    mode: 'oauth',
    source,
    tokenStatus,
    credentialsPath,
    expiresAt:
      typeof normalizedExpiresAt === 'number'
        ? new Date(normalizedExpiresAt).toISOString()
        : null,
    canRefresh: Boolean(oauth?.refreshToken),
    usingEnvOverride,
  };
}

export function readClaudeAccessToken(
  configDir = getClaudeHomeConfigDir(),
): string | undefined {
  const credentials = readCredentialsFile(getClaudeCredentialsPath(configDir));
  if (!credentials || credentials === 'invalid-json') return undefined;
  if (getOauthTokenStatus(credentials.claudeAiOauth) !== 'valid') {
    return undefined;
  }
  return credentials.claudeAiOauth?.accessToken;
}

export function getClaudeAuthStatus(options?: {
  configDir?: string;
  providerPreset?: 'anthropic' | 'ollama';
}): ClaudeAuthStatus {
  const envVars = readClaudeEnv();
  const providerPreset = options?.providerPreset;
  const sessionConfigDir = options?.configDir;
  const sessionPath = sessionConfigDir
    ? getClaudeCredentialsPath(sessionConfigDir)
    : getClaudeCredentialsPath();
  const homePath = getClaudeCredentialsPath();

  if (providerPreset === 'ollama') {
    return {
      mode: 'ollama',
      source: 'env',
      tokenStatus: 'valid',
      credentialsPath: sessionPath,
      expiresAt: null,
      canRefresh: false,
      usingEnvOverride: false,
    };
  }

  if (envVars.ANTHROPIC_API_KEY) {
    return {
      mode: 'api-key',
      source: 'env',
      tokenStatus: 'valid',
      credentialsPath: sessionPath,
      expiresAt: null,
      canRefresh: false,
      usingEnvOverride: true,
    };
  }

  if (sessionConfigDir) {
    const sessionFile = readCredentialsFile(sessionPath);
    const sessionStatus = buildOauthStatus(
      'session-credentials',
      sessionPath,
      sessionFile,
    );
    if (
      sessionStatus.tokenStatus === 'valid' ||
      sessionStatus.tokenStatus === 'expired' ||
      sessionStatus.tokenStatus === 'invalid-json'
    ) {
      return sessionStatus;
    }
  }

  const homeFile = readCredentialsFile(homePath);
  const homeStatus = buildOauthStatus('home-credentials', homePath, homeFile);
  if (
    homeStatus.tokenStatus === 'valid' ||
    homeStatus.tokenStatus === 'expired' ||
    homeStatus.tokenStatus === 'invalid-json'
  ) {
    return homeStatus;
  }

  if (envVars.CLAUDE_CODE_OAUTH_TOKEN || envVars.ANTHROPIC_AUTH_TOKEN) {
    return {
      mode: 'oauth',
      source: 'env',
      tokenStatus: 'valid',
      credentialsPath: sessionPath,
      expiresAt: null,
      canRefresh: false,
      usingEnvOverride: true,
    };
  }

  return {
    mode: 'missing',
    source: 'none',
    tokenStatus: 'missing',
    credentialsPath: homePath,
    expiresAt: null,
    canRefresh: false,
    usingEnvOverride: false,
  };
}
