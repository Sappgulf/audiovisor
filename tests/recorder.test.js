import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRecorder } from '../src/recorder.js';

class FakeRecorder {
  static isTypeSupported() { return true; }
  constructor() { this.state = 'inactive'; this.mimeType = 'video/webm'; this.onstop = null; FakeRecorder.last = this; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; }
}

function fakeStream(audioTrack) {
  const tracks = [{ kind: 'video', stop: vi.fn() }];
  return {
    tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    addTrack(t) { tracks.push(t); },
    _audio: audioTrack,
  };
}

describe('recorder takes', () => {
  let prevWindow;
  let prevRecorder;
  let streams;

  beforeEach(() => {
    prevWindow = globalThis.window;
    prevRecorder = globalThis.MediaRecorder;
    globalThis.window = { MediaRecorder: FakeRecorder };
    globalThis.MediaRecorder = FakeRecorder;
    streams = [];
  });

  afterEach(() => {
    globalThis.window = prevWindow;
    globalThis.MediaRecorder = prevRecorder;
  });

  function make(audioTrack) {
    const dom = new JSDOM('<!doctype html><button id="record-btn"></button>');
    const canvas = {
      captureStream: () => { const s = fakeStream(audioTrack); streams.push(s); return s; },
    };
    const download = vi.fn();
    const rec = createRecorder({
      engine: { getRecordStream: () => ({ getAudioTracks: () => [audioTrack] }), buffer: null, fx: {} },
      getLiveCanvas: () => canvas,
      download,
      toast: () => {},
      doc: dom.window.document,
    });
    return { rec, download };
  }

  it('saving stops the take\'s own video track and leaves the shared audio track running', () => {
    const audio = { kind: 'audio', stop: vi.fn() };
    const { rec, download } = make(audio);
    rec.startRecording();
    FakeRecorder.last.ondataavailable?.({ data: new Blob(['abcde']) });
    const first = FakeRecorder.last;
    rec.stopRecording();
    first.onstop();
    expect(streams[0].getVideoTracks()[0].stop).toHaveBeenCalled();
    expect(audio.stop).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('a take still flushing does not take in the chunks of the next take', () => {
    const { rec, download } = make({ kind: 'audio', stop: vi.fn() });
    rec.startRecording();
    const first = FakeRecorder.last;
    first.ondataavailable({ data: new Blob(['abcde']) });
    rec.stopRecording();
    rec.startRecording();
    FakeRecorder.last.ondataavailable({ data: new Blob(['123456789']) });
    first.onstop();
    expect(download.mock.calls[0][0].size).toBe(5);
  });
});
