// 从 index.html 抽出脚本，套一个假 DOM 跑，验证两个模块的核心物理
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) throw new Error('期望恰好一个 <script> 块，实际 ' + scripts.length);
const src = scripts[0][1];

/* ---------- DOM stub ---------- */
let elStub;
/* 画布画笔计数：每个 2D 方法被调用一次就 +1；clearRect 单独计数（每画一次清一次屏） */
let ctxCalls = 0, clearCount = 0;
let cb = null;                      // 主循环通过 requestAnimationFrame 注册的回调
function makeEl() {
  const f = function () {};
  return new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'toString') return () => '';
      if (k === 'getContext') return () => new Proxy({}, {
        get: (c, m) => {
          if (m === 'canvas') return elStub;
          if (m === 'createLinearGradient' || m === 'createRadialGradient') {
            return () => { ctxCalls++; return { addColorStop() {} }; };
          }
          if (m === 'measureText') return () => ({ width: 10 });
          if (m === 'clearRect') return () => { ctxCalls++; clearCount++; };
          return () => { ctxCalls++; };
        },
        set: () => true
      });
      if (k === 'getBoundingClientRect') return () => ({ width: 400, height: 300 });
      if (k === 'value') return '90';
      if (k === 'length') return 0;
      if (k === 'dataset' || k === 'style' || k === 'classList' || k === 'children') return elStub;
      return elStub;
    },
    set() { return true; },
    apply() { return elStub; }
  });
}
elStub = makeEl();

/* 文档片段：只需要收集子节点，index.html 里的 renderCircuit 会用它批量组装线路 */
function makeFragment() {
  const kids = [];
  const frag = Object.create(null);
  frag.children = kids;
  frag.appendChild = n => { kids.push(n); return n; };
  frag.append = frag.appendChild;
  frag.replaceChildren = (...ns) => { kids.length = 0; kids.push(...ns); };
  return frag;
}

globalThis.document = {
  getElementById: () => elStub,
  querySelectorAll: () => [],
  querySelector: () => elStub,
  createElement: () => makeEl(),
  createDocumentFragment: () => makeFragment()
};
globalThis.window = { addEventListener() {}, devicePixelRatio: 1 };
/* 真 rAF 会把所有注册的回调都排进队列，一个都不能丢：
   页面启动时先注册主循环、再注册一次 show()，只留最后一个就抓不到主循环了 */
let rafQueue = [];
globalThis.requestAnimationFrame = fn => { rafQueue.push(fn); return rafQueue.length; };
globalThis.__TEST__ = true;

vm.runInThisContext(src, { filename: 'index-inline.js' });

const B = globalThis.__B;    // 布洛赫球模块
const K = globalThis.__C;    // 线路模块

if (!B || !K) throw new Error('模块导出失败：__B=' + !!B + ' __C=' + !!K);

/* ---------- 测试框架 ---------- */
let pass = 0, fail = 0, section = '';
function group(name) { section = name; console.log('\n\x1b[36m' + name + '\x1b[0m'); }
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + '   → ' + extra); }
}
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const fmt = v => v.map(x => (+x).toFixed(6)).join(', ');

console.log('\n=== 量子实验室 · 集成测试 ===');

/* ═══════════════════════════════════════════════════════════
   模块 1 · 布洛赫球
   ═══════════════════════════════════════════════════════════ */
group('布洛赫球 · 门与旋转');

const K0 = [0, 0, 1], K1 = [0, 0, -1];
const g = (name, v) => B.rotVec(v, { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1], H: [Math.SQRT1_2, 0, Math.SQRT1_2], S: [0, 0, 1], T: [0, 0, 1] }[name],
  { X: Math.PI, Y: Math.PI, Z: Math.PI, H: Math.PI, S: Math.PI / 2, T: Math.PI / 4 }[name]);

