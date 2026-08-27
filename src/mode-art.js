/*
 * The stage's quiet caption layer: one chapter, title and line of copy per
 * mode, shown bottom-left while that mode plays. The renderer paints the
 * world on black; this just names it.
 */
export const MODE_ART = Object.freeze({
  bars: {
    chapter: '01 / FIRST LIGHT',
    title: 'Build the skyline',
    story: 'Pillars rise where the kick lands, turning rhythm into architecture.',
  },
  waves: {
    chapter: '02 / THE CURRENT',
    title: 'Follow the river',
    story: 'A liquid waveform carries the song from the horizon to your hands.',
  },
  scope: {
    chapter: '03 / TRUE NORTH',
    title: 'Find the center',
    story: 'Two voices cross in the dark and draw a compass from their motion.',
  },
  particles: {
    chapter: '04 / CONSTELLATIONS',
    title: 'Gather the sparks',
    story: 'Every small sound becomes a star in a field that never holds still.',
  },
  kaleido: {
    chapter: '05 / THE GARDEN',
    title: 'Open the flower',
    story: 'A single pulse unfolds into a crystal mandala with no final petal.',
  },
  spectro: {
    chapter: '06 / MEMORY WATER',
    title: 'Read the weather',
    story: 'Harmonics fall in layers, leaving a luminous record of the song behind.',
  },
  tunnel: {
    chapter: '07 / DEEP LISTENING',
    title: 'Go further in',
    story: 'Concentric doors open toward the next downbeat, one impossible room at a time.',
  },
  plasma: {
    chapter: '08 / ORBITAL HEAT',
    title: 'Hold the charge',
    story: 'The bass becomes a magnetic storm, circling a heart of liquid light.',
  },
  terrain: {
    chapter: '09 / AFTERGLOW',
    title: 'Cross the valley',
    story: 'Frequency ridges become mountains while the melody searches for dawn.',
  },
  city: {
    chapter: '10 / NIGHT DRIVE',
    title: 'Leave a signal',
    story: 'The city answers in windows, rain, and a bright road through the middle.',
  },
  nebula: {
    chapter: '11 / BIRTH CLOUD',
    title: 'Become weather',
    story: 'The track exhales into color, gathering dust until a new world appears.',
  },
  spiral: {
    chapter: '12 / THE LONG LOOP',
    title: 'Return transformed',
    story: 'A melody circles back as a galaxy, familiar and larger than before.',
  },
  orb: {
    chapter: '13 / HEARTBEAT',
    title: 'Keep the pulse',
    story: 'One glowing core gathers the whole room and beats it back to you.',
  },
  fluid: {
    chapter: '14 / MERCURY DREAM',
    title: 'Let the edges melt',
    story: 'Chrome ribbons forget their shape and discover a softer kind of gravity.',
  },
  tensor: {
    chapter: '15 / THE MESH',
    title: 'Connect the distance',
    story: 'Invisible relationships surface as a living lattice around the beat.',
  },
  prism: {
    chapter: '16 / FIRST COLOR',
    title: 'Split the light',
    story: 'One note passes through glass and returns as a spectrum of possibilities.',
  },
  void: {
    chapter: '17 / THE SILENCE',
    title: 'Orbit the unknown',
    story: 'The quiet is not empty; it bends every stray signal toward its center.',
  },
  bloomfield: {
    chapter: '18 / OPEN GROUND',
    title: 'Let it grow',
    story: 'Small harmonies become a field of luminous flowers reaching for the refrain.',
  },
  fractal: {
    chapter: '19 / INFINITE REPRISE',
    title: 'Repeat, then change',
    story: 'The same motif keeps opening, each return revealing a smaller universe.',
  },
  radar: {
    chapter: '20 / THE LISTENING POST',
    title: 'Wait for the mark',
    story: 'A patient sweep catches every arriving beat before it becomes a story.',
  },
  lava: {
    chapter: '21 / SLOW FIRE',
    title: 'Take your time',
    story: 'Warm shapes rise, merge, and drift apart on the song’s deepest breath.',
  },
  gpu: {
    chapter: '22 / THE ENGINE',
    title: 'Wake the machine',
    story: 'A crystalline core turns computation into color and sends it outward.',
  },
  vinyl: {
    chapter: '23 / THE GROOVE',
    title: 'Stay in the loop',
    story: 'The record remembers every turn, carrying the last note back to the first.',
  },
});

export function modeArt(id) {
  return MODE_ART[id] || MODE_ART.bars;
}
