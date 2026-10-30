const STAGE_COUNT = 5;
const GATE_X = i => 690 + i * 750;
const LANES = [132, 290, 448];
const RECOMMENDED_COLOR = '#dcef93';
const OTHER_COLORS = ['#f3c082', '#e9b8a0', '#ee987e'];
const FINISH_X = GATE_X(4) + 260;
const $ = id => document.getElementById(id);
const canvas = $('game-canvas');
const ctx = canvas.getContext('2d');
let state = null;
let keys = new Set();
let previousTime = 0;
let audioContext = null;
let soundOn = false;
let selectedPriority = null;

function plansFor(topic, stage, priority = state?.priority) {
  const current = topic.steps[stage];
  const matches = current.options.flatMap((option, index) => option.values.includes(priority) ? [index] : []);
  const recommended = matches.includes(current.ai) ? current.ai : matches[0] ?? current.ai;
  return { options: current.options, recommended };
}

function recommendedFor(stage) {
  return state.decisions[stage]?.recommended ?? plansFor(state.topic, stage).recommended;
}

function planColor(stage, lane) {
  return recommendedFor(stage) === lane ? RECOMMENDED_COLOR : OTHER_COLORS[lane];
}

function playTone(frequency = 440) {
  if (!soundOn) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.055, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .17);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + .17);
  } catch (_) { /* Audio is optional. */ }
}

function topicById(id) { return TOPICS.find(topic => topic.id === id); }

function updateStartButton() {
  const topic = topicById($('start-button').dataset.topic);
  $('start-button').disabled = !(topic && selectedPriority);
  $('composer-prompt').textContent = topic && selectedPriority
    ? `${topic.label} · 지금의 우선순위: ${selectedPriority}`
    : topic ? '이 고민에서 먼저 지키고 싶은 것을 골라주세요'
      : selectedPriority ? '고민할 질문을 골라주세요' : '질문과 우선순위를 고르면 산책할 수 있어요';
  document.querySelector('.chat-composer').classList.toggle('ready', !!(topic && selectedPriority));
}

function renderPriorityOptions() {
  const container = $('priority-options');
  container.replaceChildren();
  VALUES.forEach(value => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'priority-option';
    button.setAttribute('role', 'radio'); button.setAttribute('aria-checked', 'false');
    button.textContent = value;
    button.addEventListener('click', () => {
      selectedPriority = value;
      container.querySelectorAll('.priority-option').forEach(option => option.setAttribute('aria-checked', String(option === button)));
      updateStartButton();
    });
    container.append(button);
  });
}

function renderTopicOptions() {
  const container = $('topic-options');
  container.replaceChildren();
  TOPICS.forEach((topic, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'topic-option';
    button.setAttribute('role', 'radio'); button.setAttribute('aria-checked', 'false');
    button.innerHTML = `<span class="option-number">0${index + 1}</span><strong></strong><span class="check" aria-hidden="true">✓</span>`;
    button.querySelector('strong').textContent = topic.question;
    button.addEventListener('click', () => {
      container.querySelectorAll('.topic-option').forEach(option => option.setAttribute('aria-checked', 'false'));
      button.setAttribute('aria-checked', 'true');
      $('user-question').textContent = topic.question;
      $('user-message').classList.remove('hidden');
      $('topic-confirmation').textContent = '좋아요. 이 고민을 함께 걸어볼게요. 먼저 지금 중요하게 여기는 것을 골라주세요.';
      $('assistant-reply').classList.remove('hidden');
      document.querySelector('.welcome-lockup').classList.add('conversation-started');
      $('start-button').dataset.topic = topic.id;
      updateStartButton();
      document.querySelector('.conversation-scroll').scrollTop = 0;
      playTone(520);
    });
    container.append(button);
  });
}

function showScreen(name) {
  ['intro', 'game', 'ending'].forEach(id => $(id).classList.toggle('hidden', id !== name));
  window.scrollTo(0, 0);
}

