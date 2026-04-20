import { getAccessToken, clearTokenCache } from '../../src/wechat/auth';
import axios from 'axios';
import * as fs from 'fs';

jest.mock('axios');
jest.mock('fs');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('wechat/auth', () => {
  beforeEach(() => {
    clearTokenCache();
    jest.clearAllMocks();
    // Default: no disk cache file
    mockedFs.existsSync.mockReturnValue(false);
    mockedFs.writeFileSync.mockImplementation(() => undefined);
    mockedFs.readFileSync.mockReturnValue('{}');
  });

  test('should fetch and cache access token', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        access_token: 'test_token_123',
        expires_in: 7200,
      },
    });

    const token = await getAccessToken();
    expect(token).toBe('test_token_123');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    // Second call should use in-memory cache
    const token2 = await getAccessToken();
    expect(token2).toBe('test_token_123');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  test('should persist token to disk after fetch', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { access_token: 'test_token_123', expires_in: 7200 },
    });

    await getAccessToken();
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      '/tmp/wechat_token_cache.json',
      expect.stringContaining('test_token_123'),
      { mode: 0o600 }
    );
  });

  test('should restore token from disk cache on startup', async () => {
    const futureExpiry = Date.now() + 2 * 60 * 60 * 1000; // 2 hours from now
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ token: 'disk_cached_token', expiresAt: futureExpiry })
    );

    // Re-import to trigger loadCacheFromDisk() — simulate fresh module load
    jest.resetModules();
    const { getAccessToken: freshGetAccessToken } = await import('../../src/wechat/auth');

    const token = await freshGetAccessToken();
    expect(token).toBe('disk_cached_token');
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  test('should refresh token when expired', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { access_token: 'old_token', expires_in: 0 },
    });

    await getAccessToken();

    mockedAxios.get.mockResolvedValueOnce({
      data: { access_token: 'new_token', expires_in: 7200 },
    });

    const token = await getAccessToken();
    expect(token).toBe('new_token');
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  test('should throw error when WeChat API returns error', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { errcode: 40013, errmsg: 'invalid appid' },
    });

    await expect(getAccessToken()).rejects.toThrow('WeChat API error: invalid appid');
  });

  test('should degrade gracefully when disk cache is unreadable', async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation(() => { throw new Error('EACCES'); });

    mockedAxios.get.mockResolvedValueOnce({
      data: { access_token: 'fresh_token', expires_in: 7200 },
    });

    const token = await getAccessToken();
    expect(token).toBe('fresh_token');
  });
});
