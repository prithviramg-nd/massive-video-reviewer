export type LabelStatus = 'TP' | 'FP';

export interface VideoLabel {
  status: LabelStatus;
  tags: string[];
}

/**
 * A label as stored in review_db.json. Older files may hold a bare status string
 * or `{ status, tag: string }`; `normalizeLabel` reads all of them.
 */
export type StoredLabel = VideoLabel | LabelStatus | { status?: LabelStatus; tag?: string; tags?: string[] };

/** Shape of `<folder>/review_db.json` (unchanged from the old backend). */
export interface ReviewDb {
  /** Page index measured in 1x2 pages (page size 2), so it is grid-layout independent. */
  lastPage: number;
  labels: Record<string, StoredLabel>;
}

/** A video on the current page: its S3 key plus a presigned URL. */
export interface PageVideo {
  key: string;
  url: string;
}

export interface VideoItem extends PageVideo {
  label: LabelStatus;
  tags: string[];
}

export function normalizeLabel(storedLabel: StoredLabel | undefined): VideoLabel {
  if (storedLabel && typeof storedLabel === 'object') {
    const labelRecord = storedLabel as { status?: LabelStatus; tag?: string; tags?: string[] };
    const rawTags = labelRecord.tags ?? labelRecord.tag;
    const tags = Array.isArray(rawTags) ? rawTags.filter(Boolean) : rawTags ? [rawTags] : [];
    return { status: labelRecord.status || 'TP', tags };
  }
  return { status: (storedLabel as LabelStatus) || 'TP', tags: [] };
}