let v = g('X', K0);
check('X|0⟩ = |1⟩  →  r = (0,0,−1)', approx(v[2], -1), fmt(v));
v = g('H', K0);
check('H|0⟩ = |+⟩  →  r = (1,0,0)', approx(v[0], 1), fmt(v));
v = g('Z', [1, 0, 0]);
check('Z|+⟩ = |−⟩  →  r = (−1,0,0)', approx(v[0], -1), fmt(v));
v = g('S', [1, 0, 0]);
check('S|+⟩ = |+i⟩ →  r = (0,1,0)', approx(v[1], 1), fmt(v));
v = g('T', [1, 0, 0]);
check('T|+⟩ → r = (cos45°, sin45°, 0)',
      approx(v[0], Math.SQRT1_2) && approx(v[1], Math.SQRT1_2), fmt(v));
v = g('H', g('H', [0.3, -0.5, 0.81]));
check('H² = I', approx(v[0], 0.3) && approx(v[1], -0.5), fmt(v));
v = B.rotVec([1, 0, 0], [0, 0, 1], 2 * Math.PI);
check('Rz(2π) 在球上是恒等（全局相位不可见）', approx(v[0], 1) && approx(v[1], 0), fmt(v));

group('布洛赫球 · 拉比振荡');
B.setDeco(0, 0);
const evolve = (r0, secs, dt = 1e-4) => {
  let w = r0.slice();
  for (let i = 0; i < Math.round(secs / dt); i++) w = B.stepRK4(w, dt);
  return w;
};
const Prob1 = r => (1 - r[2]) / 2;

B.setOD(6, 0);
check('共振 Ωt=π 时 P(|1⟩) ≈ 1', approx(Prob1(evolve(K0, Math.PI / 6)), 1, 1e-5),
      Prob1(evolve(K0, Math.PI / 6)).toFixed(8));

B.setOD(6, 12);
let maxP = 0, w = K0.slice();
for (let i = 0; i < 300000; i++) { w = B.stepRK4(w, 1e-4); maxP = Math.max(maxP, Prob1(w)); }
check('失谐 Δ=2Ω 时峰值 = Ω²/(Ω²+Δ²) = 0.2', approx(maxP, 0.2, 2e-3), 'max = ' + maxP.toFixed(6));

{
  B.setOD(6, 12);
  const axis = [6, 0, 12], A = Math.hypot(...axis), n = axis.map(x => x / A);
  const d0 = K0[0] * n[0] + K0[1] * n[1] + K0[2] * n[2];
  let u = K0.slice();
  for (let i = 0; i < 20000; i++) u = B.stepRK4(u, 1e-4);
  const d1 = u[0] * n[0] + u[1] * n[1] + u[2] * n[2];
  check('失谐时沿进动轴分量守恒', approx(d1, d0, 1e-9), `${d1.toFixed(9)} vs ${d0.toFixed(9)}`);
}

group('布洛赫球 · 退相干');
B.setOD(0, 0);
B.setDeco(2, 0);
check('T₁ 弛豫：t = T₁ 时 r_z = 1 − 2/e',
      approx(evolve(K1, 2)[2], 1 - 2 / Math.E, 1e-6), evolve(K1, 2)[2].toFixed(8));

B.setDeco(0, 2);
check('纯退相位：t = T_φ 时 r_x = 1/e', approx(evolve([1, 0, 0], 2)[0], 1 / Math.E, 1e-6));
check('纯退相位不改 r_z', approx(evolve([1, 0, 0], 2)[2], 0, 1e-12));

B.setDeco(4, 0);
check('只开 T₁ 时 T₂ = 2T₁', approx(1 / B.rates().g2, 8, 1e-12));
B.setDeco(4, 4);
check('1/T₂ = 1/(2T₁) + 1/T_φ', approx(1 / B.rates().g2, 1 / (1 / 8 + 1 / 4), 1e-12));

