import React, { useState, useMemo, useRef, useEffect } from "react";

/* ------------------------------------------------------------------
   DOMAIN MODEL
   A board is Beaker[]. A Beaker is { units, slots, locked, cost }.
   units are ordered BOTTOM -> TOP; a unit is a color name or "?" (hidden).
   slots is that beaker's own capacity, so a locked one-slot beaker is
   expressible alongside normal four-slot beakers.
   A locked beaker cannot receive or give until it is unlocked, which
   costs coins and is therefore a move of last resort.
   ------------------------------------------------------------------ */

const PALETTE = {
  peach: "#F5CFB8", mauve: "#8A6068", red: "#E14B4B", maroon: "#8E1F3F",
  purple: "#7B2382", darkgreen: "#1F4A2C", yellow: "#EFB63C", olive: "#7BA02E",
  orange: "#E07B2C", pink: "#EE79B7", blue: "#1E5FD0", lightblue: "#4EA8DE",
  teal: "#17A2A2", brown: "#6B4326", grey: "#9AA0A8", white: "#F2F2F2",
  black: "#20242C", lime: "#B6E24A", "?": "#3A3F52",
};
const colorOf = (c) => (c && c.startsWith("#") ? c : PALETTE[c]) || "#666B7E";

const mk = (units, slots = 4, locked = false, cost = 0) => ({ units, slots, locked, cost });

const LEVEL_FROM_SCREENSHOT = [
  mk(["maroon", "red", "mauve", "peach"]),
  mk(["red", "purple", "purple", "peach"]),
  mk(["red", "olive", "yellow", "darkgreen"]),
  mk(["mauve", "maroon", "orange", "darkgreen"]),
  mk(["lightblue", "blue", "purple", "pink"]),
  mk(["peach", "maroon", "lightblue", "blue"]),
  mk(["red", "maroon", "yellow", "blue"]),
  mk(["pink", "yellow", "lightblue", "peach"]),
  mk(["blue", "orange", "pink", "olive"]),
  mk(["darkgreen", "orange", "yellow", "mauve"]),
  mk(["olive", "purple", "darkgreen", "olive"]),
  mk(["pink", "lightblue", "orange", "mauve"]),
  mk([]),
  mk([]),
  mk([], 1, true, 100), // beaker 15: locked, one slot, 100 coins
];

/* --- pure state helpers. `state` is Beaker[]; solver works on a subset. --- */
const top = (bk) => (bk.units.length ? bk.units[bk.units.length - 1] : null);

function runLength(bk) {
  const u = bk.units;
  if (!u.length) return 0;
  const t = u[u.length - 1];
  if (t === "?") return 0; // hidden units are not pourable
  let n = 0;
  for (let i = u.length - 1; i >= 0 && u[i] === t; i--) n++;
  return n;
}

const isComplete = (bk) =>
  bk.units.length === 0 ||
  (bk.units.length === bk.slots && bk.units.every((x) => x === bk.units[0]) && bk.units[0] !== "?");

const isSolved = (state) => state.every(isComplete);
const hasHidden = (state) => state.some((bk) => bk.units.some((u) => u === "?"));

/* Legal pours from a state.
   - source needs a pourable top run
   - destination needs room, and must be empty or share the top color
   - moving a whole monochrome beaker into an empty one changes nothing, so it is cut
   - a one-slot beaker can only ever hold a single unit, which the room check handles */
function legalPours(state) {
  const moves = [];
  for (let i = 0; i < state.length; i++) {
    const run = runLength(state[i]);
    if (!run) continue;
    const c = top(state[i]);
    const monochrome = state[i].units.length === run;
    for (let j = 0; j < state.length; j++) {
      if (i === j) continue;
      const dst = state[j];
      const room = dst.slots - dst.units.length;
      if (room <= 0) continue;
      if (dst.units.length === 0) {
        if (monochrome) continue;
      } else if (top(dst) !== c) continue;
      moves.push({ from: i, to: j, color: c, amount: Math.min(run, room) });
    }
  }
  return moves;
}

function applyPour(state, mv) {
  const next = state.map((bk) => ({ ...bk, units: bk.units.slice() }));
  for (let k = 0; k < mv.amount; k++) next[mv.from].units.pop();
  for (let k = 0; k < mv.amount; k++) next[mv.to].units.push(mv.color);
  return next;
}

const stateKey = (state) => state.map((bk) => bk.units.join(">") + "/" + bk.slots).sort().join("|");

/* ------------------------------------------------------------------
   SOLVER
   Two passes. First without the locked beakers, since unlocking costs
   coins. Only if that fails is the locked beaker brought in, and its
   first use is preceded by an explicit unlock step.
   ------------------------------------------------------------------ */
function search(state, nodeBudget = 400000) {
  const dead = new Set();
  const onPath = new Set();
  const path = [];
  let nodes = 0;

  function dfs(s) {
    if (nodes++ > nodeBudget) throw new Error("budget");
    if (isSolved(s)) return true;
    const k = stateKey(s);
    if (dead.has(k) || onPath.has(k)) return false;
    onPath.add(k);
    for (const mv of legalPours(s).sort(order(s))) {
      path.push(mv);
      if (dfs(applyPour(s, mv))) return true;
      path.pop();
    }
    onPath.delete(k);
    dead.add(k);
    return false;
  }

  try {
    return dfs(state)
      ? { status: "solved", moves: path.slice(), visited: nodes }
      : { status: "unsolvable", visited: nodes };
  } catch {
    return { status: "budget", visited: nodes };
  }
}

