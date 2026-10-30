import { describe, it, expect } from 'vitest';
import { pickRecorderMime } from '../src/recorder.js';

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
