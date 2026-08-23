(function runSpiderLogicTests() {
  "use strict";

  const outEl = document.getElementById("out");
  const logic = window.SnakeLogic;
  if (!outEl) throw new Error("Missing #out element");
  if (!logic) throw new Error("SnakeLogic not found");

  let passed = 0;
  let failed = 0;
  const lines = [];

  function write(line) {
    lines.push(line);
    outEl.textContent = lines.join("\n");
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed");
  }

  function assertPoint(actual, expected, message) {
    assert(
      actual && expected && actual.x === expected.x && actual.y === expected.y,
      message || `Expected (${expected.x},${expected.y}), got (${actual?.x},${actual?.y})`,
    );
  }

  function test(name, fn) {
    try {
      fn();
      passed++;
      write(`PASS  ${name}`);
    } catch (err) {
      failed++;
      write(`FAIL  ${name}`);
      write(`      ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function baseState(overrides) {
    return {
      rows: 5,
      cols: 5,
      spider: [
        { x: 2, y: 2 },
        { x: 1, y: 2 },
        { x: 0, y: 2 },
      ],
      spiderDirection: "right",
      queuedFlyDirection: null,
      fly: { x: 4, y: 4 },
      scoreTicks: 0,
      ageTicks: 0,
      growthRemaining: 0,
      webs: [],
      webBeam: null,
      webCooldownTicks: 0,
      lastWebShot: null,
      webShotSeq: 0,
      spiderlings: [],
      elapsedMs: 0,
      nextOffspringMs: 30000,
      flyLearn: { lastDir: null, counts: { up: { up: 0, down: 0, left: 0, right: 0 }, down: { up: 0, down: 0, left: 0, right: 0 }, left: { up: 0, down: 0, left: 0, right: 0 }, right: { up: 0, down: 0, left: 0, right: 0 } } },
      flyMovedDir: null,
      params: {
        difficulty: "normal",
        webTtlTicks: 48,
        webCooldownTicks: 7,
        webStripLen: 1,
        growEveryTicks: 16,
        offspringEveryMs: 34000,
        offspringTtlMs: 9500,
        offspringCount: 2,
      },
      status: logic.STATUS.playing,
      ...overrides,
    };
  }

  write("Running Spider/Fly logic tests...\n");

  test("Tick moves spider and increments survival ticks", () => {
    const rng = logic.createRng(1);
    const s1 = baseState();
    const s2 = logic.reduceState(s1, { type: "tick" }, rng);
    assertPoint(s2.spider[0], { x: 3, y: 2 });
    assert(s2.spider.length === 3, "Spider should keep length 3");
    assert(s2.scoreTicks === 1, "Survival ticks should increment");
  });

  test("Fly direction updates via action", () => {
    const s1 = baseState({ queuedFlyDirection: null });
    const s2 = logic.reduceState(s1, { type: "flyDirection", direction: "up" }, Math.random);
    assert(s2.queuedFlyDirection === "up", "queuedFlyDirection should become 'up'");
  });

  test("Fly moves first and is blocked by walls", () => {
    const s1 = baseState({ fly: { x: 0, y: 0 }, queuedFlyDirection: "left" });
    const s2 = logic.reduceState(s1, { type: "tick" }, Math.random);
    assertPoint(s2.fly, { x: 0, y: 0 }, "Fly should stay in-bounds");
  });

  test("Spider wall collision ends the game", () => {
    const s1 = baseState({
      // No legal moves: walls + body block all options.
      rows: 5,
      cols: 5,
      spider: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      spiderDirection: "up",
      fly: { x: 4, y: 4 },
      webCooldownTicks: 9999,
    });
    const s2 = logic.reduceState(s1, { type: "tick" }, Math.random);
    assert(s2.status === logic.STATUS.gameover, "Status should be gameover");
  });

  test("Normal mode starts the spider a safe distance from the fly", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const state = logic.createInitialState({ rows: 20, cols: 20, difficulty: "normal" }, logic.createRng(seed));
      const head = state.spider[0];
      const distance = Math.abs(head.x - state.fly.x) + Math.abs(head.y - state.fly.y);
      assert(distance >= 9, `Seed ${seed} started only ${distance} blocks away`);
    }
  });

  test("Difficulty settings limit how often webs can be placed", () => {
    const easy = logic.createInitialState({ rows: 20, cols: 20, difficulty: "easy" }, logic.createRng(1));
    const normal = logic.createInitialState({ rows: 20, cols: 20, difficulty: "normal" }, logic.createRng(1));
    const hard = logic.createInitialState({ rows: 20, cols: 20, difficulty: "hard" }, logic.createRng(1));
    assert(easy.params.webCooldownTicks === 16, "Easy should have a long web cooldown");
    assert(normal.params.webCooldownTicks === 12, "Normal should have a moderate web cooldown");
    assert(hard.params.webCooldownTicks === 7, "Hard should still have a meaningful web cooldown");
  });

  test("The main chaser stays a single compact spider", () => {
    const rng = logic.createRng(21);
    let state = baseState({
      rows: 50,
      cols: 50,
      spider: [{ x: 25, y: 25 }],
      spiderDirection: "right",
      fly: { x: 49, y: 49 },
      webCooldownTicks: 9999,
      params: {
        ...baseState().params,
        growEveryTicks: 1,
        maxSpiderLength: 1,
      },
    });
    for (let tick = 0; tick < 20; tick++) state = logic.reduceState(state, { type: "tick" }, rng);
    assert(state.spider.length === 1, "The main spider should not grow a snake-like body");
  });

  test("AI avoids moving into the body when choosing direction", () => {
    const rngZero = () => 0;
    const s1 = baseState({
      spider: [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 3, y: 3 },
        { x: 2, y: 3 },
      ],
      spiderDirection: "right",
      fly: { x: 4, y: 2 },
    });
    const dir = logic.chooseAiDirection(s1, rngZero);
    assert(dir === "up", "AI should pick a safe direction (tie-broken deterministically)");
  });

  test("Spider catching the fly ends the game", () => {
    const s1 = baseState({
      spider: [
        { x: 2, y: 2 },
        { x: 1, y: 2 },
        { x: 0, y: 2 },
      ],
      spiderDirection: "right",
      fly: { x: 3, y: 2 },
    });
    const s2 = logic.reduceState(s1, { type: "tick" }, Math.random);
    assert(s2.status === logic.STATUS.gameover, "Status should be gameover");
  });

  test("Fly moving into the spider also ends the game", () => {
    const s1 = baseState({
      spider: [
        { x: 2, y: 2 },
        { x: 1, y: 2 },
        { x: 0, y: 2 },
      ],
      fly: { x: 3, y: 2 },
      queuedFlyDirection: "left",
    });
    const s2 = logic.reduceState(s1, { type: "tick" }, Math.random);
    assert(s2.status === logic.STATUS.gameover, "Status should be gameover");
  });

  test("Spider can shoot a web when aligned (sets cooldown + trap tile)", () => {
    const rngZero = () => 0;
    const s1 = baseState({
      rows: 8,
      cols: 8,
      spider: [{ x: 0, y: 0 }],
      spiderDirection: "down",
      fly: { x: 0, y: 3 },
      webs: [],
      webCooldownTicks: 0,
    });
    const s2 = logic.reduceState(s1, { type: "tick" }, rngZero);
    assert(!!s2.lastWebShot, "lastWebShot should be set");
    assert(s2.webShotSeq === 1, "webShotSeq should increment");
    assert(s2.webCooldownTicks > 0, "webCooldownTicks should be set");
    assert(s2.webs.length >= 1, "Should add web traps");
    assertPoint(s2.webs[0], { x: 0, y: 2 }, "Web should stop before reaching the fly");
    assert(!!s2.webBeam, "webBeam should be set for rendering");
    assertPoint(s2.webBeam.from, { x: 0, y: 0 }, "Beam origin should be the spider head at shoot time");
    assertPoint(s2.webBeam.to, { x: 0, y: 2 }, "Beam range should be capped");
  });

  test("Spider cannot shoot when the fly is beyond web range", () => {
    const s1 = baseState({
      rows: 12,
      cols: 12,
      spider: [{ x: 0, y: 0 }],
      spiderDirection: "down",
      fly: { x: 0, y: 10 },
      webs: [],
      webCooldownTicks: 0,
    });
    const s2 = logic.reduceState(s1, { type: "tick" }, () => 0);
    assert(!s2.lastWebShot, "A distant aligned fly should not trigger a web shot");
    assert(s2.webShotSeq === 0, "Distant shots should not increment webShotSeq");
    assert(s2.webs.length === 0, "Distant shots should not create web traps");
  });

  test("When adjacent, web shot tries to place beyond the fly (no insta-kill)", () => {
    const rngZero = () => 0;
    const s1 = baseState({
      rows: 8,
      cols: 8,
      spider: [{ x: 0, y: 4 }],
      spiderDirection: "down",
      fly: { x: 0, y: 5 },
      webs: [],
      webCooldownTicks: 0,
    });
    const s2 = logic.reduceState(s1, { type: "tick" }, rngZero);
    assert(s2.status === logic.STATUS.playing, "Should not instantly die from the shot");
    assert(s2.webs.length >= 1, "Should add web traps");
    assertPoint(s2.webs[0], { x: 0, y: 6 }, "Web should appear beyond the fly");
  });

  test("Offspring spawns every 30s and disappears after ~10s", () => {
    const rng = logic.createRng(7);
    let s = baseState({
      rows: 12,
      cols: 12,
      spider: [{ x: 6, y: 6 }],
      spiderDirection: "right",
      fly: { x: 0, y: 0 },
      webs: [],
      webCooldownTicks: 9999,
      elapsedMs: 29950,
      nextOffspringMs: 30000,
      spiderlings: [],
    });

    s = logic.reduceState(s, { type: "tick", dtMs: 100 }, rng);
    assert(s.spiderlings.length > 0, "Should spawn spiderlings at 30s");

    // Advance ~10.1s and ensure they expire.
    for (let i = 0; i < 101; i++) s = logic.reduceState(s, { type: "tick", dtMs: 100 }, rng);
    assert(s.spiderlings.length === 0, "Spiderlings should expire after ~10s");
  });

  test("Spiderlings chase the fly", () => {
    const rng = logic.createRng(9);
    const s1 = baseState({
      rows: 12,
      cols: 12,
      spider: [{ x: 10, y: 10 }],
      spiderDirection: "left",
      fly: { x: 6, y: 2 },
      webs: [],
      webCooldownTicks: 9999,
      spiderlings: [{ x: 2, y: 2, ttlMs: 10000 }],
    });

    const s2 = logic.reduceState(s1, { type: "tick", dtMs: 120 }, rng);
    assertPoint(s2.spiderlings[0], { x: 3, y: 2 }, "Spiderling should move closer on X axis");
  });

  test("Spiderlings do not stack on the same cell after moving", () => {
    const rng = logic.createRng(11);
    const s1 = baseState({
      rows: 12,
      cols: 12,
      spider: [{ x: 10, y: 10 }],
      spiderDirection: "left",
      fly: { x: 6, y: 2 },
      webs: [],
      webCooldownTicks: 9999,
      spiderlings: [
        { x: 2, y: 2, ttlMs: 10000 },
        { x: 2, y: 3, ttlMs: 10000 },
      ],
    });

    const s2 = logic.reduceState(s1, { type: "tick", dtMs: 120 }, rng);
    const a = s2.spiderlings[0];
    const b = s2.spiderlings[1];
    assert(!(a.x === b.x && a.y === b.y), "Spiderlings should not occupy the same cell");
  });

  test("After 120s, predictor learns direction transitions", () => {
    const rng = logic.createRng(13);
    let s = baseState({
      rows: 30,
      cols: 30,
      spider: [{ x: 29, y: 29 }],
      spiderDirection: "left",
      fly: { x: 10, y: 10 },
      webs: [],
      webCooldownTicks: 9999,
      elapsedMs: 120000,
    });

    // Teach: up -> right a few times.
    for (let i = 0; i < 3; i++) {
      s = logic.reduceState(s, { type: "flyDirection", direction: "up" }, rng);
      s = logic.reduceState(s, { type: "tick", dtMs: 120 }, rng);
      s = logic.reduceState(s, { type: "flyDirection", direction: "right" }, rng);
      s = logic.reduceState(s, { type: "tick", dtMs: 120 }, rng);
    }

    const predicted = logic.predictFlyDirection(s.flyLearn, "up");
    assert(predicted && predicted.dir === "right", "Predictor should learn up->right transition");
  });

  test("Fly stepping onto a web trap stuns and removes it", () => {
    const s1 = baseState({
      rows: 8,
      cols: 8,
      spider: [{ x: 4, y: 4 }],
      spiderDirection: "left",
      fly: { x: 2, y: 2 },
      queuedFlyDirection: "right",
      webs: [{ x: 3, y: 2, ttlTicks: 10 }],
    });
    const s2 = logic.reduceState(s1, { type: "tick" }, Math.random);
    assert(s2.status === logic.STATUS.playing, "Status should remain playing");
    assert(s2.flyStunTicks >= 1, "Fly should be stunned");
    assert(s2.webs.length === 0, "Web trap should be removed on hit");
  });

  test("Growth logic still works when a larger maximum length is allowed", () => {
    const rng = logic.createRng(2);
    let s = baseState({
      rows: 50,
      cols: 50,
      spider: [
        { x: 25, y: 25 },
        { x: 24, y: 25 },
        { x: 23, y: 25 },
      ],
      spiderDirection: "right",
      fly: { x: 0, y: 0 },
      webs: [],
      webCooldownTicks: 9999,
    });

    const initialLen = s.spider.length;
    for (let i = 0; i < 21; i++) s = logic.reduceState(s, { type: "tick" }, rng);
    assert(s.status === logic.STATUS.playing, "Should still be playing");
    assert(s.spider.length > initialLen, "Spider should have grown");
  });

  write(`\nSummary: ${passed} passed, ${failed} failed`);
})();
