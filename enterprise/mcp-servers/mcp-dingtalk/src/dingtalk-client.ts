import axios, { AxiosInstance } from 'axios';
import { config } from './config';

interface AccessTokenResponse {
  errcode: number;
  errmsg: string;
  access_token: string;
  expires_in: number;
}

export class DingTalkClient {
  private client: AxiosInstance;
  private accessToken: string = '';
  private tokenExpiry: number = 0;

  constructor() {
    this.client = axios.create({
      baseURL: config.dingtalkBaseUrl,
      timeout: 10_000,
    });
  }

  private async ensureToken(): Promise<void> {
    if (Date.now() < this.tokenExpiry - 60_000) return;

    const res = await this.client.get<AccessTokenResponse>('/gettoken', {
      params: { appkey: config.dingtalkAppKey, appsecret: config.dingtalkAppSecret },
    });

    if (res.data.errcode !== 0) {
      throw new Error(`DingTalk auth failed: ${res.data.errmsg}`);
    }

    this.accessToken = res.data.access_token;
    this.tokenExpiry = Date.now() + res.data.expires_in * 1000;
  }

  async sendWorkNotification(
    userIds: string[],
    title: string,
    content: string,
  ): Promise<string> {
    await this.ensureToken();
    const res = await this.client.post(
      '/topapi/message/corpconversation/asyncsend_v2',
      {
        agent_id: config.dingtalkAppKey,
        userid_list: userIds.join(','),
        msg: {
          msgtype: 'markdown',
          markdown: { title, text: content },
        },
      },
      { params: { access_token: this.accessToken } },
    );
    const data = res.data as Record<string, unknown>;
    if (data.errcode !== 0) throw new Error(`DingTalk send failed: ${data.errmsg}`);
    return String(data.task_id);
  }

  async sendGroupMessage(chatId: string, title: string, content: string): Promise<void> {
    await this.ensureToken();
    const res = await this.client.post(
      '/chat/send',
      {
        chatid: chatId,
        msg: {
          msgtype: 'markdown',
          markdown: { title, text: content },
        },
      },
      { params: { access_token: this.accessToken } },
    );
    const data = res.data as Record<string, unknown>;
    if (data.errcode !== 0) throw new Error(`DingTalk group send failed: ${data.errmsg}`);
  }

  async sendRobotWebhook(webhookUrl: string, title: string, content: string): Promise<void> {
    await axios.post(webhookUrl, {
      msgtype: 'markdown',
      markdown: { title, text: content },
    });
  }

  async getUserInfo(userId: string): Promise<{ name: string; email?: string }> {
    await this.ensureToken();
    const res = await this.client.post(
      '/topapi/v2/user/get',
      { userid: userId },
      { params: { access_token: this.accessToken } },
    );
    const data = res.data as Record<string, Record<string, string>>;
    return { name: data.result.name, email: data.result.email };
  }
}