{
  B.setDeco(0, 2);
  let u = [1, 0, 0], prev = 1, mono = true;
  for (let i = 0; i < 30000; i++) {
    u = B.stepRK4(u, 1e-4);
    const L = Math.hypot(...u);
    if (L > prev + 1e-12) mono = false;
    prev = L;
  }
  check('纯退相位使 |r| 单调收缩', mono, '|r| = ' + prev.toFixed(6));
  check('|r| 始终 ≤ 1', prev <= 1 + 1e-12);
}
B.setDeco(2, 1);
check('带 T₁ 时 r 爬向北极而非停在球心', approx(evolve([1, 0, 0], 3)[2], 1 - Math.exp(-1.5), 1e-6));
B.setDeco(2, 2);
check('完全混态 ρ=I/2 最终弛豫到纯态 |0⟩（零温模型）',
      approx(Math.hypot(...evolve([0, 0, 0], 40)), 1, 1e-6));

B.setDeco(0, 0); B.setOD(0, 0);
v = evolve([0.3, -0.5, Math.sqrt(1 - 0.09 - 0.25)], 3);
check('无驱动无退相干时态完全不演化', approx(v[0], 0.3) && approx(v[1], -0.5), fmt(v));

{
  const th = 1.234, ph = 2.718;
  const r0 = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
  const { a, b } = B.ampsFromR(r0);
  const rx = 2 * (a.re * b.re + a.im * b.im);
  const ry = 2 * (a.re * b.im - a.im * b.re);
  const rz = (a.re ** 2 + a.im ** 2) - (b.re ** 2 + b.im ** 2);
  check('r → 振幅 → r 往返一致',
        approx(rx, r0[0], 1e-12) && approx(ry, r0[1], 1e-12) && approx(rz, r0[2], 1e-12));
}

group('布洛赫球 · 门矩阵（计算过程里展开的那套）');
{
  const S2 = B.S2;
  const k0 = B.ampsFromR([0, 0, 1]);          // |0⟩
  const k1 = B.ampsFromR([0, 0, -1]);          // |1⟩

  let [na, nb] = B.gateApply('H', k0.a, k0.b);
  check('H|0⟩ 逐项算出 α′=β′=1/√2', approx(na.re, S2) && approx(nb.re, S2), `${na.re} ${nb.re}`);

  [na, nb] = B.gateApply('X', k0.a, k0.b);
  check('X|0⟩ 逐项算出 α′=0, β′=1', approx(na.re, 0) && approx(nb.re, 1));

  [na, nb] = B.gateApply('Z', k1.a, k1.b);
  check('Z|1⟩ 逐项算出 β′=−1（只改相位）', approx(nb.re, -1) && approx(na.re, 0));

  [na, nb] = B.gateApply('S', k1.a, k1.b);
  check('S|1⟩ 逐项算出 β′=i', approx(nb.im, 1) && approx(nb.re, 0));

  [na, nb] = B.gateApply('T', k1.a, k1.b);
  check('T|1⟩ 逐项算出 β′=e^(iπ/4)', approx(nb.re, S2) && approx(nb.im, S2));

  // 关键一致性：矩阵算出来的结果 必须和几何旋转的结果对上
  const PAIRS = [
    ['X', [1, 0, 0], Math.PI], ['Y', [0, 1, 0], Math.PI], ['Z', [0, 0, 1], Math.PI],
    ['H', [S2, 0, S2], Math.PI], ['S', [0, 0, 1], Math.PI / 2], ['T', [0, 0, 1], Math.PI / 4]
  ];
  let allMatch = true, detail = '';
  for (const [type, axis, ang] of PAIRS) {
    const r0 = [0.3, -0.5, Math.sqrt(1 - 0.09 - 0.25)];
    const ampo = B.ampsFromR(r0);
    const res = B.gateApply(type, ampo.a, ampo.b);
    const rGeo = B.rotVec(r0, axis, ang);
    const ampGeo = B.ampsFromR(rGeo);
    // 比较 r 矢量（相位规范化差异会被消掉）
    const rx = 2 * (res[0].re * res[1].re + res[0].im * res[1].im);
    const ry = 2 * (res[0].re * res[1].im - res[0].im * res[1].re);
    const rz = (res[0].re ** 2 + res[0].im ** 2) - (res[1].re ** 2 + res[1].im ** 2);
    if (!(approx(rx, rGeo[0], 1e-9) && approx(ry, rGeo[1], 1e-9) && approx(rz, rGeo[2], 1e-9))) {
      allMatch = false;
      detail += `${type}: (${rx.toFixed(4)},${ry.toFixed(4)},${rz.toFixed(4)}) vs ${fmt(rGeo)}  `;
    }
  }
  check('矩阵乘法和几何旋转结果一致（6 个门全对）', allMatch, detail);

  check('expandGate 生成的展开里包含具体数字', (() => {
    const k = B.ampsFromR([0, 0, 1]);
    const h = B.expandGate('H', k.a, k.b);
    return h.includes('0.707') && h.includes("α'") && h.includes("β'");
  })());
}

