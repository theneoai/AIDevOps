import axios from 'axios';
import { config } from '../config';
import { createLogger } from '../logger';
import { WeChatAccessTokenResponse } from '../types/wechat';
import { getCachedToken, saveToken, acquireRefreshLock } from './token-store';

const logger = createLogger(config.LOG_LEVEL);

export async function getAccessToken(): Promise<string> {
  // Fast path: valid token already in store (Redis or disk)
  const cached = await getCachedToken();
  if (cached) {
    logger.debug('Using cached WeChat access_token');
    return cached;
  }

  // Slow path: need to refresh — acquire distributed lock so only one replica calls WeChat
  const releaseLock = await acquireRefreshLock();
  try {
    // Re-check after acquiring lock in case another replica just refreshed
    const raceCheck = await getCachedToken();
    if (raceCheck) {
      logger.debug('Token refreshed by peer replica — using their token');
      return raceCheck;
    }

    logger.info('Fetching new access_token from WeChat API');
    const response = await axios.get<WeChatAccessTokenResponse>(
      'https://api.weixin.qq.com/cgi-bin/token',
      {
        params: {
          grant_type: 'client_credential',
          appid: config.WECHAT_APP_ID,
          secret: config.WECHAT_APP_SECRET,
        },
        timeout: 10_000,
      },
    );

    const data = response.data;

    if (data.errcode !== undefined && data.errcode !== 0) {
      const errorMsg = data.errmsg || `Unknown WeChat error (errcode: ${data.errcode})`;
      logger.error('WeChat API returned error', { errcode: data.errcode, errmsg: data.errmsg });
      throw new Error(`WeChat API error: ${errorMsg}`);
    }

    await saveToken(data.access_token, data.expires_in);
    return data.access_token;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('WeChat API error:')) {
      throw err;
    }
    logger.error('Failed to fetch WeChat access_token', { error: String(err) });
    throw new Error('Failed to fetch access_token from WeChat API');
  } finally {
    await releaseLock();
  }
}

export async function clearTokenCache(): Promise<void> {
  // Save an already-expired token to invalidate the cache
  await saveToken('', 0);
  logger.debug('WeChat token cache cleared');
}
