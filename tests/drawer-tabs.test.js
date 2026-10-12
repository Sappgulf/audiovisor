/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDrawerTabs } from '../src/drawer-tabs.js';

describe('drawer tabs report the Source and Studio opens', () => {
  let onSourceTab;
  let onStudioTab;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <div class="drawer-scroll"></div>
      <button class="drawer-tab" data-tab="look" aria-selected="true"></button>
      <button class="drawer-tab" data-tab="source" aria-selected="false"></button>
      <button class="drawer-tab" data-tab="studio" aria-selected="false"></button>
      <div class="drawer-panel" data-panel="look"></div>
      <div class="drawer-panel" data-panel="source"></div>
      <div class="drawer-panel" data-panel="studio"></div>`;
    onSourceTab = vi.fn();
    onStudioTab = vi.fn();
    createDrawerTabs({ onSourceTab, onStudioTab });
  });

  it('opening the Studio tab calls onStudioTab only', () => {
    document.querySelector('[data-tab="studio"]').click();
    expect(onStudioTab).toHaveBeenCalledTimes(1);
    expect(onSourceTab).not.toHaveBeenCalled();
  });

  it('opening the Source tab calls onSourceTab only', () => {
    document.querySelector('[data-tab="source"]').click();
    expect(onSourceTab).toHaveBeenCalledTimes(1);
    expect(onStudioTab).not.toHaveBeenCalled();
  });

  it('the default Look tab reports neither', () => {
    expect(onSourceTab).not.toHaveBeenCalled();
    expect(onStudioTab).not.toHaveBeenCalled();
  });
});
