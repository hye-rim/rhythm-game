'use strict';

(() => {
  const L = window.RhythmLogic;
  const $ = (id) => document.getElementById(id);
  const cv = $('c'), g = cv.getContext('2d');
  const LANE_COLORS = ['#ff5fa2', '#ffd23f', '#4fc3f7', '#7ee081'];
  const KEYS = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
  const LEAD_IN = 3;                       // 시작 버튼을 누르고 첫 박자까지(초)
  const INK = '#2b1d52';

  // ---------- 저장 ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장이 막혀도 게임은 된다 */ } },
  };
  let scores = store.get('rhythmScores', {});
  let offsetMs = store.get('rhythmOffset', 0);
  const bestSum = () => L.SONGS.reduce((a, s) => a + (scores[s.id] || 0), 0);
  function saveScore(id, score) {
    const isNew = score > (scores[id] || 0);
    if (isNew) { scores[id] = score; store.set('rhythmScores', scores); }
    try { localStorage.setItem('rhythmBest', String(bestSum())); } catch (e) { /* 무시 */ }   // 로비 '내 기록'에서 읽는 값
    return isNew;
  }

  // ---------- 소리 ----------
  let ctx = null, master = null, noiseBuf = null;
  function initAudio() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    master = ctx.createGain(); master.gain.value = 0.8;
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function tone(type, midi, t, dur, vol, lp) {
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = type; o.frequency.value = hz(midi);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(vol, t + 0.012);
    gn.gain.setTargetAtTime(0.0001, t + Math.max(0.02, dur * 0.7), Math.max(0.03, dur * 0.15));
    let node = o;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); node = f; }
    node.connect(gn); gn.connect(master);
    o.start(t); o.stop(t + dur + 0.4);
  }
  function noise(t, dur, vol, type, freq) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = freq;
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(gn); gn.connect(master);
    s.start(t); s.stop(t + dur + 0.05);
  }
  function kick(t) {
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    gn.gain.setValueAtTime(0.9, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(gn); gn.connect(master); o.start(t); o.stop(t + 0.25);
  }
  function scheduleSong(chart, song, at) {
    chart.kick.forEach((t) => kick(at + t));
    chart.snare.forEach((t) => { noise(at + t, 0.16, 0.45, 'bandpass', 1900); tone('triangle', 52, at + t, 0.1, 0.25); });
    chart.hat.forEach((h) => noise(at + h.t, h.open ? 0.11 : 0.04, h.open ? 0.13 : 0.2, 'highpass', 7500));
    chart.bass.forEach((b) => tone('sawtooth', b.midi, at + b.t, b.dur, 0.2, 520));
    chart.pad.forEach((p) => tone('triangle', p.midi, at + p.t, p.dur, 0.035));
    chart.lead.forEach((l) => tone(song.lead, l.midi, at + l.t, l.dur, song.lead === 'sawtooth' ? 0.09 : 0.14, song.lead === 'sawtooth' ? 2600 : 0));
  }
  function hitSound(grade) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (grade === 'miss') return;
    tone('triangle', grade === 'perfect' ? 96 : 89, t, 0.06, 0.16);
    noise(t, 0.03, 0.12, 'highpass', 5000);
  }

  // ---------- 게임 상태 ----------
  let state = 'menu';           // menu | play | pause | result
  let song = null, chart = null, notes = [], laneQ = [[], [], [], []], head = [0, 0, 0, 0];
  let startAt = 0, counts, combo, maxCombo, judged, endHandled;
  let fx = { flash: [0, 0, 0, 0], rings: [], text: null, pulse: 0 };
  let W = 0, H = 0, dpr = 1;

  const songNow = () => (ctx ? ctx.currentTime - startAt - offsetMs / 1000 : -LEAD_IN);

  function startSong(s) {
    initAudio();
    if (ctx.state === 'suspended') ctx.resume();
    song = s; chart = L.buildSong(s);
    notes = chart.notes.map((n) => ({ t: n.t, lane: n.lane, done: false }));
    laneQ = [[], [], [], []]; head = [0, 0, 0, 0];
    notes.forEach((n) => laneQ[n.lane].push(n));
    counts = { perfect: 0, great: 0, good: 0, miss: 0 }; combo = 0; maxCombo = 0; judged = 0; endHandled = false;
    fx = { flash: [0, 0, 0, 0], rings: [], text: null, pulse: 0 };
    // 이전 곡의 소리가 남지 않게 컨텍스트를 새로 만든다
    ctx.close(); ctx = null; initAudio();
    startAt = ctx.currentTime + LEAD_IN;
    scheduleSong(chart, s, startAt);
    setState('play');
  }

  function setState(s) {
    state = s;
    $('menu').hidden = s !== 'menu';
    $('pause').hidden = s !== 'pause';
    $('result').hidden = s !== 'result';
    $('pauseBtn').hidden = s !== 'play';
    if (s !== 'play') resize();          // 곡 중에 미뤄 둔 크기 변화를 반영
  }

  function pause() { if (state !== 'play') return; ctx.suspend(); setState('pause'); }
  function resume() { if (state !== 'pause') return; ctx.resume(); setState('play'); }
  function toMenu() { if (ctx) { ctx.close(); ctx = null; } renderSongs(); setState('menu'); }

  function judgeNote(n, grade) {
    n.done = true; judged++;
    counts[grade]++;
    if (grade === 'miss') combo = 0; else { combo++; maxCombo = Math.max(maxCombo, combo); }
    fx.text = { grade, t: performance.now() };
    if (grade !== 'miss') { fx.rings.push({ lane: n.lane, t: performance.now(), grade }); hitSound(grade); }
  }

  function press(lane) {
    if (state !== 'play') return;
    fx.flash[lane] = 1;
    update();
    const now = songNow();
    const q = laneQ[lane];
    while (head[lane] < q.length && q[head[lane]].done) head[lane]++;
    const n = q[head[lane]];
    if (!n) return;
    const grade = L.judge(n.t - now);
    if (grade) { judgeNote(n, grade); head[lane]++; }
  }

  function update() {
    if (state !== 'play') return;
    const now = songNow();
    for (let l = 0; l < 4; l++) {
      const q = laneQ[l];
      while (head[l] < q.length && (q[head[l]].done || now - q[head[l]].t > L.WINDOW.good)) {
        if (!q[head[l]].done) judgeNote(q[head[l]], 'miss');
        head[l]++;
      }
    }
    if (!endHandled && now > chart.length) { endHandled = true; finish(); }
  }

  function finish() {
    const total = notes.length;
    const score = L.scoreOf(counts, total), grade = L.gradeOf(score);
    const isNew = saveScore(song.id, score);
    $('rTitle').textContent = song.emoji + ' ' + song.title;
    $('rGrade').textContent = grade;
    $('rScore').textContent = score.toLocaleString();
    $('rNew').hidden = !isNew;
    const tag = counts.miss === 0 && counts.good === 0 && counts.great === 0 ? '올 퍼펙트!' : counts.miss === 0 ? '풀 콤보!' : '';
    $('rStats').innerHTML = (tag ? `<dt></dt><dd>🎉 ${tag}</dd>` : '') +
      `<dt>퍼펙트</dt><dd>${counts.perfect}</dd><dt>그레이트</dt><dd>${counts.great}</dd><dt>굿</dt><dd>${counts.good}</dd><dt>미스</dt><dd>${counts.miss}</dd><dt>최대 콤보</dt><dd>${maxCombo}</dd>`;
    ctx.suspend();
    setState('result');
  }

  // ---------- 그리기 ----------
  // 곡을 치는 중에 화면 높이만 조금 바뀌는 건(아이폰 사파리 주소창이 접히거나 펴질 때) 무시한다.
  // 그때마다 판을 다시 맞추면 판정선과 버튼이 통째로 위아래로 출렁인다. 폭이 바뀌거나 곡 밖이면 다시 맞춘다
  function resize(force) {
    const w = window.innerWidth, h = window.innerHeight;
    if (force !== true && state === 'play' && w === W && Math.abs(h - H) < 160) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = w; H = h;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', () => resize());
  const field = () => { const pw = Math.min(W, 520); return { pw, x0: (W - pw) / 2, lw: pw / 4, judgeY: Math.round(H * 0.8) }; };

  const GRADE_TEXT = { perfect: ['PERFECT', '#ffd23f'], great: ['GREAT', '#7ee081'], good: ['GOOD', '#4fc3f7'], miss: ['MISS', '#ff6b6b'] };
  function outlined(text, x, y, size, color) {
    g.font = `${size}px Jua, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = Math.max(4, size / 6); g.strokeStyle = INK; g.strokeText(text, x, y);
    g.fillStyle = color; g.fillText(text, x, y);
  }
  function roundRect(x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function draw() {
    g.clearRect(0, 0, W, H);
    if (!song || state === 'menu') return;
    const { pw, x0, lw, judgeY } = field();
    const now = songNow();
    const speed = (judgeY - 70) / song.fall;
    const beat = 60 / song.bpm;

    // 줄 바탕
    g.fillStyle = 'rgba(43,29,82,.45)'; g.fillRect(x0, 0, pw, H);
    for (let l = 0; l < 4; l++) {
      if (l % 2 === 0) { g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x0 + l * lw, 0, lw, H); }
      const f = fx.flash[l];
      if (f > 0.01) { const gr = g.createLinearGradient(0, judgeY - 220, 0, judgeY); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, LANE_COLORS[l] + Math.round(f * 150).toString(16).padStart(2, '0')); g.fillStyle = gr; g.fillRect(x0 + l * lw, judgeY - 220, lw, 220); }
    }
    // 박자선: 스크롤이 눈에 보이게
    g.strokeStyle = 'rgba(255,255,255,.13)'; g.lineWidth = 2;
    const k0 = Math.floor(now / beat);
    for (let k = k0; k < k0 + song.fall / beat + 3; k++) {
      const y = judgeY - (k * beat - now) * speed;
      if (y < 0 || y > judgeY) continue;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + pw, y); g.stroke();
    }
    g.strokeStyle = INK; g.lineWidth = 3;
    g.strokeRect(x0, -3, pw, H + 6);

    // 노트
    const nw = lw - 14, nh = 30;
    for (const n of notes) {
      if (n.done) continue;
      const y = judgeY - (n.t - now) * speed;
      if (y < -nh || y > H + nh) continue;
      const x = x0 + n.lane * lw + 7;
      g.fillStyle = INK; roundRect(x - 3, y - nh / 2 - 3 + 4, nw + 6, nh + 6, 13); g.fill();
      g.fillStyle = LANE_COLORS[n.lane]; roundRect(x, y - nh / 2, nw, nh, 10); g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)'; roundRect(x + 5, y - nh / 2 + 4, nw - 10, 7, 4); g.fill();
    }

    // 판정선과 패드
    g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(x0, judgeY - 2, pw, 4);
    for (let l = 0; l < 4; l++) {
      const pressed = fx.flash[l] > 0.5;
      const py = judgeY + 14 + (pressed ? 3 : 0), ph = Math.max(46, Math.min(H - py - 14, 96));
      g.fillStyle = INK; roundRect(x0 + l * lw + 5, py + 5 - (pressed ? 3 : 0), lw - 10, ph, 16); g.fill();
      g.fillStyle = pressed ? '#fff' : LANE_COLORS[l]; roundRect(x0 + l * lw + 5, py, lw - 10, ph, 16); g.fill();
      g.strokeStyle = INK; g.lineWidth = 3; roundRect(x0 + l * lw + 5, py, lw - 10, ph, 16); g.stroke();
      outlined('DFJK'[l], x0 + l * lw + lw / 2, py + ph / 2, 20, '#fff');
    }

    // 링 효과
    const tNow = performance.now();
    fx.rings = fx.rings.filter((r) => tNow - r.t < 320);
    for (const r of fx.rings) {
      const p = (tNow - r.t) / 320;
      g.strokeStyle = r.grade === 'perfect' ? '#ffd23f' : '#fff'; g.globalAlpha = 1 - p; g.lineWidth = 5;
      g.beginPath(); g.arc(x0 + r.lane * lw + lw / 2, judgeY, 14 + p * 34, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
    }

    // 점수·진행 막대·콤보·판정
    const total = notes.length;
    const score = L.scoreOf(counts, total);
    const prog = Math.max(0, Math.min(1, now / chart.length));
    g.fillStyle = 'rgba(43,29,82,.7)'; g.fillRect(0, 0, W, 6);
    g.fillStyle = '#ffd23f'; g.fillRect(0, 0, W * prog, 6);
    g.textAlign = 'left';
    outlined(score.toLocaleString(), x0 + 12 + String(score.toLocaleString()).length * 7.5, 34, 26, '#fff');
    if (combo >= 2) outlined(String(combo), W / 2, H * 0.32, 64, '#ffd23f');
    if (combo >= 2) outlined('COMBO', W / 2, H * 0.32 + 42, 18, '#fff');
    if (fx.text) {
      const age = tNow - fx.text.t;
      if (age < 450) { const [txt, col] = GRADE_TEXT[fx.text.grade]; g.globalAlpha = 1 - age / 450; outlined(txt, W / 2, judgeY - 90 - age * 0.03, 30, col); g.globalAlpha = 1; }
    }
    for (let l = 0; l < 4; l++) fx.flash[l] = Math.max(0, fx.flash[l] - 0.07);

    // 카운트다운
    if (now < 0) {
      const c = Math.ceil(-now);
      outlined(c <= LEAD_IN ? String(c) : '', W / 2, H * 0.4, 110, '#fff');
      outlined(song.emoji + ' ' + song.title, W / 2, H * 0.4 - 100, 30, '#fff');
    }
  }

  function loop() { update(); draw(); requestAnimationFrame(loop); }
  setInterval(update, 40);               // 화면 갱신이 느려져도 놓친 음표 판정은 제때 하도록

  // ---------- 입력 ----------
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state !== 'play') return;
    const { x0, lw } = field();
    // 캔버스가 CSS로 확대·축소되거나 좌우에 여백이 생겨도 줄 판정이 어긋나지 않게
    // 화면 좌표를 캔버스 내부 좌표로 먼저 변환한다.
    const rect = cv.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) * (W / rect.width);
    const lane = Math.floor((canvasX - x0) / lw);
    if (lane >= 0 && lane < 4) press(lane);
  });
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code in KEYS) { press(KEYS[e.code]); return; }
    if (e.code === 'Escape') { state === 'play' ? pause() : state === 'pause' ? resume() : 0; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  // ---------- 화면 ----------
  function renderSongs() {
    $('songs').innerHTML = L.SONGS.map((s) => {
      const sc = scores[s.id] || 0;
      return `<button class="song" data-id="${s.id}">
        <span class="em" style="background:${s.color}">${s.emoji}</span>
        <span class="mid"><div class="nm">${s.title}</div><div class="meta">${'★'.repeat(s.level)}${'☆'.repeat(4 - s.level)} ${s.levelName} · BPM ${s.bpm}${s.credit ? ' · ' + s.credit : ''}</div></span>
        <span class="best">${sc ? `${L.gradeOf(sc)}<b>${sc.toLocaleString()}</b>` : '<b>-</b>'}</span></button>`;
    }).join('');
  }
  $('songs').addEventListener('click', (e) => {
    const b = e.target.closest('.song'); if (!b) return;
    startSong(L.SONGS.find((s) => s.id === b.dataset.id));
  });
  const showOffset = () => { $('syncVal').textContent = (offsetMs > 0 ? '+' : '') + offsetMs + 'ms'; };
  const nudge = (d) => { offsetMs = Math.max(-200, Math.min(200, offsetMs + d)); store.set('rhythmOffset', offsetMs); showOffset(); };
  $('syncMinus').onclick = () => nudge(-10);
  $('syncPlus').onclick = () => nudge(10);
  $('pauseBtn').addEventListener('pointerdown', (e) => { e.stopPropagation(); pause(); });
  $('resumeBtn').onclick = resume;
  $('retryBtn').onclick = () => startSong(song);
  $('retryBtn2').onclick = () => startSong(song);
  $('menuBtn').onclick = toMenu;
  $('menuBtn2').onclick = toMenu;

  resize(); renderSongs(); showOffset(); setState('menu'); loop();
  /* @test-hooks:start */
  window.__rh = { press, update, draw, songNow, startSong, get counts() { return counts; }, get state() { return state; }, get notes() { return notes; }, get startAt() { return startAt; }, get ctx() { return ctx; }, finish };
  /* @test-hooks:end */
})();