/* ═══════════════════════════════════════════════════════════
   模块 2 · 量子线路
   ═══════════════════════════════════════════════════════════ */
group('量子线路 · 门');

const { c, cabs2, cadd, cmul, cconj } = K;
const prob = (psi, i) => cabs2(psi[i]);
const norm2 = psi => psi.reduce((s, a) => s + cabs2(a), 0);
const fmtP = psi => psi.map((a, i) =>
  `|${i.toString(2).padStart(Math.log2(psi.length), '0')}⟩:${cabs2(a).toFixed(4)}`).join(' ');

const makeGates = (n, ops) => {
  const gg = Array.from({ length: 12 }, () => new Array(n).fill(null));
  for (const [col, q, type, targ] of ops) {
    if (type === 'CNOT' || type === 'CZ' || type === 'SWAP') {
      gg[col][q] = { type, ctrl: q, targ };
      gg[col][targ] = { ref: true, owner: q };
    } else gg[col][q] = { type };
  }
  return gg;
};
const run = (n, ops, theta) => {
  if (theta !== undefined) K.setTheta(theta);
  K.set(n, makeGates(n, ops));
  const st = K.evalCircuit();
  return { psi: st[st.length - 1].psi, steps: st };
};

{
  let psi = K.applySingle(K.basisState(0, 1), 0, K.U.H, 1);
  check('H|0⟩ 两分量各 1/2', approx(prob(psi, 0), 0.5) && approx(prob(psi, 1), 0.5));
  psi = K.applySingle(K.basisState(1, 1), 0, K.U.X, 1);
  check('X|1⟩ = |0⟩', approx(prob(psi, 0), 1));
  psi = K.applySingle(K.basisState(0, 1), 0, K.gateMatrix('Rx'), 1);
  K.setTheta(180);
  psi = K.applySingle(K.basisState(0, 1), 0, K.gateMatrix('Rx'), 1);
  check('Rx(180°)|0⟩ → P(|1⟩) = 1', approx(prob(psi, 1), 1), fmtP(psi));

  let a = K.applySingle(K.applySingle(K.basisState(0, 1), 0, K.U.T, 1), 0, K.U.T, 1);
  let b = K.applySingle(K.basisState(0, 1), 0, K.U.S, 1);
  check('T² = S', approx(a[0].re, b[0].re, 1e-12) && approx(a[0].im, b[0].im, 1e-12));
  let d = K.applySingle(K.applySingle(K.basisState(0, 1), 0, K.U.S, 1), 0, K.U.Sdg, 1);
  check('S·S† = I', approx(d[0].re, 1, 1e-12) && approx(d[0].im, 0, 1e-12));
}