// Finish a beaker first, then empty one, then merge. Avoid burning empties.
function order(state) {
  const val = (mv) => {
    const dst = state[mv.to], src = state[mv.from];
    let s = 0;
    if (dst.units.length + mv.amount === dst.slots && dst.units.every((u) => u === mv.color)) s -= 100;
    if (src.units.length === mv.amount) s -= 40;
    if (dst.units.length === 0) s += 20;
    s -= mv.amount * 2;
    return s;
  };
  return (a, b) => val(a) - val(b);
}

/* Prefer pouring the SMALLER stack into the LARGER one. It consolidates a
   color instead of scattering it, and it never costs an extra move. Burning a
   fresh empty beaker is ranked last. */
function preferSmallToLarge(state) {
  const rank = (mv) => {
    const dst = state[mv.to];
    let s = mv.amount;                       // move the smaller stack
    if (dst.units.length === 0) s += 50;     // an empty beaker is a last resort
    else s -= dst.units.length;              // pour onto the deepest match
    return s;
  };
  return (a, b) => rank(a) - rank(b);
}

/* Breadth-first, so the first solution found is the shortest one. No move can
   repeat a state, which is what removes the pour-it-back-and-forth churn. */
function shortestSearch(state, cap = 600000) {
  let frontier = [[state, []]];
  const seen = new Set([stateKey(state)]);
  for (let depth = 0; depth < 80; depth++) {
    const next = [];
    for (const [s, path] of frontier) {
      for (const mv of legalPours(s).sort(preferSmallToLarge(s))) {
        const ns = applyPour(s, mv);
        if (isSolved(ns)) return { status: "solved", moves: [...path, mv], visited: seen.size };
        const k = stateKey(ns);
        if (seen.has(k)) continue;
        seen.add(k);
        if (seen.size > cap) return { status: "budget", visited: seen.size };
        next.push([ns, [...path, mv]]);
      }
    }
    frontier = next;
    if (!frontier.length) return { status: "unsolvable", visited: seen.size };
  }
  return { status: "budget", visited: seen.size };
}

/* Two moves that share no beaker are independent, so their order is free.
   Reorder to keep same-color moves together and smaller pours first. Each
   beaker's own sequence is preserved, so the result is still legal. */
function groupMoves(moves) {
  const deps = moves.map((mv, i) => {
    const d = [];
    for (let j = 0; j < i; j++) {
      const o = moves[j];
      if (o.from === mv.from || o.from === mv.to || o.to === mv.from || o.to === mv.to) d.push(j);
    }
    return d;
  });
  const done = new Set();
  const out = [];
  let lastColor = null;
  while (out.length < moves.length) {
    const ready = moves.map((_, i) => i).filter((i) => !done.has(i) && deps[i].every((j) => done.has(j)));
    ready.sort((a, b) => {
      const A = moves[a], B = moves[b];
      const sa = A.color === lastColor ? 0 : 1, sb = B.color === lastColor ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (A.color !== B.color) return A.color < B.color ? -1 : 1;
      if (A.amount !== B.amount) return A.amount - B.amount;
      return a - b;
    });
    done.add(ready[0]);
    lastColor = moves[ready[0]].color;
    out.push(moves[ready[0]]);
  }
  return out;
}

/* Solve the full board, mapping between the active subset and real indices,
   and splicing in unlock steps. Returns steps: pours plus {type:"unlock"}. */
function solveBoard(board) {
  if (hasHidden(board)) return { status: "hidden" };

  const run = (activeIdx) => {
    const sub = activeIdx.map((i) => board[i]);
    // Shortest first. Fall back to depth-first only if the level is too wide
    // for a breadth-first sweep, where a long answer beats no answer.
    let r = shortestSearch(sub);
    let optimal = r.status === "solved";
    if (r.status === "budget") { r = search(sub); optimal = false; }
    if (r.status !== "solved") return r;
    const moves = groupMoves(r.moves);
    return { ...r, optimal, moves: moves.map((m) => ({ ...m, from: activeIdx[m.from], to: activeIdx[m.to] })) };
  };

  const unlocked = board.map((_, i) => i).filter((i) => !board[i].locked);
  const free = run(unlocked);
  if (free.status === "solved") {
    return { status: "solved", steps: free.moves.map(asPour), usedLocked: [], visited: free.visited, optimal: free.optimal };
  }

  const lockedIdx = board.map((_, i) => i).filter((i) => board[i].locked);
  if (!lockedIdx.length) return free;

  const all = board.map((_, i) => i);
  const withLocked = run(all);
  if (withLocked.status !== "solved") {
    return { ...withLocked, freeFailed: free.status };
  }

  // Splice an unlock step before the first touch of each locked beaker.
  const steps = [];
  const opened = new Set();
  const used = [];
  for (const mv of withLocked.moves) {
    for (const idx of [mv.from, mv.to]) {
      if (board[idx].locked && !opened.has(idx)) {
        opened.add(idx);
        used.push(idx);
        steps.push({ type: "unlock", beaker: idx, cost: board[idx].cost });
      }
    }
    steps.push(asPour(mv));
  }
  return { status: "solved", steps, usedLocked: used, visited: withLocked.visited, neededLock: true, optimal: withLocked.optimal };
}

