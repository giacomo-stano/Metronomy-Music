// Exclusive handoff, independent of React/native APIs so failure paths are testable.
export async function withExclusiveDiagnostic<T>(options: {
  busy: { current: boolean };
  isCurrent: () => boolean;
  suspend: () => void;
  settle: () => Promise<void>;
  open: () => Promise<T>;
  restorePaused: () => void;
}): Promise<T | undefined> {
  if (options.busy.current) return;
  options.busy.current = true;
  try {
    options.suspend();
    await options.settle();
    if (!options.isCurrent()) return;
    return await options.open();
  } finally {
    try {
      if (options.isCurrent()) options.restorePaused();
    } finally {
      options.busy.current = false;
    }
  }
}
