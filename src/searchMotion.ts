export const SEARCH_TITLE_HEIGHT = 62;
export const SEARCH_PINNED_HEIGHT = 108;
export const SEARCH_TRANSITION_MS = 280;

export function searchTitleHeight(offset: number, editing: number) {
  'worklet';
  return (SEARCH_TITLE_HEIGHT - Math.min(SEARCH_TITLE_HEIGHT, Math.max(0, offset))) *
    (1 - Math.min(1, Math.max(0, editing)));
}
