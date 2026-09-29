'use strict';

// 리듬 탭의 곡 데이터와 채보 생성. 브라우저와 Node(테스트)가 같이 쓴다.
// 곡은 코드로 만든다: 같은 곡 번호면 언제나 같은 멜로디·드럼·채보가 나온다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RhythmLogic = factory();
})(this, function () {
  const LANES = 4;
  const WINDOW = { perfect: 0.05, great: 0.095, good: 0.14 };   // 판정 범위(초)
  const WEIGHT = { perfect: 1, great: 0.8, good: 0.5, miss: 0 };

  const SCALES = {
    major: [0, 2, 4, 7, 9],          // 메이저 펜타토닉
    minor: [0, 3, 5, 7, 10],         // 마이너 펜타토닉
  };

  // form: i=인트로(드럼만) A/B=노래 부분(4마디) o=마무리
  // rhythm: 한 마디(16칸)에서 노트가 놓이는 칸 번호들. 난이도가 높을수록 촘촘하다.
  const SONGS = [
    {
      id: 'malang', title: '말랑 팝', emoji: '🍡', color: '#ff8fc0', level: 1, levelName: '쉬움',
      bpm: 96, root: 60, scale: 'major', chords: [0, 7, 9, 5], form: 'iAABABo', fall: 1.7, lead: 'triangle',
      rhythmA: [[0, 4, 8, 12], [0, 4, 8, 10, 12], [0, 6, 8, 12], [0, 4, 6, 8, 12]],
      rhythmB: [[0, 4, 8, 12, 14], [0, 2, 4, 8, 12], [0, 4, 6, 8, 10, 12], [0, 6, 8, 12, 14]],
    },
    {
      id: 'penguin', title: '달려라 펭귄', emoji: '🐧', color: '#4fc3f7', level: 2, levelName: '보통',
      bpm: 128, root: 57, scale: 'minor', chords: [0, 8, 3, 10], form: 'iAABABAo', fall: 1.45, lead: 'square',
      rhythmA: [[0, 2, 4, 6, 8, 12], [0, 3, 6, 8, 11, 14], [0, 2, 4, 8, 10, 12, 14], [0, 4, 6, 8, 10, 12]],
      rhythmB: [[0, 2, 4, 6, 8, 10, 12, 14], [0, 3, 4, 6, 8, 11, 12, 14], [0, 2, 6, 8, 10, 12, 14, 15], [0, 4, 6, 7, 8, 12, 14]],
    },
    {
      id: 'arcade', title: '밤샘 오락실', emoji: '🕹️', color: '#ffd23f', level: 3, levelName: '어려움',
      bpm: 152, root: 52, scale: 'minor', chords: [0, 0, 8, 10], form: 'iAABAABBo', fall: 1.25, lead: 'sawtooth',
      rhythmA: [[0, 2, 3, 4, 6, 8, 10, 11, 12, 14], [0, 1, 2, 4, 6, 7, 8, 10, 12, 13, 14], [0, 2, 4, 5, 6, 8, 10, 12, 14, 15], [0, 3, 4, 6, 8, 9, 10, 12, 14]],
      rhythmB: [[0, 1, 2, 3, 4, 6, 8, 9, 10, 12, 13, 14], [0, 2, 3, 4, 5, 6, 8, 10, 11, 12, 14, 15], [0, 1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 14], [0, 2, 3, 4, 6, 7, 8, 10, 12, 13, 14, 15]],
    },
  ];

  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  // 한 곡을 만든다: { notes:[{t,lane}], lead:[{t,dur,midi}], bass, pad, kick, snare, hat, length }
  function buildSong(song) {
    const stepDur = 60 / song.bpm / 4;
    const scale = SCALES[song.scale];
    const degMidi = (deg, chordRoot) => song.root + chordRoot + 12 * Math.floor(deg / 5) + scale[((deg % 5) + 5) % 5] + 12;
    const out = { notes: [], lead: [], bass: [], pad: [], kick: [], snare: [], hat: [] };

    // 부분(A/B)마다 4마디 멜로디를 한 번만 만들어서 반복 때 그대로 쓴다
    const motifs = {};
    const makeMotif = (kind) => {
      const r = rng(hash(song.id + kind));
      const pats = kind === 'A' ? song.rhythmA : song.rhythmB;
      const bars = [];
      let deg = 5;                                   // 5..9 사이를 오간다 (중간 옥타브)
      for (let b = 0; b < 4; b++) {
        const pat = pats[b % pats.length];
        const steps = pat.map((s, i) => {
          if (i > 0 || b === 0) { const move = Math.floor(r() * 5) - 2; deg += move; }
          if (deg < 3) deg += 3; if (deg > 10) deg -= 3;
          return { step: s, deg };
        });
        bars.push(steps);
      }
      return bars;
    };
    const laneOfDeg = (deg) => Math.min(LANES - 1, Math.max(0, Math.floor(((deg - 3) / 8) * LANES)));

    let bar = 0;
    const barCount = { i: 1, A: 4, B: 4, o: 2 };
    for (const sec of song.form) {
      const n = barCount[sec];
      if (sec === 'A' || sec === 'B') motifs[sec] = motifs[sec] || makeMotif(sec);
      for (let b = 0; b < n; b++, bar++) {
        const t0 = bar * 16 * stepDur;
        const chord = song.chords[bar % song.chords.length];
        const beat = stepDur * 4;
        // 드럼: 킥 1·3박, 스네어 2·4박, 하이햇 8분음표
        for (let s = 0; s < 16; s += 4) {
          if (s === 0 || s === 8) out.kick.push(t0 + s * stepDur); else out.snare.push(t0 + s * stepDur);
        }
        if (song.bpm > 140) for (const s of [6, 14]) out.kick.push(t0 + s * stepDur);
        for (let s = 0; s < 16; s += 2) out.hat.push({ t: t0 + s * stepDur, open: s % 4 === 2 });
        // 베이스: 코드 뿌리음을 8분음표로
        for (let s = 0; s < 16; s += 2) out.bass.push({ t: t0 + s * stepDur, dur: stepDur * 1.8, midi: song.root + chord - 12 + (s % 8 === 6 ? 7 : 0) });
        // 패드: 마디 전체를 받쳐 주는 화음
        if (sec !== 'i') for (const iv of [0, scale[2], scale[3]]) out.pad.push({ t: t0, dur: beat * 4, midi: song.root + chord + iv });
        // 멜로디와 채보
        if (sec === 'A' || sec === 'B') {
          const steps = motifs[sec][b];
          let lastLane = -1, run = 0;
          steps.forEach((e, i) => {
            const t = t0 + e.step * stepDur;
            const next = steps[i + 1] ? steps[i + 1].step : 16;
            let lane = laneOfDeg(e.deg);
            // 같은 줄이 세 번 넘게 이어지면 옆 줄로 비껴 준다
            if (lane === lastLane) { run++; if (run >= 3) { lane = lane === 0 ? 1 : lane - 1 + (i % 2) * 2; lane = Math.min(LANES - 1, Math.max(0, lane)); run = 0; } } else run = 0;
            lastLane = lane;
            out.lead.push({ t, dur: Math.max(stepDur * 0.9, (next - e.step) * stepDur * 0.85), midi: degMidi(e.deg, chord) });
            out.notes.push({ t, lane });
          });
        }
        if (sec === 'o' && b === 1) out.lead.push({ t: t0, dur: beat * 3, midi: song.root + chord + 12 });
      }
    }
    out.length = bar * 16 * stepDur + 1.5;
    out.notes.sort((a, b) => a.t - b.t);
    // 같은 줄이 세 번을 넘겨 이어지면 옆 줄로 옮긴다 (곡 전체에서 한 번 더 훑는다)
    for (let i = 3, dir = 1; i < out.notes.length; i++) {
      const n = out.notes[i];
      if (n.lane === out.notes[i - 1].lane && n.lane === out.notes[i - 2].lane && n.lane === out.notes[i - 3].lane) {
        n.lane += (n.lane === 0 ? 1 : n.lane === LANES - 1 ? -1 : dir); dir = -dir;
      }
    }
    return out;
  }

  // 판정: 시간 차이(초)로 등급을 돌려준다. 범위 밖이면 null
  function judge(dt) {
    const d = Math.abs(dt);
    if (d <= WINDOW.perfect) return 'perfect';
    if (d <= WINDOW.great) return 'great';
    if (d <= WINDOW.good) return 'good';
    return null;
  }

  // 점수는 10만점 만점: 노트마다 등급 가중치를 더해서 전체 노트 수로 나눈다
  function scoreOf(counts, total) {
    const sum = counts.perfect * WEIGHT.perfect + counts.great * WEIGHT.great + counts.good * WEIGHT.good;
    return total ? Math.round((sum / total) * 100000) : 0;
  }
  const gradeOf = (score) => (score >= 95000 ? 'S' : score >= 85000 ? 'A' : score >= 70000 ? 'B' : score >= 50000 ? 'C' : 'D');

  return { LANES, WINDOW, WEIGHT, SONGS, buildSong, judge, scoreOf, gradeOf, rng };
});
