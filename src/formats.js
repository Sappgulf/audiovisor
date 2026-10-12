// @ts-check
/**
 * Accepted file types: the one list the picker, the drop handler and the
 * folder walk all read from, so a format is added in one place.
 *
 * Video is accepted because the browser decodes its audio track with
 * decodeAudioData; the picture is never shown. No imports here: this rides
 * in the eager bundle, so it stays a few hundred bytes.
 */
export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.aif', '.aiff', '.caf', '.weba'];
export const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.webm', '.ogv'];
export const PLAYLIST_EXTENSIONS = ['.m3u', '.m3u8', '.pls'];

/* The picker's accept attribute. Every extension in the three lists above
   must appear here literally: a MIME wildcard alone (audio/*) hides files
   whose type the OS does not report, such as .caf or .m3u8. */
export const ACCEPT_ATTR = 'audio/*,video/mp4,video/webm,video/quicktime,video/ogg,.m4a,.aac,.aif,.aiff,.caf,.opus,.oga,.weba,.flac,.m4v,.ogv,.mov,.m3u,.m3u8,.pls,.mp3,.wav,.ogg,.mp4,.webm';

/**
 * Lower-cased extension including the dot, or '' when there is none.
 * @param {string} [name]
 * @returns {string}
 */
export function extOf(name) {
  const m = /\.[^./\\]+$/.exec(String(name || ''));
  return m ? m[0].toLowerCase() : '';
}

/** @param {string} [name] */
export function isPlaylistFile(name) {
  return PLAYLIST_EXTENSIONS.includes(extOf(name));
}
