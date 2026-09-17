// @ts-check
import { fmtTime } from './utils.js';
import { detectMood } from './mood.js';
import { renderWebGPU } from './webgpu.js';
import { renderWebGL2 } from './webgl2.js';
import { isPluginMode } from './plugins.js';
import {
  shouldEvaluate, nextTier, next2dQuality, estimateBaseline, baselineOr, relaxBaseline,
  TIERS, SEVERE,
} from './adaptive.js';

/**
 * The animation loop.
 *
 * Owns everything that only matters while frames are being produced: the
 * adaptive quality sampler, the stage-live class, the beat custom property,
 * the once-a-second clock and the throttled VU/mood chrome. The raytrace
 * kill switch (`raySuspended`) lives here too because both the loop and the
 * raytrace toggle need to flip it; main.js reads it through `isSuspended()`.
 *
 * @param {object} deps
 * @param {any} deps.engine
 * @param {any} deps.renderer
 * @param {() => any} deps.getRay
 * @param {any} deps.state
 * @param {(msg: string, opts?: object) => void} deps.toast
 * @param {() => { webgpuState: object|null, webgl2State: object|null, webgpuCanvas: HTMLCanvasElement|null }} deps.getGpu
 * @param {() => void} deps.drawVu
 * @param {(buffer: object) => void} deps.drawWaveform
 * @param {HTMLElement} deps.seekTrack
 * @param {() => boolean} deps.getAutoDj
 * @param {() => boolean} deps.isDjFiring
 * @param {(v: boolean) => void} deps.setDjFiring
 * @param {(tier: string) => void} [deps.onQualityChange] called when the
 *   adaptive sampler moves the effective raytrace tier
 * @param {Document} [deps.doc]
 */