group('量子线路 · 两比特门真值表');
{
  let ok = true, got = [];
  for (let i = 0; i < 4; i++) {
    const out = K.applyTwo(K.basisState(i, 2), 'CNOT', 0, 1, 2);
    let hit = -1;
    for (let j = 0; j < 4; j++) if (prob(out, j) > 0.5) hit = j;
    got.push(`${i}→${hit}`);
    if (hit !== [0, 1, 3, 2][i]) ok = false;
  }
  check('CNOT(0→1)：|10⟩→|11⟩, |11⟩→|10⟩', ok, got.join(' '));

  let ok2 = true;
  for (let i = 0; i < 4; i++) {
    const out = K.applyTwo(K.basisState(i, 2), 'CNOT', 1, 0, 2);
    let hit = -1;
    for (let j = 0; j < 4; j++) if (prob(out, j) > 0.5) hit = j;
    if (hit !== [0, 3, 2, 1][i]) ok2 = false;
  }
  check('CNOT(1→0)，控制位在下', ok2);

  let ok3 = true;
  for (let i = 0; i < 4; i++) {
    const out = K.applyTwo(K.basisState(i, 2), 'SWAP', 0, 1, 2);
    let hit = -1;
    for (let j = 0; j < 4; j++) if (prob(out, j) > 0.5) hit = j;
    if (hit !== [0, 2, 1, 3][i]) ok3 = false;
  }
  check('SWAP 交换两比特', ok3);

  check('CZ|11⟩ = −|11⟩', approx(K.applyTwo(K.basisState(3, 2), 'CZ', 0, 1, 2)[3].re, -1));
}

group('量子线路 · 纠缠');
{
  const { psi } = run(2, [[0, 0, 'H'], [1, 0, 'CNOT', 1]]);
  check('Bell 态：|00⟩ 与 |11⟩ 各 1/2',
        approx(prob(psi, 0), 0.5) && approx(prob(psi, 3), 0.5) &&
        prob(psi, 1) < 1e-12 && prob(psi, 2) < 1e-12, fmtP(psi));
  check('Bell 态归一', approx(norm2(psi), 1, 1e-12));
  const r0 = K.blochOfRho(K.reducedRho(psi, 0, 2));
  check('Bell 态 q0 约化态落在球心 |r| = 0', approx(Math.hypot(...r0), 0, 1e-12), fmt(r0));
  check('Bell 态 q0 纠缠熵 = 1 bit', approx(K.entropyOfRho(K.reducedRho(psi, 0, 2)), 1, 1e-12));
  check('Bell 态 q1 纠缠熵 = 1 bit', approx(K.entropyOfRho(K.reducedRho(psi, 1, 2)), 1, 1e-12));

  const { psi: prod } = run(2, [[0, 0, 'H']]);
  check('H|00⟩ 是乘积态：两比特熵都是 0',
        approx(K.entropyOfRho(K.reducedRho(prod, 0, 2)), 0, 1e-12) &&
        approx(K.entropyOfRho(K.reducedRho(prod, 1, 2)), 0, 1e-12));
  const rp = K.blochOfRho(K.reducedRho(prod, 0, 2));
  check('乘积态 q0 在球面上，|r| = 1 且指向 x 轴',
        approx(Math.hypot(...rp), 1, 1e-12) && approx(rp[0], 1, 1e-12), fmt(rp));

  const { psi: g3 } = run(3, [[0, 0, 'H'], [1, 0, 'CNOT', 1], [2, 1, 'CNOT', 2]]);
  check('GHZ(3)：|000⟩ 与 |111⟩ 各 1/2',
        approx(prob(g3, 0), 0.5) && approx(prob(g3, 7), 0.5), fmtP(g3));
  let allOne = true;
  for (let q = 0; q < 3; q++) if (!approx(K.entropyOfRho(K.reducedRho(g3, q, 3)), 1, 1e-12)) allOne = false;
  check('GHZ(3) 每个比特熵都是 1 bit', allOne);

  const { psi: g4 } = run(4, [[0, 0, 'H'], [1, 0, 'CNOT', 1], [2, 1, 'CNOT', 2], [3, 2, 'CNOT', 3]]);
  check('GHZ(4)：|0000⟩ 与 |1111⟩ 各 1/2',
        approx(prob(g4, 0), 0.5) && approx(prob(g4, 15), 0.5), fmtP(g4));
}

