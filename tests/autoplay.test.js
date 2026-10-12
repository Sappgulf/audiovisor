import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createAutoplayGuard } from '../src/autoplay.js';

describe('autoplay guard', () => {
  it('arms on an interrupted context and re-arms when a resume is refused', async () => {
    const win = new JSDOM('<!doctype html><body></body>').window;
    let refuse = true;
    const ctx = {
      state: 'interrupted',
      resume: vi.fn(() => {
        if (refuse) return Promise.reject(new Error('needs a gesture'));
        ctx.state = 'running';
        return Promise.resolve();
      }),
    };
    const engine = { ctx, playing: false, play: vi.fn() };
    const toast = vi.fn();
    const guard = createAutoplayGuard({ engine, toast, refreshStatus: () => {}, doc: win.document });

    guard.ensureAudible();
    expect(toast).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new win.Event('pointerdown'));
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.resume).toHaveBeenCalledTimes(1);

    refuse = false;
    guard.ensureAudible();
    expect(toast).toHaveBeenCalledTimes(2);
  });
});
