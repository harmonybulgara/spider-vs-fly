(function attachSnakeLogic(global) {
  "use strict";

  const DEFAULT_CONFIG = Object.freeze({ rows: 20, cols: 20 });
  const STATUS = Object.freeze({
    playing: "playing",
    paused: "paused",
    gameover: "gameover",
  });

  const DIR_VECTORS = Object.freeze({
    up: Object.freeze({ x: 0, y: -1 }),
    down: Object.freeze({ x: 0, y: 1 }),
    left: Object.freeze({ x: -1, y: 0 }),
    right: Object.freeze({ x: 1, y: 0 }),
  });

  const OPPOSITE_DIR = Object.freeze({
    up: "down",
    down: "up",
    left: "right",
    right: "left",
  });

  const AI_DIR_ORDER = Object.freeze(["up", "left", "down", "right"]);

  const WEB_BEAM_TTL_TICKS = 4;
  const LEARN_AFTER_MS = 120000;
  const WEB_MAX_RANGE_BLOCKS = 4;

  function clamp01(v) {
    if (typeof v !== "number" || !Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  function clampInt(value, min, fallback) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    const n = Math.floor(value);
    return n < min ? min : n;
  }

  function normalizeConfig(config) {
    const rows = clampInt(config?.rows, 4, DEFAULT_CONFIG.rows);
    const cols = clampInt(config?.cols, 4, DEFAULT_CONFIG.cols);
    return { rows, cols };
  }

  function createRng(seed) {
    let t = (seed >>> 0) || 0;
    return function rng() {
      t += 0x6d2b79f5;
      let x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function safeRngValue(rng) {
    const v = rng();
    if (typeof v !== "number" || !Number.isFinite(v)) return 0;
    if (v <= 0) return 0;
    if (v >= 1) return 0.9999999999;
    return v;
  }

  function randomInt(rng, maxExclusive) {
    if (maxExclusive <= 0) return 0;
    return Math.floor(safeRngValue(rng) * maxExclusive);
  }

  function samePoint(a, b) {
    return !!a && !!b && a.x === b.x && a.y === b.y;
  }

  function toIndex(point, cols) {
    return point.y * cols + point.x;
  }

  function isDirection(value) {
    return value === "up" || value === "down" || value === "left" || value === "right";
  }

  function isOpposite(a, b) {
    if (!isDirection(a) || !isDirection(b)) return false;
    return OPPOSITE_DIR[a] === b;
  }

  function movePoint(head, direction) {
    const vec = DIR_VECTORS[direction];
    return { x: head.x + vec.x, y: head.y + vec.y };
  }

  function outOfBounds(point, rows, cols) {
    return point.x < 0 || point.y < 0 || point.x >= cols || point.y >= rows;
  }

  function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function createDirMatrix() {
    return {
      up: { up: 0, down: 0, left: 0, right: 0 },
      down: { up: 0, down: 0, left: 0, right: 0 },
      left: { up: 0, down: 0, left: 0, right: 0 },
      right: { up: 0, down: 0, left: 0, right: 0 },
    };
  }

  function createFlyLearnState() {
    return { lastDir: null, counts: createDirMatrix() };
  }

  function updateFlyLearn(learn, movedDir) {
    const base = learn && typeof learn === "object" && learn.counts ? learn : createFlyLearnState();
    if (!isDirection(movedDir)) return base;

    const last = base.lastDir;
    if (isDirection(last)) {
      const counts = base.counts;
      counts[last][movedDir] = (counts[last][movedDir] || 0) + 1;
      return { lastDir: movedDir, counts };
    }
    return { lastDir: movedDir, counts: base.counts };
  }

  function predictFlyDirection(learn, fromDir) {
    if (!learn || !learn.counts || !isDirection(fromDir)) return null;
    const row = learn.counts[fromDir];
    if (!row) return null;

    let bestDir = null;
    let best = 0;
    let total = 0;
    for (const dir of AI_DIR_ORDER) {
      const c = row[dir] || 0;
      total += c;
      if (c > best) {
        best = c;
        bestDir = dir;
      }
    }
    if (!bestDir || best <= 0) return null;
    return { dir: bestDir, confidence: total > 0 ? best / total : 0 };
  }

  function simulateFlyFuture(state, steps) {
    const fly = state.fly;
    if (!fly) return fly;
    let pos = { x: fly.x, y: fly.y };

    let lastDir = isDirection(state.flyMovedDir) ? state.flyMovedDir : state.flyLearn?.lastDir;
    let nextDir = isDirection(state.queuedFlyDirection) ? state.queuedFlyDirection : null;

    for (let i = 0; i < steps; i++) {
      if (!nextDir && isDirection(lastDir)) {
        const pred = predictFlyDirection(state.flyLearn, lastDir);
        nextDir = pred?.dir || null;
      }
      if (!isDirection(nextDir)) break;

      const cand = movePoint(pos, nextDir);
      if (outOfBounds(cand, state.rows, state.cols)) break;
      if (hasWebAt(state.webs, cand)) break;

      pos = cand;
      lastDir = nextDir;
      nextDir = null;
    }

    return pos;
  }

  function chooseChaserStep(from, target, rows, cols, blocked, rng = Math.random) {
    let bestDist = Number.POSITIVE_INFINITY;
    const best = [];

    for (const dir of AI_DIR_ORDER) {
      const next = movePoint(from, dir);
      if (outOfBounds(next, rows, cols)) continue;
      if (blocked && blocked.has(toIndex(next, cols))) continue;
      const d = manhattan(next, target);
      if (d < bestDist) {
        bestDist = d;
        best.length = 0;
        best.push(next);
      } else if (d === bestDist) {
        best.push(next);
      }
    }

    if (best.length === 0) return from;
    if (best.length === 1) return best[0];
    return best[randomInt(rng, best.length)];
  }

  function lineCells(a, b) {
    const cells = [];
    if (a.x === b.x) {
      const step = a.y < b.y ? 1 : -1;
      for (let y = a.y + step; y !== b.y; y += step) cells.push({ x: a.x, y });
      return cells;
    }
    if (a.y === b.y) {
      const step = a.x < b.x ? 1 : -1;
      for (let x = a.x + step; x !== b.x; x += step) cells.push({ x, y: a.y });
      return cells;
    }
    return cells;
  }

  function hasWebAt(webs, p) {
    for (const w of webs) {
      if (w.ttlTicks > 0 && w.x === p.x && w.y === p.y) return true;
    }
    return false;
  }

  function decayWebs(webs) {
    if (!Array.isArray(webs) || webs.length === 0) return [];
    const next = [];
    for (const w of webs) {
      const ttlTicks = w.ttlTicks - 1;
      if (ttlTicks > 0) next.push({ x: w.x, y: w.y, ttlTicks });
    }
    return next;
  }

  function removeWebAt(webs, p) {
    if (!Array.isArray(webs) || webs.length === 0) return webs || [];
    const next = [];
    for (const w of webs) {
      if (w.x === p.x && w.y === p.y) continue;
      next.push(w);
    }
    return next;
  }

  function decayBeam(beam) {
    if (!beam || typeof beam.ttlTicks !== "number") return null;
    const ttlTicks = beam.ttlTicks - 1;
    if (ttlTicks <= 0) return null;
    return { from: beam.from, to: beam.to, ttlTicks };
  }

  function decaySpiderlings(spiderlings, dtMs) {
    if (!Array.isArray(spiderlings) || spiderlings.length === 0) return [];
    const next = [];
    for (const s of spiderlings) {
      const ttlMs = (s.ttlMs || 0) - dtMs;
      if (ttlMs > 0) next.push({ x: s.x, y: s.y, ttlMs });
    }
    return next;
  }

  function placeSpiderlings(state, rng, count) {
    const rows = state.rows;
    const cols = state.cols;
    const occupied = new Set();
    for (const p of state.spider) occupied.add(toIndex(p, cols));
    if (state.fly) occupied.add(toIndex(state.fly, cols));
    for (const w of state.webs) occupied.add(toIndex(w, cols));
    for (const s of state.spiderlings || []) occupied.add(toIndex(s, cols));

    const empty = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        if (!occupied.has(idx)) empty.push({ x, y });
      }
    }

    if (empty.length === 0) return [];
    const next = [];
    let n = count;
    while (n > 0 && empty.length > 0) {
      const i = randomInt(rng, empty.length);
      const p = empty.splice(i, 1)[0];
      next.push({ x: p.x, y: p.y, ttlMs: state.params.offspringTtlMs });
      n--;
    }
    return next;
  }

  function moveSpiderlings(spiderlings, target, rows, cols, blockedBase, rng) {
    if (!Array.isArray(spiderlings) || spiderlings.length === 0) return spiderlings || [];
    const next = [];
    const blocked = new Set(blockedBase || []);

    // Prevent spiderlings from stacking on each other.
    for (const s of spiderlings) blocked.add(toIndex(s, cols));

    // Move deterministically in array order; later spiderlings cannot move into earlier ones.
    for (const s of spiderlings) {
      blocked.delete(toIndex(s, cols));
      const moved = chooseChaserStep({ x: s.x, y: s.y }, target, rows, cols, blocked, rng);
      blocked.add(toIndex(moved, cols));
      next.push({ x: moved.x, y: moved.y, ttlMs: s.ttlMs });
    }

    return next;
  }

  function canShootWeb(state) {
    return state.webCooldownTicks <= 0;
  }

  function tryShootWeb(state) {
    // Only shoot if aligned with fly and clear path (no spider segments between).
    const head = state.spider[0];
    const fly = state.fly;
    if (!fly) return null;
    if (head.x !== fly.x && head.y !== fly.y) return null;

    const between = lineCells(head, fly);
    if (between.length === 0) {
      // If adjacent, try placing a web just beyond the fly (still feels like a "shot" without insta-killing).
      const dx = Math.sign(fly.x - head.x);
      const dy = Math.sign(fly.y - head.y);
      const candidate = { x: fly.x + dx, y: fly.y + dy };
      if (outOfBounds(candidate, state.rows, state.cols)) return null;

      const spiderOccupied = new Set();
      for (const p of state.spider) spiderOccupied.add(toIndex(p, state.cols));
      if (spiderOccupied.has(toIndex(candidate, state.cols))) return null;
      if (hasWebAt(state.webs, candidate)) return null;

      return candidate;
    }

    const spiderOccupied = new Set();
    for (const p of state.spider) spiderOccupied.add(toIndex(p, state.cols));

    for (const c of between) {
      if (spiderOccupied.has(toIndex(c, state.cols))) return null;
    }

    // Cap range: place the web within WEB_MAX_RANGE_BLOCKS of the spider head.
    const dx = Math.sign(fly.x - head.x);
    const dy = Math.sign(fly.y - head.y);

    const distToFly = manhattan(head, fly);
    const dist = Math.min(WEB_MAX_RANGE_BLOCKS, Math.max(1, distToFly - 1));
    const candidate = { x: head.x + dx * dist, y: head.y + dy * dist };

    if (outOfBounds(candidate, state.rows, state.cols)) return null;
    if (spiderOccupied.has(toIndex(candidate, state.cols))) return null;
    if (samePoint(candidate, fly)) return null;
    return candidate;
  }

  function placeFly(state, rng) {
    const rows = state.rows;
    const cols = state.cols;
    const occupied = new Set();
    for (const p of state.spider) occupied.add(toIndex(p, cols));

    const empty = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        if (!occupied.has(idx)) empty.push({ x, y });
      }
    }

    if (empty.length === 0) return null;
    return empty[randomInt(rng, empty.length)];
  }

  function centerPoint(cols, rows) {
    return { x: Math.floor(cols / 2), y: Math.floor(rows / 2) };
  }

  function pointInCenterZone(p, cols, rows) {
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);
    const r = 3; // 7x7-ish "center area"
    return Math.abs(p.x - cx) <= r && Math.abs(p.y - cy) <= r;
  }

  function chooseSpiderStart(cols, rows, rng, avoidPoint, minHeadDistance) {
    const candidates = [];
    for (let y = 0; y < rows; y++) {
      for (let headX = 2; headX < cols; headX++) {
        const segs = [
          { x: headX, y },
          { x: headX - 1, y },
          { x: headX - 2, y },
        ];

        let ok = !avoidPoint || manhattan(segs[0], avoidPoint) >= minHeadDistance;
        for (const p of segs) {
          if (outOfBounds(p, rows, cols) || pointInCenterZone(p, cols, rows)) {
            ok = false;
            break;
          }
          if (avoidPoint && samePoint(p, avoidPoint)) {
            ok = false;
            break;
          }
        }
        if (ok) candidates.push(segs);
      }
    }

    if (candidates.length === 0) return null;
    return candidates[randomInt(rng, candidates.length)];
  }

  function chooseAiDirection(state, rng = Math.random) {
    const current = state.spiderDirection;
    const head = state.spider[0];
    const bodyToCheck = state.spider.length > 1 ? state.spider.slice(0, -1) : [];

      let target = state.fly;
      if (isDirection(state.queuedFlyDirection) && state.fly) {
        const predicted = movePoint(state.fly, state.queuedFlyDirection);
        if (!outOfBounds(predicted, state.rows, state.cols) && !hasWebAt(state.webs, predicted)) {
          target = predicted;
        }
      }
      // Learning / cut-off: gradually shift from "chase" to "intercept" over time.
      const elapsedMs = state.elapsedMs || 0;
      const learnFactor = clamp01(elapsedMs / LEARN_AFTER_MS); // 0..1 over first 120s
      const horizon = 1 + Math.floor(learnFactor * 4); // 1..5 cells ahead
      const intercept = simulateFlyFuture(state, horizon);

      let bestDist = Number.POSITIVE_INFINITY;
      const bestDirs = [];

    for (const dir of AI_DIR_ORDER) {
      if (state.spider.length > 1 && isOpposite(current, dir)) continue;

      const nextHead = movePoint(head, dir);
      if (outOfBounds(nextHead, state.rows, state.cols)) continue;

      let hitsBody = false;
      for (const p of bodyToCheck) {
        if (samePoint(p, nextHead)) {
          hitsBody = true;
          break;
        }
      }
      if (hitsBody) continue;
      if (hasWebAt(state.webs, nextHead)) continue;
      for (const s of state.spiderlings || []) {
        if (samePoint(s, nextHead)) {
          hitsBody = true;
          break;
        }
      }
      if (hitsBody) continue;

        const chaseDist = manhattan(nextHead, target);
        const interceptDist = intercept ? manhattan(nextHead, intercept) : chaseDist;
        // As learnFactor increases, "intercept" dominates, creating a cut-off feeling.
        const dist = chaseDist * (1.0 - learnFactor * 0.45) + interceptDist * (0.55 + learnFactor * 0.9);
        if (dist < bestDist) {
          bestDist = dist;
          bestDirs.length = 0;
          bestDirs.push(dir);
        } else if (dist === bestDist) {
        bestDirs.push(dir);
      }
    }

    if (bestDirs.length === 0) return isDirection(current) ? current : "right";
    if (bestDirs.length === 1) return bestDirs[0];
    return bestDirs[randomInt(rng, bestDirs.length)];
  }

  function createInitialState(config, rng = Math.random) {
    const { rows, cols } = normalizeConfig(config);
    const params = paramsForDifficulty(config?.difficulty);

    const fly = centerPoint(cols, rows);
    const minHeadDistance = params.difficulty === "easy" ? 11 : params.difficulty === "hard" ? 7 : 9;
    const seededSpider = chooseSpiderStart(cols, rows, rng, fly, minHeadDistance);
    const spider =
      seededSpider ||
      (function fallbackSpider() {
        const flyX = Math.floor(cols / 2);
        const headX = Math.min(cols - 1, Math.max(2, flyX + 2));
        const headY = Math.floor(rows / 2);
        return [
          { x: headX, y: headY },
          { x: headX - 1, y: headY },
          { x: headX - 2, y: headY },
        ];
      })();

      const base = {
        rows,
        cols,
        spider,
        spiderDirection: "right",
        queuedFlyDirection: null,
        fly: null,
      scoreTicks: 0,
      ageTicks: 0,
      elapsedMs: 0,
      nextOffspringMs: params.offspringEveryMs,
      growthRemaining: 0,
      webs: [],
      webBeam: null,
      webCooldownTicks: 0,
      lastWebShot: null,
      webShotSeq: 0,
      spiderlings: [],
      flyLearn: createFlyLearnState(),
      flyMovedDir: null,
      flyStunTicks: 0,
      params,
      status: STATUS.playing,
    };

    return { ...base, fly };
  }

  function reduceState(state, action, rng = Math.random) {
    if (!state || !action || typeof action.type !== "string") return state;

    switch (action.type) {
      case "flyDirection": {
        if (state.status === STATUS.gameover) return state;
        if (!isDirection(action.direction)) return state;
        if (state.queuedFlyDirection === action.direction) return state;
        return { ...state, queuedFlyDirection: action.direction };
      }

      case "togglePause": {
        if (state.status === STATUS.gameover) return state;
        const nextStatus = state.status === STATUS.paused ? STATUS.playing : STATUS.paused;
        return { ...state, status: nextStatus };
      }

      case "restart": {
        return createInitialState({ rows: state.rows, cols: state.cols, difficulty: state.params?.difficulty }, rng);
      }

      case "tick": {
        const dtMs =
          typeof action.dtMs === "number" && Number.isFinite(action.dtMs) && action.dtMs > 0
            ? action.dtMs
            : 120;

        // Even after game-over, allow timed elements to decay so tests and state stay consistent.
        if (state.status !== STATUS.playing) {
          return {
            ...state,
            webs: decayWebs(state.webs),
            webBeam: decayBeam(state.webBeam),
            spiderlings: decaySpiderlings(state.spiderlings, dtMs),
          };
        }

        if (!state.fly) return { ...state, status: STATUS.gameover };

        const params = state.params || paramsForDifficulty("normal");
        const ageTicks = (state.ageTicks || 0) + 1;
        const baseGrowthRemaining = state.growthRemaining || 0;
        const growthRemaining = ageTicks % params.growEveryTicks === 0 ? baseGrowthRemaining + 1 : baseGrowthRemaining;

        const webs = decayWebs(state.webs);
        const webBeam = decayBeam(state.webBeam);
        const webCooldownTicks = Math.max(0, (state.webCooldownTicks || 0) - 1);
        const spiderlings = decaySpiderlings(state.spiderlings, dtMs);
        const flyStunTicks = Math.max(0, (state.flyStunTicks || 0) - 1);

        let elapsedMs = (state.elapsedMs || 0) + dtMs;
        let nextOffspringMs =
          typeof state.nextOffspringMs === "number" && Number.isFinite(state.nextOffspringMs) && state.nextOffspringMs > 0
            ? state.nextOffspringMs
            : params.offspringEveryMs;
        let nextSpiderlings = spiderlings;
        while (elapsedMs >= nextOffspringMs) {
          nextSpiderlings = nextSpiderlings.concat(
            placeSpiderlings({ ...state, webs, spiderlings: nextSpiderlings, params }, rng, params.offspringCount),
          );
          nextOffspringMs += params.offspringEveryMs;
        }

        // 1) Fly moves first (player-controlled).
        let nextFly = state.fly;
        let flyMovedDir = null;
        if (flyStunTicks <= 0 && isDirection(state.queuedFlyDirection)) {
          const candidate = movePoint(state.fly, state.queuedFlyDirection);
          if (!outOfBounds(candidate, state.rows, state.cols)) {
            nextFly = candidate;
            flyMovedDir = state.queuedFlyDirection;
          }
        }
        const flyLearn = updateFlyLearn(state.flyLearn, flyMovedDir);

          for (const p of state.spider) {
            if (samePoint(p, nextFly)) return { ...state, fly: nextFly, status: STATUS.gameover };
          }
          for (const s of nextSpiderlings) {
            if (samePoint(s, nextFly)) {
              return {
                ...state,
                fly: nextFly,
                webs,
                spiderlings: nextSpiderlings,
                flyLearn,
                flyMovedDir,
                elapsedMs,
                nextOffspringMs,
                webCooldownTicks,
                ageTicks,
                growthRemaining,
                status: STATUS.gameover,
              };
            }
          }
        let nextWebsAfterHit = webs;
        let nextFlyStunTicks = flyStunTicks;
        if (hasWebAt(webs, nextFly)) {
          // Webbing is sticky (slows you) rather than instantly killing you.
          nextWebsAfterHit = removeWebAt(webs, nextFly);
          nextFlyStunTicks = Math.max(nextFlyStunTicks, 2);
        }

        // 2) Spiderlings chase the fly.
        const blockedForSpiderlings = new Set();
        for (const p of state.spider) blockedForSpiderlings.add(toIndex(p, state.cols));
        for (const w of nextWebsAfterHit) blockedForSpiderlings.add(toIndex(w, state.cols));

        // Allow moving into each other's old positions by clearing as we go in moveSpiderlings().
        let chasedSpiderlings = moveSpiderlings(nextSpiderlings, nextFly, state.rows, state.cols, blockedForSpiderlings, rng);
        for (const s of chasedSpiderlings) {
          if (samePoint(s, nextFly)) {
            return {
              ...state,
              fly: nextFly,
              webs,
              spiderlings: chasedSpiderlings,
              flyLearn,
              flyMovedDir,
              elapsedMs,
              nextOffspringMs,
              webCooldownTicks,
              ageTicks,
              growthRemaining,
              status: STATUS.gameover,
            };
          }
        }

        // 3) AI may shoot a web trap if aligned.
        let lastWebShot = null;
        let nextWebBeam = webBeam;
        let webShotSeq = state.webShotSeq || 0;
        let nextWebCooldown = webCooldownTicks;
        let nextWebs = nextWebsAfterHit;
        if (canShootWeb({ ...state, webCooldownTicks }) && nextFly) {
          const shotCell = tryShootWeb({ ...state, fly: nextFly, webs: nextWebsAfterHit });
          if (shotCell && !hasWebAt(nextWebsAfterHit, shotCell)) {
            // Shoot "further": lay a short strip of web traps in the shot direction (including beyond the fly if possible).
            const head = state.spider[0];
            const dx = Math.sign(shotCell.x - head.x);
            const dy = Math.sign(shotCell.y - head.y);

            const toAdd = [];
            let stepIndex = 0;
            while (toAdd.length < params.webStripLen && stepIndex < params.webStripLen + 2) {
              const p = { x: shotCell.x + dx * stepIndex, y: shotCell.y + dy * stepIndex };
              stepIndex++;
              if (outOfBounds(p, state.rows, state.cols)) break;
              if (manhattan(head, p) > WEB_MAX_RANGE_BLOCKS) break;
              let hitsSpider = false;
              for (const sp of state.spider) {
                if (samePoint(sp, p)) {
                  hitsSpider = true;
                  break;
                }
              }
              if (hitsSpider) break;
              if (nextFly && samePoint(nextFly, p)) break;
              toAdd.push(p);
            }

            nextWebs = nextWebsAfterHit.concat(toAdd.map((p) => ({ x: p.x, y: p.y, ttlTicks: params.webTtlTicks })));
            nextWebCooldown = params.webCooldownTicks;
            lastWebShot = { x: shotCell.x, y: shotCell.y };
            webShotSeq = webShotSeq + 1;
            const beamTo = toAdd.length > 0 ? toAdd[toAdd.length - 1] : shotCell;
            nextWebBeam = {
              from: { x: state.spider[0].x, y: state.spider[0].y },
              to: { x: beamTo.x, y: beamTo.y },
              ttlTicks: WEB_BEAM_TTL_TICKS,
            };
          }
        }

        // 4) AI picks spider direction based on the (potentially) moved fly.
        const aiDir = chooseAiDirection(
          { ...state, fly: nextFly, webs: nextWebs, spiderlings: chasedSpiderlings, flyLearn, flyMovedDir, elapsedMs },
          rng,
        );
        const head = state.spider[0];
        const didShoot = !!lastWebShot;
        const nextHead = didShoot ? head : movePoint(head, aiDir);

        if (outOfBounds(nextHead, state.rows, state.cols)) {
          return {
            ...state,
            fly: nextFly,
            spiderDirection: aiDir,
            webs: nextWebs,
            webBeam: nextWebBeam,
            webCooldownTicks: nextWebCooldown,
            lastWebShot,
            webShotSeq,
            spiderlings: chasedSpiderlings,
            flyLearn,
            flyMovedDir,
            flyStunTicks: nextFlyStunTicks,
            elapsedMs,
            nextOffspringMs,
            ageTicks,
            growthRemaining,
            status: STATUS.gameover,
          };
        }
        if (hasWebAt(nextWebs, nextHead)) {
          return {
            ...state,
            fly: nextFly,
            spiderDirection: aiDir,
            webs: nextWebs,
            webBeam: nextWebBeam,
            webCooldownTicks: nextWebCooldown,
            lastWebShot,
            webShotSeq,
            spiderlings: chasedSpiderlings,
            flyLearn,
            flyMovedDir,
            flyStunTicks: nextFlyStunTicks,
            elapsedMs,
            nextOffspringMs,
            ageTicks,
            growthRemaining,
            status: STATUS.gameover,
          };
        }

        const bodyToCheck = state.spider.length > 1 ? state.spider.slice(0, -1) : [];
        for (const p of bodyToCheck) {
          if (samePoint(p, nextHead)) {
            return {
              ...state,
              fly: nextFly,
              spiderDirection: aiDir,
              webs: nextWebs,
              webBeam: nextWebBeam,
              webCooldownTicks: nextWebCooldown,
              lastWebShot,
              webShotSeq,
              spiderlings: chasedSpiderlings,
              flyLearn,
              flyMovedDir,
              flyStunTicks: nextFlyStunTicks,
              elapsedMs,
              nextOffspringMs,
              ageTicks,
              growthRemaining,
              status: STATUS.gameover,
            };
          }
        }

        const willGrow = growthRemaining > 0;
        const trimmed = state.spider.length > 1 ? state.spider.slice(0, -1) : [];
        const actuallyGrew = !didShoot && willGrow;
        const nextSpider = didShoot ? state.spider : actuallyGrew ? [nextHead, ...state.spider] : [nextHead, ...trimmed];
        const nextGrowthRemaining = actuallyGrew ? growthRemaining - 1 : growthRemaining;

        if (samePoint(nextHead, nextFly)) {
          return {
            ...state,
            fly: nextFly,
            spider: nextSpider,
            spiderDirection: aiDir,
            webs: nextWebs,
            webBeam: nextWebBeam,
            webCooldownTicks: nextWebCooldown,
            lastWebShot,
            webShotSeq,
            spiderlings: chasedSpiderlings,
            flyLearn,
            flyMovedDir,
            flyStunTicks: nextFlyStunTicks,
            elapsedMs,
            nextOffspringMs,
            ageTicks,
            growthRemaining: nextGrowthRemaining,
            status: STATUS.gameover,
          };
        }

        return {
          ...state,
          fly: nextFly,
          spider: nextSpider,
          spiderDirection: aiDir,
          webs: nextWebs,
          webBeam: nextWebBeam,
          webCooldownTicks: nextWebCooldown,
          lastWebShot,
          webShotSeq,
          spiderlings: chasedSpiderlings,
          flyLearn,
          flyMovedDir,
          flyStunTicks: nextFlyStunTicks,
          elapsedMs,
          nextOffspringMs,
          scoreTicks: (state.scoreTicks || 0) + 1,
          ageTicks,
          growthRemaining: nextGrowthRemaining,
          params,
        };
      }

      default:
        return state;
    }
  }

  global.SnakeLogic = Object.freeze({
    STATUS,
    createRng,
    createInitialState,
    reduceState,
    placeFly,
    chooseAiDirection,
    hasWebAt,
    placeSpiderlings,
    predictFlyDirection,
    samePoint,
    toIndex,
    isOpposite,
  });
})(typeof window !== "undefined" ? window : globalThis);
  function paramsForDifficulty(difficulty) {
    const d = difficulty === "easy" || difficulty === "hard" ? difficulty : "normal";
    if (d === "easy") {
      return {
        difficulty: "easy",
        webTtlTicks: 40,
        webCooldownTicks: 10,
        webStripLen: 1,
        growEveryTicks: 18,
        offspringEveryMs: 45000,
        offspringTtlMs: 9000,
        offspringCount: 1,
      };
    }
    if (d === "hard") {
      return {
        difficulty: "hard",
        webTtlTicks: 82,
        webCooldownTicks: 3,
        webStripLen: 1,
        growEveryTicks: 8,
        offspringEveryMs: 18000,
        offspringTtlMs: 13000,
        offspringCount: 4,
      };
    }
    return {
      difficulty: "normal",
      webTtlTicks: 48,
      webCooldownTicks: 7,
      webStripLen: 1,
      growEveryTicks: 16,
      offspringEveryMs: 34000,
      offspringTtlMs: 9500,
      offspringCount: 2,
    };
  }