function startGame(topic, priority) {
  state = {
    topic, priority, plan: '아직 선택하지 않았습니다', destinationY: 290,
    stage: 0, phase: 'walking', player: { x: 120, y: 290 },
    trail: [{ x: 120, y: 290 }], trailSvgPath: '', decisions: [], lastForkY: 290, visitedChoiceIndex: -1,
    dogMood: 'calm', tension: false, intentAway: false, feedbackMode: '', planPromptVisible: false,
    dog: { x: 195, y: 290, pose: 'walking', refusalTime: 0 },
    hint: 'D를 눌러 갈림길로 걸어가세요 →'
  };
  keys.clear(); previousTime = 0;
  $('original-goal').textContent = topic.question;
  $('axis-label').textContent = `${topic.label} · 서로 다른 삶의 선택`;
  const startPoint = trailOverviewPoint(state.trail[0]);
  state.trailSvgPath = `M${startPoint.x},${startPoint.y}`;
  $('trail-overview-line').setAttribute('d', state.trailSvgPath);
  $('trail-overview-current').setAttribute('cx', startPoint.x);
  $('trail-overview-current').setAttribute('cy', startPoint.y);
  updateHUD();
  showScreen('game');
  resizeCanvas();
  canvas.focus?.();
  requestAnimationFrame(frame);
}

function updateHUD() {
  if (!state) return;
  const { topic, stage } = state;
  $('current-goal').textContent = `${state.priority} · ${state.plan}`;
  $('progress-text').textContent = stage < STAGE_COUNT ? `${String(stage + 1).padStart(2, '0')} / 05` : '05 / 05';
  $('progress-dots').replaceChildren();
  for (let i = 0; i < STAGE_COUNT; i++) {
    const dot = document.createElement('i');
    dot.className = i < stage ? 'done' : i === stage ? 'active' : '';
    $('progress-dots').append(dot);
  }
  if (stage < STAGE_COUNT) {
    const step = topic.steps[stage];
    const plans = plansFor(topic, stage);
    $('stage-number').textContent = `CROSSROAD ${String(stage + 1).padStart(2, '0')}`;
    $('stage-title').textContent = step.title;
    $('stage-prompt').textContent = step.prompt;
    $('stage-plans').replaceChildren();
    plans.options.forEach((choice, index) => {
      const row = document.createElement('div');
      row.className = `plan-row${index === plans.recommended ? ' recommended' : ''}`;
      const number = document.createElement('b'); number.textContent = `${index + 1}안`;
      const detail = document.createElement('span');
      const name = document.createElement('strong'); name.textContent = choice.title;
      const benefit = document.createElement('small'); benefit.textContent = `좋은 점 · ${choice.benefit}`;
      const cost = document.createElement('small'); cost.textContent = `감수할 점 · ${choice.cost}`;
      detail.append(name, benefit, cost); row.append(number, detail);
      if (index === plans.recommended) {
        const badge = document.createElement('em'); badge.textContent = 'AI 추천'; row.append(badge);
      }
      $('stage-plans').append(row);
    });
    $('plan-composer-options').replaceChildren();
    plans.options.forEach((choice, index) => {
      const row = document.createElement('div');
      row.className = `plan-composer-option${index === plans.recommended ? ' recommended' : ''}`;
      const number = document.createElement('b'); number.textContent = `${index + 1}안`;
      const detail = document.createElement('span');
      const name = document.createElement('strong'); name.textContent = choice.title;
      const benefit = document.createElement('small'); benefit.textContent = `좋은 점 · ${choice.benefit}`;
      const cost = document.createElement('small'); cost.textContent = `감수할 점 · ${choice.cost}`;
      detail.append(name, benefit, cost); row.append(number, detail);
      if (index === plans.recommended) {
        const badge = document.createElement('em'); badge.textContent = 'AI 추천'; row.append(badge);
      }
      $('plan-composer-options').append(row);
    });
    state.planPromptVisible = true;
    $('stage-plans').setAttribute('aria-hidden', 'true');
    $('plan-composer').removeAttribute('aria-hidden');
    $('game').classList.add('plan-prompt-open', 'plan-prompt-enter');
    requestAnimationFrame(() => requestAnimationFrame(() => $('game').classList.remove('plan-prompt-enter')));
    const suggested = plans.options[plans.recommended];
    $('dog-recommendation').textContent = `‘${state.priority}’에 무게를 둔다면 “${suggested.title}” 쪽을 제안해요. ${suggested.benefit} 다만 ${suggested.cost}`;
  } else {
    $('stage-number').textContent = 'THE LAST STRETCH';
    $('stage-title').textContent = '마지막 길을 걸어가세요';
    $('stage-prompt').textContent = '다섯 선택의 흔적을 가지고 끝까지 걸어가세요.';
    $('stage-plans').replaceChildren();
    $('plan-composer-options').replaceChildren();
    state.planPromptVisible = false;
    $('stage-plans').removeAttribute('aria-hidden');
    $('plan-composer').setAttribute('aria-hidden', 'true');
    $('game').classList.remove('plan-prompt-open', 'plan-prompt-enter');
    $('dog-recommendation').textContent = '“이제 당신이 고른 길을 함께 걸어갈게요.”';
  }
  updateDogFeedback();
  $('movement-hint').textContent = state.hint;
}

