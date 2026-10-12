/**
 * Clear played: removes the entries before the current one through the
 * engine's removeFromQueue, so the current track is never touched.
 */
import { describe, it, expect, vi } from 'vitest';
const { clearPlayed } = await import('../src/queue-import.js');

/** A queue with audio.js's removeFromQueue bookkeeping for a non-current index. */
function queueEngine(names, queueIndex) {
  const engine = {
    queue: names.map((name) => ({ meta: { name } })),
    queueIndex,
    removeFromQueue: vi.fn((i) => {
      engine.queue.splice(i, 1);
      if (i < engine.queueIndex) engine.queueIndex--;
    }),
  };
  return engine;
}

describe('clearPlayed', () => {
  it('removes every entry before the current track and keeps the rest in order', () => {
    const engine = queueEngine(['a', 'b', 'c', 'd', 'e'], 2);
    const toast = vi.fn();
    const onDone = vi.fn();
    clearPlayed({ engine, toast, onDone });
    expect(engine.queue.map((q) => q.meta.name)).toEqual(['c', 'd', 'e']);
    expect(engine.queueIndex).toBe(0);
    expect(engine.queue[engine.queueIndex].meta.name).toBe('c');
    expect(toast).toHaveBeenCalledWith('Cleared <b>2</b> played', expect.anything());
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the current track is the first', () => {
    const engine = queueEngine(['a', 'b'], 0);
    const toast = vi.fn();
    clearPlayed({ engine, toast, onDone: vi.fn() });
    expect(engine.removeFromQueue).not.toHaveBeenCalled();
    expect(engine.queue.length).toBe(2);
    expect(toast).toHaveBeenCalledWith('Nothing <b>played</b> yet', expect.anything());
  });

  it('does nothing on an empty queue', () => {
    const engine = queueEngine([], -1);
    clearPlayed({ engine, toast: vi.fn(), onDone: vi.fn() });
    expect(engine.removeFromQueue).not.toHaveBeenCalled();
  });
});
