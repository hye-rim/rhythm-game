'use strict';

// 곡 데이터·채보 생성·판정 규칙 테스트. 실행: npm test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

test('every song builds the same chart every time', () => {
  for (const s of L.SONGS) assert.deepStrictEqual(L.buildSong(s), L.buildSong(s), s.id);
});

test('charts are playable: sorted, in range, balanced lanes, no long same-lane runs', () => {
  for (const s of L.SONGS) {
    const c = L.buildSong(s);
    assert.ok(c.notes.length > 50, s.id + ' has enough notes');
    assert.ok(c.notes[0].t > 1.2, s.id + ' leaves a lead-in');
    let run = 1;
    c.notes.forEach((n, i) => {
      assert.ok(n.lane >= 0 && n.lane < L.LANES, s.id + ' lane range');
      assert.ok(n.t < c.length, s.id + ' note inside the song');
      if (i) { assert.ok(n.t >= c.notes[i - 1].t, s.id + ' sorted'); run = n.lane === c.notes[i - 1].lane ? run + 1 : 1; assert.ok(run <= 3, s.id + ' same-lane run <= 3'); }
    });
    const counts = [0, 0, 0, 0]; c.notes.forEach((n) => counts[n.lane]++);
    counts.forEach((k) => assert.ok(k > c.notes.length * 0.1, s.id + ' lanes balanced ' + counts));
  }
});

test('written tunes fill exactly 16 steps per bar', () => {
  for (const s of L.SONGS.filter((x) => x.tune)) {
    s.tune.bars.forEach((b, i) => assert.strictEqual(L.parseBar(b).reduce((a, e) => a + e.len, 0), 16, s.id + ' bar ' + (i + 1)));
    assert.strictEqual(s.tune.chords.length, s.tune.bars.length, s.id + ' chords');
  }
});

test('judgement windows and score', () => {
  assert.strictEqual(L.judge(0.04), 'perfect');
  assert.strictEqual(L.judge(-0.09), 'great');
  assert.strictEqual(L.judge(0.13), 'good');
  assert.strictEqual(L.judge(0.2), null);
  assert.strictEqual(L.scoreOf({ perfect: 10, great: 0, good: 0 }, 10), 100000);
  assert.strictEqual(L.scoreOf({ perfect: 0, great: 10, good: 0 }, 10), 80000);
  assert.strictEqual(L.scoreOf({ perfect: 0, great: 0, good: 0 }, 0), 0);
  assert.deepStrictEqual(['S', 'A', 'B', 'C', 'D'], [95000, 85000, 70000, 50000, 0].map(L.gradeOf));
});