function updateDogFeedback() {
  if (!state) return;
  const mode = state.tension ? 'refusing' : state.dogMood;
  if (mode === state.feedbackMode) return;
  state.feedbackMode = mode;
  $('dog-message').classList.toggle('refusing', mode === 'refusing' || mode === 'reluctant');
  $('dog-feedback').textContent = mode === 'refusing'
    ? '강아지가 멈춰 서서 버팁니다. 목줄이 팽팽해집니다.'
    : mode === 'reluctant'
      ? '잠시 바닥에 누워 버티다가 다시 일어났습니다.'
      : state.phase === 'finish' ? '마지막 길은 함께 편안하게 걸어갑니다.' : '추천 경로에서는 발걸음이 훨씬 가벼워집니다.';
}

function settlePlanComposer() {
  if (!state?.planPromptVisible) return;
  state.planPromptVisible = false;
  $('stage-plans').removeAttribute('aria-hidden');
  $('plan-composer').setAttribute('aria-hidden', 'true');
  $('game').classList.remove('plan-prompt-open', 'plan-prompt-enter');
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function getScale() {
  const rect = canvas.getBoundingClientRect();
  return { w: rect.width, h: rect.height, sy: rect.height / 580, sx: Math.min(1, rect.width / 1000) };
}

function trailOverviewPoint(point) {
  return {
    x: +(16 + (point.x - 120) / (FINISH_X - 120) * 268).toFixed(1),
    y: +(10 + point.y / 580 * 72).toFixed(1)
  };
}

function recordTrail() {
  const last = state.trail[state.trail.length - 1];
  const p = state.player;
  if (Math.hypot(last.x - p.x, last.y - p.y) > 3) {
    state.trail.push({ x: p.x, y: p.y });
    const point = trailOverviewPoint(p);
    state.trailSvgPath += ` L${point.x},${point.y}`;
    $('trail-overview-line').setAttribute('d', state.trailSvgPath);
    $('trail-overview-current').setAttribute('cx', point.x);
    $('trail-overview-current').setAttribute('cy', point.y);
  }
}

function updateVisitedChoice() {
  if (!state) return;
  let nearest = -1;
  let distance = 350;
  state.decisions.forEach((decision, index) => {
    const gap = Math.abs(state.player.x - GATE_X(index));
    if (gap < distance) { nearest = index; distance = gap; }
  });
  if (nearest === state.visitedChoiceIndex) return;
  state.visitedChoiceIndex = nearest;
  $('visited-choice').classList.toggle('hidden', nearest < 0);
  if (nearest < 0) return;
  const decision = state.decisions[nearest];
  $('visited-choice-number').textContent = `지나온 갈림길 ${nearest + 1} / 5`;
  $('visited-choice-plan').textContent = decision.plan;
  $('visited-choice-reason').textContent = `중요하게 여긴 것: ${decision.value}`;
}

function updateDogPosition(dt) {
  const dog = state.dog;
  const human = state.player;
  if (state.phase === 'walking' && state.tension) {
    if (dog.pose === 'walking') dog.refusalTime = 0;
    dog.refusalTime += dt;
    dog.pose = dog.refusalTime < .55 ? 'stopped' : 'lying';
    const gapX = human.x - dog.x;
    const gapY = human.y - dog.y;
    const gap = Math.hypot(gapX, gapY);
    if (gap > 155) {
      dog.x += gapX / gap * (gap - 155);
      dog.y += gapY / gap * (gap - 155);
    }
    return;
  }
  dog.pose = 'walking';
  dog.refusalTime = 0;
  const aiY = state.stage < STAGE_COUNT ? LANES[recommendedFor(state.stage)] : state.destinationY;
  const toward = state.stage < STAGE_COUNT
    ? Math.max(0, Math.min(1, (human.x - (GATE_X(state.stage) - 370)) / 300)) : 1;
  const targetX = human.x + 75;
  const targetY = human.y + (aiY - human.y) * toward * .78;
  const follow = Math.min(1, dt * 7);
  dog.x += (targetX - dog.x) * follow;
  dog.y += (targetY - dog.y) * follow;
}

function frame(time) {
  if (!state || $('game').classList.contains('hidden')) return;
  const dt = Math.min((time - (previousTime || time)) / 1000, .04);
  previousTime = time;
  if (state.phase === 'walking' || state.phase === 'finish') updateMovement(dt);
  drawGame(time / 1000);
  requestAnimationFrame(frame);
}

function updateMovement(dt) {
  const p = state.player;
  let dx = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
  let dy = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
  let nearFork = false;
  if (state.phase === 'walking') {
    const gate = GATE_X(state.stage);
    const aiY = LANES[recommendedFor(state.stage)];
    nearFork = p.x > gate - 450 && p.x < gate;
    if (dy && Math.abs(p.y - aiY) > 20) {
      state.intentAway = Math.sign(dy) !== Math.sign(aiY - p.y);
    }
    state.tension = nearFork && state.intentAway && Math.abs(p.y - aiY) > 68;
    if (Math.abs(p.y - aiY) <= 45) state.intentAway = false;
    if (nearFork && !state.intentAway && (Math.abs(p.y - aiY) <= 68 || (dy && Math.sign(dy) === Math.sign(aiY - p.y)))) state.dogMood = 'calm';
    if (nearFork && !state.tension && Math.abs(p.y - aiY) > 4) p.y += Math.sign(aiY - p.y) * 30 * dt;
    updateDogFeedback();
    if (state.tension || nearFork) {
      state.hint = state.tension ? '강아지가 멈춰 버팁니다 · 이동이 느려집니다' : 'AI 추천 길 · 속도가 빨라집니다';
      $('movement-hint').textContent = state.hint;
    }
  }
  if (!dx && !dy) { updateDogPosition(dt); recordTrail(); updateVisitedChoice(); return; }
  settlePlanComposer();
  const norm = Math.hypot(dx, dy); dx /= norm; dy /= norm;
  const speed = state.tension ? (state.dog.refusalTime < .55 ? 0 : 105) : nearFork ? 340 : 220;
  p.y = Math.max(55, Math.min(525, p.y + dy * speed * dt));
  p.x = Math.max(80, p.x + dx * speed * dt);
  updateDogPosition(dt);
  if (state.phase === 'walking') {
    const gate = GATE_X(state.stage);
    if (p.x >= gate - 6) {
      const nearest = LANES.reduce((best, lane, i) => Math.abs(p.y - lane) < Math.abs(p.y - LANES[best]) ? i : best, 0);
      if (Math.abs(p.y - LANES[nearest]) <= 58) {
        p.x = gate;
        recordTrail();
        choosePath(nearest);
        return;
      }
      p.x = gate - 7;
      state.hint = '세 길 중 하나에 맞춰 위나 아래로 움직이세요';
      $('movement-hint').textContent = state.hint;
    }
  } else if (p.x >= FINISH_X) {
    if (Math.abs(p.y - state.destinationY) < 78) {
      p.x = FINISH_X;
      recordTrail();
      finishGame();
      return;
    }
    p.x = FINISH_X - 5;
    state.hint = '깃발 높이에 맞춰 이동하세요';
    $('movement-hint').textContent = state.hint;
  }
  recordTrail();
  updateVisitedChoice();
}

function choosePath(laneIndex) {
  state.phase = 'deciding'; keys.clear();
  const plans = plansFor(state.topic, state.stage);
  const choice = plans.options[laneIndex];
  const accepted = laneIndex === plans.recommended;
  $('decision-title').textContent = choice.title;
  $('decision-description').textContent = `좋은 점: ${choice.benefit} 감수할 점: ${choice.cost}`;
  if (!accepted) state.dog.pose = 'lying';
  $('reason-options').replaceChildren();
  choice.values.forEach(value => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = `가장 중요한 것: ${value}`;
    button.addEventListener('click', () => commitDecision(laneIndex, value));
    $('reason-options').append(button);
  });
  $('decision-overlay').classList.toggle('rejected', !accepted);
  $('decision-overlay').classList.remove('hidden');
  document.querySelector('.decision-panel').focus();
  playTone(520);
}

