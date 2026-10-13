export type MenuAnchor = { x: number; y: number };
type Measurable = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void };
let trigger: { view: Measurable; time: number } | null = null;

export function rememberMenuTrigger(view: Measurable | null) {
  trigger = view ? { view, time: Date.now() } : null;
}

// pageX/pageY are relative to the React root, not necessarily the full-screen
// modal (safe-area containers and the player sheet can have different origins).
export function measureMenuAnchor(callback: (anchor: MenuAnchor | null) => void) {
  const current = trigger;
  trigger = null;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (anchor: MenuAnchor | null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    callback(anchor);
  };
  if (!current || Date.now() - current.time > 2000) {
    finish(null);
  } else {
    // A virtualized row may disappear before native measurement completes.
    timer = setTimeout(() => finish(null), 180);
    try {
      current.view.measureInWindow((x, y, width, height) => {
        finish([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
          ? { x: x + width, y } : null);
      });
    } catch { finish(null); }
  }
  return () => { finished = true; clearTimeout(timer); };
}
