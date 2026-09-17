// @ts-check
import { fmtStamp } from './utils.js';

/**
 * Share card.
 *
 * The snapshot used to be the raw stage canvas — a frame of pixels with no
 * context, which never made it past a group chat. This composites it into a
 * 1200x675 card in the language of the og image: the stage cover-fit behind
 * scrims, the equalizer mark, the wordmark, the track, and the look's mode
 * + theme chips.
 */

export const CARD_W = 1200;
export const CARD_H = 675;

export function cardRoundRect(x, cx, cy, w, h, r) {
  x.beginPath();
  if (x.roundRect) x.roundRect(cx - w / 2, cy - h / 2, w, h, r);
  else x.rect(cx - w / 2, cy - h / 2, w, h);
}

/**
 * @param {object} deps
 * @param {() => { colors?: string[], name?: string } | undefined} deps.getTheme
 * @param {() => string} deps.getModeName
 * @param {() => string | null | undefined} deps.getTrackName
 * @param {() => HTMLCanvasElement} deps.getLiveCanvas
 * @param {(blob: Blob, name: string) => void} deps.download
 * @param {(msg: string, opts?: object) => void} deps.toast
 */
export function createShareCard({ getTheme, getModeName, getTrackName, getLiveCanvas, download, toast }) {
  async function renderShareCard() {
    const cv = document.createElement('canvas');
    cv.width = CARD_W;
    cv.height = CARD_H;
    const x = cv.getContext('2d');
    const accent = getTheme()?.colors?.[0] || '#d9b089';

    /* stage frame, cover-fit */
    const src = getLiveCanvas();
    if (src.width > 0 && src.height > 0) {
      const sR = src.width / src.height;
      const tR = CARD_W / CARD_H;
      let sw = src.width;
      let sh = src.height;
      if (sR > tR) sw = src.height * tR;
      else sh = src.width / tR;
      x.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, CARD_W, CARD_H);
    } else {
      x.fillStyle = '#14110f';
      x.fillRect(0, 0, CARD_W, CARD_H);
    }

    /* scrims so the lockup always reads */
    const sb = x.createLinearGradient(0, CARD_H * 0.5, 0, CARD_H);
    sb.addColorStop(0, 'rgba(0,0,0,0)');
    sb.addColorStop(0.5, 'rgba(0,0,0,0.30)');
    sb.addColorStop(1, 'rgba(0,0,0,0.72)');
    x.fillStyle = sb;
    x.fillRect(0, 0, CARD_W, CARD_H);
    const sl = x.createLinearGradient(0, 0, CARD_W * 0.58, 0);
    sl.addColorStop(0, 'rgba(0,0,0,0.50)');
    sl.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = sl;
    x.fillRect(0, 0, CARD_W, CARD_H);

    const left = 56;
    const bottom = 54;
    const wmSize = 62;

    /* equalizer mark — same proportions as the icons (see scripts/make-icons) */
    const mSize = 74;
    const mX = left + mSize / 2;
    const mY = CARD_H - bottom - mSize / 2 - 118;
    x.fillStyle = 'rgba(10,10,10,0.55)';
    cardRoundRect(x, mX, mY, mSize, mSize, 17);
    x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.16)';
    x.lineWidth = 1;
    x.stroke();
    x.beginPath();
    x.arc(mX, mY, mSize * 0.306, 0, Math.PI * 2);
    x.strokeStyle = 'rgba(255,255,255,0.30)';
    x.lineWidth = Math.max(1, mSize * 0.042);
    x.stroke();
    const half = mSize * 0.14375;
    x.save();
    x.translate(mX, mY);
    x.rotate(Math.PI / 4);
    x.fillStyle = accent;
    x.fillRect(-half, -half, half * 2, half * 2);
    x.restore();
    x.fillStyle = '#0b0b0b';
    const bw = mSize * 0.0469;
    const bars = [[-0.0844, 0.08125], [0, 0.1375], [0.0844, 0.10625]];
    for (const [bx, bh] of bars) {
      cardRoundRect(x, mX + bx * mSize, mY, bw, bh * 2 * mSize, bw / 2);
      x.fill();
    }

    /* wordmark + tagline */
    const wmX = left + mSize + 22;
    x.fillStyle = '#ffffff';
    x.font = `700 ${wmSize}px "Space Grotesk", system-ui, sans-serif`;
    x.textBaseline = 'alphabetic';
    x.fillText('AUDIOVISOR', wmX, mY + 14);
    x.font = '500 15px "JetBrains Mono", ui-monospace, monospace';
    x.letterSpacing = '0.3em';
    x.fillStyle = accent;
    x.fillText('REAL-TIME AUDIO VISUALIZER', wmX, mY + 46);
    x.letterSpacing = '0em';

    /* now playing */
    const trackName = getTrackName();
    if (trackName && !trackName.includes('Waiting for input')) {
      x.fillStyle = 'rgba(255,255,255,0.78)';
      x.font = '600 24px "Space Grotesk", system-ui, sans-serif';
      const label = trackName.length > 52 ? `${trackName.slice(0, 51)}…` : trackName;
      x.fillText(label, wmX, mY + 92);
    }

    /* chips */
    const chipY = CARD_H - bottom - 30;
    const chips = [
      { t: getModeName(), fill: accent },
      { t: getTheme()?.name || 'Theme', fill: '#ffffff' },
    ];
    let cx0 = wmX;
    x.font = '500 12px "JetBrains Mono", ui-monospace, monospace';
    for (const chip of chips) {
      const tw = x.measureText(chip.t.toUpperCase()).width;
      const pw = tw + 28;
      x.beginPath();
      if (x.roundRect) x.roundRect(cx0, chipY - 15, pw, 30, 15);
      else x.rect(cx0, chipY - 15, pw, 30);
      x.fillStyle = 'rgba(8,8,8,0.5)';
      x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.17)';
      x.lineWidth = 1;
      x.stroke();
      x.fillStyle = chip.fill;
      x.textBaseline = 'middle';
      x.fillText(chip.t.toUpperCase(), cx0 + 14, chipY + 1);
      cx0 += pw + 10;
    }

    /* wordmark baseline sits above the mark box; chips under the mark */
    x.textBaseline = 'alphabetic';
    return cv;
  }

  function snapshot() {
    (async () => {
      try { await document.fonts?.ready; } catch { /* jsdom / no FontFaceSet */ }
      try {
        const card = await renderShareCard();
        card.toBlob((blob) => {
          if (!blob) return;
          download(blob, `audiovisor-${fmtStamp()}.png`);
          toast('SHARE <b>CARD</b> saved', { duration: 1400 });
        }, 'image/png');
      } catch (err) {
        console.error(err);
        toast('<b>Snapshot failed</b>', { duration: 2000 });
      }
    })();
  }

  return { renderShareCard, snapshot };
}
