// @ts-check
import { CUSTOM_THEME_ID, loadCustomTheme, normalizeColors } from './custom-theme.js';

/**
 * Five-stop custom palette editor.
 *
 * The swatch list stays the source of truth for built-in moods; this only
 * creates/updates the one `custom` theme and hands it to `setCustomTheme`,
 * which owns persistence, the picker dot and the renderer update.
 *
 * @param {object} deps
 * @param {HTMLElement | null} deps.root
 * @param {any} deps.picker
 * @param {() => {colors?: string[]} | undefined} deps.getTheme
 * @param {(colors: string[], opts?: object) => any} deps.setCustomTheme
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {Document} [deps.doc]
 */
export function createThemeEditor({ root, picker, getTheme, setCustomTheme, toast, doc = document }) {
  if (!root) return { apply: () => false };

  const stored = loadCustomTheme();
  const fallback = getTheme()?.colors || ['#ff2bd6', '#ff8a00', '#ccff00', '#00f0ff', '#7b2bff'];
  const colors = stored?.colors || fallback;
  const inputs = [];

  const preview = doc.createElement('div');
  preview.className = 'custom-preview';
  preview.setAttribute('aria-hidden', 'true');

  const grid = doc.createElement('div');
  grid.className = 'custom-colors';

  for (let i = 0; i < 5; i++) {
    const input = doc.createElement('input');
    input.type = 'color';
    input.className = 'custom-color';
    input.value = colors[i] || fallback[i] || '#ffffff';
    input.setAttribute('aria-label', `Custom palette colour ${i + 1}`);
    input.addEventListener('input', paintPreview);
    inputs.push(input);
    grid.appendChild(input);
  }

  const actions = doc.createElement('div');
  actions.className = 'custom-actions';
  const fromCurrent = doc.createElement('button');
  fromCurrent.type = 'button';
  fromCurrent.className = 'mini-btn';
  fromCurrent.textContent = 'Use current';
  const save = doc.createElement('button');
  save.type = 'button';
  save.className = 'mini-btn lime-btn-sm';
  save.textContent = 'Apply & save';
  actions.append(fromCurrent, save);

  const identity = doc.createElement('div');
  identity.className = 'custom-theme-copy';
  identity.innerHTML = '<strong>Custom palette</strong><span class="mono">Five stops · saved on this device</span>';

  root.append(identity, preview, grid, actions);

  function currentColors() {
    return inputs.map((input) => input.value);
  }

  function paintPreview() {
    preview.style.background = `linear-gradient(135deg, ${currentColors().join(', ')})`;
  }

  function apply(showToast = true) {
    const next = normalizeColors(currentColors());
    if (!next) {
      toast('<b>Invalid palette</b> — use six-digit hex colours', { duration: 2400 });
      return false;
    }
    const theme = setCustomTheme(next);
    if (theme) {
      picker.addTheme?.(theme);
      picker.setActiveTheme(CUSTOM_THEME_ID);
    }
    if (showToast) toast('Custom <b>theme</b> applied');
    return true;
  }

  fromCurrent.addEventListener('click', () => {
    const source = getTheme()?.colors || [];
    inputs.forEach((input, i) => { if (source[i]) input.value = source[i]; });
    paintPreview();
  });
  save.addEventListener('click', () => apply());

  paintPreview();
  return { apply, colors: currentColors, inputs };
}