const asPour = (mv) => ({ type: "pour", ...mv });

/* ------------------------------------------------------------------
   STATE GRAPH — BFS over reachable states, capped.
   Sinks: green when solved, red when stuck.
   ------------------------------------------------------------------ */
function buildGraph(state, limit = 600) {
  const nodes = [];
  const index = new Map();
  const edges = [];
  const queue = [];
  const push = (s, depth) => {
    const k = stateKey(s);
    if (index.has(k)) return index.get(k);
    const id = nodes.length;
    index.set(k, id);
    nodes.push({ id, state: s, depth, sink: false, solved: false });
    queue.push(id);
    return id;
  };
  push(state, 0);
  let truncated = false;
  while (queue.length) {
    const n = nodes[queue.shift()];
    if (isSolved(n.state)) { n.sink = true; n.solved = true; continue; }
    const moves = legalPours(n.state);
    if (!moves.length) { n.sink = true; continue; }
    if (nodes.length >= limit) { truncated = true; continue; }
    for (const mv of moves) {
      edges.push({ from: n.id, to: push(applyPour(n.state, mv), n.depth + 1), mv });
      if (nodes.length >= limit) { truncated = true; break; }
    }
  }
  return { nodes, edges, truncated };
}

/* ------------------------------------------------------------------
   BOARD READER — deterministic, no model call.
   1. decode the image into a canvas
   2. background = modal color of the image border
   3. connected components: one blob per beaker, any layout, any height
   4. measure the unit height from real color bands (bands only — a hidden
      cell has no band height of its own to contribute)
   5. read each beaker bottom-up in unit-height cells: a real color (MODAL
      RGB, which ignores sparkles, gloss and JPEG noise by construction), a
      hidden "?" (a background-ish cell carrying a small fleck of the glass
      outline's ink — how these levels draw an unrevealed unit), or —
      reaching neither — the empty headroom that ends the beaker
   6. capacity comes from geometry: the decorative neck is calibrated from
      whichever beakers are already full (clustered by box height first, so
      a topper like a cork/lock on one beaker can't skew it), then each
      beaker's slot count is its interior height over the unit height
   7. only at the very end are RGB values given names; "?" already is one
   ------------------------------------------------------------------ */

const dist = (a, b) => Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]);
const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

function loadPixels(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      resolve({ data, w, h, at: (x, y) => { const i = (y*w + x) * 4; return [data[i], data[i+1], data[i+2]]; } });
    };
    img.onerror = () => reject(new Error("That image could not be decoded."));
    img.src = dataUrl;
  });
}

function modalColor(counts) {
  let best = null, n = -1;
  for (const [k, v] of counts) if (v > n) { n = v; best = k; }
  return { color: best.split(",").map(Number), share: n };
}

function sampleModal(pix, x0, y0, x1, y1, stepIn) {
  const st = stepIn || 2;
  const counts = new Map();
  let total = 0;
  for (let y = Math.max(0, y0); y <= Math.min(pix.h-1, y1); y += st)
    for (let x = Math.max(0, x0); x <= Math.min(pix.w-1, x1); x += st) {
      const k = pix.at(x, y).join(",");
      counts.set(k, (counts.get(k) || 0) + 1);
      total++;
    }
  if (!total) return { color: [0,0,0], share: 0 };
  const m = modalColor(counts);
  return { color: m.color, share: m.share / total };
}

function bandsOf(sig, thr, minLen) {
  const out = []; let s = null;
  for (let i = 0; i < sig.length; i++) {
    if (sig[i] > thr && s === null) s = i;
    else if (sig[i] <= thr && s !== null) { if (i - s >= minLen) out.push([s, i-1]); s = null; }
  }
  if (s !== null && sig.length - s >= minLen) out.push([s, sig.length-1]);
  return out;
}