group('量子线路 · 算法与不变量');
{
  const { psi: dense } = run(2, [[0, 0, 'H'], [1, 0, 'CNOT', 1], [2, 0, 'Z'], [2, 1, 'X'], [4, 0, 'CNOT', 1], [5, 0, 'H']]);
  check('超密集编码（编码 11）确定性得到 |11⟩', approx(prob(dense, 3), 1, 1e-12), fmtP(dense));

  const { psi: back } = run(2, [[0, 0, 'H'], [1, 0, 'CNOT', 1], [3, 0, 'CNOT', 1], [4, 0, 'H']]);
  check('Bell 态经 CNOT→H 逆变换解回 |00⟩', approx(prob(back, 0), 1, 1e-12), fmtP(back));

  const { psi: uni } = run(3, [
    [0, 0, 'H'], [1, 0, 'CNOT', 1], [2, 0, 'Ry'], [2, 1, 'T'],
    [3, 2, 'SWAP', 1], [4, 0, 'Rx'], [5, 0, 'CZ', 2], [6, 1, 'Sdg']
  ], 37);
  check('任意门组合后总概率仍为 1（酉性）', approx(norm2(uni), 1, 1e-10), norm2(uni));

  const base = run(2, [[0, 0, 'H'], [1, 0, 'CNOT', 1]]).psi;
  const ph = run(2, [[0, 0, 'H'], [1, 0, 'CNOT', 1], [2, 0, 'S'], [2, 1, 'T']]).psi;
  let same = true;
  for (let i = 0; i < 4; i++) if (!approx(prob(base, i), prob(ph, i), 1e-12)) same = false;
  check('局部相位门不改变任何测量概率', same);
}

group('量子线路 · 测量');
{
  const bell = run(2, [[0, 0, 'H'], [1, 0, 'CNOT', 1]]).psi;
  let s0 = 0, s1 = 0, collapsed = true;
  for (let k = 0; k < 400; k++) {
    const { psi: out, bit } = K.measureQubit(bell, 0, 2);
    if (bit === 0) { s0++; if (!approx(prob(out, 0), 1, 1e-12)) collapsed = false; }
    else { s1++; if (!approx(prob(out, 3), 1, 1e-12)) collapsed = false; }
  }
  check('测 Bell 态 q0：坍缩到 |00⟩ 或 |11⟩，绝无 |01⟩/|10⟩', collapsed);
  check('测 Bell 态 q0 约 50/50', Math.abs(s0 - s1) < 80, `${s0} / ${s1}`);

  const { bit } = K.measureQubit(K.basisState(0, 2), 0, 2);
  check('|00⟩ 测 q0 必得 0', bit === 0);

  const { psi: m, steps: msteps } = run(2, [[0, 0, 'H'], [1, 0, 'CNOT', 1], [2, 0, 'M']]);
  const mbit = msteps[msteps.length - 1].meas[0].bit;
  check('线路内测量门给出经典结果并坍缩、保持归一',
        approx(norm2(m), 1, 1e-12) && (mbit === 0 || mbit === 1) &&
        ((mbit === 0 && prob(m, 0) > 0.99) || (mbit === 1 && prob(m, 3) > 0.99)),
        'bit=' + mbit + ' ' + fmtP(m));
}

