import axios, { AxiosInstance } from 'axios';
import { config } from './config';

interface TenantAccessTokenResponse {
  code: number;
  msg: string;
  tenant_access_token: string;
  expire: number;
}

export class FeishuClient {
  private client: AxiosInstance;
  private accessToken: string = '';
  private tokenExpiry: number = 0;

  constructor() {
    this.client = axios.create({
      baseURL: config.feishuBaseUrl,
      timeout: 10_000,
    });
  }

  private async ensureToken(): Promise<void> {
    if (Date.now() < this.tokenExpiry - 60_000) return;

    const res = await this.client.post<TenantAccessTokenResponse>(
      '/open-apis/auth/v3/tenant_access_token/internal',
      { app_id: config.feishuAppId, app_secret: config.feishuAppSecret },
    );

    if (res.data.code !== 0) {
      throw new Error(`Feishu auth failed: ${res.data.msg}`);
    }

    this.accessToken = res.data.tenant_access_token;
    this.tokenExpiry = Date.now() + res.data.expire * 1000;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    await this.ensureToken();
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  async sendMessage(chatId: string, text: string): Promise<string> {
    const headers = await this.authHeaders();
    const res = await this.client.post(
      '/open-apis/im/v1/messages',
      {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
      { params: { receive_id_type: 'chat_id' }, headers },
    );
    return (res.data as Record<string, Record<string, string>>).data.message_id;
  }

  async createDocument(title: string, content: string): Promise<string> {
    const headers = await this.authHeaders();
    const res = await this.client.post(
      '/open-apis/docx/v1/documents',
      { title, folder_token: '' },
      { headers },
    );
    const docToken = (res.data as Record<string, Record<string, string>>).data.document.document_id;

    // Append content as a text block
    await this.client.post(
      `/open-apis/docx/v1/documents/${docToken}/blocks/${docToken}/children`,
      {
        children: [
          {
            block_type: 2,
            text: { elements: [{ text_run: { content, text_element_style: {} } }], style: {} },
          },
        ],
      },
      { headers },
    );

    return docToken;
  }

  async updateDocument(docToken: string, content: string): Promise<void> {
    const headers = await this.authHeaders();
    await this.client.patch(
      `/open-apis/docx/v1/documents/${docToken}/blocks/${docToken}`,
      { update_text_elements: { elements: [{ text_run: { content } }] } },
      { headers },
    );
  }

  async getDocumentContent(docToken: string): Promise<string> {
    const headers = await this.authHeaders();
    const res = await this.client.get(
      `/open-apis/docx/v1/documents/${docToken}/raw_content`,
      { headers },
    );
    return (res.data as Record<string, Record<string, string>>).data.content;
  }
}
