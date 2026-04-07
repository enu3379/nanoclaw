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

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  createdPaths.push(dir);
  return dir;
}

afterEach(() => {
  process.env.HOME = originalHome;
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
    const configDir = path.join(fakeHome, '.claude');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(getClaudeCredentialsPath(configDir), '{invalid-json');

    const status = getClaudeAuthStatus();
    expect(status.mode).toBe('oauth');
    expect(status.tokenStatus).toBe('invalid-json');
    expect(readClaudeAccessToken()).toBeUndefined();
  });
});
