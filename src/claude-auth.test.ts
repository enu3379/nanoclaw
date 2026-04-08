import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  getClaudeAuthStatus,
  getClaudeCredentialsPath,
  readClaudeAccessToken,
} from './claude-auth.js';

const createdPaths: string[] = [];
const originalHome = process.env.HOME;
const originalCwd = process.cwd();
const originalAuthEnv = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
  ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
};

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdPaths.push(dir);
  return dir;
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.chdir(originalCwd);
  for (const [key, value] of Object.entries(originalAuthEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  while (createdPaths.length > 0) {
    const entry = createdPaths.pop();
    if (entry && fs.existsSync(entry)) {
      fs.rmSync(entry, { recursive: true, force: true });
    }
  }
});

describe('claude auth helpers', () => {
  it('treats oauth expiresAt epoch seconds as valid time', () => {
    const fakeHome = makeTempDir('nanoclaw-claude-auth-');
    process.env.HOME = fakeHome;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;
    process.chdir(fakeHome);
    const configDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      getClaudeCredentialsPath(configDir),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'token',
          refreshToken: 'refresh',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      }),
    );

    const status = getClaudeAuthStatus();
    expect(status.mode).toBe('oauth');
    expect(status.tokenStatus).toBe('valid');
    expect(readClaudeAccessToken()).toBe('token');
  });

  it('reports invalid-json for malformed credentials', () => {
    const fakeHome = makeTempDir('nanoclaw-claude-auth-');
    process.env.HOME = fakeHome;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;
    process.chdir(fakeHome);
    const configDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(getClaudeCredentialsPath(configDir), '{invalid-json');

    const status = getClaudeAuthStatus();
    expect(status.mode).toBe('oauth');
    expect(status.tokenStatus).toBe('invalid-json');
    expect(readClaudeAccessToken()).toBeUndefined();
  });
});
