/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAutoplayGuard } from '../src/autoplay.js';

beforeEach(() => { document.body.innerHTML = ''; });

function setup(state = 'suspended') {
  const engine = {
    ctx: { state, resume: vi.fn(() => Promise.resolve()) },
    playing: false,
    play: vi.fn(),
  };
  const toast = vi.fn();
  const refreshStatus = vi.fn();
  const guard = createAutoplayGuard({ engine, toast, refreshStatus });
  return { engine, toast, refreshStatus, guard };
}

describe('autoplay guard', () => {
  it('resumes a suspended context on the next pointer gesture', async () => {
    const { engine, toast, refreshStatus, guard } = setup();
    guard.ensureAudible();
    expect(toast).toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.ctx.resume).toHaveBeenCalled();
    expect(engine.play).toHaveBeenCalled();
    expect(refreshStatus).toHaveBeenCalled();
  });

  it('does nothing when the context is already running', () => {
    const { toast, guard } = setup('running');
    guard.ensureAudible();
    expect(toast).not.toHaveBeenCalled();
  });

  it('does nothing before an AudioContext exists', () => {
    const engine = { ctx: null, play: vi.fn() };
    const toast = vi.fn();
    const guard = createAutoplayGuard({ engine, toast, refreshStatus: vi.fn() });
    guard.ensureAudible();
    expect(toast).not.toHaveBeenCalled();
  });
});
