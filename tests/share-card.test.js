/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createShareCard, cardRoundRect, CARD_W, CARD_H } from '../src/share-card.js';

function fakeCtx() {
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: '', letterSpacing: '',
    beginPath: vi.fn(), roundRect: vi.fn(), rect: vi.fn(),
    fill: vi.fn(), stroke: vi.fn(), arc: vi.fn(),
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    measureText: (t) => ({ width: String(t).length * 7 }),
  };
}

describe('cardRoundRect', () => {
  it('prefers the native rounded rect when available', () => {
    const x = { beginPath: vi.fn(), roundRect: vi.fn(), rect: vi.fn() };
    cardRoundRect(x, 100, 50, 40, 20, 5);
    expect(x.roundRect).toHaveBeenCalledWith(80, 40, 40, 20, 5);
    expect(x.rect).not.toHaveBeenCalled();
  });

  it('falls back to a plain rect', () => {
    const x = { beginPath: vi.fn(), rect: vi.fn() };
    cardRoundRect(x, 100, 50, 40, 20, 5);
    expect(x.rect).toHaveBeenCalledWith(80, 40, 40, 20);
  });
});

describe('createShareCard', () => {
  let ctx;
  let originalGetContext;
  let originalToBlob;

  beforeEach(() => {
    ctx = fakeCtx();
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.getContext = () => ctx;
    HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob(['png'])); };
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
    vi.restoreAllMocks();
  });

  const card = (overrides = {}) => createShareCard({
    getTheme: () => ({ colors: ['#ccff00', '#ff2bd6'], name: 'Neon' }),
    getModeName: () => 'Bars',
    getTrackName: () => 'Kind of Blue',
    getLiveCanvas: () => ({ width: 800, height: 450 }),
    download: vi.fn(),
    toast: vi.fn(),
    ...overrides,
  });

  it('renders a card at the og dimensions', async () => {
    const { renderShareCard } = card();
    const cv = await renderShareCard();
    expect(cv.width).toBe(CARD_W);
    expect(cv.height).toBe(CARD_H);
  });

  it('cover-fits the stage frame into the card', async () => {
    const { renderShareCard } = card();
    await renderShareCard();
    expect(ctx.drawImage).toHaveBeenCalled();
    const args = ctx.drawImage.mock.calls[0];
    expect(args.slice(-4)).toEqual([0, 0, CARD_W, CARD_H]);
  });

  it('snapshot downloads a timestamped png and reports it', async () => {
    const download = vi.fn();
    const toast = vi.fn();
    const { snapshot } = card({ download, toast });
    snapshot();
    await new Promise((r) => setTimeout(r, 0));
    expect(download).toHaveBeenCalledTimes(1);
    const [blob, name] = download.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(name).toMatch(/^audiovisor-\d{8}-\d{6}\.png$/);
    expect(toast).toHaveBeenCalledWith('SHARE <b>CARD</b> saved', { duration: 1400 });
  });
});
