/**
 * @vitest-environment jsdom
 *
 * Shared links. The link is replayed by main.js once the stage exists, not when
 * the module is created: creating it earlier reached a render loop that did not
 * exist yet, and the shared look never applied.
 */
import { describe, it, expect, vi } from 'vitest';
import { createCollab } from '../src/collab.js';

const shareHash = (data) => `#share=${btoa(JSON.stringify(data))}`;

function deps(hash) {
  return { state: {}, toast: vi.fn(), setMode: vi.fn(), setTheme: vi.fn(), setFx: vi.fn(), location: { hash } };
}

describe('shared links', () => {
  it('does not apply the link when the module is created', () => {
    const d = deps(shareHash({ mode: 'orb', theme: 'jade' }));
    createCollab(d);
    expect(d.setMode).not.toHaveBeenCalled();
  });

  it('applies the mode, theme and boolean effects when asked', () => {
    const d = deps(shareHash({ mode: 'orb', theme: 'jade', fx: { reverb: true } }));
    createCollab(d).applyShareHash();
    expect(d.setMode).toHaveBeenCalledWith('orb');
    expect(d.setTheme).toHaveBeenCalledWith('jade');
    expect(d.setFx).toHaveBeenCalledWith('reverb', true);
    expect(d.toast).toHaveBeenCalledWith(expect.stringContaining('remix'));
  });

  it('skips effect values that are not booleans', () => {
    const d = deps(shareHash({ fx: { reverb: 'yes', echo: 1 } }));
    createCollab(d).applyShareHash();
    expect(d.setFx).not.toHaveBeenCalled();
  });

  it('ignores a hash that is not a share link', () => {
    const d = deps('#something-else');
    createCollab(d).applyShareHash();
    expect(d.setMode).not.toHaveBeenCalled();
    expect(d.toast).not.toHaveBeenCalled();
  });
});