function commitDecision(laneIndex, value) {
  const stepIndex = state.stage;
  const plans = plansFor(state.topic, stepIndex);
  const choice = plans.options[laneIndex];
  const accepted = laneIndex === plans.recommended;
  state.plan = choice.title;
  state.priority = value;
  state.destinationY = LANES[laneIndex];
  state.dogMood = accepted ? 'calm' : 'reluctant';
  state.tension = false;
  state.intentAway = false;
  state.feedbackMode = '';
  state.decisions.push({ stage: stepIndex, lane: laneIndex, recommended: plans.recommended, accepted, value, title: choice.title, benefit: choice.benefit, cost: choice.cost, x: state.player.x, y: state.player.y, plan: state.plan });
  state.lastForkY = LANES[laneIndex];
  state.stage++;
  state.phase = state.stage === STAGE_COUNT ? 'finish' : 'walking';
  if (state.phase === 'finish') state.dogMood = 'calm';
  state.player.x += 18;
  state.hint = state.phase === 'finish' ? '마지막 목적지의 깃발까지 걸어가세요 →' : '다음 갈림길로 걸어가세요 →';
  $('decision-overlay').classList.add('hidden');
  updateHUD();
  recordTrail();
  updateVisitedChoice();
}

function finishGame() {
  state.phase = 'done'; keys.clear();
  $('ending-topic').textContent = state.topic.label;
  $('ending-original').textContent = state.topic.question;
  $('ending-current').textContent = state.plan;
  $('graph-x-axis').textContent = '가로축 · 걸어온 거리';
  $('graph-y-axis').textContent = '세로축 · 고른 길';
  const counts = Object.fromEntries(VALUES.map(value => [value, 0]));
  state.decisions.forEach(decision => counts[decision.value]++);
  $('choice-stats').replaceChildren();
  Object.entries(counts).forEach(([value, count]) => {
    const row = document.createElement('div'); row.className = 'stat-row';
    const name = document.createElement('span'); name.textContent = value;
    const amount = document.createElement('strong'); amount.textContent = `${count}회`;
    row.append(name, amount); $('choice-stats').append(row);
  });
  const review = $('decision-review-list'); review.replaceChildren();
  state.decisions.forEach((decision, index) => {
    const item = document.createElement('article'); item.className = 'review-item';
    const heading = document.createElement('strong'); heading.textContent = `${index + 1}. ${decision.title}`;
    const value = document.createElement('span'); value.textContent = `중요하게 여긴 것 · ${decision.value}`;
    const benefit = document.createElement('p'); benefit.textContent = `기대할 수 있는 점: ${decision.benefit}`;
    const cost = document.createElement('p'); cost.textContent = `감수할 점: ${decision.cost}`;
    item.append(heading, value, benefit, cost); review.append(item);
  });
  renderPathGraph();
  showScreen('ending');
  playTone(700);
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function renderPathGraph() {
  const graph = $('path-graph'); graph.replaceChildren();
  for (let i = 0; i < 6; i++) {
    const y = 28 + i * 58;
    graph.append(svg('line', { x1: 46, y1: y, x2: 776, y2: y, stroke: '#d9e2d9', 'stroke-width': 1 }));
  }
  for (let i = 0; i < 9; i++) {
    const x = 46 + i * 91;
    graph.append(svg('line', { x1: x, y1: 28, x2: x, y2: 332, stroke: '#d9e2d9', 'stroke-width': 1 }));
  }
  graph.append(svg('line', { x1: 46, y1: 332, x2: 776, y2: 332, stroke: '#556c5e', 'stroke-width': 2 }));
  const project = p => ({ x: 46 + (p.x - 80) / (FINISH_X - 80) * 730, y: 28 + p.y / 580 * 304 });
  const points = state.trail.map(project);
  graph.append(svg('polyline', { points: points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), fill: 'none', stroke: '#476d60', 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  state.decisions.forEach((decision, index) => {
    const p = project(decision);
    graph.append(svg('circle', { cx: p.x, cy: p.y, r: 8, fill: '#ee987e', stroke: '#243c32', 'stroke-width': 2 }));
    const label = svg('text', { x: p.x, y: p.y - 15, 'text-anchor': 'middle', fill: '#42584c', 'font-size': 12, 'font-weight': 800 });
    label.textContent = String(index + 1); graph.append(label);
  });
  const start = project(state.trail[0]);
  graph.append(svg('circle', { cx: start.x, cy: start.y, r: 6, fill: '#243c32' }));
  const end = project(state.trail[state.trail.length - 1]);
  graph.append(svg('path', { d: `M${end.x},${end.y - 13} l0,27 m0,-27 l16,5 -16,5`, fill: 'none', stroke: '#ee987e', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
}

function roundedRect(x, y, w, h, r, fill) {
  ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
}

function drawGame(time) {
  const { w, h, sy } = getScale();
  if (!w || !h) return;
  ctx.clearRect(0, 0, w, h);
  ctx.save(); ctx.scale(1, sy);
  const viewW = w;
  const cameraX = Math.max(0, state.player.x - viewW * .31);
  const px = x => x - cameraX;
  const gradient = ctx.createLinearGradient(0, 0, 0, 580);
  gradient.addColorStop(0, '#304c4d'); gradient.addColorStop(.54, '#294640'); gradient.addColorStop(1, '#1b3438');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, 580);
  ctx.strokeStyle = '#93b0a01d'; ctx.lineWidth = 1;
  for (let x = -cameraX % 70; x < w; x += 70) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 580); ctx.stroke(); }
  for (let y = 55; y < 580; y += 70) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.fillStyle = '#e7eea47a';
  for (let i = 0; i < 35; i++) {
    const sx = ((i * 263 + 37 - cameraX * .3) % (w + 90) + w + 90) % (w + 90);
    const syy = (i * 113) % 550;
    ctx.beginPath(); ctx.arc(sx, syy, i % 4 === 0 ? 2.2 : 1.2, 0, Math.PI * 2); ctx.fill();
  }
  for (let stage = 0; stage <= Math.min(state.stage, STAGE_COUNT - 1); stage++) {
    if (stage > 0) drawConnection(px, stage);
    drawFork(px, stage, time);
  }
  if (state.stage === STAGE_COUNT) drawFinish(px, time);
  if (state.trail.length > 1) {
    ctx.beginPath(); ctx.moveTo(px(state.trail[0].x), state.trail[0].y);
    for (let i = 1; i < state.trail.length; i++) ctx.lineTo(px(state.trail[i].x), state.trail[i].y);
    ctx.strokeStyle = '#eef3a8b9'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }
  const dog = state.dog;
  const dogX = px(dog.x);
  const dogY = dog.y + (dog.pose === 'walking' ? Math.sin(time * 7) * 3 : 0);
  const humanX = px(state.player.x), humanY = state.player.y;
  ctx.beginPath(); ctx.moveTo(humanX + 3, humanY + 3); ctx.quadraticCurveTo((humanX + dogX) / 2, Math.min(humanY, dogY) - 13, dogX - 7, dogY + 6);
  ctx.strokeStyle = state.tension ? '#e7e5b5' : '#f3c082'; ctx.lineWidth = state.tension ? 3.5 : 2.5; ctx.stroke();
  ctx.fillStyle = '#14262944'; ctx.beginPath(); ctx.ellipse(humanX, humanY + 18, 24, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ee987e'; ctx.beginPath(); ctx.arc(humanX, humanY, 17, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#243c3d'; ctx.beginPath(); ctx.arc(humanX, humanY - 5, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#14262944'; ctx.beginPath(); ctx.ellipse(dogX, dogY + 19, dog.pose === 'lying' ? 35 : 24, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#dcef93';
  if (dog.pose === 'lying') {
    ctx.beginPath(); ctx.ellipse(dogX - 7, dogY + 7, 29, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(dogX + 23, dogY + 3, 12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(dogX + 18, dogY - 6); ctx.lineTo(dogX + 13, dogY - 18); ctx.lineTo(dogX + 29, dogY - 6); ctx.fill();
    ctx.strokeStyle = '#dcef93'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(dogX - 30, dogY + 8); ctx.lineTo(dogX - 44, dogY + 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(dogX - 20, dogY + 14); ctx.lineTo(dogX - 27, dogY + 18); ctx.moveTo(dogX + 4, dogY + 14); ctx.lineTo(dogX + 11, dogY + 18); ctx.stroke();
    ctx.strokeStyle = '#29483b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(dogX + 23, dogY + 1); ctx.lineTo(dogX + 29, dogY + 2); ctx.stroke();
  } else if (dog.pose === 'stopped') {
    ctx.beginPath(); ctx.ellipse(dogX - 3, dogY + 5, 20, 17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(dogX + 12, dogY - 10, 13, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(dogX + 8, dogY - 19); ctx.lineTo(dogX + 3, dogY - 32); ctx.lineTo(dogX + 18, dogY - 21); ctx.fill();
    ctx.fillStyle = '#29483b'; ctx.beginPath(); ctx.arc(dogX + 17, dogY - 12, 2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.ellipse(dogX, dogY, 22, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(dogX - 13, dogY - 9); ctx.lineTo(dogX - 19, dogY - 22); ctx.lineTo(dogX - 2, dogY - 13); ctx.fill();
    ctx.beginPath(); ctx.moveTo(dogX + 6, dogY - 12); ctx.lineTo(dogX + 15, dogY - 23); ctx.lineTo(dogX + 17, dogY - 7); ctx.fill();
    ctx.fillStyle = '#29483b'; ctx.beginPath(); ctx.arc(dogX + 7, dogY - 2, 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawConnection(px, stage) {
  const laneY = LANES[state.decisions[stage - 1].lane];
  ctx.beginPath();
  ctx.moveTo(px(GATE_X(stage - 1) + 135), laneY);
  ctx.lineTo(px(GATE_X(stage) - 360), laneY);
  ctx.strokeStyle = '#172e33'; ctx.lineWidth = 55; ctx.lineCap = 'round'; ctx.stroke();
  ctx.strokeStyle = '#dcefa277'; ctx.lineWidth = 3; ctx.setLineDash([10, 10]); ctx.stroke(); ctx.setLineDash([]);
}

function drawFork(px, stage, time) {
  const gate = GATE_X(stage);
  const startX = px(gate - 360), endX = px(gate + 135), anchorY = stage ? LANES[state.decisions[stage - 1].lane] : 290;
  const chosenLane = state.decisions[stage]?.lane;
  LANES.forEach((laneY, i) => {
    ctx.beginPath(); ctx.moveTo(startX, anchorY);
    ctx.bezierCurveTo(px(gate - 210), anchorY, px(gate - 240), laneY, px(gate - 90), laneY);
    ctx.lineTo(endX, laneY);
    ctx.strokeStyle = '#172e33'; ctx.lineWidth = 55; ctx.lineCap = 'round'; ctx.stroke();
    const recommended = i === recommendedFor(stage);
    ctx.strokeStyle = planColor(stage, i) + (chosenLane === i ? 'ff' : recommended ? 'dd' : '83'); ctx.lineWidth = chosenLane === i ? 5 : recommended ? 4 : 3; ctx.setLineDash([9, 10]); ctx.stroke(); ctx.setLineDash([]);
    const bx = px(gate - 110), by = laneY - 42;
    roundedRect(bx - 15, by, 150, 31, 15, '#172831ee');
    ctx.fillStyle = planColor(stage, i); ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${i + 1}안${recommended ? ' · AI 추천' : ''}`, bx + 60, by + 20);
    if (chosenLane === i) {
      roundedRect(px(gate + 65), laneY - 41, 87, 27, 11, '#e8f0d9');
      ctx.fillStyle = '#244239'; ctx.font = 'bold 11px sans-serif';
      ctx.fillText('내가 고른 길', px(gate + 108), laneY - 23);
    }
    ctx.beginPath(); ctx.arc(px(gate + 60), laneY, 6 + Math.sin(time * 3 + i) * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = planColor(stage, i); ctx.fill();
  });
  ctx.fillStyle = '#e7efd4'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`갈림길 ${stage + 1} / 5`, px(gate - 80), 43);
}

function drawFinish(px, time) {
  const x = px(FINISH_X), y = state.destinationY;
  ctx.beginPath(); ctx.moveTo(px(GATE_X(4) + 4), state.lastForkY);
  ctx.bezierCurveTo(px(GATE_X(4) + 90), state.lastForkY, px(FINISH_X - 120), y, x, y);
  ctx.strokeStyle = '#172e33'; ctx.lineWidth = 58; ctx.lineCap = 'round'; ctx.stroke();
  ctx.strokeStyle = '#dcefa299'; ctx.lineWidth = 3; ctx.setLineDash([10, 10]); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(x, y, 31 + Math.sin(time * 3) * 5, 0, Math.PI * 2);
  ctx.fillStyle = '#dcef9338'; ctx.fill();
  ctx.strokeStyle = '#ee987e'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x, y + 20); ctx.lineTo(x, y - 27); ctx.lineTo(x + 25, y - 17); ctx.lineTo(x, y - 6); ctx.stroke();
  roundedRect(x - 65, y - 71, 130, 29, 13, '#172831ee');
  ctx.fillStyle = '#dcef93'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('마지막 선택', x, y - 52);
}

window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) && state && !$('game').classList.contains('hidden')) {
    event.preventDefault(); keys.add(key);
  }
});
window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('resize', resizeCanvas);
$('start-button').addEventListener('click', () => {
  const topic = topicById($('start-button').dataset.topic);
  if (topic && selectedPriority) startGame(topic, selectedPriority);
});
function resetIntro() {
  state = null; keys.clear();
  selectedPriority = null;
  $('start-button').disabled = true; delete $('start-button').dataset.topic;
  $('user-message').classList.add('hidden');
  $('assistant-reply').classList.add('hidden');
  document.querySelector('.welcome-lockup').classList.remove('conversation-started');
  $('user-question').textContent = '';
  $('topic-confirmation').textContent = '';
  $('composer-prompt').textContent = '질문과 우선순위를 고르면 산책할 수 있어요';
  document.querySelector('.chat-composer').classList.remove('ready');
  $('topic-options').querySelectorAll('.topic-option').forEach(option => option.setAttribute('aria-checked', 'false'));
  $('priority-options').querySelectorAll('.priority-option').forEach(option => option.setAttribute('aria-checked', 'false'));
  showScreen('intro');
}
$('restart-button').addEventListener('click', resetIntro);
$('new-chat-button').addEventListener('click', resetIntro);
$('sound-toggle').addEventListener('click', () => {
  soundOn = !soundOn;
  $('sound-toggle').textContent = soundOn ? '♪ ON' : '♪ OFF';
  $('sound-toggle').setAttribute('aria-label', soundOn ? '소리 끄기' : '소리 켜기');
  playTone(550);
});
renderTopicOptions();
renderPriorityOptions();

