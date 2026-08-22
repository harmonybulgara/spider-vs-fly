(function runSpiderUi() {
  "use strict";

  const logic = window.SnakeLogic;
  if (!logic) throw new Error("SnakeLogic not found. Did src/spider-logic.js load?");

  const config = { rows: 20, cols: 20 };
  const url = new URL(window.location.href);
  const seedParam = url.searchParams.get("seed");
  const seed = seedParam && /^\d+$/.test(seedParam) ? Number(seedParam) : Date.now();
  let rng = logic.createRng(seed);

  const DIFF_KEY = "spider_difficulty";
  let difficulty = "normal";
  try {
    const raw = window.localStorage?.getItem(DIFF_KEY);
    if (raw === "easy" || raw === "normal" || raw === "hard") difficulty = raw;
  } catch {
    // ignore
  }
  const diffParam = url.searchParams.get("difficulty");
  if (diffParam === "easy" || diffParam === "normal" || diffParam === "hard") difficulty = diffParam;

  let state = logic.createInitialState({ ...config, difficulty }, rng);

  const gridEl = document.getElementById("grid");
  const overlayEl = document.getElementById("overlay");
  const toastEl = document.getElementById("toast");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const statusEl = document.getElementById("status");
  const startBtn = document.getElementById("btn-start");
  const pauseBtn = document.getElementById("btn-pause");
  const restartBtn = document.getElementById("btn-restart");
  const soundBtn = document.getElementById("btn-sound");
  const shareBtn = document.getElementById("btn-share");
  const difficultyEl = document.getElementById("difficulty");

  if (
    !gridEl ||
    !overlayEl ||
    !toastEl ||
    !scoreEl ||
    !bestEl ||
    !statusEl ||
    !startBtn ||
    !pauseBtn ||
    !restartBtn ||
    !soundBtn
  ) {
    throw new Error("Missing required DOM elements.");
  }
  if (!shareBtn) throw new Error("Missing #btn-share element.");
  if (!difficultyEl) throw new Error("Missing #difficulty element.");

  gridEl.style.setProperty("--cols", String(config.cols));

  const cells = [];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < config.rows * config.cols; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    frag.appendChild(cell);
    cells.push(cell);
  }
  gridEl.appendChild(frag);

  let prevSpiderIndices = new Set();
  let prevFlyIndex = null;
  let prevWebIndices = new Set();
  let prevBeamIndices = new Set();
  let prevSpiderlingIndices = new Set();

  const audio = window.SpiderAudio ? window.SpiderAudio.create() : null;
  let audioArmed = false;
  let desiredSoundEnabled = true;
  soundBtn.textContent = "Sound: On";

  const BEST_KEY = "spider_best_ms";
  let bestMs = 0;
  let runMs = 0;
  let hasStarted = false;
  try {
    const raw = window.localStorage?.getItem(BEST_KEY);
    const n = raw ? Number(raw) : 0;
    if (Number.isFinite(n) && n > 0) bestMs = n;
  } catch {
    bestMs = 0;
  }

  difficultyEl.value = difficulty;

  function setOverlay(message) {
    if (message) {
      overlayEl.textContent = message;
      overlayEl.hidden = false;
      return;
    }
    overlayEl.textContent = "";
    overlayEl.hidden = true;
  }

  let toastTimer = null;
  function showToast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastTimer = null;
      toastEl.hidden = true;
      toastEl.textContent = "";
    }, 1600);
  }

  function statusLabel(status) {
    if (!hasStarted) return "Ready";
    if (status === logic.STATUS.paused) return "Paused";
    if (status === logic.STATUS.gameover) return "Game Over";
    return "Playing";
  }

  function formatMs(ms) {
    const s = ms / 1000;
    return `${s.toFixed(1)}s`;
  }

  function computeThreat() {
    const head = state.spider?.[0];
    const fly = state.fly;
    if (!head || !fly) return 0;
    const dist = Math.abs(head.x - fly.x) + Math.abs(head.y - fly.y);
    return 1 - Math.min(1, dist / 18);
  }

  function updateIntensity() {
    const t = computeThreat();
    // Keep early-game readable: minimal shake at the start, then ramp over time.
    const s = Math.min(1, runMs / 120000); // ramps over ~120s
    const timeShake = Math.pow(s, 1.35) * 9; // grows non-linearly
    const threatShake = (t * t) * (1.2 + s * 3.2); // threat matters more later
    const shake = Math.round(timeShake + threatShake);
    gridEl.style.setProperty("--shake", `${Math.min(8, shake)}px`);
    document.body.classList.toggle("intense-shake", shake >= 2 && s > 0.08 && state.status === logic.STATUS.playing);
  }

  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let spinTimer = null;

  function stopSpinChaos() {
    if (spinTimer !== null) window.clearTimeout(spinTimer);
    spinTimer = null;
  }

  function setSpinVars() {
    const dir = Math.random() < 0.5 ? "normal" : "reverse";
    const seconds = 9 + Math.random() * 8; // 9s..17s (faster)
    document.body.style.setProperty("--web-spin-direction", dir);
    document.body.style.setProperty("--web-spin-duration", `${seconds.toFixed(1)}s`);
  }

  function scheduleSpinChaos() {
    if (spinTimer !== null) return;
    setSpinVars();
    const nextMs = 1200 + Math.random() * 2600; // ~1.2s..3.8s
    spinTimer = window.setTimeout(() => {
      spinTimer = null;
      if (!hasStarted) return;
      if (state.status !== logic.STATUS.playing) return;
      scheduleSpinChaos();
    }, nextMs);
  }

  function startSpinChaos() {
    if (reduceMotion?.matches) return;
    document.body.classList.add("web-spin");
    stopSpinChaos();
    scheduleSpinChaos();
  }

  function armAudio() {
    if (!audio || audioArmed) return;
    audioArmed = true;
    audio.arm();
    audio.setEnabled(desiredSoundEnabled);
  }

  function render() {
    for (const idx of prevSpiderIndices) {
      const cell = cells[idx];
      cell.classList.remove("spider", "spider-head");
    }
    prevSpiderIndices = new Set();

    if (prevFlyIndex !== null) {
      cells[prevFlyIndex].classList.remove("fly");
      prevFlyIndex = null;
    }

    for (const idx of prevWebIndices) {
      cells[idx].classList.remove("web-trap");
    }
    prevWebIndices = new Set();

    for (const idx of prevBeamIndices) {
      cells[idx].classList.remove("web-beam");
    }
    prevBeamIndices = new Set();

    for (const idx of prevSpiderlingIndices) {
      cells[idx].classList.remove("spiderling");
    }
    prevSpiderlingIndices = new Set();

    for (const w of state.webs) {
      const idx = w.y * state.cols + w.x;
      prevWebIndices.add(idx);
      cells[idx].classList.add("web-trap");
    }

    if (state.webBeam) {
      const from = state.webBeam.from;
      const to = state.webBeam.to;
      if (from && to && (from.x === to.x || from.y === to.y)) {
        if (from.x === to.x) {
          const step = from.y < to.y ? 1 : -1;
          for (let y = from.y + step; y !== to.y; y += step) {
            const idx = y * state.cols + from.x;
            prevBeamIndices.add(idx);
            cells[idx].classList.add("web-beam");
          }
        } else {
          const step = from.x < to.x ? 1 : -1;
          for (let x = from.x + step; x !== to.x; x += step) {
            const idx = from.y * state.cols + x;
            prevBeamIndices.add(idx);
            cells[idx].classList.add("web-beam");
          }
        }
      }
    }

    for (const s of state.spiderlings || []) {
      const idx = s.y * state.cols + s.x;
      prevSpiderlingIndices.add(idx);
      cells[idx].classList.add("spiderling");
    }

    for (let i = 0; i < state.spider.length; i++) {
      const p = state.spider[i];
      const idx = p.y * state.cols + p.x;
      prevSpiderIndices.add(idx);
      const cell = cells[idx];
      cell.classList.add("spider");
      if (i === 0) cell.classList.add("spider-head");
    }

    if (state.fly) {
      prevFlyIndex = state.fly.y * state.cols + state.fly.x;
      cells[prevFlyIndex].classList.add("fly");
    }

    scoreEl.textContent = formatMs(runMs);
    bestEl.textContent = formatMs(bestMs);
    statusEl.textContent = statusLabel(state.status);
    pauseBtn.textContent = state.status === logic.STATUS.paused ? "Resume" : "Pause";
    startBtn.disabled = hasStarted && state.status !== logic.STATUS.gameover;

    if (!hasStarted) {
      setOverlay("You are the fly. Press Start.");
    } else if (state.status === logic.STATUS.gameover) {
      setOverlay("Caught. Press Enter or Restart.");
    } else if (state.status === logic.STATUS.paused) {
      setOverlay("Paused. Press Space or Resume.");
    } else {
      setOverlay("");
    }
  }

  const BASE_TICK_MS = 120;
  let timer = null;

  function stopLoop() {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
  }

  function computeTickMs() {
    const t = computeThreat();
    const survival = Math.min(1, runMs / 90000);
    const base = difficulty === "easy" ? 140 : difficulty === "hard" ? 88 : 126;
    const ms = base - t * 34 - survival * 38;
    return Math.max(52, Math.floor(ms));
  }

  function scheduleNextTick() {
    if (timer !== null) return;
    const dt = computeTickMs();
    timer = window.setTimeout(() => {
      timer = null;
      if (state.status !== logic.STATUS.playing) return;
      runMs += dt;
      dispatch({ type: "tick", dtMs: dt });
      if (state.status === logic.STATUS.playing) scheduleNextTick();
    }, dt);
  }

  function startLoop() {
    stopLoop();
    scheduleNextTick();
  }

  function dispatch(action) {
    const prevStatus = state.status;
    const prevWebShotSeq = state.webShotSeq || 0;
    state = logic.reduceState(state, action, rng);
    render();

    if (state.status !== logic.STATUS.gameover) document.body.classList.remove("danger-flash");

    if (audio) {
      audio.setThreatLevel(computeThreat());
      audio.setSurvivalSeconds(runMs / 1000);
      if ((state.webShotSeq || 0) !== prevWebShotSeq) audio.playWebShot();
    }
    updateIntensity();

    if (prevStatus !== logic.STATUS.gameover && state.status === logic.STATUS.gameover) {
      stopLoop();
      stopSpinChaos();
      document.body.classList.remove("web-spin");
      if (runMs > bestMs) {
        bestMs = runMs;
        try {
          window.localStorage?.setItem(BEST_KEY, String(bestMs));
        } catch {
          // ignore storage errors
        }
      }
      document.body.classList.remove("danger-flash");
      void document.body.offsetWidth; // restart animation
      document.body.classList.add("danger-flash");
      audio?.playDeath();
      return;
    }

    if (prevStatus !== state.status) {
      if (state.status === logic.STATUS.paused) {
        stopLoop();
        stopSpinChaos();
      }
      if (state.status === logic.STATUS.playing) {
        scheduleNextTick();
        startSpinChaos();
      }
    }
  }

  function setDirection(direction) {
    dispatch({ type: "flyDirection", direction });
  }

  function startGame() {
    if (hasStarted && state.status !== logic.STATUS.gameover) return;
    if (state.status === logic.STATUS.gameover) {
      runMs = 0;
      rng = logic.createRng(seed);
      state = logic.createInitialState({ rows: config.rows, cols: config.cols, difficulty }, rng);
      render();
    }
    hasStarted = true;
    startSpinChaos();
    if (state.status === logic.STATUS.paused) dispatch({ type: "togglePause" });
    scheduleNextTick();
  }

  function shareUrl() {
    const u = new URL(window.location.href);
    u.searchParams.set("seed", String(seed));
    u.searchParams.set("difficulty", difficulty);
    return u.toString();
  }

  async function onShare() {
    const shareData = {
      title: document.title || "Spider vs Fly",
      text: "Try to survive as the fly. The spider AI chases + shoots webs.",
      url: shareUrl(),
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      // user cancelled or share failed; fall back to copy
    }

    try {
      await navigator.clipboard.writeText(shareData.url);
      showToast("Link copied.");
      return;
    } catch {
      // Clipboard may be blocked on file:// or without HTTPS.
    }

    showToast("Copy link from the address bar.");
  }

  function onKeyDown(event) {
    const key = event.key;
    let dir = null;

    if (key === "ArrowUp" || key === "w" || key === "W") dir = "up";
    else if (key === "ArrowDown" || key === "s" || key === "S") dir = "down";
    else if (key === "ArrowLeft" || key === "a" || key === "A") dir = "left";
    else if (key === "ArrowRight" || key === "d" || key === "D") dir = "right";

    if (dir) {
      event.preventDefault();
      armAudio();
      if (!hasStarted) startGame();
      setDirection(dir);
      return;
    }

    if (key === " " || key === "Spacebar" || key === "p" || key === "P") {
      event.preventDefault();
      armAudio();
      if (!hasStarted) {
        startGame();
        return;
      }
      dispatch({ type: "togglePause" });
      return;
    }

    if (key === "Enter" || key === "r" || key === "R") {
      event.preventDefault();
      armAudio();
      if (!hasStarted) {
        startGame();
        return;
      }
      runMs = 0;
      startSpinChaos();
      rng = logic.createRng(seed);
      stopLoop();
      state = logic.createInitialState({ rows: config.rows, cols: config.cols, difficulty }, rng);
      render();
      updateIntensity();
      scheduleNextTick();
    }
  }

  function onPointerDownDir(event) {
    const dir = event.currentTarget?.dataset?.dir;
    if (!dir) return;
    event.preventDefault();
    armAudio();
    if (!hasStarted) startGame();
    setDirection(dir);
  }

  document.addEventListener("keydown", onKeyDown);
  startBtn.addEventListener("click", () => {
    armAudio();
    startGame();
  });
  pauseBtn.addEventListener("click", () => {
    armAudio();
    if (!hasStarted) {
      startGame();
      return;
    }
    dispatch({ type: "togglePause" });
  });
  restartBtn.addEventListener("click", () => {
    armAudio();
    runMs = 0;
    hasStarted = true;
    startSpinChaos();
    rng = logic.createRng(seed);
    stopLoop();
    state = logic.createInitialState({ rows: config.rows, cols: config.cols, difficulty }, rng);
    render();
    updateIntensity();
    scheduleNextTick();
  });
  difficultyEl.addEventListener("change", () => {
    const v = String(difficultyEl.value || "normal");
    difficulty = v === "easy" || v === "hard" ? v : "normal";
    try {
      window.localStorage?.setItem(DIFF_KEY, difficulty);
    } catch {
      // ignore
    }

    // Apply immediately by restarting the state with new difficulty.
    rng = logic.createRng(seed);
    runMs = 0;
    hasStarted = false;
    stopLoop();
    state = logic.createInitialState({ rows: config.rows, cols: config.cols, difficulty }, rng);
    render();
    updateIntensity();
    document.body.classList.remove("web-spin");
  });
  soundBtn.addEventListener("click", () => {
    if (!audio) return;
    armAudio();
    desiredSoundEnabled = audioArmed ? !audio.isEnabled() : !desiredSoundEnabled;
    if (audioArmed) audio.setEnabled(desiredSoundEnabled);
    soundBtn.textContent = desiredSoundEnabled ? "Sound: On" : "Sound: Off";
  });
  shareBtn.addEventListener("click", () => {
    armAudio();
    onShare();
  });

  for (const btn of document.querySelectorAll("[data-dir]")) {
    btn.addEventListener("pointerdown", onPointerDownDir);
    btn.addEventListener("click", (e) => e.preventDefault());
  }

  render();
  updateIntensity();
  // Starting screen: game begins only after Start / first input.
  stopLoop();
})();