async function readBoardFromImage(dataUrl) {
  const pix = await loadPixels(dataUrl);
  const { w, h } = pix;

  // background
  const edge = new Map();
  const bump = (c) => edge.set(c.join(","), (edge.get(c.join(",")) || 0) + 1);
  for (let x = 0; x < w; x += 3) { bump(pix.at(x, 0)); bump(pix.at(x, h-1)); }
  for (let y = 0; y < h; y += 3) { bump(pix.at(0, y)); bump(pix.at(w-1, y)); }
  const bg = modalColor(edge).color;
  const isInk = (x, y) => dist(pix.at(x, y), bg) > 45;

  // Beakers via connected components on the ink mask. Projections assumed
  // beakers share row bands and a common floor; special levels stagger them,
  // so each beaker is found as its own blob and gets its own floor.
  const S = Math.max(1, Math.round(Math.max(w, h) / 700));   // work on a coarse grid
  const mw = Math.floor(w / S), mh = Math.floor(h / S);
  const mask = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++)
    for (let x = 0; x < mw; x++)
      mask[y * mw + x] = isInk(x * S, y * S) ? 1 : 0;

  const seenPx = new Uint8Array(mw * mh);
  const blobs = [];
  const stack = new Int32Array(mw * mh);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seenPx[i]) continue;
    let sp = 0; stack[sp++] = i; seenPx[i] = 1;
    let n = 0, x0 = mw, x1 = 0, y0 = mh, y1 = 0;
    while (sp) {
      const p = stack[--sp], px_ = p % mw, py = (p - px_) / mw;
      n++;
      if (px_ < x0) x0 = px_; if (px_ > x1) x1 = px_;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
      const nb = [px_ > 0 ? p-1 : -1, px_ < mw-1 ? p+1 : -1, py > 0 ? p-mw : -1, py < mh-1 ? p+mw : -1];
      for (const q of nb) if (q >= 0 && mask[q] && !seenPx[q]) { seenPx[q] = 1; stack[sp++] = q; }
    }
    if (n > 200 / (S * S)) blobs.push({ n, x0: x0*S, y0: y0*S, x1: x1*S, y1: y1*S });
  }

  // Beaker-shaped: tall, and matching the dominant WIDTH. Heights vary within
  // a level - special levels mix tall and short beakers - but every beaker in
  // a level is drawn the same width. Page chrome and coin badges are neither
  // tall nor that width.
  const tall = blobs.filter((b) => (b.y1 - b.y0) >= 2.0 * (b.x1 - b.x0));
  if (!tall.length) throw new Error("No beakers found. Crop tighter around the beakers and retry.");
  let domWidth = 0, bestCount = 0;
  for (const b of tall) {
    const ww = b.x1 - b.x0;
    const c = tall.filter((o) => Math.abs((o.x1 - o.x0) - ww) <= 0.15 * ww).length;
    if (c > bestCount) { bestCount = c; domWidth = ww; }
  }
  const boxes = tall.filter((b) => Math.abs((b.x1 - b.x0) - domWidth) <= 0.15 * domWidth);
  // reading order: banded by row, left to right inside a band. The band height
  // is keyed to the SHORTEST beaker so a tall one never swallows two rows.
  const bucket = Math.min(...boxes.map((b) => b.y1 - b.y0)) * 0.5;
  boxes.sort((a, b) => (Math.round(a.y0 / bucket) - Math.round(b.y0 / bucket)) || (a.x0 - b.x0));
  if (!boxes.length) throw new Error("No beakers found. Crop tighter around the beakers and retry.");

  const inner = (b) => { const pad = Math.round((b.x1 - b.x0) * 0.32); return [b.x0 + pad, b.x1 - pad]; };

  // The glass outline, learned from the box border ring. Rim and base strokes
  // cross the sampling strip, and without this an empty beaker reads as full.
  const oc = new Map();
  for (const b of boxes)
    for (let y = b.y0; y <= b.y1; y += 3)
      for (const x of [b.x0 + 2, b.x1 - 2]) {
        const c = pix.at(x, y);
        if (dist(c, bg) > 45) oc.set(c.join(","), (oc.get(c.join(",")) || 0) + 1);
      }
  const outline = oc.size ? modalColor(oc).color : bg;

  // A row is liquid when its modal color is neither background nor outline.
  // Solidity is kept low on purpose: the mode already discards sparkles, and a
  // strict threshold rejects heavily speckled fills.
  const liquidRow = (b, y) => {
    const [ix0, ix1] = inner(b);
    const { color, share } = sampleModal(pix, ix0, y, ix1, y, 1);
    return (share > 0.30 && dist(color, bg) > 60 && dist(color, outline) > 60) ? color : null;
  };

  // Some levels hide a unit's color until it's exposed, drawing a "?" glyph
  // (in the same ink as the glass outline) over an otherwise background-
  // colored cell. shareNear finds that fleck: the fraction of a region's
  // pixels that are close to `target`, used both for the outline ring above
  // and, here, for the glyph.
  const shareNear = (x0, y0, x1, y1, target, thr) => {
    let hit = 0, total = 0;
    for (let y = Math.max(0, y0); y <= Math.min(pix.h-1, y1); y += 2)
      for (let x = Math.max(0, x0); x <= Math.min(pix.w-1, x1); x += 2) {
        total++;
        if (dist(pix.at(x, y), target) < thr) hit++;
      }
    return total ? hit / total : 0;
  };

  // Unit height, from real color bands only (a hidden cell has no reliable
  // band height of its own, so it must not skew this). Every band is a whole
  // number of units tall, so refine the median band height until it divides
  // them all cleanly.
  const runs = [];
  for (const b of boxes) {
    const seq = [];
    for (let y = b.y0; y <= b.y1; y++) seq.push(liquidRow(b, y));
    let cur = null, st = 0;
    for (let i = 0; i <= seq.length; i++) {
      const c = i < seq.length ? seq[i] : null;
      if (cur && c && dist(c, cur) < 45) continue;
      if (cur && i - st >= 8) runs.push(i - st);
      cur = c; st = i;
    }
  }
  if (!runs.length) throw new Error("Could not find any liquid in the beakers.");
  const median = (a) => { const s2 = [...a].sort((x, y) => x - y); return s2[Math.floor(s2.length/2)]; };
  let u = median(runs);
  const solid = runs.filter((r) => r >= 0.6 * u);
  for (let k = 0; k < 6; k++) u = median(solid.map((r) => r / Math.max(1, Math.round(r / u))));

  // Read each beaker bottom-up, one unit-height cell at a time: a real color,
  // a hidden "?" (a background-ish cell with a glyph fleck in it), or -
  // reaching neither - the empty headroom above the liquid, which ends the
  // beaker's filled region. This reads hidden cells directly, rather than
  // trying to locate a "liquid floor" by color alone, which a hidden bottom
  // cell (indistinguishable from background by color) would place too high.
  const GLYPH_LO = 0.02, GLYPH_HI = 0.42;
  const readUnits = boxes.map((b) => {
    const [ix0, ix1] = inner(b);
    const maxCells = Math.ceil((b.y1 - b.y0) / u) + 1;
    const units = [];
    for (let k = 0; k < maxCells; k++) {
      const cellBot = b.y1 - k * u;
      const cellTop = cellBot - u;
      if (cellTop < b.y0 - u * 0.1) break;
      const sy0 = Math.round(cellTop + u * 0.15), sy1 = Math.round(cellBot - u * 0.15);
      const { color, share } = sampleModal(pix, ix0, sy0, ix1, sy1);
      if (share > 0.30 && dist(color, bg) > 60 && dist(color, outline) > 60) {
        units.push(color);
        continue;
      }
      const g = shareNear(ix0, sy0, ix1, sy1, outline, 55);
      if (g > GLYPH_LO && g < GLYPH_HI) {
        units.push("?");
        continue;
      }
      break;
    }
    return units;
  });

  // Neck (decorative headroom above the true liquid capacity) is a constant
  // of the art style, not of any one beaker - but a beaker with a topper
  // (a cork, a lock) has a taller box for a reason unrelated to capacity, so
  // it would corrupt a naive min/median across ALL beakers. Cluster by box
  // height first (mirrors the domWidth clustering above) and take the
  // tightest (min) candidate within the dominant cluster: a beaker that is
  // genuinely full, almost always true of at least one in the dominant class.
  const heights = boxes.map((b) => b.y1 - b.y0);
  let domHeight = 0, bestHCount = 0;
  for (const hh of heights) {
    const c = heights.filter((o) => Math.abs(o - hh) <= 6).length;
    if (c > bestHCount) { bestHCount = c; domHeight = hh; }
  }
  let neck = Infinity;
  boxes.forEach((b, i) => {
    if (!readUnits[i].length || Math.abs((b.y1 - b.y0) - domHeight) > 6) return;
    const candidate = (b.y1 - b.y0) - readUnits[i].length * u;
    if (candidate < neck) neck = candidate;
  });
  if (!isFinite(neck)) neck = 0;
  neck = Math.max(0, neck);

  const slotsOf = (b) => Math.max(1, Math.round(((b.y1 - b.y0) - neck) / u));
  const board = boxes.map((b, i) => ({ units: readUnits[i].slice(0, slotsOf(b)), slots: slotsOf(b) }));

  // FINAL STEP: names. Nearest palette entry, assigned greedily and uniquely
  // so two distinct fills can never collapse onto the same name. A hidden
  // unit isn't a color at all, so it skips naming and passes through as-is.
  const reps = [];
  for (const bk of board) for (const c of bk.units) {
    if (c === "?") continue;
    if (!reps.some((r) => dist(c, r) < 45)) reps.push(c);
  }
  const entries = Object.entries(PALETTE).filter(([n]) => n !== "?")
    .map(([n, hx]) => [n, [1, 3, 5].map((i) => parseInt(hx.slice(i, i+2), 16))]);
  const pairs = [];
  reps.forEach((c, ri) => entries.forEach(([n, rgb]) => pairs.push({ ri, n, d: dist(c, rgb) })));
  pairs.sort((a, b) => a.d - b.d);
  const nameOf = new Map(); const taken = new Set();
  for (const p of pairs) {
    if (nameOf.has(p.ri) || taken.has(p.n)) continue;
    nameOf.set(p.ri, p.n); taken.add(p.n);
  }
  reps.forEach((c, ri) => { if (!nameOf.has(ri)) nameOf.set(ri, hex(c)); });
  const named = (c) => (c === "?" ? "?" : nameOf.get(reps.findIndex((r) => dist(c, r) < 45)));
  // paint with the exact RGB found on screen, not the palette approximation
  reps.forEach((c, ri) => { PALETTE[nameOf.get(ri)] = hex(c); });

  const beakers = board.map((bk) => mk(bk.units.map(named), bk.slots));

  // The purchasable beaker is always last in these layouts, and its badge is
  // the same shape and height as a real beaker, so geometry cannot see it.
  // Assume the last beaker is locked — but only when it reads empty, since
  // locking a beaker that holds liquid would be plainly wrong.
  const last = beakers[beakers.length - 1];
  if (last && last.units.length === 0) {
    beakers[beakers.length - 1] = mk([], 1, true, 100);
  }
  return beakers;
}

