import { useCallback, useRef, useState } from 'react';

// Bấm lần 2 khi key còn đang chạy: từ chối im lặng, không alert, không chạy task.
export const BLOCKED = { success: false, blocked: true };

export function useBusyGuard() {
  const keysRef = useRef(new Set());
  const [, forceRender] = useState(0);
  const rerender = () => forceRender((n) => n + 1);

  const run = useCallback(async (key, task) => {
    if (keysRef.current.has(key)) return BLOCKED;
    keysRef.current.add(key);
    rerender();
    try {
      return await task();
    } finally {
      keysRef.current.delete(key);
      rerender();
    }
  }, []);

  const isBusy = useCallback((key) => keysRef.current.has(key), []);

  return { run, isBusy, busy: keysRef.current.size > 0 };
}
