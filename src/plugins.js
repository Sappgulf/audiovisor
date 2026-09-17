// @ts-check
import { MODES } from './themes.js';

/**
 * Visualizer plugin API.
 *
 * Lets an embed register a custom Canvas2D mode without forking the app. The
 * mode is pushed onto the live MODES array (so the mode picker, keyboard
 * cycling and the command palette all see it) and its `draw` is dispatched
 * from the renderer before the built-in switch. Plugin modes are Canvas2D
 * only — the raytraced stage steps aside while one is active.
 *
 * A mode's `draw` receives the renderer (for size, theme, quality and the
 * cached sprite helpers), the current spectrum and waveform, and both the
 * real delta-time and a 60Hz-normalized one, mirroring the built-ins.
 */

/** @typedef {(renderer: any, freq: Uint8Array, wave: Uint8Array, dt: number, dt60: number) => void} PluginDraw */

/** @type {Map<string, { id: string, name: string, icon: string, draw: PluginDraw }>} */
const registry = new Map();

/**
 * Register a custom visualizer mode.
 *
 * @param {{ id: string, name?: string, icon?: string, draw: PluginDraw }} def
 * @returns {{ id: string, name: string, icon: string }}
 */
export function registerMode(def) {
  const { id, name, icon = 'sparkles', draw } = def || {};
  if (!id || typeof id !== 'string') throw new Error('registerMode: { id } is required');
  if (typeof draw !== 'function') throw new Error('registerMode: { draw } must be a function');
  if (MODES.some((m) => m.id === id)) throw new Error(`registerMode: mode '${id}' already exists`);
  const mode = { id, name: name || id, icon };
  MODES.push(mode);
  registry.set(id, { ...mode, draw });
  return mode;
}

/** @param {string} id */
export function getPluginMode(id) { return registry.get(id); }

/** @param {string} id */
export function isPluginMode(id) { return registry.has(id); }

/** @returns {Array<{ id: string, name: string, icon: string }>} */
export function registeredModes() {
  return [...registry.values()].map(({ id, name, icon }) => ({ id, name, icon }));
}

/** Test-only: forget every registered mode and remove it from MODES. */
export function _clearPlugins() {
  for (const id of registry.keys()) {
    const i = MODES.findIndex((m) => m.id === id);
    if (i >= 0) MODES.splice(i, 1);
  }
  registry.clear();
}