/* ------------------------------------------------------------------
   UI
   ------------------------------------------------------------------ */
function Beaker({ beaker, index, highlight, small, maxSlots, scale = 1 }) {
  const w = (small ? 26 : 46) * scale;
  const unit = (small ? 16 : 30) * scale;
  const pad = (maxSlots - beaker.slots) * unit;
  return (
    <div className="flex flex-col items-center gap-1">
      <div style={{ height: pad }} />
      <div
        className="flex flex-col-reverse overflow-hidden relative"
        style={{
          width: w, height: unit * beaker.slots,
          border: `2px ${beaker.locked ? "dashed" : "solid"} ${highlight ? "#67E8F9" : beaker.locked ? "#B08A2E" : "#5B6178"}`,
          borderRadius: "6px 6px 12px 12px",
          background: "#171B2C",
          boxShadow: highlight ? "0 0 0 3px rgba(103,232,249,0.25)" : "none",
        }}
      >
        {beaker.units.map((c, i) => (
          <div key={i} style={{ height: unit, background: colorOf(c) }} />
        ))}
      </div>
      {!small && (
        <span className={`text-[10px] tracking-widest ${beaker.locked ? "text-amber-400" : "text-slate-500"}`}>
          {index + 1}{beaker.locked ? ` · ${beaker.cost}` : ""}
        </span>
      )}
    </div>
  );
}

