// @ts-check
import { fmtTime } from './utils.js';
import { detectMood } from './mood.js';
import { renderWebGPU } from './webgpu.js';
import { renderWebGL2 } from './webgl2.js';
import { isPluginMode } from './plugins.js';
import {
  shouldEvaluate, nextTier, next2dQualityState, estimateBaseline, baselineOr, relaxBaseline,
  TIERS, SEVERE, OVER_BUDGET, climbCeiling, windowCost, isUsableInterval,
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
 * @param {() => { webgpuState: object|null, webgl2State: object|null, webgpuCanvas: HTMLCanvasElement|null, startGpu?: () => void, gpuDead?: boolean }} deps.getGpu
 * @param {() => void} deps.drawVu
 * @param {(buffer: object) => void} deps.drawWaveform
 * @param {HTMLElement} deps.seekTrack
 * @param {() => boolean} deps.getAutoDj
 * @param {() => boolean} deps.isDjFiring
 * @param {(v: boolean) => void} deps.setDjFiring
 * @param {(tier: string) => void} [deps.onQualityChange] called when the
 *   adaptive sampler moves the effective raytrace tier
 * @param {() => void} [deps.onFallback] load the Canvas2D extras when the ray
 *   stage is unavailable or is suspended after repeated frame errors
 * @param {Document} [deps.doc]
 */
export function createRenderLoop({
  engine, renderer, getRay, state, toast, getGpu, drawVu, drawWaveform,
  seekTrack, getAutoDj, isDjFiring, setDjFiring, onQualityChange, onFallback, doc = document,
}) {
  let rayDropped = false;
  let raySuspended = false;   // runtime-only kill switch, never persisted
  /* GPU Core's Canvas2D stand-in used to be installed and removed around
     every frame. If WebGPU/WebGL2 never become ready the fallback is the
     permanent renderer, and that churn cleared scene state and re-allocated
     its arrays 60 times a second. Track the transition instead. */
  let gpuFallbackActive = false;
  let _lastSecs = -1;
  let _vuAcc = 0;
  let _lastBeatWritten = -1;
  let _stageLive = null;
  let _audioOnly = null;
  let _uiAcc = 0;
  let _seekAcc = 0;
  let _seekPct = -1;
  const seekFillEl = doc.getElementById('seek-fill');
  /* looked up once; these two are read several times every frame */
  const rayCanvasEl = doc.getElementById('ray-canvas');
  const vizCanvasEl = doc.getElementById('viz-canvas');
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
  /* the 2D renderer's equivalent: clean windows before restoring bloom/trail */
  let healthy2d = 0;
  /* the highest tier this mode may climb back to: set just under a tier the
     sampler had to step down from, so a mode does not oscillate between a
     tier it cannot hold and the one below. Cleared on a mode change. */
  let climbCap = null;
  /* per-mode memory of that cap for the session: without it every mode
     switch re-ran the climb into a tier the mode had already failed, half a
     second of 30fps judder each time */
  const climbCaps = new Map();
  /* frames to skip entirely after a tier change. The first frame after
     stepping down still waits on the GPU backlog of the heavier tier —
     measured 100-133ms — and counting it read as a second failure that
     knocked the stage from medium straight on to low. */
  const SETTLE_AFTER_TIER_CHANGE = 8;
  let tierSettle = 0;
  let severeRun = 0;
  /* frames to ignore after a mode change, while one-time setup settles */
  const SETTLE_AFTER_MODE_CHANGE = 5;
  /* a playback resume is less invasive than a mode change: the scene is
     already built, but the GPU and audio graph may have gone cold */
  const SETTLE_AFTER_RESUME = 3;
  let settleFrames = SETTLE_AFTER_MODE_CHANGE;
  /* consecutive judged windows that were over budget; the first one is
     treated as external load rather than evidence about the scene */
  let overBudgetRun = 0;
  /* whether the visual stage was idle on the previous frame, so the
     idle->playing edge can restart the sampler cleanly */
  let _wasVisualIdle = null;
  /* the ray stage halves its own idle rate; the Canvas2D fallback has no
     such throttle, so skip alternate idle frames here */
  let _idle2dSkip = false;
  let lastFrameTs = performance.now();
  let _frameErrors = 0;
  let fallbackNotified = false;
  /* rAF is scheduled only while the page is visible and the loop is running.
     Browsers already throttle hidden tabs, but explicitly cancelling avoids a
     stale frame timestamp and any work that slips through before throttling. */
  let rafId = 0;
  let running = false;
  let hidden = doc.hidden === true;

  /** Change the effective tier and report it, so the UI can show what is
      actually running rather than only the ceiling the user chose. */
  function applyTier(ray, tier) {
    if (tier === ray.quality) return;
    tierSettle = SETTLE_AFTER_TIER_CHANGE;
    overBudgetRun = 0;
    frameTimes.length = 0;
    ray.setQuality(tier);
    onQualityChange?.(tier);
  }

  function resetSampling(settle = SETTLE_AFTER_RESUME) {
    frameTimes.length = 0;
    healthyStreak = 0;
    severeRun = 0;
    overBudgetRun = 0;
    tierSettle = 0;
    settleFrames = Math.max(settleFrames, settle);
  }

  function schedule() {
    if (!running || hidden || rafId) return;
    rafId = requestAnimationFrame(frame);
  }

  function frame(now) {
    rafId = 0;
    hidden = doc.hidden === true;
    if (hidden) return;
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
        onFallback?.();
        toast('Raytrace <b>suspended</b> — the stage kept erroring', { duration: 3600 });
      }
    }
    schedule();
  }

  const rootEl = doc.documentElement;

  function frameStep(now) {
    /* The ray stage stays idle until an audio source starts or the user picks
       a mode. Drawing behind the first-run card would waste GPU and battery;
       the frame clock restarts cleanly when either path reveals the stage. */
    if (rootEl.classList.contains('mode-unchosen')) {
      lastFrameTs = now;
      return;
    }
    const ray = getRay();
    if (state.raytraceWanted && !ray.loading && !ray.ok && !fallbackNotified) {
      fallbackNotified = true;
      onFallback?.();
    }
    const { webgpuState, webgl2State, webgpuCanvas, startGpu, gpuDead } = getGpu();
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
    const audioOnly = input === 'spotify' || input === 'apple' || (input === 'stream' && engine.streamNoTap);
    const visualIdle = idle || audioOnly;
    if (audioOnly !== _audioOnly) {
      _audioOnly = audioOnly;
      rootEl.classList.toggle('audio-only-playback', audioOnly);
    }
    /* The render loop is the only thing that knows whether the stage is
       actually animating — toggle the class once per change so the CSS can
       drop the expensive chrome blur while it is (see style.css). */
    if (visualIdle !== _stageLive) {
      _stageLive = visualIdle;
      doc.documentElement.classList.toggle('stage-live', !visualIdle);
    }
    /* Starting playback after an idle spell can follow a cold GPU and a
       decoder start; the first intervals are not a verdict on the mode. */
    const resumed = _wasVisualIdle === true && !visualIdle;
    _wasVisualIdle = visualIdle;
    if (resumed) {
      lastFrameTs = now;
      resetSampling(SETTLE_AFTER_RESUME);
    }

    engine.syncExternal();
    const audioTime = idle ? 0 : engine.getTime();

    let levels = null;
    let freq = null;
    let wave = null;
    let stereoL = null;
    let stereoR = null;
    if (!visualIdle) {
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
    const rtOn = !audioOnly && state.raytraceWanted && ray.ok && !raySuspended && !isPluginMode(state.modeId);
    // Surface a runtime GPU context loss instead of silently swapping
    // renderers. A browser without WebGL2 is an expected capability fallback,
    // not an error to put over the first-run experience; the effective backend
    // is still reported in the Look panel.
    if (!audioOnly && state.raytraceWanted && !ray.ok && !ray.loading && ray.lost && !rayDropped) {
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
      const beatVal = audioOnly ? 0 : rtOn ? ray.beat : renderer.beat;
      if (Math.abs(beatVal - _lastBeatWritten) > 0.004) {
        _lastBeatWritten = beatVal;
        shellEl.style.setProperty('--beat', beatVal.toFixed(3));
      }
    }

    if (audioOnly) {
      rayCanvasEl.classList.remove('is-live');
      vizCanvasEl.classList.add('is-off');
      if (webgpuCanvas) webgpuCanvas.style.display = 'none';
    } else if (rtOn) {
      // raytraced stage owns every mode; the 2D renderer still advances its
      // beat envelope so chrome (VU, chips, favicon) keeps working
      if (ray.w !== renderer.w || ray.h !== renderer.h) ray.resize(renderer.w, renderer.h);
      rayCanvasEl.classList.add('is-live');
      vizCanvasEl.classList.add('is-off');
      if (webgpuCanvas) webgpuCanvas.style.display = 'none';
      renderer.updateAnalysis(levels, dtMs);
      /* drop slow-mo: scene time stretches (up to ~45%) while the drop
         envelope is hot. Analysis smoothing keeps the real dt so reactivity
         is untouched — only motion slows. */
      const drop = levels?.drop || 0;
      const dtMotion = dtMs * (1 - 0.45 * drop);
      ray.render(idle, freq, wave, levels, dtMotion, null, stereoL, stereoR);
    } else {
      if (idle) {
        _idle2dSkip = !_idle2dSkip;
        if (_idle2dSkip) return;
      } else {
        _idle2dSkip = false;
      }
      rayCanvasEl.classList.remove('is-live');
      if (state.modeId === 'gpu') startGpu?.();
      const gpuReady = !!(webgpuState || webgl2State) && !gpuDead;
      const gpuMode = state.modeId === 'gpu' && gpuReady;
      /* cap the fallback backing store the same way the ray stage does; at a
         4K panel and dpr 2 an uncapped canvas is ~33M pixels a frame */
      const gpuDpr = Math.min(renderer.dpr, 1.5);
      const gpuPx = renderer.w * renderer.h * gpuDpr * gpuDpr;
      const gpuScale = gpuPx > 2.1e6 ? gpuDpr * Math.sqrt(2.1e6 / gpuPx) : gpuDpr;
      const gpuW = Math.max(2, Math.round(renderer.w * gpuScale));
      const gpuH = Math.max(2, Math.round(renderer.h * gpuScale));
      if (webgpuCanvas && gpuReady && (webgpuCanvas.width !== gpuW || webgpuCanvas.height !== gpuH)) {
        webgpuCanvas.width = gpuW;
        webgpuCanvas.height = gpuH;
      }
      if (webgpuCanvas) webgpuCanvas.style.display = gpuMode ? 'block' : 'none';
      vizCanvasEl.classList.toggle('is-off', gpuMode);
      if (gpuMode && !idle && levels) {
        if (webgpuState) renderWebGPU(webgpuState, renderer.t, levels.level);
        else renderWebGL2(webgl2State, renderer.t, levels.level, gpuW, gpuH);
      } else {
        if (state.modeId !== 'gpu') gpuFallbackActive = false;
        const effMode = state.modeId === 'gpu' && !gpuMode;
        if (effMode && !gpuFallbackActive) {
          renderer.setMode('void');
          gpuFallbackActive = true;
        } else if (gpuMode && gpuFallbackActive) {
          renderer.setMode('gpu');
          gpuFallbackActive = false;
        }
        renderer.render(idle, freq, wave, levels, dtMs * (1 - 0.45 * (levels?.drop || 0)), stereoL, stereoR);
      }
    }

    if (!idle) {
      const t = audioTime;
      const dur = engine.getDuration();
      _seekAcc += dtMs;
      if (_seekAcc >= 80) {
        _seekAcc = 0;
        const pct = dur ? (t / dur) * 100 : 0;
        if (Math.abs(pct - _seekPct) >= 0.05) {
          _seekPct = pct;
          seekFillEl.style.width = `${pct}%`;
        }
      }
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
      if (_vuAcc >= 33) { _vuAcc = 0; if (!audioOnly) drawVu(); }
      _uiAcc += dtMs;
      if (_uiAcc >= 100) {
        _uiAcc = 0;
        if (audioOnly) {
          bpmValueEl.textContent = '--.--';
          bpmValueEl.title = '';
          bassChipEl.classList.add('is-hidden');
          moodChipEl.classList.add('is-hidden');
        } else {
          const bi = engine.beatInfo;
          /* A decoded file has a whole-track estimate; an early live lock can
             briefly disagree with it. Keep live tempo for sources without a
             decoded track, and for files until their analysis finishes. */
          const liveBpm = bi.bpm && bi.confidence > 0.25 ? bi.bpm : 0;
          const analyzedBpm = input === 'track' ? state.analyzedBpm : 0;
          const bpm = analyzedBpm || liveBpm || 0;
          bpmValueEl.textContent = bpm ? bpm.toFixed(2) : '--.--';
          bpmValueEl.title = analyzedBpm ? 'Analysed from the track'
            : liveBpm ? 'Live tempo lock' : '';
          bassChipEl.classList.toggle('is-hidden', !(renderer.sm.bass > 0.35));
          if (levels) {
            const mood = detectMood({ bpm: levels.bpm, bass: levels.bass, mid: levels.mid, high: levels.high, width: levels.width });
            if (mood) { moodValueEl.textContent = mood.tag; moodChipEl.classList.remove('is-hidden'); }
            else moodChipEl.classList.add('is-hidden');
          }
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

    // Sources without decoded audio have a still player view. No renderer
    // frame or adaptation sample should run against inaccessible audio.
    if (audioOnly) return;
    /* Idle is not a quality signal either: the raytrace stage already halves
       its own idle frame rate, and judging those frames against the playback
       sampler let an idle detour change the tier that playback then opened at.
       The idle->playing edge above restarts the sampler with settle frames. */
    if (idle) {
      frameTimes.length = 0;
      return;
    }

    // the interval, not this callback's CPU time — see src/adaptive.js
    rayBaselineEstimate = estimateBaseline(frameTimes, rayBaselineEstimate);
    const rayBaseline = baselineOr(rayBaselineEstimate);
    if (tierSettle > 0) {
      tierSettle--;
    } else if (settleFrames > 0) {
      settleFrames--;
      /* A mode change used to deliver 12 fully-rendered jank frames before the
         sampler had a single sample: at ~172ms that was two seconds of stutter
         in a row for Aurora Terrain before anything reacted. Settle exists so a
         spiky cold frame cannot poison the *average* window — but one interval
         three and a half times over budget is not noise, and the climb will
         undo a wrong guess in a couple of seconds. Step down right now. */
      /* one severe frame right after a switch is usually the mode's GPU
         pipeline being built on first draw (300ms on a real M1 display) —
         acting on it dropped every freshly picked mode to low and recorded
         low as its ceiling. Two in a row is the scene itself. */
      severeRun = isUsableInterval(frameGap) && frameGap > rayBaseline * SEVERE ? severeRun + 1 : 0;
      if (state.raytraceWanted && ray.ok && severeRun >= 2 && TIERS.indexOf(ray.quality) > 0) {
        const { tier } = nextTier(ray.quality, frameGap, state.rayQuality, rayBaseline);
        applyTier(ray, tier);
      }
    } else if (isUsableInterval(frameGap)) frameTimes.push(frameGap);
    /* Normally this waits for a full window before judging, but that window
       costs more wall-clock the slower things are — on a mode running several
       times over budget that was seconds of stutter before anything happened. shouldEvaluate() acts on a
       short window when every sample in it is severely over budget, which is
       not an ambiguous signal. See src/adaptive.js. */
    if (shouldEvaluate(frameTimes, rayBaseline)) {
      const samples = frameTimes;
      /* a window is the natural pace to revisit the baseline: one lucky frame
         can pin the session best below what the display ever achieves again,
         and relaxing per-frame would tie recovery speed to frame timing */
      rayBaselineEstimate = relaxBaseline(rayBaselineEstimate, samples);
      const relaxed = baselineOr(rayBaselineEstimate);
      /* judge the window on the same baseline it was just relaxed against;
         mixing the two made a borderline window change verdict between the
         cost calculation and the tier decision */
      const avg = windowCost(samples, relaxed);
      samples.length = 0;
      if (state.raytraceWanted && ray.ok) {
        overBudgetRun = Number.isFinite(avg) && avg > relaxed * OVER_BUDGET ? overBudgetRun + 1 : 0;
        const allowed = climbCeiling(state.rayQuality, state.rayQualityExplicit);
        const ceiling = climbCap && TIERS.indexOf(climbCap) < TIERS.indexOf(allowed)
          ? climbCap : allowed;
        const { tier, streak } = nextTier(
          ray.quality, avg, ceiling, relaxed, healthyStreak, overBudgetRun,
        );
        healthyStreak = streak;
        if (TIERS.indexOf(tier) < TIERS.indexOf(ray.quality)) {
          climbCap = tier;
          climbCaps.set(state.modeId, tier);
        }
        applyTier(ray, tier);
      } else {
        overBudgetRun = 0;
        const d2 = next2dQualityState(renderer.quality, avg, relaxed, healthy2d);
        healthy2d = d2.streak;
        renderer.setQuality(d2.quality);
      }
    }
  }

  function onVisibilityChange() {
    if (doc.hidden) {
      hidden = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      /* whatever window was in flight is no longer representative: the next
         samples after a hidden spell may include the resume gap and a cold
         GPU. Keep the learned baseline and tier, drop the evidence. */
      frameTimes.length = 0;
      healthyStreak = 0;
      severeRun = 0;
      overBudgetRun = 0;
      tierSettle = 0;
      return;
    }
    hidden = false;
    lastFrameTs = performance.now();
    resetSampling(SETTLE_AFTER_RESUME);
    schedule();
  }
  doc.addEventListener?.('visibilitychange', onVisibilityChange);

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
    start: () => {
      if (running) return;
      running = true;
      hidden = doc.hidden === true;
      if (hidden) return;
      lastFrameTs = performance.now();
      schedule();
    },
    scheduleResize,
    /** A mode change invalidates the tier the last mode adapted to. */
    /** @param {string} [modeId] the mode being switched to */
    resetAdaptation: (modeId = state.modeId) => {
      healthyStreak = 0;
      healthy2d = 0;
      climbCap = climbCaps.get(modeId) ?? null;
      severeRun = 0;
      overBudgetRun = 0;
      tierSettle = 0;
      settleFrames = SETTLE_AFTER_MODE_CHANGE;
      frameTimes.length = 0;
      lastFrameTs = performance.now();
    },
    resume: () => {
      raySuspended = false;
      lastFrameTs = performance.now();
      resetSampling(SETTLE_AFTER_RESUME);
    },
    isSuspended: () => raySuspended,
  };
}
