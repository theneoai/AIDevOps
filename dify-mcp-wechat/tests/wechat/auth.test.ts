import { getAccessToken, clearTokenCache } from '../../src/wechat/auth';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('wechat/auth', () => {
  beforeEach(() => {
    clearTokenCache();
    jest.clearAllMocks();
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

    // Second call should use cache
    const token2 = await getAccessToken();
    expect(token2).toBe('test_token_123');
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  test('should refresh token when expired', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        access_token: 'old_token',
        expires_in: 0,
      },
    });

    await getAccessToken();

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        access_token: 'new_token',
        expires_in: 7200,
      },
    });

    const token = await getAccessToken();
    expect(token).toBe('new_token');
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  test('should throw error when WeChat API returns error', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        errcode: 40013,
        errmsg: 'invalid appid',
      },
    });

    await expect(getAccessToken()).rejects.toThrow('WeChat API error: invalid appid');
  });
});
