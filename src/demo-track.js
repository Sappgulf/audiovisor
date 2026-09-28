/**
 * A short musical loop rendered into an AudioBuffer so the stage can run
 * before the listener has a file. Kick, snare, hats, bass and a stab, all
 * written sample-by-sample so the analysers see a real spectrum.
 */

export const DEMO_BPM = 118;

export const DEMO_META = {
  name: 'Night Circuit',
  ext: 'DEMO',
  demo: true,
};

const BARS = 8;

function noise(i, salt) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * @param {{ sampleRate: number, createBuffer: Function }} ctx
 */
export function renderDemoTrack(ctx) {
  const sr = ctx.sampleRate;
  const beat = 60 / DEMO_BPM;
  const dur = beat * 4 * BARS;
  const n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, n, sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);

  // A minor, one note per bar, an octave below middle C's A.
  const bassHz = [55, 55, 65.41, 65.41, 49, 49, 73.42, 65.41];
  const stab = [220, 261.63, 329.63];

  let kickPhase = 0;
  let bassPhase = 0;
  let stabPhase = stab.map(() => 0);

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const bar = Math.floor(t / (beat * 4)) % BARS;
    const beatPos = (t / beat) % 4;
    const beatIn = beatPos - Math.floor(beatPos);
    const step = Math.floor(beatPos);

    let mono = 0;

    const kickF = 160 * Math.pow(0.26, Math.min(1, beatIn / 0.2));
    kickPhase += (kickF / sr) * Math.PI * 2;
    if (beatIn < 0.28) {
      mono += Math.sin(kickPhase) * Math.exp(-beatIn * 16) * 0.9;
    }

    if ((step === 1 || step === 3) && beatIn < 0.14) {
      mono += noise(i, 3) * Math.exp(-beatIn * 26) * 0.38;
    }

    const eighth = (t / (beat * 0.5)) % 1;
    let hat = 0;
    if (eighth < 0.045) {
      const open = step % 2 === 1 && beatIn > 0.45;
      hat = noise(i, 9) * Math.exp(-eighth * (open ? 40 : 90)) * (open ? 0.16 : 0.1);
    }

    bassPhase += (bassHz[bar] / sr) * Math.PI * 2;
    const bassEnv = 0.22 + 0.5 * Math.exp(-beatIn * 2.4);
    mono += Math.sin(bassPhase) * bassEnv * 0.4;

    const barIn = t % (beat * 4);
    if (barIn < 0.42) {
      const env = Math.exp(-barIn * 5.5);
      for (let c = 0; c < stab.length; c++) {
        stabPhase[c] += (stab[c] / sr) * Math.PI * 2;
        mono += Math.sin(stabPhase[c]) * env * 0.07;
      }
    }

    const left = mono * 0.92 + hat * 0.25;
    const right = mono * 0.92 + hat * 0.85;
    L[i] = left < -1 ? -1 : left > 1 ? 1 : left;
    R[i] = right < -1 ? -1 : right > 1 ? 1 : right;
  }

  return buf;
}