group('量子线路 · 约化密度矩阵');
{
  const { psi } = run(2, [[0, 0, 'H'], [1, 0, 'CNOT', 1], [2, 0, 'Ry']], 60);
  const rho = K.reducedRho(psi, 0, 2);
  check('约化密度矩阵迹 = 1',
        approx(cadd(rho.a, rho.d).re, 1, 1e-12) && approx(cadd(rho.a, rho.d).im, 0, 1e-12));
  check('约化密度矩阵 Hermitian',
        approx(cadd(rho.b, cconj(rho.b)).im, 0, 1e-12));

  const S = K.entropyOfRho(K.reducedRho(run(2, [[0, 0, 'Ry']], 60).psi, 0, 2));
  check('单比特纠缠熵恒在 [0, 1]', S >= -1e-12 && S <= 1 + 1e-12, 'S = ' + S);
}

group('量子线路 · 逐步求值（计算过程）');
{
  const { steps: st } = run(2, [[0, 0, 'H'], [1, 0, 'CNOT', 1]]);
  check('步骤数 = 初始态 + 2 个门列', st.length === 3, 'steps = ' + st.length);

  check('第 0 步是初始态 |00⟩', prob(st[0].psi, 0) > 0.999, fmtP(st[0].psi));

  check('第 1 步（H 之后）= |+⟩⊗|0⟩',
        approx(prob(st[1].psi, 0), 0.5) && approx(prob(st[1].psi, 2), 0.5) &&
        prob(st[1].psi, 1) < 1e-12, fmtP(st[1].psi));

  check('第 2 步（CNOT 之后）= |Φ+⟩ Bell 态',
        approx(prob(st[2].psi, 0), 0.5) && approx(prob(st[2].psi, 3), 0.5), fmtP(st[2].psi));

  check('每一步都带 before 快照（用于"作用前/后"对比）',
        st[2].before && approx(prob(st[2].before, 2), 0.5), fmtP(st[2].before || []));

  check('每个非初始步都记录了 ops（用于生成文字说明）',
        st.slice(1).every(s => s.ops && s.ops.length > 0),
        JSON.stringify(st.slice(1).map(s => s.ops.length)));

  check('空列被跳过，不产生多余步骤',
        run(2, [[0, 0, 'X'], [5, 0, 'X']]).steps.length === 3,
        'steps = ' + run(2, [[0, 0, 'X'], [5, 0, 'X']]).steps.length);

  check('两比特门的 ops 记录了控制位和目标位', (() => {
    const s = run(2, [[0, 0, 'CNOT', 1]]).steps[1];
    const o = s.ops[0];
    return o.type === 'CNOT' && o.ctrl === 0 && o.targ === 1;
  })());
}

group('渲染循环 · 不该画的时候一次都不画');
{
  /* 主循环靠 requestAnimationFrame 驱动，这里把回调存下来自己按帧号喂进去，
     再用「2D 上下文的调用次数」当画笔计数 */
  let frames = 0;
  const runFrames = (n, t0 = 2000) => {
    for (let i = 0; i < n; i++) {
      const q = rafQueue; rafQueue = [];
      q.forEach(fn => fn(t0 + (frames++) * 16));
    }
  };
  runFrames(4);                                  // 先跑几帧让画面稳定下来
  if (process.env.DBG) console.log('  [dbg] 稳定后 clearRect =', clearCount, ' ctxCalls =', ctxCalls);
  const b0 = clearCount; runFrames(1);
  if (process.env.DBG) console.log('  [dbg] 再跑 1 帧，clearRect 增量 =', clearCount - b0);

  const drawn = () => ctxCalls;
  const base = drawn();
  runFrames(3);
  check('暂停且无操作时不再重画（脏检查生效）', drawn() - base === 0,
        '多画了 ' + (drawn() - base) + ' 次');

  B.setR([0, 0, -1]);                            // 改状态（真实交互经 updateUI 标脏）
  B.poke();
  const beforeChange = drawn();
  runFrames(1);
  check('状态变化后确实重画了', drawn() - beforeChange > 0, '画了 ' + (drawn() - beforeChange) + ' 次');

  runFrames(3);
  const beforeIdle = drawn();
  runFrames(3);
  check('改完再静止，又回到不重画', drawn() - beforeIdle === 0,
        '多画了 ' + (drawn() - beforeIdle) + ' 次');

  // 切到线路面板后，布洛赫球应当彻底停画
  globalThis.__TAB__('circuit');
  runFrames(3);
  const beforeHidden = drawn();
  runFrames(3);
  check('面板切走后球体完全停画', drawn() - beforeHidden === 0,
        '多画了 ' + (drawn() - beforeHidden) + ' 次');

  // 切回来应当立刻恢复绘制，并且不会因为脏检查而漏画
  globalThis.__TAB__('bloch');
  runFrames(1);
  const beforeBack = drawn();
  B.poke();
  runFrames(1);
  check('切回面板后又能正常重画', drawn() - beforeBack > 0, '画了 ' + (drawn() - beforeBack) + ' 次');
}

