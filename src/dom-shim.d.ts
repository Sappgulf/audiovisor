/**
 * Pragmatic DOM shims for opt-in JS type-checking.
 *
 * The `// @ts-check` modules are plain JS and lean on getElementById /
 * querySelector, whose precise element type is not worth threading through
 * every call site. These widen the common accessors so the checker focuses
 * on real mistakes — typos, wrong arity, missing object properties — rather
 * than element narrowing. Tighten or delete individual shims as modules gain
 * real types.
 */

interface Element {
  focus(): void;
  blur(): void;
  dataset: DOMStringMap;
  tabIndex: number;
  inert: boolean;
  closest(selector: string): Element | null;
}

interface HTMLElement {
  value: string;
  files: FileList | null;
  showPicker?(): void;
}

interface EventTarget {
  closest(selector: string): Element | null;
}

interface Navigator {
  wakeLock?: { request(type: string): Promise<{ release(): Promise<void>; addEventListener(t: string, fn: () => void): void }> };
}

interface CanvasRenderingContext2D {
  letterSpacing: string;
}
