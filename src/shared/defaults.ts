import type { Settings } from "./types.ts";

export const DEFAULT_SETTINGS: Settings = {
  wpm: 300,
  minWpm: 200,
  maxWpm: 700,
  showPivot: true,
  punctuationPause: true,
  longWordPause: true,
  fontScale: 1,
  autoOpen: true,
  keepAwake: true,
  accent: "#f68330",
};
