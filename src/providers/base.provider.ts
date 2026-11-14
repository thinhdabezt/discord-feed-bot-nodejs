export interface FeedItem {
  id: string;              // "x:185692019283"
  platform: 'x' | 'ig' | 'fb';
  authorName: string;
  authorHandle: string;
  authorAvatar?: string;
  content: string;
  url: string;
  mediaUrls: string[];
  createdAt: Date;
}

export interface FeedProvider {
  platform: 'x' | 'ig' | 'fb';
  fetchLatest(targetHandle: string): Promise<FeedItem[]>;
}
