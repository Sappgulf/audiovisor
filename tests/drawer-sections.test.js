import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* The Source feed and the Studio panel count as fetched when their factories
   run. The factories are stubs, so only the loader's behaviour is tested. */
const loads = vi.hoisted(() => ({ social: 0, studio: 0, fail: false, socialArgs: null, studioArgs: null }));

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('drawer sections load when their tab first opens', () => {
  let mod;
  let deps;

  beforeEach(async () => {
    vi.resetModules();
    loads.social = 0;
    loads.studio = 0;
    loads.fail = false;
    loads.socialArgs = null;
    loads.studioArgs = null;
    vi.doMock('../src/social-ui.js', () => {
      loads.social++;
      if (loads.fail) throw new Error('offline');
      return { createSocialFeed: vi.fn((args) => { loads.socialArgs = args; return { renderSocial() {} }; }) };
    });
    vi.doMock('../src/ai-studio.js', () => {
      loads.studio++;
      if (loads.fail) throw new Error('offline');
      return { createAiStudio: vi.fn((args) => { loads.studioArgs = args; return {}; }) };
    });
    mod = await import('../src/drawer-sections.js');
    deps = {
      state: { modeId: 'bars' }, engine: {}, toast: vi.fn(),
      setFx: vi.fn(), setTheme: vi.fn(), saveSettings: vi.fn(),
    };
  });

  afterEach(() => {
    vi.doUnmock('../src/social-ui.js');
    vi.doUnmock('../src/ai-studio.js');
  });

  it('creating the sections requests neither module', async () => {
    mod.createDrawerSections(deps);
    await settle();
    expect(loads.social).toBe(0);
    expect(loads.studio).toBe(0);
  });

  it('the Source tab loads the feed once, with its state and toast', async () => {
    const { ensureSocial } = mod.createDrawerSections(deps);
    await ensureSocial();
    await ensureSocial();
    expect(loads.social).toBe(1);
    expect(loads.studio).toBe(0);
    expect(loads.socialArgs).toEqual({ state: deps.state, toast: deps.toast });
  });

  it('the Studio tab loads the AI panel once, and not the feed', async () => {
    const { ensureStudio } = mod.createDrawerSections(deps);
    await ensureStudio();
    await ensureStudio();
    expect(loads.studio).toBe(1);
    expect(loads.social).toBe(0);
    expect(loads.studioArgs.setFx).toBe(deps.setFx);
    expect(loads.studioArgs.saveSettings).toBe(deps.saveSettings);
  });

  it('a failed fetch toasts and the next open retries', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { ensureStudio } = mod.createDrawerSections(deps);
      loads.fail = true;
      expect(await ensureStudio()).toBeNull();
      expect(deps.toast).toHaveBeenCalledWith(expect.stringContaining('AI studio unavailable'), expect.anything());

      loads.fail = false;
      expect(await ensureStudio()).not.toBeNull();
      expect(loads.studio).toBe(2);
    } finally { err.mockRestore(); }
  });
});
