export interface PublishArticleParams {
  title: string;
  content: string;
  thumb_media_id?: string;
  author?: string;
  digest?: string;
  content_source_url?: string;
  need_open_comment?: boolean;
  only_fans_can_comment?: boolean;
}

export interface PublishArticleResult {
  media_id: string;
  status: 'success' | 'failed';
  created_at: string;
  error_message?: string;
}

export interface UploadImageParams {
  image_url: string;
  type?: 'thumb' | 'content';
}

export interface UploadImageResult {
  media_id: string;
  url: string;
  status: 'success' | 'failed';
  error_message?: string;
}

export interface GetAccessTokenResult {
  access_token: string;
  expires_in: number;
  expires_at: string;
}
