// frontend/types.ts
export type LabelStatus = 'TP' | 'FP';

export interface VideoLabel {
  status: LabelStatus;
  tags: string[];
}

export interface VideoItem {
  key: string;
  url: string;
  label: LabelStatus;
  tags: string[];
}

export interface AppState {
  lastPage: number;
  labels: Record<string, VideoLabel>; // Updated to the new object structure
  videoKeys: string[];
}

export interface PageData {
  videos: VideoItem[];
  totalPages: number;
}
