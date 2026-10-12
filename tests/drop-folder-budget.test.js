/**
 * The folder walk's total budget. Per-level limits alone let a tree of empty
 * folders grow without end; every folder visited now counts against one budget.
 */
import { describe, it, expect } from 'vitest';
import { walkDroppedEntries } from '../src/drop-folder.js';

/** A folder whose every child is another folder `fan` wide, counting the reads. */
function fanout(name, fan, counter) {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader() {
      counter.reads++;
      let sent = false;
      return {
        readEntries(cb) {
          if (sent) return cb([]);
          sent = true;
          cb(Array.from({ length: fan }, (_, i) => fanout(`${name}/${i}`, fan, counter)));
        },
      };
    },
  };
}

describe('folder walk budget', () => {
  it('stops visiting once the node budget is spent, even when nothing is media', async () => {
    const counter = { reads: 0 };
    const out = await walkDroppedEntries([fanout('root', 2000, counter)]);
    expect(out).toEqual([]);
    expect(counter.reads).toBeGreaterThan(0);
    expect(counter.reads).toBeLessThanOrEqual(5000);
  });
});
