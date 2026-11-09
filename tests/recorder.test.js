import { describe, it, expect, vi, afterEach } from 'vitest';
import { pickRecorderMime, createRecorder } from '../src/recorder.js';

function fakeCtor(supported) {
  return { isTypeSupported: (mime) => supported.includes(mime) };
}

describe('recorder container selection', () => {
  it('prefers VP9 WebM', () => {
    expect(pickRecorderMime(fakeCtor(['video/webm;codecs=vp9,opus', 'video/webm']))).toEqual({
      mime: 'video/webm;codecs=vp9,opus', ext: 'webm',
    });
  });

  it('falls back to MP4 on Safari', () => {
    expect(pickRecorderMime(fakeCtor(['video/mp4']))).toEqual({ mime: 'video/mp4', ext: 'mp4' });
  });

  it('returns a safe default when nothing is advertised', () => {
    expect(pickRecorderMime(fakeCtor([]))).toEqual({ mime: '', ext: 'webm' });
  });

  it('returns null without MediaRecorder', () => {
    expect(pickRecorderMime(null)).toBeNull();
  });
});

describe('session recording lifecycle', () => {
  const savedWindow = globalThis.window;
  const savedMediaRecorder = globalThis.MediaRecorder;

  afterEach(() => {
    globalThis.window = savedWindow;
    if (savedMediaRecorder === undefined) delete globalThis.MediaRecorder;
    else globalThis.MediaRecorder = savedMediaRecorder;
  });

  function fakeTrack(kind) {
    return { kind, stop: vi.fn() };
  }

  function setup() {
    const videoTrack = fakeTrack('video');
    const audioTrack = fakeTrack('audio');
    const stream = {
      getTracks: () => [videoTrack],
      getAudioTracks: () => [audioTrack],
      addTrack: vi.fn(),
    };
    const audioStream = { getAudioTracks: () => [audioTrack] };
    const engine = { getRecordStream: () => audioStream };
    const download = vi.fn();
    const toast = vi.fn();
    const canvas = { captureStream: () => stream };

    class FakeMediaRecorder {
      static isTypeSupported() { return true; }
      constructor() { this.state = 'inactive'; FakeMediaRecorder.last = this; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)]) });
        setTimeout(() => this.onstop?.(), 0);
      }
      pause() { this.state = 'paused'; }
      resume() { this.state = 'recording'; }
    }
    globalThis.MediaRecorder = FakeMediaRecorder;
    globalThis.window = { MediaRecorder: FakeMediaRecorder };

    const recorder = createRecorder({
      engine,
      getLiveCanvas: () => canvas,
      download,
      toast,
      doc: { getElementById: () => null },
    });
    return { recorder, videoTrack, audioTrack, download, stream };
  }

  it('never stops the engine-owned audio track', async () => {
    const { recorder, videoTrack, audioTrack, stream, download } = setup();
    recorder.startRecording();
    expect(stream.addTrack).toHaveBeenCalled();
    recorder.stopRecording();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(videoTrack.stop).toHaveBeenCalled();
    expect(audioTrack.stop).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('can record a second time with the same audio track', async () => {
    const { recorder, audioTrack, download } = setup();
    recorder.startRecording();
    recorder.stopRecording();
    await new Promise((resolve) => setTimeout(resolve, 10));
    recorder.startRecording();
    recorder.stopRecording();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(download).toHaveBeenCalledTimes(2);
    expect(audioTrack.stop).not.toHaveBeenCalled();
  });

  it('survives a rapid stop followed by a new start', async () => {
    const { recorder, audioTrack, download } = setup();
    recorder.startRecording();
    recorder.stopRecording();
    recorder.startRecording();
    recorder.stopRecording();
    await new Promise((resolve) => setTimeout(resolve, 10));
    /* the first onstop finalises its own file and must not tear down the
       second recording's state */
    expect(download).toHaveBeenCalledTimes(2);
    expect(audioTrack.stop).not.toHaveBeenCalled();
  });
});