export function createRenderLoop({
  engine, renderer, getRay, state, toast, getGpu, drawVu, drawWaveform,
  seekTrack, getAutoDj, isDjFiring, setDjFiring, onQualityChange, doc = document,
}) {
  let rayDropped = false;
  let raySuspended = false;   // runtime-only kill switch, never persisted
  let _lastSecs = -1;
  let _vuAcc = 0;
  let _lastBeatWritten = -1;
  let _stageLive = null;
  let _uiAcc = 0;
  const seekFillEl = doc.getElementById('seek-fill');
  const timeCurrentEl = doc.getElementById('time-current');
  const bpmValueEl = doc.getElementById('bpm-value');
  const bassChipEl = doc.getElementById('bass-chip');
  const moodChipEl = doc.getElementById('mood-chip');
  const moodValueEl = doc.getElementById('mood-value');
  const shellEl = doc.getElementById('shell');
  const frameTimes = [];
  /* the display's natural frame interval, learned from the fastest frames we
     see rather than assumed to be 60Hz; null until one has been seen */
  let rayBaselineEstimate = null;
  /* consecutive healthy windows; vsync hides headroom, so climbing back up is
     earned by a run of clean windows rather than measured directly */
  let healthyStreak = 0;
  /* frames to ignore after a mode change, while one-time setup settles */
  const SETTLE_AFTER_MODE_CHANGE = 5;
  let settleFrames = SETTLE_AFTER_MODE_CHANGE;
  let lastFrameTs = performance.now();
  let _frameErrors = 0;

  /** Change the effective tier and report it, so the UI can show what is
      actually running rather than only the ceiling the user chose. */
  function applyTier(ray, tier) {
    if (tier === ray.quality) return;
    ray.setQuality(tier);
    onQualityChange?.(tier);
  }

  function frame(now) {
    try {
      frameStep(now);
      _frameErrors = 0;
    } catch (err) {
      if (_frameErrors++ < 3) console.error('frame error', err);
      // a renderer that throws every frame would otherwise spin forever; drop
      // to the Canvas2D stage for this session only — the stored preference is
      // deliberately left alone so a transient fault isn't made permanent
      if (_frameErrors === 8 && state.raytraceWanted && !raySuspended) {
        raySuspended = true;
        toast('Raytrace <b>suspended</b> — the stage kept erroring', { duration: 3600 });
      }
    }
    requestAnimationFrame(frame);
  }

  function frameStep(now) {
    const ray = getRay();
    const { webgpuState, webgl2State, webgpuCanvas } = getGpu();
    /* The gap since the last frame is what a viewer experiences, and the only
       figure that reflects GPU cost — the CPU time this function takes is
       ~0.1ms whatever the scene, because WebGL work is queued rather than
       run. Animation still uses the clamped value so a tab restore does not
       jump the scene; the adaptive sampler wants the real interval. */
    const frameGap = now - lastFrameTs;
    const dtMs = Math.min(50, frameGap);
    lastFrameTs = now;

    const input = engine.activeInput;
    const idle = input === 'none';
    /* The render loop is the only thing that knows whether the stage is
       actually animating — toggle the class once per change so the CSS can
       drop the expensive chrome blur while it is (see style.css). */
    if (idle !== _stageLive) {
      _stageLive = idle;
      doc.documentElement.classList.toggle('stage-live', !idle);
    }

    engine.syncExternal();
    const audioTime = idle ? 0 : engine.getTime();

    let levels = null;
    let freq = null;
    let wave = null;
    let stereoL = null;
    let stereoR = null;
    if (!idle) {
      const d = engine.getData(audioTime);
      if (!d) {
        freq = wave = null;
      } else {
        freq = d.freq;
        wave = d.wave;
        stereoL = d.stereoL || null;
        stereoR = d.stereoR || null;
        if (engine.playing || engine.micActive || engine.captureActive) {
          levels = engine.getLevels(d, audioTime);
        }
      }
    }

    /* Plugin modes are Canvas2D-only, so the raytraced stage steps aside
       while one is selected. */
    const rtOn = state.raytraceWanted && ray.ok && !raySuspended && !isPluginMode(state.modeId);
    // surface a GPU context loss instead of silently swapping renderers
    if (state.raytraceWanted && !ray.ok && !ray.loading && !rayDropped) {
      rayDropped = true;
      toast(ray.lost
        ? 'GPU context lost — <b>Canvas2D stage</b> until it recovers'
        : '<b>WebGL2 unavailable</b> — Canvas2D stage', { duration: 3200 });
    } else if (rtOn && rayDropped) {
      rayDropped = false;
      toast('RAYTRACE <b>recovered</b>', { duration: 1800 });
    }
    /* A custom-property write invalidates every rule that reads --beat (logo,
       BPM chip). The value moves in tiny increments 60+ times a second, so
       only touch the style when it has moved enough to see. */
    {
      const beatVal = rtOn ? ray.beat : renderer.beat;
      if (Math.abs(beatVal - _lastBeatWritten) > 0.004) {
        _lastBeatWritten = beatVal;
        shellEl.style.setProperty('--beat', beatVal.toFixed(3));
      }
    }

    if (rtOn) {
      // raytraced stage owns every mode; the 2D renderer still advances its
      // beat envelope so chrome (VU, chips, favicon) keeps working
      if (ray.w !== renderer.w || ray.h !== renderer.h) ray.resize(renderer.w, renderer.h);
      doc.getElementById('ray-canvas').classList.add('is-live');
      doc.getElementById('viz-canvas').classList.add('is-off');
      if (webgpuCanvas) webgpuCanvas.style.display = 'none';
      renderer.updateAnalysis(levels, dtMs);
      /* drop slow-mo: scene time stretches (up to ~45%) while the drop
         envelope is hot. Analysis smoothing keeps the real dt so reactivity
         is untouched — only motion slows. */
      const drop = levels?.drop || 0;
      const dtMotion = dtMs * (1 - 0.45 * drop);
      ray.render(idle, freq, wave, levels, dtMotion, null, stereoL, stereoR);
    } else {
      doc.getElementById('ray-canvas').classList.remove('is-live');
      const gpuReady = !!(webgpuState || webgl2State);
      const gpuMode = state.modeId === 'gpu' && gpuReady;
      if (webgpuCanvas && gpuReady && (webgpuCanvas.width !== Math.round(renderer.w * renderer.dpr) || webgpuCanvas.height !== Math.round(renderer.h * renderer.dpr))) {
        webgpuCanvas.width = Math.round(renderer.w * renderer.dpr);
        webgpuCanvas.height = Math.round(renderer.h * renderer.dpr);
      }
      if (webgpuCanvas) webgpuCanvas.style.display = gpuMode ? 'block' : 'none';
      doc.getElementById('viz-canvas').classList.toggle('is-off', gpuMode);
      if (gpuMode && !idle && levels) {
        if (webgpuState) renderWebGPU(webgpuState, renderer.t, levels.level);
        else renderWebGL2(webgl2State, renderer.t, levels.level, webgpuCanvas.width, webgpuCanvas.height);
      } else {
        const effMode = state.modeId === 'gpu' ? 'void' : null;
        if (effMode) renderer.setMode(effMode);
        renderer.render(idle, freq, wave, levels, dtMs * (1 - 0.45 * (levels?.drop || 0)), stereoL, stereoR);
        if (effMode) renderer.setMode('gpu');
      }
    }

    if (!idle) {
      const t = audioTime;
      const dur = engine.getDuration();
      seekFillEl.style.width = `${dur ? (t / dur) * 100 : 0}%`;
      _vuAcc += dtMs;
      // the clock only ticks once a second — skip 59 of 60 text writes
      const secs = Math.floor(t);
      if (secs !== _lastSecs) {
        _lastSecs = secs;
        timeCurrentEl.textContent = fmtTime(t);
        // the seek bar is a slider now; keep assistive tech in step with it,
        // at the same once-a-second cadence as the visible clock
        seekTrack.setAttribute('aria-valuenow', String(dur ? Math.round((t / dur) * 100) : 0));
        seekTrack.setAttribute('aria-valuetext', `${fmtTime(t)} of ${fmtTime(dur)}`);
      }
      if (_vuAcc >= 33) { _vuAcc = 0; drawVu(); }
      _uiAcc += dtMs;
      if (_uiAcc >= 100) {
        _uiAcc = 0;
        const bi = engine.beatInfo;
        /* Live lock wins; the offline analysis only fills the gap before the
           tracker has converged. */
        const liveBpm = bi.bpm && bi.confidence > 0.25 ? bi.bpm : 0;
        const bpm = liveBpm || state.analyzedBpm || 0;
        bpmValueEl.textContent = bpm ? bpm.toFixed(2) : '--.--';
        bpmValueEl.title = liveBpm ? 'Live tempo lock'
          : state.analyzedBpm ? 'Analysed from the track' : '';
        bassChipEl.classList.toggle('is-hidden', !(renderer.sm.bass > 0.35));
        if (levels) {
          const mood = detectMood({ bpm: levels.bpm, bass: levels.bass, mid: levels.mid, high: levels.high, width: levels.width });
          if (mood) { moodValueEl.textContent = mood.tag; moodChipEl.classList.remove('is-hidden'); }
          else moodChipEl.classList.add('is-hidden');
        }
      }
      // Auto DJ crossfade near track end
      if (getAutoDj() && !isDjFiring() && engine.playing && engine.mode === 'file' && engine.queue.length > 1) {
        const rem = engine.getDuration() - audioTime;
        if (rem < 6) {
          setDjFiring(true);
          engine.crossfadeTo((engine.queueIndex + 1) % engine.queue.length, 4);
          toast('AUTO DJ — <b>crossfading</b>');
          setTimeout(() => { setDjFiring(false); }, 5200);
        }
      }
    }

    // the interval, not this callback's CPU time — see src/adaptive.js
    rayBaselineEstimate = estimateBaseline(frameTimes, rayBaselineEstimate);
    const rayBaseline = baselineOr(rayBaselineEstimate);
    if (settleFrames > 0) {
      settleFrames--;
      /* A mode change used to deliver 12 fully-rendered jank frames before the
         sampler had a single sample: at ~172ms that was two seconds of stutter
         in a row for Aurora Terrain before anything reacted. Settle exists so a
         spiky cold frame cannot poison the *average* window — but one interval
         three and a half times over budget is not noise, and the climb will
         undo a wrong guess in a couple of seconds. Step down right now. */
      if (state.raytraceWanted && ray.ok && Number.isFinite(frameGap)
          && frameGap > rayBaseline * SEVERE && TIERS.indexOf(ray.quality) > 0) {
        const { tier } = nextTier(ray.quality, frameGap, state.rayQuality, rayBaseline);
        applyTier(ray, tier);
      }
    } else if (Number.isFinite(frameGap) && frameGap > 0) frameTimes.push(frameGap);
    /* Normally this waits for a full window before judging, but that window
       costs more wall-clock the slower things are — on a mode running several
       times over budget that was seconds of stutter before anything happened. shouldEvaluate() acts on a
       short window when every sample in it is severely over budget, which is
       not an ambiguous signal. See src/adaptive.js. */
    if (shouldEvaluate(frameTimes, rayBaseline)) {
      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      /* a window is the natural pace to revisit the baseline: one lucky frame
         can pin the session best below what the display ever achieves again,
         and relaxing per-frame would tie recovery speed to frame timing */
      rayBaselineEstimate = relaxBaseline(rayBaselineEstimate, frameTimes);
      const relaxed = baselineOr(rayBaselineEstimate);
      frameTimes.length = 0;
      if (state.raytraceWanted && ray.ok) {
        const { tier, streak } = nextTier(ray.quality, avg, state.rayQuality, relaxed, healthyStreak);
        healthyStreak = streak;
        applyTier(ray, tier);
      } else {
        renderer.setQuality(next2dQuality(renderer.quality, avg, relaxed));
      }
    }
  }

  let resizeRaf = 0;
  function scheduleResize() {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      renderer.resize();
      getRay().resize(renderer.w, renderer.h);
      if (engine.buffer && engine.mode === 'file') drawWaveform(engine.buffer);
    });
  }

  const stageEl = doc.getElementById('stage');
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => scheduleResize()).observe(stageEl);
  } else {
    doc.defaultView?.addEventListener('resize', () => scheduleResize());
  }

  return {
    start: () => requestAnimationFrame(frame),
    scheduleResize,
    /** A mode change invalidates the tier the last mode adapted to. */
    resetAdaptation: () => {
      healthyStreak = 0;
      settleFrames = SETTLE_AFTER_MODE_CHANGE;
      frameTimes.length = 0;
    },
    resume: () => { raySuspended = false; },
    isSuspended: () => raySuspended,
  };
}
