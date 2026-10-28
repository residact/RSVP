// Types partagés entre le serveur et l'interface web.

export interface Settings {
  wpm: number;
  minWpm: number;
  maxWpm: number;
  showPivot: boolean;
  punctuationPause: boolean;
  longWordPause: boolean;
  fontScale: number;
  autoOpen: boolean;
  keepAwake: boolean;
  accent: string;
}

export interface TextItem {
  id: string;
  title: string;
  text: string;
  words: number;
  source: string;
  createdAt: string;
}

export type TextMeta = Omit<TextItem, "text"> & { preview: string };

export interface ChapterInfo {
  title: string;
  words: number;
}

export interface Progress {
  chapter: number;
  word: number;
  total: number;
  updatedAt: string;
}

export interface BookSummary {
  id: string;
  title: string;
  author: string;
  language: string;
  fileName: string;
  cover: string | null;
  addedAt: string;
  progress: Progress | null;
  chapterCount: number;
  totalWords: number;
  percent: number;
  duplicate?: boolean;
}

export interface BookDetail extends BookSummary {
  chapters: ChapterInfo[];
}

export interface ChapterContent {
  index: number;
  count: number;
  title: string;
  words: number;
  text: string;
}

export interface Info {
  baseUrl: string;
  mcpUrl: string;
  token: string;
  version: string;
}

/** Livre tel qu'analysé avant d'être stocké. */
export interface ParsedBook {
  title: string;
  author: string;
  language: string;
  cover: { data: Uint8Array; ext: string } | null;
  chapters: { title: string; md: string; words: number }[];
}
