import axios from 'axios';
import { config } from '../config';
import { createLogger } from '../logger';
import { WeChatAccessTokenResponse } from '../types/wechat';

const logger = createLogger(config.LOG_LEVEL);

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();

  // 如果缓存的 token 还没过期（预留 5 分钟缓冲），直接返回
  if (cachedToken && now < tokenExpiresAt - 5 * 60 * 1000) {
    logger.debug('Using cached access token');
    return cachedToken;
  }

  logger.info('Fetching new access token from WeChat API');

  try {
    const response = await axios.get<WeChatAccessTokenResponse>(
      'https://api.weixin.qq.com/cgi-bin/token',
      {
        params: {
          grant_type: 'client_credential',
          appid: config.WECHAT_APP_ID,
          secret: config.WECHAT_APP_SECRET,
        },
      }
    );

    const data = response.data;

    if (data.errcode !== undefined && data.errcode !== 0) {
      const errorMsg = data.errmsg || `Unknown WeChat error (errcode: ${data.errcode})`;
      logger.error('WeChat API returned error', { errcode: data.errcode, errmsg: data.errmsg });
      throw new Error(`WeChat API error: ${errorMsg}`);
    }

    cachedToken = data.access_token;
    tokenExpiresAt = now + data.expires_in * 1000;

    logger.info('Successfully fetched and cached access token', {
      expires_in: data.expires_in,
      expires_at: new Date(tokenExpiresAt).toISOString(),
    });

    return cachedToken;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('WeChat API error:')) {
      throw error;
    }
    logger.error('Failed to fetch access token', { error });
    throw new Error('Failed to fetch access token from WeChat API');
  }
}

export function clearTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
  logger.debug('Token cache cleared');
}