group('预设按钮 · 接线没接错容器');
{
  /* 曾经这里写成 #presets（HTML 里根本没有这个 id），四个预设按钮全是死的。
     这条断言盯住「代码找的容器」和「按钮实际所在的容器」是同一个。 */
  const btnZone = html.match(/<div class="toolgrid"[^>]*id="(\w+)"[^>]*>([\s\S]*?)<\/div>/);
  const presetBtns = [...html.matchAll(/data-preset="(\w+)"/g)].map(m => m[1]);
  check('预设按钮确实放在 #qubitchoice 里',
        btnZone && btnZone[1] === 'qubitchoice' && /data-preset=/.test(btnZone[2]),
        '找到的容器 = ' + (btnZone && btnZone[1]));
  check('四个预设都在：bell / ghz3 / ghz4 / dense（另有全 H）',
        ['bell', 'ghz3', 'ghz4', 'dense'].every(p => presetBtns.includes(p)),
        presetBtns.join(','));
  check('绑定代码用的选择器就是 #qubitchoice button[data-preset]',
        /querySelectorAll\("#qubitchoice button\[data-preset\]"\)/.test(src) ||
        /\$\$\("#qubitchoice button\[data-preset\]"\)/.test(src));
  check('源码里不再残留不存在的 #presets', !/#presets/.test(src));
  check('每个预设名字都能在 PRESETS 里查到（allh 走单独分支）',
        ['bell', 'ghz3', 'ghz4', 'dense'].every(p => new RegExp('\\b' + p + ':').test(src)));
}

group('面板显隐 · ID 权重没压过 .panel');
{
  /* 曾经 #panel-intro{display:flex}（ID 选择器，权重 1,0,0）压过 .panel{display:none}（类，0,1,0），
     入门面板永远可见，切到布洛赫球时两块面板同屏把一屏劈成两半。
     这里盯住「面板的 display 只能由 .panel 系列控制」。 */
  const idDisplay = [...html.matchAll(/#panel-\w+\s*\{[^}]*\}/g)]
    .filter(m => /\bdisplay\s*:/.test(m[0])).map(m => m[0].replace(/\s+/g, ' ').trim());
  check('没有 #panel-* 规则声明 display（否则会压过 .panel{display:none}）',
        idDisplay.length === 0, idDisplay.join(' | '));
  check('.panel 默认 display:none、.panel.active 才 display:flex',
        /\.panel\s*\{[^}]*\bdisplay\s*:\s*none/.test(html) &&
        /\.panel\.active\s*\{[^}]*\bdisplay\s*:\s*flex/.test(html));
  check('入门面板确有 direction 声明（否则 flex 方向退化成 row）',
        /#panel-intro\s*\{[^}]*flex-direction\s*:\s*column/.test(html));
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}结果：${pass} 通过，${fail} 失败\x1b[0m\n`);
process.exit(fail ? 1 : 0);
