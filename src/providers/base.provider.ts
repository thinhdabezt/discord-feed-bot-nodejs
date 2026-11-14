export interface FeedItem {
  id: string;              // "x:185692019283"
  platform: 'x' | 'ig' | 'fb';
  authorName: string;
  authorHandle: string;
  authorAvatar?: string;
  content: string;
  url: string;
  mediaUrls: string[];     // Danh sách link ảnh / thumbnail video
  videoUrl?: string;       // Link file video MP4 chất lượng cao (nếu có)
  hasMedia: boolean;       // true nếu có ảnh hoặc video
  createdAt: Date;
}

export interface FeedProvider {
  platform: 'x' | 'ig' | 'fb';
  fetchLatest(targetHandle: string): Promise<FeedItem[]>;
}
