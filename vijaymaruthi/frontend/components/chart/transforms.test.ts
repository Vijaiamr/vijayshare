/**
 * transforms.test.ts — unit tests for the alternative chart-type transforms.
 * Run: npx tsx components/chart/transforms.test.ts
 */
import { toKagi, toLineBreak, toPointFigure, toRange } from "./transforms";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}\n      expected ${e}\n      actual   ${a}`);
  }
}

// ── Kagi ──
// Closes: 100, 102, 101, 98, 99, 105 with reversal 2 (absolute).
// 100 → up. 102 ≥ 100 → 102. 101 < 102 but 102-101=1 < 2 → stays 102.
// 98: 102-98=4 ≥ 2 → reverse down → 98. 99 > 98 (down, no reverse: 99-98=1<2) → 98.
// 105: 105-98=7 ≥ 2 → reverse up → 105.
const kagi = toKagi(
  [
    { time: "d1", close: 100 },
    { time: "d2", close: 102 },
    { time: "d3", close: 101 },
    { time: "d4", close: 98 },
    { time: "d5", close: 99 },
    { time: "d6", close: 105 },
  ],
  { reversal: 2, absolute: true },
);
check("kagi basic", kagi.map((p) => p.value), [100, 102, 102, 98, 98, 105]);

// ── Point & Figure ──
// Box 2, reversal 3 (absolute). Closes/highs/lows:
// d1: close 100 → price 100, no column yet.
// d2: high 104 ≥ 100+2 → X column, price = 100 + 2*floor((104-100)/2)=104.
// d3: high 103 < 104+2; low 97 ≤ 104-2*3=98 → reverse to O, price = 104-2=102.
// d4: low 96 ≤ 102-2 → extend O: 102 - 2*floor((102-96)/2)=96.
const pf = toPointFigure(
  [
    { time: "d1", high: 100, low: 99, close: 100 },
    { time: "d2", high: 104, low: 101, close: 103 },
    { time: "d3", high: 103, low: 97, close: 98 },
    { time: "d4", high: 98, low: 96, close: 97 },
  ],
  { boxSize: 2, reversal: 3, absolute: true },
);
check("pointfigure basic", pf.map((p) => p.value), [100, 104, 102, 96]);

// ── Range ──
// Range 5 (absolute). Base = first close = 101.
// d1: high 103 < 106, low 99 > 96 → no bar → 101.
// d2: high 106 ≥ 106 → 106.
// d3: low 99 ≤ 101 → 101.
const rg = toRange(
  [
    { time: "d1", high: 103, low: 99, close: 101 },
    { time: "d2", high: 106, low: 102, close: 104 },
    { time: "d3", high: 102, low: 99, close: 100 },
  ],
  { range: 5, absolute: true },
);
check("range basic", rg.map((p) => p.value), [101, 106, 101]);

// ── Line Break ──
// 3-line break. Closes: 100, 102, 101, 104, 99, 103.
// 100 → line [100]. 102 > max(100)=100 → push [100,102].
// 101: max(last3=[100,102])=102, min=100 → 101 in range → update last → [100,101].
// 104 > max(100,101)=101 → push → [100,101,104].
// 99 < min(100,101,104)=100 → push → [100,101,104,99].
// 103: max(last3=[101,104,99])=104, min=99 → in range → update last → [100,101,104,103].
const lb = toLineBreak(
  [
    { time: "d1", close: 100 },
    { time: "d2", close: 102 },
    { time: "d3", close: 101 },
    { time: "d4", close: 104 },
    { time: "d5", close: 99 },
    { time: "d6", close: 103 },
  ],
  { lines: 3 },
);
check("linebreak basic", lb.map((p) => p.value), [100, 102, 101, 104, 99, 103]);

// ── Edge cases ──
check("kagi empty", toKagi([]), []);
check("pf empty", toPointFigure([]), []);
check("range empty", toRange([]), []);
check("linebreak empty", toLineBreak([]), []);
check("kagi single", toKagi([{ time: "d1", close: 50 }]).map((p) => p.value), [50]);
check("pf zero box", toPointFigure([{ time: "d1", high: 10, low: 9, close: 10 }], { boxSize: 0, absolute: true }), []);

console.log(failures === 0 ? "\nALL TRANSFORM TESTS PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);