export default function WaterSortSolver() {
  const [board, setBoard] = useState(LEVEL_FROM_SCREENSHOT);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState(null);
  const [showTarget, setShowTarget] = useState(false);
  const fileRef = useRef(null);
  const targetRef = useRef(null);
  const boardRef = useRef(null);
  const [boardWidth, setBoardWidth] = useState(0);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBoardWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const result = useMemo(() => {
    try { return solveBoard(board); } catch { return { status: "error" }; }
  }, [board]);

  const graph = useMemo(
    () => buildGraph(board.filter((b) => !b.locked), 600),
    [board]
  );

  const timeline = useMemo(() => {
    if (result.status !== "solved") return [board];
    const frames = [board];
    let s = board;
    for (const st of result.steps) {
      if (st.type === "unlock") {
        s = s.map((b, i) => (i === st.beaker ? { ...b, locked: false } : b));
      } else {
        s = applyPour(s, st);
      }
      frames.push(s);
    }
    return frames;
  }, [result, board]);

  useEffect(() => setStep(0), [board]);

  const shown = timeline[Math.min(step, timeline.length - 1)];
  const steps = result.status === "solved" ? result.steps : [];
  const active = step < steps.length ? steps[step] : null;
  const maxSlots = Math.max(...board.map((b) => b.slots), 1);
  // extra beaker (odd count) goes to the lower row, matching the reference
  // game layout where the "buy a bottle" slot trails the bottom row.
  const rowSplit = Math.floor(shown.length / 2);
  const rows = [shown.slice(0, rowSplit), shown.slice(rowSplit)];
  const rowGap = 16; // gap-4
  const maxRowLen = Math.max(rows[0].length, rows[1].length, 1);
  const neededWidth = maxRowLen * 46 + Math.max(0, maxRowLen - 1) * rowGap;
  const beakerScale = boardWidth > 0 ? Math.min(1, boardWidth / neededWidth) : 1;

  async function ingest(file) {
    setError(null); setReading(true);
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("Could not read that file."));
        r.readAsDataURL(file);
      });
      const url = `data:${file.type || "image/png"};base64,${b64}`;
      setPreview(url);
      const beakers = await readBoardFromImage(url);
      if (!beakers.length) throw new Error("No beakers found in that image.");
      setBoard(beakers);
    } catch (e) {
      setError(e.message || "Reading failed. Try a tighter crop of the beakers.");
    } finally { setReading(false); }
  }

  // Desktop: a plain paste anywhere on the page.
  useEffect(() => {
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      if (item) { e.preventDefault(); ingest(item.getAsFile()); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // Mobile: the button reads the clipboard directly. iOS shows a Paste
  // confirmation; if the browser refuses, fall back to a real paste target.
  async function pasteFromClipboard() {
    setError(null);
    try {
      if (!navigator.clipboard?.read) throw new Error("unsupported");
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await item.getType(type);
          setShowTarget(false);
          return ingest(new File([blob], "screenshot", { type }));
        }
      }
      setError("The clipboard has no image in it. Copy a screenshot first, then tap Paste screenshot.");
    } catch {
      setShowTarget(true);
      setError(null);
      setTimeout(() => targetRef.current?.focus(), 0);
    }
  }

  const tally = useMemo(() => {
    const m = new Map();
    board.forEach((b) => b.units.forEach((c) => m.set(c, (m.get(c) || 0) + 1)));
    return [...m.entries()].sort();
  }, [board]);
  const normal = Math.max(...board.map((b) => b.slots));
  const odd = tally.filter(([c, n]) => c !== "?" && n !== normal);

  return (
    <div className="min-h-screen w-full bg-[#0E1120] text-slate-200 p-6" style={{ fontFamily: "ui-sans-serif, system-ui" }}>
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-700 pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Water sort solver</h1>
            <p className="text-sm text-slate-400">Copy a screenshot, then tap Paste screenshot.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={pasteFromClipboard}
              className="bg-cyan-300 text-slate-900 font-medium rounded px-3 py-2 text-sm">
              Paste screenshot
            </button>
            <button onClick={() => fileRef.current?.click()}
              className="border border-slate-600 rounded px-3 py-2 text-sm">
              Choose from photos
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => e.target.files?.[0] && ingest(e.target.files[0])} />
        </header>

        {showTarget && (
          <div className="border border-cyan-400/50 rounded p-3">
            <p className="text-sm text-cyan-200 mb-2">
              Long-press the box below and tap Paste.
            </p>
            <div
              ref={targetRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Paste your screenshot here"
              onPaste={(e) => {
                const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
                if (item) {
                  e.preventDefault();
                  setShowTarget(false);
                  ingest(item.getAsFile());
                } else {
                  setError("That paste had no image in it. Copy the screenshot again and retry.");
                }
              }}
              className="min-h-[72px] rounded bg-[#171B2C] border border-dashed border-slate-600 p-3 text-slate-500 text-sm"
            />
            <button className="mt-2 text-xs text-slate-400 underline"
              onClick={() => setShowTarget(false)}>Cancel</button>
          </div>
        )}

        {reading && <div className="text-cyan-300 text-sm">Reading the beakers…</div>}
        {error && <div className="text-rose-300 text-sm border border-rose-500/40 rounded px-3 py-2">{error}</div>}
        {odd.length > 0 && (
          <div className="text-amber-300 text-sm border border-amber-500/40 rounded px-3 py-2">
            These colors do not add up to {normal} units: {odd.map(([c, n]) => `${c} (${n})`).join(", ")}. Correct the board before trusting the solution.
          </div>
        )}

        <section ref={boardRef} className="flex flex-col gap-4">
          {rows.map((row, ri) => (
            <div key={ri} className="flex gap-4 items-start justify-center">
              {row.map((b, i) => {
                const idx = ri === 0 ? i : rowSplit + i;
                return (
                  <Beaker key={idx} beaker={b} index={idx} maxSlots={maxSlots} scale={beakerScale}
                    highlight={active && (active.type === "unlock" ? active.beaker === idx : idx === active.from || idx === active.to)} />
                );
              })}
            </div>
          ))}
        </section>

        <section className="border border-slate-700 rounded p-4 flex flex-col gap-3">
          {result.status === "solved" && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-emerald-300 text-sm">
                  {result.optimal ? "Fewest possible: " : ""}{steps.filter((s) => s.type === "pour").length} pours
                  {result.neededLock
                    ? `, and ${result.usedLocked.length} unlock${result.usedLocked.length > 1 ? "s" : ""}.`
                    : ", no unlock needed."}
                </span>
                <button className="border border-slate-600 rounded px-2 py-1 text-sm"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</button>
                <button className="border border-slate-600 rounded px-2 py-1 text-sm"
                  onClick={() => setStep((s) => Math.min(steps.length, s + 1))}>Next step</button>
                <span className="text-sm text-slate-400">{step} / {steps.length}</span>
              </div>
              <ol className="grid grid-cols-1 md:grid-cols-3 gap-x-6 text-sm max-h-64 overflow-auto">
                {steps.map((st, i) => (
                  <li key={i}
                    className={`py-0.5 ${i === step ? "text-cyan-300" : i < step ? "text-slate-600" : st.type === "unlock" ? "text-amber-300" : "text-slate-300"}`}>
                    <button onClick={() => setStep(i)} className="text-left">
                      {i + 1}. {st.type === "unlock"
                        ? `Unlock beaker ${st.beaker + 1} — ${st.cost} coins`
                        : <>beaker {st.from + 1} → {st.to + 1}
                            <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm"
                              style={{ background: colorOf(st.color) }} />
                            <span className="text-slate-500"> ×{st.amount}</span></>}
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
          {result.status === "unsolvable" && (
            <p className="text-rose-300 text-sm">
              No solution exists, with or without the locked beaker. {result.visited.toLocaleString()} states searched.
            </p>
          )}
          {result.status === "hidden" && (
            <p className="text-amber-300 text-sm">This board has hidden units. Replace each "?" with the color once the game reveals it, then solve again.</p>
          )}
          {result.status === "budget" && (
            <p className="text-amber-300 text-sm">Search budget spent without a result. Check the transcription, or free a beaker.</p>
          )}
        </section>

        <GraphView graph={graph} maxSlots={maxSlots}
          solutionKeys={result.status === "solved"
            ? new Set(timeline.map((s) => stateKey(s.filter((b) => !b.locked))))
            : new Set()} />

        <BoardEditor board={board} onChange={setBoard} />

        {preview && (
          <details className="text-sm text-slate-400">
            <summary className="cursor-pointer">Source screenshot</summary>
            <img src={preview} alt="Loaded puzzle screenshot" className="mt-2 max-h-96 rounded border border-slate-700" />
          </details>
        )}
      </div>
    </div>
  );
}

function GraphView({ graph, solutionKeys, maxSlots }) {
  const { nodes, edges, truncated } = graph;
  const [hover, setHover] = useState(null);

  const layers = useMemo(() => {
    const m = new Map();
    nodes.forEach((n) => { if (!m.has(n.depth)) m.set(n.depth, []); m.get(n.depth).push(n); });
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [nodes]);

  const widest = Math.max(...layers.map(([, l]) => l.length), 1);
  const W = Math.max(720, widest * 16);
  const H = layers.length * 34 + 40;
  const pos = new Map();
  layers.forEach(([depth, list]) =>
    list.forEach((n, i) => pos.set(n.id, { x: ((i + 1) / (list.length + 1)) * W, y: 24 + depth * 34 })));

  const won = nodes.filter((n) => n.solved).length;
  const stuck = nodes.filter((n) => n.sink && !n.solved).length;

  return (
    <section className="border border-slate-700 rounded p-4">
      <div className="flex flex-wrap items-baseline gap-4 mb-2">
        <h2 className="font-medium">Move graph</h2>
        <span className="text-xs text-slate-400">
          unlocked beakers only · {nodes.length} states, {edges.length} pours ·{" "}
          <span className="text-emerald-400">{won} winning</span> ·{" "}
          <span className="text-rose-400">{stuck} dead ends</span>
          {truncated && " · truncated at the exploration cap"}
        </span>
      </div>
      <div className="overflow-auto max-h-[420px] border border-slate-800 rounded bg-[#0B0E19]">
        <svg width={W} height={H}>
          {edges.map((e, i) => {
            const a = pos.get(e.from), b = pos.get(e.to);
            return a && b ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#242A40" strokeWidth={1} /> : null;
          })}
          {nodes.map((n) => {
            const p = pos.get(n.id);
            const onPath = solutionKeys.has(stateKey(n.state));
            const fill = n.solved ? "#22C55E" : n.sink ? "#EF4444" : onPath ? "#67E8F9" : "#4B5468";
            return <circle key={n.id} cx={p.x} cy={p.y} r={n.sink || onPath ? 5 : 3} fill={fill}
              onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)} />;
          })}
        </svg>
      </div>
      <div className="mt-3 min-h-[90px]">
        {hover ? (
          <div className="flex gap-2 items-start">
            {hover.state.map((b, i) => <Beaker key={i} beaker={b} index={i} small maxSlots={maxSlots} />)}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Hover a state to see its beakers. Cyan marks the solution path.</p>
        )}
      </div>
    </section>
  );
}

function BoardEditor({ board, onChange }) {
  const names = Object.keys(PALETTE);
  const edit = (i, patch) => onChange(board.map((b, k) => (k === i ? { ...b, ...patch } : b)));
  const setUnit = (bi, ui, val) => {
    const units = board[bi].units.slice();
    if (val === "") edit(bi, { units: units.slice(0, ui) });
    else { units[ui] = val; edit(bi, { units }); }
  };
  return (
    <details className="border border-slate-700 rounded p-4">
      <summary className="cursor-pointer font-medium">Correct the board</summary>
      <p className="text-xs text-slate-500 mt-1 mb-3">
        Rows are bottom to top. Clear a cell to truncate the beaker above it. A locked beaker is left out of the search unless nothing else solves the level.
      </p>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
        {board.map((b, bi) => (
          <div key={bi} className="border border-slate-800 rounded p-2">
            <div className="text-xs text-slate-500 mb-1">Beaker {bi + 1}</div>
            {Array.from({ length: b.slots }).map((_, ui) => (
              <select key={ui} value={b.units[ui] || ""} onChange={(e) => setUnit(bi, ui, e.target.value)}
                className="w-full bg-[#171B2C] border border-slate-700 rounded text-xs px-1 py-0.5 mb-1"
                style={{ color: b.units[ui] ? colorOf(b.units[ui]) : "#64748B" }}>
                <option value="">empty</option>
                {names.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            ))}
            <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
              <label>slots</label>
              <input type="number" min={1} max={8} value={b.slots}
                onChange={(e) => edit(bi, { slots: Math.max(1, Math.min(8, +e.target.value || 1)) })}
                className="w-12 bg-[#171B2C] border border-slate-700 rounded px-1" />
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={b.locked} onChange={(e) => edit(bi, { locked: e.target.checked })} />
                locked
              </label>
            </div>
            {b.locked && (
              <div className="flex items-center gap-2 mt-1 text-xs text-amber-400">
                <label>coins</label>
                <input type="number" min={0} value={b.cost}
                  onChange={(e) => edit(bi, { cost: +e.target.value || 0 })}
                  className="w-16 bg-[#171B2C] border border-slate-700 rounded px-1" />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <button className="border border-slate-600 rounded px-2 py-1 text-sm"
          onClick={() => onChange([...board, mk([], 4)])}>Add beaker</button>
        <button className="border border-slate-600 rounded px-2 py-1 text-sm"
          onClick={() => onChange(board.slice(0, -1))}>Remove last</button>
      </div>
    </details>
  );
}
