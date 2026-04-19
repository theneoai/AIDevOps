export interface WeChatAccessTokenResponse {
  access_token: string;
  expires_in: number;
  errcode?: number;
  errmsg?: string;
}

export interface WeChatDraftResponse {
  media_id: string;
  errcode?: number;
  errmsg?: string;
}

export interface WeChatUploadImageResponse {
  url: string;
  errcode?: number;
  errmsg?: string;
}

export interface WeChatUploadMaterialResponse {
  media_id: string;
  url: string;
  errcode?: number;
  errmsg?: string;
}

export interface WeChatErrorResponse {
  errcode: number;
  errmsg: string;
}
