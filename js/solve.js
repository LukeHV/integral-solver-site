/* solve.js — turns typed input into a full solution:
 * parse → integrate (with steps) → verify by differentiating → evaluate limits
 * (including infinite and improper ones) → cross-check numerically. */
(function (G) {
  'use strict';
  const C = G.CAS, PR = G.PARSE, IN = G.INTEGRATE;
  const { S, N, ZERO, ONE, NEG1, add, mul, pow, sub, subsVar, has, evalN, isNum, val, isRat } = C;
  const dvar = (x) => C.symTex(x);

  // ---------- numerical integration: adaptive Gauss–Kronrod 7/15 ----------
  const XK = [0.991455371120812639, 0.949107912342758525, 0.864864423359769073, 0.741531185599394440, 0.586087235467691130, 0.405845151377397167, 0.207784955007898468, 0];
  const WK = [0.022935322010529225, 0.063092092629978553, 0.104790010322250184, 0.140653259715525919, 0.169004726639267903, 0.190350578064785410, 0.204432940075298892, 0.209482141084727828];
  const WG = [0.129484966168869693, 0.279705391489276668, 0.381830050505118945, 0.417959183673469388];
  function gk(f, a, b) {
    const c = (a + b) / 2, h = (b - a) / 2;
    const fc = f(c);
    let rk = fc * WK[7], rg = fc * WG[3], bad = !Number.isFinite(fc);
    for (let j = 0; j < 7; j++) {
      const dx = h * XK[j], f1 = f(c - dx), f2 = f(c + dx);
      if (!Number.isFinite(f1) || !Number.isFinite(f2)) bad = true;
      rk += WK[j] * (f1 + f2);
      if (j % 2 === 1) rg += WG[(j - 1) / 2] * (f1 + f2);
    }
    return { v: rk * h, e: Math.abs((rk - rg) * h), a, b, bad };
  }
  function quadRaw(f, a, b, tol, maxIt = 1500) {
    let segs = [gk(f, a, b)], dropped = 0;
    const ignoreBad = (t) => { const y = f(t); return Number.isFinite(y) ? y : 0; };
    for (let it = 0; it < maxIt; it++) {
      let tot = 0, err = 0, worst = 0;
      segs.forEach((s, i) => {
        tot += s.v; err += s.e;
        const w = segs[worst];
        if (s.bad ? !w.bad || s.b - s.a > w.b - w.a : !w.bad && s.e > w.e) worst = i;
      });
      if (err <= tol * Math.max(1, Math.abs(tot)) && !segs.some((s) => s.bad)) return { value: tot, error: err, ok: true, dropped };
      const s = segs[worst];
      // a tiny end piece where the integrand rounds to ±∞ (an integrable endpoint singularity
      // such as 1/√(1−x²) at x = 1): its share of the area is negligible, so drop the bad samples
      if (s.bad && (s.b <= a + 1e-4 * (b - a) || s.a >= b - 1e-4 * (b - a)) && s.b - s.a < 1e-7 * (b - a)) {
        segs[worst] = { ...gk(ignoreBad, s.a, s.b), bad: false };
        // the dropped samples carried some area: count the piece itself as uncertain (this only
        // limits how many digits are shown, not whether the value is accepted)
        dropped += Math.abs(segs[worst].v);
        continue;
      }
      if (s.b - s.a < 1e-14 * Math.max(1, Math.abs(s.a))) break;
      const m = (s.a + s.b) / 2;
      segs.splice(worst, 1, gk(f, s.a, m), gk(f, m, s.b));
    }
    let tot = 0, err = 0, bad = false;
    for (const s of segs) { tot += s.v; err += s.e; bad = bad || s.bad; }
    return { value: tot, error: err, ok: !bad && Number.isFinite(tot) && err < 1e-6 * Math.max(1, Math.abs(tot)), dropped };
  }
  // finite interval: substitute x = a + (b−a)·φ(t) with φ(t) = t³(10 − 15t + 6t²), whose
  // derivative 30t²(1−t)² vanishes at both ends; it tames algebraic and log endpoint singularities
  function quadFinite(f, a, b, tol = 1e-11, maxIt) {
    const w = b - a;
    const g = (t) => {
      const t2 = t * t, s = 1 - t;
      const x = t < 0.5 ? a + w * t2 * t * (10 - 15 * t + 6 * t2) : b - w * s * s * s * (10 - 15 * s + 6 * s * s);
      const d = 30 * t2 * s * s;
      if (d === 0) return 0;
      return f(x) * w * d;
    };
    return quadRaw(g, 0, 1, tol, maxIt);
  }
  function quad(f, a, b, maxIt) {
    if (a === b) return { value: 0, error: 0, ok: true };
    if (a > b) { const r = quad(f, b, a); return { ...r, value: -r.value }; }
    if (a === -Infinity && b === Infinity) {
      const r1 = quad(f, -Infinity, 0), r2 = quad(f, 0, Infinity);
      return { value: r1.value + r2.value, error: r1.error + r2.error, ok: r1.ok && r2.ok };
    }
    if (b === Infinity) return quadFinite((t) => { const d = 1 - t; return f(a + t / d) / (d * d); }, 0, 1);
    if (a === -Infinity) return quadFinite((t) => { const d = 1 - t; return f(b - t / d) / (d * d); }, 0, 1);
    return quadFinite(f, a, b, 1e-11, maxIt);
  }
  // a very long finite interval (∫ from 0 to 10⁹ of e^(−x)): the first samples can all miss a
  // narrow bump near an end or near 0, and the quadrature then "settles" on 0. Split it at
  // distances 1, 10, 100, … from each end (and from 0) so every scale gets its own pieces.
  function quadWide(f, a, b) {
    if (!(Number.isFinite(a) && Number.isFinite(b)) || !(b - a > 1e4)) return quad(f, a, b);
    const w = b - a, pts = new Set([a, b]);
    for (let s = 1; s < w; s *= 10) {
      pts.add(a + s); pts.add(b - s);
      if (a < 0 && b > 0) { if (s < b) pts.add(s); if (-s > a) pts.add(-s); }
    }
    if (a < 0 && b > 0) pts.add(0);
    const cs = [...pts].filter((p) => p >= a && p <= b).sort((p, q) => p - q);
    let value = 0, error = 0, ok = true, dropped = 0;
    for (let i = 0; i + 1 < cs.length; i++) {
      if (!(cs[i + 1] > cs[i])) continue;
      const r = quad(f, cs[i], cs[i + 1]);
      value += r.value; error += r.error; ok = ok && r.ok; dropped += r.dropped || 0;
    }
    return { value, error, ok, dropped };
  }

  // ---------- recognise exact values from decimals (for limits) ----------
  function ratApprox(v, maxDen = 200) {
    let h1 = 1, h0 = 0, k1 = 0, k0 = 1, x = v;
    for (let i = 0; i < 20; i++) {
      const a = Math.floor(x);
      [h1, h0] = [a * h1 + h0, h1];
      [k1, k0] = [a * k1 + k0, k1];
      if (k1 > maxDen) break;
      if (Math.abs(h1 / k1 - v) < 1e-10 * Math.max(1, Math.abs(v))) return [h1, k1];
      if (x === a) break;
      x = 1 / (x - a);
    }
    return null;
  }
  function identify(v) {
    if (!Number.isFinite(v)) return null;
    if (Math.abs(v) < 1e-9) return ZERO;
    const bases = [[ONE, 1], [C.PI, Math.PI], [C.sqrtN(2), Math.SQRT2], [C.sqrtN(3), Math.sqrt(3)], [pow(C.PI, C.TWO), Math.PI * Math.PI], [pow(C.PI, C.HALF), Math.sqrt(Math.PI)], [mul(C.PI, C.sqrtN(3)), Math.PI * Math.sqrt(3)], [mul(C.PI, C.sqrtN(2)), Math.PI * Math.SQRT2]];
    for (const [b, bv] of bases) {
      const r = ratApprox(v / bv);
      if (r && Math.abs(r[0] / r[1] * bv - v) < 1e-9 * Math.max(1, Math.abs(v))) return mul(N(r[0], r[1]), b);
    }
    return null;
  }

  // ---------- bounds ----------
  function parseBound(src, x) {
    const s = String(src).trim();
    if (!s) return { empty: true };
    const t = s.toLowerCase().replace(/\s+/g, '');
    if (['inf', '∞', '+inf', '+∞', 'infinity', 'oo'].includes(t)) return { inf: 1, v: Infinity, e: null, tex: '\\infty' };
    if (['-inf', '-∞', '−∞', '−inf', '-infinity', '-oo'].includes(t)) return { inf: -1, v: -Infinity, e: null, tex: '-\\infty' };
    if (/\d,\d/.test(s)) throw new PR.ParseError('Use a point for decimals: write 1.5, not 1,5');
    const tree = PR.parse(s);
    const vs = PR.vars(tree);
    if (vs.size) throw new PR.ParseError(`A limit can't contain “${[...vs][0]}”. Use numbers, π, e or ∞ (inf).`);
    const e = PR.toExpr(tree);
    const v = evalN(e, {});
    if (!Number.isFinite(v)) throw new PR.ParseError('That limit is not a finite number');
    return { inf: 0, v, e, tex: PR.astTex(tree) };
  }

  // ---------- main entry ----------
  function pickVar(tree, want) {
    if (want) return want;
    const vs = PR.vars(tree);
    for (const c of ['x', 't', 'theta', 'u', 'y', 'z', 's', 'r', 'v', 'w']) if (vs.has(c)) return c;
    return vs.size ? [...vs].sort()[0] : 'x';
  }

  function preview(src, varWant) {
    const { s, v } = PR.clean(src);
    if (!s) return { empty: true };
    const tree = PR.parse(s);
    PR.checkFinite(tree);
    const x = pickVar(tree, PR.normVar(varWant) || v);
    return { tree, x, tex: PR.astTex(tree), typedVar: v };
  }

  function evalFn(e, x, params) {
    return (t) => { params[x] = t; return evalN(e, params); };
  }

  function verify(f, F, x, params) {
    const dF = C.diff(F, x);
    let good = 0, bad = 0;
    const pts = [0.37, 0.81, 1.23, 1.71, 2.29, 2.83, -0.43, -0.92, -1.37, -2.11, 0.13, 3.4, 4.7, -3.6];
    for (const p of pts) {
      const env = { ...params, [x]: p };
      const a = evalN(f, env), b = evalN(dF, env);
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 1e8) continue;
      if (Math.abs(a - b) <= 1e-7 * (1 + Math.abs(a))) good++; else bad++;
    }
    return { ok: good >= 2 && bad === 0, good, bad };
  }

  // drop additive constants (absorbed into + C)
  function tidy(F, x) {
    if (F.t === 'add') {
      const keep = F.a.filter((t) => has(t, x));
      if (keep.length && keep.length < F.a.length) return add(...keep);
    }
    return F;
  }

  // Does a sequence of values settle? Floating point makes x = target + u round to the target
  // once u is tiny, so the values can freeze at a wrong number (sec(π/2) ≈ 1.6e16): only
  // accept when the last real change before any freeze was already tiny.
  function settles(seq, canFreeze) {
    const n = seq.length;
    if (n < 4) return null;
    const L = seq[n - 1], sc = 1 + Math.abs(L);
    const d = (i) => Math.abs(seq[i] - seq[i - 1]);
    if (d(n - 1) > 1e-9 * sc || d(n - 2) > 1e-9 * sc) return null;
    if (canFreeze) {
      let i = n - 1;
      while (i > 1 && d(i) <= 1e-12 * sc) i--;
      if (d(i) > 1e-6 * sc) return null;
    }
    return L;
  }
  const U = '__u';
  // Does a sequence run off to +∞ or −∞? After dropping a frozen floating-point tail, the last
  // third must move one way with steps that do not shrink (ln x at x = 2^j grows by ln 2 each
  // time; −1/ln x creeps towards 0 with shrinking steps, which is not running off).
  function runsOff(seq) {
    const s = seq.slice();
    while (s.length > 2 && Math.abs(s[s.length - 1] - s[s.length - 2]) <= 1e-12 * (1 + Math.abs(s[s.length - 1]))) s.pop();
    const n = s.length;
    if (n < 8) return 0;
    const w = s.slice(n - Math.max(6, Math.floor(n / 3)));
    const d = [];
    for (let i = 1; i < w.length; i++) d.push(w[i] - w[i - 1]);
    const sg = Math.sign(d[0]);
    if (!sg || d.some((q) => Math.sign(q) !== sg)) return 0;
    if (Math.abs(d[d.length - 1]) < 0.9 * Math.abs(d[0])) return 0;
    if (Math.abs(w[w.length - 1] - w[0]) <= 1e-8 * (1 + Math.abs(w[w.length - 1]))) return 0;
    return sg;
  }
  // (e^u)^c → e^(cu), so x^(−1/100) with x = e^u stays e^(−u/100) instead of overflowing
  function tidyExp(e) {
    if (e.t === 'num' || e.t === 'sym') return e;
    const r = C.rebuild(e, tidyExp);
    if (r.t === 'pow' && r.b.t === 'pow' && r.b.b.t === 'sym' && r.b.b.s === 'e' && isNum(r.e)) return pow(C.E, mul(r.b.e, r.e));
    return r;
  }
  function finitePrefix(seq) {
    const cut = seq.findIndex((v) => !Number.isFinite(v));
    return { fin: cut < 0 ? seq : seq.slice(0, cut), cut };
  }
  function limitAt(F, x, target, side, params, exact) {
    // one-sided limit (side +1 = from above, −1 = from below; target may be ±Infinity).
    // Returns {ok, v, e} when it settles, else {ok: false} with runsOff (±1, the antiderivative
    // heads to ±∞, so the integral diverges), osc (it keeps swinging) or undecided.
    const seq = [], ps = [];
    const T = Number.isFinite(target) ? exact || identify(target) : null;
    let g;
    if (!Number.isFinite(target)) {
      const g0 = evalFn(F, x, params);
      g = (p) => g0(target > 0 ? p : -p);
      for (let j = 3; j <= 200; j++) ps.push(Math.pow(2, j));
    } else {
      // write x = target ± u exactly, so (x − 1)^(1/3) becomes (∓u)^(1/3) and u can be tiny
      g = T ? evalFn(subsVar(F, x, add(T, mul(N(side), S(U)))), U, params) : (u) => evalN(F, { ...params, [x]: target + side * u });
      for (let k = 2; k <= 60; k++) ps.push(Math.pow(10, -k) * (T ? 1 : Math.max(1, Math.abs(target))));
    }
    for (const p of ps) seq.push(g(p));
    // stop at the first non-finite value (overflow far out, such as e^x for huge x)
    const { fin, cut } = finitePrefix(seq);
    const L = settles(fin, Number.isFinite(target));
    if (L !== null) {
      const ex = identify(L);
      return { ok: true, v: ex ? evalN(ex, {}) : L, e: ex };
    }
    const off = runsOff(fin);
    if (off) return { ok: false, runsOff: off };
    // the values overflow (e^x as x → ∞, e^(1/x) as x → 0⁺): look closely at the stretch just
    // before the overflow. If the antiderivative keeps growing in size there, one way, past 10¹⁰,
    // it runs off to ±∞.
    if (cut > 0) {
      const near = fin.slice(Math.max(0, cut - 3));
      const p0 = ps[cut - 1], p1 = ps[cut];
      for (let i = 1; i <= 40; i++) {
        const y = g(p0 * Math.pow(p1 / p0, i / 40));
        if (!Number.isFinite(y)) break;
        near.push(y);
      }
      const w = near.slice(-6);
      const sg = Math.sign(w[w.length - 1]);
      if (w.length >= 4 && sg && w.every((q) => Math.sign(q) === sg) && w.every((q, i) => i === 0 || Math.abs(q) > Math.abs(w[i - 1])) &&
          Math.abs(w[w.length - 1]) > 1e10 && Math.abs(w[w.length - 1]) > 10 * Math.abs(w[0])) return { ok: false, runsOff: sg };
    }
    // no limit: does the antiderivative oscillate (sin x as x → ∞)?
    let turns = 0;
    for (let i = 2; i < fin.length; i++) if ((fin[i] - fin[i - 1]) * (fin[i - 1] - fin[i - 2]) < 0) turns++;
    if (cut < 0 && turns >= 4) return { ok: false, osc: true };
    // slow limits (−1/ln x as x → ∞, x^(−1/100)): approach on a far faster scale by writing
    // x = ±e^u (or x = c ± e^(−u)) exactly, so ln x becomes u, and let u = 2^(k/2) grow
    if (Number.isFinite(target) && !T) return { ok: false, undecided: true };
    const repl = Number.isFinite(target) ? add(T, mul(N(side), pow(C.E, mul(NEG1, S(U))))) : mul(N(target > 0 ? 1 : -1), pow(C.E, S(U)));
    const g2 = evalFn(tidyExp(subsVar(F, x, repl)), U, params);
    const seq2 = [];
    for (let k = 0; k <= 1990; k++) seq2.push(g2(Math.pow(2, k / 2)));
    const fin2 = finitePrefix(seq2).fin;
    const L2 = settles(fin2, true);
    if (L2 !== null) {
      const ex = identify(L2);
      return { ok: true, v: ex ? evalN(ex, {}) : L2, e: ex };
    }
    const off2 = runsOff(fin2);
    if (off2) return { ok: false, runsOff: off2 };
    return { ok: false, undecided: true };
  }

  // does an expression contain ∞ or 0/0 (e^(−1/0) after substituting x = 0)?
  const nonFinite = (e) => (e.t === 'num' ? !Number.isFinite(val(e)) : e.t === 'sym' ? false : (e.a || [e.b, e.e, e.x]).some((q) => q && nonFinite(q)));
  function boundValue(F, x, bd, side, params) {
    // value of the antiderivative at a limit: exact substitution if F is continuous there, else a limit
    if (!bd.inf) {
      const e = subsVar(F, x, bd.e);
      const v = evalN(e, params);
      const l = limitAt(F, x, bd.v, side, params, bd.e);
      // a finite substituted value only counts if F really tends to it (ln|sec x| at π/2 does not)
      if (Number.isFinite(v) && !nonFinite(e) && (!l.ok ? false : Math.abs(l.v - v) <= 1e-6 * (1 + Math.abs(v)))) return { ok: true, e, v, limit: false };
      return l.ok ? { ok: true, e: l.e || C.F(l.v), v: l.v, limit: true } : { ...l, at: bd.v };
    }
    const l = limitAt(F, x, bd.v, 0, params);
    return l.ok ? { ok: true, e: l.e || C.F(l.v), v: l.v, limit: true } : { ...l, at: bd.v };
  }

  // ∫ from c to ±∞ of an integrand that keeps changing sign (sin x / x): integrate between
  // successive zeros, which gives an alternating series, and sum it with repeated averaging
  // (the Euler transform). Returns {ok, value} when the pieces shrink, {osc} when they don't.
  function oscTail(f, c, dir) {
    const g = (t) => f(c + dir * t);
    // scan step: 0.05, or finer when the integrand changes sign faster (sin 100x has zeros π/100 apart)
    let h = 0.05;
    {
      let ch = 0, yp = g(0.0005);
      for (let t = 0.0015; t < 2; t += 0.001) { const y = g(t); if (Number.isFinite(y) && Number.isFinite(yp) && y * yp < 0) ch++; if (y !== 0) yp = y; }
      if (ch > 0) h = Math.min(h, 2 / ch / 8);
    }
    const zeros = [];
    let t0 = h / 2, y0 = g(t0);
    for (let t = t0 + h; t < 6000 && zeros.length < 260; t += h) {
      const y = g(t);
      if (!Number.isFinite(y)) return null;
      if (y0 !== 0 && Math.sign(y) !== Math.sign(y0) && y !== 0) {
        let lo = t - h, hi = t, ylo = y0;
        for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2, ym = g(m); if (Math.sign(ym) === Math.sign(ylo)) { lo = m; ylo = ym; } else hi = m; }
        zeros.push((lo + hi) / 2);
      }
      if (y !== 0) y0 = y;
    }
    if (zeros.length < 40) return null;
    // zeros crowding closer than the scan step (sin(e^x)) may have been missed: give up
    for (let i = 1; i < zeros.length; i++) if (zeros[i] - zeros[i - 1] < 2 * h) return null;
    const first = quad(g, 0, zeros[0]);
    if (!first.ok) return null;
    const terms = [];
    for (let i = 0; i + 1 < zeros.length; i++) {
      const r = quad(g, zeros[i], zeros[i + 1]);
      if (!r.ok) return null;
      terms.push(r.value);
    }
    const n = terms.length, mean = (a, b) => terms.slice(a, b).reduce((p, q) => p + Math.abs(q), 0) / (b - a);
    const early = mean(Math.floor(n / 4), Math.floor(n / 2)), late = mean(Math.floor(3 * n / 4), n);
    if (!(late < 0.8 * early)) return { osc: true };
    // partial sums at the zeros, then repeated pairwise averaging
    let S = [], sum = first.value;
    for (const t of terms) { sum += t; S.push(sum); }
    S = S.slice(-40);
    let est = S[S.length - 1], d = Infinity;
    for (let lev = 0; lev < 20 && S.length > 1; lev++) {
      const nx = [];
      for (let i = 0; i + 1 < S.length; i++) nx.push((S[i] + S[i + 1]) / 2);
      d = Math.abs(nx[nx.length - 1] - est);
      est = nx[nx.length - 1];
      S = nx;
      if (d < 1e-13 * (1 + Math.abs(est))) break;
    }
    // ∫ from c to ∞ (dir +1) or from −∞ to c (dir −1), both as positive-orientation integrals
    return { ok: d < 1e-9 * (1 + Math.abs(est)), value: est, error: d };
  }

  // ∫ from c to ±∞ of an integrand that does not keep changing sign, or whose plain quadrature
  // did not settle: add the areas over [c, c + s], [c + s, c + 3s], [c + 3s, c + 7s], … (each
  // piece twice as long) and look at the partial sums P_k.
  //  - P_k settles: that is the value.
  //  - P_k runs off to ±∞ (pieces not shrinking: 1/ln x): the integral diverges.
  //  - the pieces shrink by a steady ratio r < 1 (a 1/x^p tail gives r = 2^(1−p)): add the
  //    geometric rest Δ·r/(1 − r), an estimate (flagged extrapolated), with the digits that agree
  //    between the last two estimates.
  //  - anything else: undecided.
  function tailAnalysis(f, c, dir) {
    const sc = Math.max(1, Math.abs(c));
    const P = [];
    let sum = 0, errSum = 0, X = c;
    for (let k = 0; k < 48; k++) {
      // far pieces of an oscillating integrand cannot be resolved; a smaller budget keeps this
      // quick, and their error estimates are added up and shown as fewer digits
      const Y = c + dir * sc * (Math.pow(2, k + 1) - 1);
      const r = dir > 0 ? quad(f, X, Y, 250) : quad(f, Y, X, 250);
      if (!r.ok || !Number.isFinite(r.value)) break;
      sum += r.value; errSum += r.error; P.push(sum); X = Y;
    }
    if (P.length < 8) return { undecided: true };
    const L = settles(P, false);
    if (L !== null) return { ok: true, value: L, error: errSum + Math.abs(P[P.length - 1] - P[P.length - 2]) };
    const off = runsOff(P);
    if (off) return { runsOff: off };
    const D = [];
    for (let i = 1; i < P.length; i++) D.push(P[i] - P[i - 1]);
    const R = [];
    for (let i = 1; i < D.length; i++) R.push(D[i] / D[i - 1]);
    // The ratio must be steady. A ratio that keeps drifting up towards 1 is not geometric
    // (1/(x ln³x) gives (k/(k+1))³), and extrapolating it would give a wrong value; far pieces
    // of an oscillating integrand add a little noise, which is allowed.
    const last = R.slice(-5);
    const rr = last[last.length - 1];
    if (!(rr > 0 && rr < 0.97) || last.some((q) => !(q > 0) || Math.abs(q - rr) > 0.03)) return { undecided: true };
    if (last.every((q, i) => i === 0 || q > last[i - 1])) return { undecided: true };
    // estimates from the last two partial sums, each with its own ratio
    const est = (i) => { const r = R[i - 1], d = D[i]; return P[i + 1] + d * r / (1 - r); };
    const e1 = est(D.length - 1), e0 = est(D.length - 2);
    const rest = Math.abs(e1 - P[P.length - 1]);
    const err = Math.abs(e1 - e0) + 0.05 * rest + errSum;
    // the extrapolated rest must be a small part of the answer
    if (!(rest < 1e-3 * (1 + Math.abs(e1))) || !(err < 1e-4 * (1 + Math.abs(e1)))) return { undecided: true, value: e1 };
    return { ok: true, value: e1, extrapolated: true, error: err };
  }

  // How does |f| behave approaching the end c of an interval of width w (side +1: from above)?
  // Sample at distances w·10^−k and estimate the power p in |f| ~ h^−p from neighbouring samples.
  //  'pole': p settles at 1 or more (or |f| overflows after growing): not integrable there.
  //  'bounded': |f| does not grow.
  //  'unclear': anything else (an integrable singularity, or swings like sin(1/x)/x).
  function endBehaviour(f, c, side, w) {
    const hs = [], ys = [];
    for (let k = 1; k <= 12; k++) {
      const t = c + side * w * Math.pow(10, -k), h = Math.abs(t - c);
      if (!(h > 0)) break;
      hs.push(h); ys.push(Math.abs(f(t)));
    }
    if (ys.length < 6 || ys.some(Number.isNaN)) return 'unclear';
    const inf = ys.findIndex((y) => y === Infinity);
    if (inf >= 0) {
      const fin = ys.slice(0, inf);
      return ys.slice(inf).every((y) => y === Infinity) && fin.length >= 2 && fin.every((y, i) => i === 0 || y > fin[i - 1]) && fin[fin.length - 1] > 1e6 ? 'pole' : 'unclear';
    }
    if (ys.every((y) => y <= 10 * Math.max(1, ys[0]))) return 'bounded';
    const ps = [];
    for (let i = 1; i < ys.length; i++) ps.push(ys[i] > 0 && ys[i - 1] > 0 ? Math.log(ys[i] / ys[i - 1]) / Math.log(hs[i - 1] / hs[i]) : NaN);
    const last = ps.slice(-6);
    if (last.every((p) => p >= 0.98) && last[last.length - 1] >= 0.999) return 'pole';
    return 'unclear';
  }

  function findSingularities(f, a, b) {
    const n = 2000, out = [];
    const ys = [];
    let overflow = false;
    let nan = 0;
    for (let i = 0; i < n; i++) {
      const t = a + (b - a) * (i + 0.5) / n;
      const y = f(t);
      ys.push(y);
      if (Number.isNaN(y)) nan++;
    }
    const mags = ys.filter(Number.isFinite).map(Math.abs).sort((p, q) => p - q);
    const med = mags.length ? mags[Math.floor(mags.length / 2)] : 0;
    for (let i = 1; i < n - 1; i++) {
      const y = Math.abs(ys[i]);
      if (!Number.isFinite(ys[i]) && !Number.isNaN(ys[i])) {
        // a run of infinite values is overflow (e^(x²) for x > 26.6), not a set of poles
        if (!Number.isFinite(ys[i - 1]) || !Number.isFinite(ys[i + 1])) overflow = true;
        else {
          // a lone infinite sample: the pole is within a grid step of it; prefer a round number
          // there where the integrand really is infinite (e^(1/x)/x² gives ∞ at 0.0005 and at 0)
          const c = a + (b - a) * (i + 0.5) / n, step = (b - a) / n;
          let at = c;
          for (let k = 0; k <= 8; k++) {
            const q = Math.round(c * Math.pow(10, k)) / Math.pow(10, k), fq = f(q);
            if (Math.abs(q - c) < step && q > a && q < b && !Number.isFinite(fq)) { at = q; break; }
          }
          if (!out.some((o) => Math.abs(o - at) < step)) out.push(at);
        }
        continue;
      }
      if (y > 30 * (med + 1e-9) && y >= Math.abs(ys[i - 1]) && y >= Math.abs(ys[i + 1])) {
        // refine the peak and see whether it blows up
        let lo = a + (b - a) * (i - 0.5) / n, hi = a + (b - a) * (i + 1.5) / n;
        for (let k = 0; k < 80; k++) {
          const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
          const v1 = Math.abs(f(m1)), v2 = Math.abs(f(m2));
          if (!(v1 < Infinity)) { lo = hi = m1; break; }
          if (!(v2 < Infinity)) { lo = hi = m2; break; }
          if (v1 > v2) hi = m2; else lo = m1;
        }
        const c = (lo + hi) / 2;
        const c0 = Math.abs(f(c)), at = (h) => Math.max(Math.abs(f(c - h * (1 + Math.abs(c)))), Math.abs(f(c + h * (1 + Math.abs(c)))));
        const probe = at(1e-9), far = at(1e-4);
        // a pole blows up as it is approached; a large but finite peak (e^x sin(e^x)) does not
        const peak = Math.max(c0, probe);
        if (!(c0 < Infinity) || (peak > 1e7 && peak > 100 * far)) {
          const snapped = Math.abs(c - Math.round(c * 1e6) / 1e6) < 1e-7 ? Math.round(c * 1e6) / 1e6 : c;
          if (!out.some((o) => Math.abs(o - snapped) < (b - a) / n)) out.push(snapped);
        }
      }
    }
    // stretches where the integrand is not a real number, with their ends refined by bisection
    const nanRuns = [];
    const edge = (i, j) => { // i is NaN, j is not (neighbouring samples)
      let p = a + (b - a) * (i + 0.5) / n, q = a + (b - a) * (j + 0.5) / n;
      for (let k = 0; k < 60; k++) { const m = (p + q) / 2; if (Number.isNaN(f(m))) p = m; else q = m; }
      return (p + q) / 2;
    };
    for (let i = 0; i < n; i++) {
      if (!Number.isNaN(ys[i])) continue;
      let j = i;
      while (j + 1 < n && Number.isNaN(ys[j + 1])) j++;
      nanRuns.push([i === 0 ? null : edge(i, i - 1), j === n - 1 ? null : edge(j, j + 1)]);
      i = j;
    }
    return { points: out, nanFrac: nan / n, overflow, nanRuns };
  }

  function solve(input) {
    const { integrand, mode, lower, upper, variable } = input;
    const { s, v: typedVar } = PR.clean(integrand || '');
    if (!s) return { empty: true };
    const tree = PR.parse(s);
    PR.checkFinite(tree);
    const x = pickVar(tree, PR.normVar(variable) || typedVar);
    const f = PR.toExpr(tree);
    const params = {};
    [...C.syms(f)].filter((q) => q !== x && q !== 'pi' && q !== 'e').forEach((q, i) => { params[q] = 1.3 + 0.37 * i; });
    const out = { x, f, tree, integrandTex: PR.astTex(tree), params: Object.keys(params), notes: [] };
    const t0 = performance.now();
    const res = IN.integrate(f, x, { limitMs: 4000 });
    out.ms = performance.now() - t0;
    const undefinedConst = (F) => !Number.isFinite(evalN(F, { ...params, [x]: 0.37 })) && !Number.isFinite(evalN(F, { ...params, [x]: 1.23 })) && /undefined|NaN/.test(C.txt(F, x));
    if (res && !res.timeout && !undefinedConst(res.F)) {
      const F = tidy(res.F, x);
      out.F = F;
      out.step = res.step;
      out.Ftex = C.tex(F, x);
      out.Ftext = C.txt(F, x);
      out.verify = verify(f, F, x, { ...params });
    } else {
      out.F = null;
      out.timeout = !!(res && res.timeout);
      out.nonElementary = IN.nonElementary(f, x);
      // |x² − 1|, √|x|, sin|x|: the answer depends on where the inside changes sign
      const absIn = (e) => e.t === 'fn' && e.f === 'abs' ? has(e.x, x) : (e.a || [e.b, e.e, e.x]).some((q) => q && typeof q === 'object' && absIn(q));
      out.absInside = absIn(f);
    }
    if (mode !== 'definite') return out;

    // ----- definite -----
    const a = parseBound(lower, x), b = parseBound(upper, x);
    if (a.empty || b.empty) { out.needBounds = true; return out; }
    out.a = a; out.b = b;
    if (a.v === b.v) {
      // equal limits (also ∞ to ∞): no width, so the integral is 0
      out.value = { e: ZERO, v: 0, tex: '0', approx: 0 };
      out.equalLimits = true;
      out.numeric = { value: 0, ok: true, error: 0 };
      out.singular = [];
      out.evalStep = { rule: 'Equal limits', items: [{ p: 'The lower and upper limits are the same, so the interval has no width and the integral is $0$.' }] };
      return out;
    }
    const fNum = evalFn(f, x, { ...params });
    const lo = Math.min(a.v, b.v), hi = Math.max(a.v, b.v);
    const sgn = a.v <= b.v ? 1 : -1;
    const infinite = !Number.isFinite(lo) || !Number.isFinite(hi);
    // singularities inside the interval
    let sing = { points: [], nanFrac: 0 };
    if (!infinite) sing = findSingularities(fNum, lo, hi);
    else {
      const L = Number.isFinite(lo) ? lo : (Number.isFinite(hi) ? hi - 60 : -60), H = Number.isFinite(hi) ? hi : L + 60 + (Number.isFinite(lo) ? 0 : 60);
      sing = findSingularities(fNum, L, H);
      sing.points = sing.points.filter((p) => p > lo && p < hi);
    }
    if (sing.nanFrac > 0.02) {
      out.undefinedPart = true;
      // say where: "for x between −1 and 0", "for x < 2", or "anywhere on this interval"
      const v = C.symTxt(x);
      const num = (t) => { const e = identify(t); return (e ? C.txt(e, x) : C.fmtNum(t, 6)).replace(/^-/, '−'); };
      const runs = sing.nanRuns.map(([p, q]) => [p === null ? (Number.isFinite(lo) ? lo : -Infinity) : p, q === null ? (Number.isFinite(hi) ? hi : Infinity) : q]);
      const say = ([p, q]) => (p === -Infinity && q === Infinity ? null : p === -Infinity ? `${v} < ${num(q)}` : q === Infinity ? `${v} > ${num(p)}` : `${v} between ${num(p)} and ${num(q)}`);
      const all = runs.length === 1 && runs[0][0] === lo && runs[0][1] === hi;
      const parts = runs.slice(0, 2).map(say).filter(Boolean);
      out.notes.push(all || !parts.length
        ? `The integrand isn't a real number anywhere on this interval, so this definite integral isn't defined.`
        : `The integrand isn't a real number for ${parts.join(' and for ')}${runs.length > 2 ? ' (and elsewhere)' : ''}, part of this interval, so this definite integral isn't defined.`);
      return out;
    }
    out.singular = sing.points;
    // numerical value
    const cuts = [lo, ...sing.points, hi];
    let numV = 0, numOk = true, numErr = 0, endRough = false, quadOk = true;
    for (let i = 0; i < cuts.length - 1; i++) {
      const r = quadWide(fNum, cuts[i], cuts[i + 1]);
      numV += r.value; numErr += r.error; numOk = numOk && r.ok; quadOk = quadOk && r.ok;
      // The integrand was infinite (in floating point) right at an end of this piece. Near a
      // point c other than 0, x − c loses precision there, which costs far more than the
      // quadrature's own error estimate: (1 − x)^(−0.9) on [0, 1] gives 9.76, not 10. Measured
      // on such cases the real error is up to a few hundred times the area of the dropped end
      // pieces, so count 1000 times that area as error; if that is not small, the value is rough.
      if (r.dropped && !infinite) {
        const de = 1000 * r.dropped;
        numErr += de;
        if (r.ok && de > 1e-6 * Math.max(1, Math.abs(r.value))) { numOk = false; endRough = true; }
      }
    }
    // On an infinite range the quadrature's error estimate is relative, so a diverging area
    // (1/ln x: ≈ 4·10^14) can look settled. Never trust a huge total there.
    if (infinite && !(Math.abs(numV) <= 1e10)) numOk = false;
    // an infinite range whose integrand keeps changing sign (sin x / x on [0, ∞)): the plain
    // quadrature cannot settle, so sum the oscillating tail instead. Otherwise (or as well, when
    // the quadrature claims to have settled) add the tail in doubling pieces and watch the sums.
    let tailVerdict = null;
    if (infinite && !sing.points.length) {
      const c = Number.isFinite(lo) ? lo : Number.isFinite(hi) ? hi : 0;
      const dirs = [];
      if (!Number.isFinite(hi)) dirs.push(+1);
      if (!Number.isFinite(lo)) dirs.push(-1);
      // with no antiderivative, look at the finite end first: an integrand that grows like
      // 1/(x − c) or faster there (cos x / x at 0) makes the area infinite, whatever the tail does
      const endSide = Number.isFinite(lo) ? +1 : Number.isFinite(hi) ? -1 : 0;
      const endPole = !out.F && endSide && endBehaviour(fNum, c, endSide, 1) === 'pole';
      let parts = numOk || endPole ? [] : dirs.map((d) => oscTail(fNum, c, d));
      if (endPole) { tailVerdict = 'pole'; numOk = false; out.divergesAt = c; }
      else if (!numOk && parts.every((p) => p && p.ok)) {
        numV = parts.reduce((t, p) => t + p.value, 0); numErr = parts.reduce((t, p) => t + p.error, 0); numOk = true; out.conditional = true;
      } else if (!numOk && parts.some((p) => p && p.osc)) out.oscillates = true;
      else {
        const tails = dirs.map((d) => tailAnalysis(fNum, c, d));
        if (tails.some((t) => t.runsOff)) { tailVerdict = 'runsOff'; numOk = false; out.divergesAt = dirs[tails.findIndex((t) => t.runsOff)] * Infinity; }
        else if (tails.every((t) => t.ok)) {
          const tv = tails.reduce((t, p) => t + p.value, 0);
          const ext = tails.some((t) => t.extrapolated);
          if (!numOk || Math.abs(tv - numV) > 1e-6 * (1 + Math.abs(tv))) {
            // the quadrature failed or disagrees with the tail sums: the tail sums are safer
            numV = tv; numOk = true;
            numErr = tails.reduce((t, p) => t + (p.error || 0), 0);
            if (ext) out.extrapolated = true;
          }
        } else { tailVerdict = 'undecided'; numOk = false; out.undecidedAt = dirs[tails.findIndex((t) => !t.ok)] * Infinity; if (tails.every((t) => Number.isFinite(t.value))) numV = tails.reduce((t, p) => t + p.value, 0); }
      }
    }
    out.numeric = { value: sgn * numV, ok: numOk, error: numErr };

    if (out.F) {
      const F = out.F;
      const pieces = [];
      const fails = [];
      const pts = [{ bd: a }, ...sing.points.map((p) => ({ p })), { bd: b }];
      // evaluate F at each cut point (one-sided limits at interior singularities)
      const sortedPts = a.v <= b.v ? pts : pts.slice().reverse();
      for (let i = 0; i < sortedPts.length - 1; i++) {
        const L = sortedPts[i], R = sortedPts[i + 1];
        const Lv = L.bd ? boundValue(F, x, L.bd, +1, { ...params }) : limitAt(F, x, L.p, +1, { ...params });
        const Rv = R.bd ? boundValue(F, x, R.bd, -1, { ...params }) : limitAt(F, x, R.p, -1, { ...params });
        if (!Lv.ok) fails.push({ ...Lv, at: L.bd ? L.bd.v : L.p });
        if (!Rv.ok) fails.push({ ...Rv, at: R.bd ? R.bd.v : R.p });
        pieces.push({ L: Lv, R: Rv });
      }
      if (!fails.length) {
        let V = ZERO;
        for (const pc of pieces) V = add(V, sub(pc.R.e || C.F(pc.R.v), pc.L.e || C.F(pc.L.v)));
        if (a.v > b.v) V = mul(NEG1, V);
        let vv = evalN(V, { ...params });
        out.value = { e: V, v: vv, tex: C.tex(V, x), approx: vv };
        // a term like 1/e^1000000000 is far below anything a decimal can show: give the rest as
        // the displayed value (≈) and keep the full exact value in the working and the note
        const tiny = !out.params.length && negligible(V);
        if (tiny) out.value.shown = { e: tiny.kept, tex: C.tex(tiny.kept, x), dropped: tiny.dropped, droppedTex: tiny.droppedTex, exactTex: C.tex(tiny.kept, x) + tiny.tail };
        // F might jump inside the interval even though f is finite: trust the numerical value then
        if (numOk && Number.isFinite(vv) && Math.abs(vv - out.numeric.value) > 1e-6 * (1 + Math.abs(vv)) && !out.params.length) {
          out.value.mismatch = true;
        }
        out.evalStep = buildEvalStep(F, x, a, b, sing.points, pieces, V, out.value.shown);
      } else {
        // the improper integral converges only if every one-sided limit exists: one that runs
        // off to ±∞ means the area is infinite; one that keeps swinging means it has no value;
        // a limit that could be neither pinned down nor ruled out leaves the question open
        const off = fails.find((q) => q.runsOff), osc = fails.find((q) => q.osc);
        if (off || osc) {
          out.diverges = true;
          out.divergesAt = (off || osc).at;
          if (!off) out.oscillates = true;
        } else {
          out.undecided = true;
          out.undecidedAt = fails[0].at;
        }
      }
    } else if (!numOk && endRough && quadOk && !infinite) {
      // the quadrature itself settled; only the accuracy next to an infinite end is in doubt
      out.roughNumeric = true; out.endSingular = true;
    } else if (!numOk && !infinite && !sing.points.length && (() => {
      // finite interval, no antiderivative, and the quadrature did not settle: look at how the
      // integrand behaves at each end. Growing like 1/(x − c) or faster (e^x/x at 0, 1/ln x at 1)
      // means the area is infinite; staying bounded at both ends (sin x / x on [0, 10⁶]) means the
      // integral exists and only the numerical value is rough; anything else is left open.
      const ends = [[lo, +1], [hi, -1]].map(([c, sd]) => ({ c, k: endBehaviour(fNum, c, sd, hi - lo) }));
      const pole = ends.find((q) => q.k === 'pole');
      if (pole) { out.diverges = true; out.divergesAt = pole.c; return true; }
      if (sing.overflow) return false;
      if (Math.abs(numV) > 1e10) return false;
      if (ends.every((q) => q.k === 'bounded')) { out.roughNumeric = true; return true; }
      out.undecided = true; out.undecidedAt = ends.find((q) => q.k !== 'bounded').c; out.endUnclear = true;
      return true;
    })()) {
      // decided above
    } else if (!numOk) {
      if (out.oscillates || tailVerdict === 'runsOff' || tailVerdict === 'pole' || (sing.overflow && infinite)) {
        out.diverges = true;
        if (sing.overflow && out.divergesAt === undefined) out.divergesAt = Number.isFinite(hi) ? -Infinity : Infinity;
      }
      else if (sing.overflow) { out.undecided = true; out.overflow = true; }
      else if (tailVerdict === 'undecided') out.undecided = true;
      else out.diverges = sing.points.length > 0 || Math.abs(numV) > 1e10;
    }
    if (!out.diverges) delete out.oscillates;
    // A finite interval on which the integrand is continuous (e^x on [0, 1000]) always has a finite
    // area; "undecided" there only means the numbers overflowed. Work the size out with logarithms.
    if (out.undecided && !infinite && !out.params.length && continuousOn(f, x, lo, hi)) {
      const big = hugeValue(out.F && continuousOn(out.F, x, lo, hi) ? out.F : null, f, x, a, b, lo, hi, sgn);
      if (big) {
        out.tooLarge = big;
        delete out.undecided; delete out.undecidedAt; delete out.overflow; delete out.endUnclear;
        if (big.how === 'antiderivative') out.evalStep = bigEvalStep(out.F, x, a, b, big);
      }
    }
    // a numerical estimate is only worth showing when it settled and is of a sane size
    if (out.undecided) out.numeric.plausible = Number.isFinite(numV) && Math.abs(numV) <= 1e10 && (numOk || tailVerdict === 'undecided');
    return out;
  }

  // ---------- values beyond floating point (e^1000) ----------
  // sign and ln|value| of an expression at a point; null when that can't be done reliably
  function logEval(e, env) {
    const plain = (q) => { const v = evalN(q, env); return Number.isFinite(v) ? { s: Math.sign(v), l: v === 0 ? -Infinity : Math.log(Math.abs(v)) } : null; };
    switch (e.t) {
      case 'num': case 'sym': return plain(e);
      case 'mul': {
        let s = 1, l = 0;
        for (const q of e.a) { const r = logEval(q, env); if (!r) return null; if (!r.s) return { s: 0, l: -Infinity }; s *= r.s; l += r.l; }
        return { s, l };
      }
      case 'add': {
        const rs = e.a.map((q) => logEval(q, env));
        if (rs.some((r) => !r)) return null;
        return sumLogs(rs);
      }
      case 'pow': {
        const k = evalN(e.e, env);
        if (!Number.isFinite(k)) return null;
        const b = logEval(e.b, env);
        if (!b) return null;
        if (!b.s) return k > 0 ? { s: 0, l: -Infinity } : null;
        if (b.s < 0 && !Number.isInteger(k)) return null;
        return { s: b.s < 0 && Math.abs(k) % 2 === 1 ? -1 : 1, l: k * b.l };
      }
      case 'fn': {
        const p = plain(e);
        if (p) return p;
        if (e.f === 'cosh' || e.f === 'sinh') {
          const a = evalN(e.x, env);
          if (!Number.isFinite(a) || Math.abs(a) < 30) return null;
          return { s: e.f === 'cosh' ? 1 : Math.sign(a), l: Math.abs(a) - Math.LN2 };
        }
        if (e.f === 'abs') { const r = logEval(e.x, env); return r && { s: r.s ? 1 : 0, l: r.l }; }
        return null;
      }
    }
    return null;
  }
  // add values given as sign and ln|value|; null if they cancel too closely to trust
  function sumLogs(rs) {
    const nz = rs.filter((r) => r.s);
    if (!nz.length) return { s: 0, l: -Infinity };
    const L = Math.max(...nz.map((r) => r.l));
    let sum = 0, mag = 0;
    for (const r of nz) { const t = Math.exp(r.l - L); sum += r.s * t; mag += t; }
    if (!(Math.abs(sum) > 1e-9 * mag)) return null;
    return { s: Math.sign(sum), l: L + Math.log(Math.abs(sum)) };
  }
  // a + b x, or null if e is not linear in x
  function linearIn(e, x) {
    const d = C.diff(e, x);
    if (has(d, x)) return null;
    const p = evalN(d, {}), q = evalN(subsVar(e, x, ZERO), {});
    return Number.isFinite(p) && Number.isFinite(q) ? (t) => q + p * t : null;
  }
  // Is e certainly continuous on the closed interval [lo, hi]? Only a few shapes are accepted:
  // sums and products of polynomials, exponentials (positive base), sin, cos, arctan, sinh, cosh,
  // tanh, erf, |…|, and powers or logarithms of a linear expression that stays away from 0.
  function continuousOn(e, x, lo, hi) {
    if (!has(e, x)) return Number.isFinite(evalN(e, {}));
    switch (e.t) {
      case 'sym': return true;
      case 'add': case 'mul': return e.a.every((q) => continuousOn(q, x, lo, hi));
      case 'pow': {
        if (!has(e.b, x)) return evalN(e.b, {}) > 0 && continuousOn(e.e, x, lo, hi);
        if (!isNum(e.e)) return false;
        const k = val(e.e);
        if (Number.isInteger(k) && k >= 0) return continuousOn(e.b, x, lo, hi);
        const lin = linearIn(e.b, x);
        if (!lin) return false;
        const p = lin(lo), q = lin(hi);
        if (k < 0) return Number.isInteger(k) ? p * q > 0 : p > 0 && q > 0;
        return p >= 0 && q >= 0;
      }
      case 'fn': {
        if (['sin', 'cos', 'atan', 'sinh', 'cosh', 'tanh', 'erf', 'abs'].includes(e.f)) return continuousOn(e.x, x, lo, hi);
        if (e.f === 'ln') {
          const lin = linearIn(e.x.t === 'fn' && e.x.f === 'abs' ? e.x.x : e.x, x);
          if (!lin) return false;
          const p = lin(lo), q = lin(hi);
          return e.x.t === 'fn' && e.x.f === 'abs' ? p * q > 0 : p > 0 && q > 0;
        }
        return false;
      }
    }
    return false;
  }
  // the size of a finite integral too large for floating point: from the antiderivative when it
  // is continuous too, otherwise by integrating f·e^(−M) numerically, with e^M about the largest |f|
  function hugeValue(F, f, x, a, b, lo, hi, sgn) {
    let r = null, exact = null, how = null, digits = 6;
    if (F) {
      const Fb = logEval(F, { [x]: b.v }), Fa = logEval(F, { [x]: a.v });
      if (Fb && Fa) {
        r = sumLogs([Fb, { s: -Fa.s, l: Fa.l }]);
        const V = sub(subsVar(F, x, b.e), subsVar(F, x, a.e));
        if (r && !nonFinite(V) && !Number.isFinite(evalN(V, {})) && C.size(V) <= 40) exact = V;
        how = 'antiderivative';
      }
    }
    if (!r) {
      const lf = (t) => logEval(f, { [x]: t });
      let M = -Infinity;
      for (let i = 0; i <= 4000; i++) {
        const q = lf(lo + (hi - lo) * i / 4000);
        if (!q) return null;
        if (q.s) M = Math.max(M, q.l);
      }
      if (!(M > 600)) return null;
      const g = (t) => { const q = lf(t); return q ? q.s * Math.exp(q.l - M) : NaN; };
      const qr = quadWide(g, lo, hi);
      if (!qr.ok || !qr.value) return null;
      r = { s: Math.sign(qr.value) * sgn, l: M + Math.log(Math.abs(qr.value)) };
      digits = Math.max(3, Math.min(6, Math.floor(-Math.log10(Math.max(qr.error / Math.abs(qr.value), 1e-12)))));
      how = 'numeric';
    }
    if (!r || !r.s || !Number.isFinite(r.l) || r.l / Math.LN10 < 300) return null;
    const lg = r.l / Math.LN10;
    let E = Math.floor(lg), m = Number(Math.pow(10, lg - E).toPrecision(digits));
    if (m >= 10) { m /= 10; E++; }
    const ms = (r.s < 0 ? '-' : '') + m.toPrecision(digits).replace(/\.?0+$/, '');
    return { how, sign: r.s, log10: lg, text: `${ms.replace('-', '−')} × 10^${E}`, tex: `${ms} \\times 10^{${E}}`, exact, exactTex: exact ? C.tex(exact, x) : null, exactText: exact ? C.txt(exact, x) : null };
  }
  function bigEvalStep(F, x, a, b, big) {
    const items = [{ p: 'Substitute the limits into the antiderivative (the constant $C$ cancels).' }, { m: `\\Big[ ${C.tex(F, x)} \\Big]_{${a.tex}}^{${b.tex}} = F(${b.tex}) - F(${a.tex})` }];
    if (big.exact) items.push({ m: `= ${big.exactTex}` });
    items.push({ p: 'This number is far beyond 10³⁰⁸, the largest a computer’s ordinary arithmetic can hold, so its decimal size is worked out with logarithms.' });
    items.push({ m: `${big.exact ? big.exactTex : `F(${b.tex}) - F(${a.tex})`} \\approx ${big.tex}` });
    return { rule: 'Evaluate between the limits', items };
  }

  // terms c·e^(−n) of a sum (c a number) smaller than 10^(−300), next to terms that are not tiny
  function negligible(V) {
    if (V.t !== 'add') return null;
    const small = (t) => {
      const fs = t.t === 'mul' ? t.a : [t];
      const ex = fs.filter((q) => q.t === 'pow' && q.b.t === 'sym' && q.b.s === 'e' && isNum(q.e));
      if (ex.length !== 1 || !fs.every((q) => q === ex[0] || isNum(q))) return false;
      const c = fs.filter(isNum).reduce((m, q) => m * Math.abs(val(q)), 1);
      return c > 0 && Number.isFinite(c) && Math.log(c) + val(ex[0].e) < -700;
    };
    const drop = V.a.filter(small), keep = V.a.filter((t) => !small(t));
    if (!drop.length || !keep.length) return null;
    const kept = add(...keep), kv = evalN(kept, {});
    if (!Number.isFinite(kv) || Math.abs(kv) < 1e-6) return null;
    // each term as c e^{-n} (an inline fraction with e^1000000000 underneath reads badly)
    const parts = drop.map((t) => {
      const fs = t.t === 'mul' ? t.a : [t];
      const ex = fs.find((q) => q.t === 'pow');
      const c = Math.abs(fs.filter(isNum).reduce((m, q) => m * val(q), 1));
      const ct = fs.filter(isNum).length ? C.tex(C.isNeg(mul(...fs.filter(isNum))) ? C.neg(mul(...fs.filter(isNum))) : mul(...fs.filter(isNum))) : '';
      return { neg: C.isNeg(t), tex: (c === 1 ? '' : ct + '\\,') + 'e^{' + C.tex(ex.e) + '}' };
    });
    const droppedTex = parts.map((q, i) => (i ? (q.neg ? ' - ' : ' + ') : '') + q.tex).join('');
    const tail = parts.map((q) => (q.neg ? ' - ' : ' + ') + q.tex).join('');
    return { kept, dropped: add(...drop), droppedTex, tail };
  }

  function buildEvalStep(F, x, a, b, sing, pieces, V, shown) {
    const v = dvar(x);
    const T = (e) => C.tex(e, x);
    const items = [];
    const FT = T(F);
    const wrap = (t) => (/[+\-]/.test(t) ? '\\left(' + t + '\\right)' : t);
    if (!sing.length && pieces.length === 1) {
      const pc = pieces[0];
      const Lt = pc.L.limit ? `\\lim_{${v}\\to ${a.v < b.v ? a.tex : b.tex}${a.inf || b.inf ? '' : ''}} F(${v})` : '';
      items.push({ p: 'Substitute the limits into the antiderivative (the constant $C$ cancels).' });
      const anyLimit = pc.L.limit || pc.R.limit;
      items.push({ m: `\\Big[ ${FT} \\Big]_{${a.tex}}^{${b.tex}} = F(${b.tex}) - F(${a.tex})` });
      if (anyLimit) {
        const lim = (bd, val, side) => bd.inf ? `\\lim_{${v}\\to ${bd.tex}} F(${v}) = ${T(val)}` : `\\lim_{${v}\\to ${bd.tex}^{${side}}} F(${v}) = ${T(val)}`;
        items.push({ p: 'At least one limit needs a limit rather than direct substitution:' });
        const lo = a.v <= b.v ? a : b, hi = a.v <= b.v ? b : a;
        if (pc.R.limit) items.push({ m: lim(hi, pc.R.e, '-') });
        else items.push({ m: `F(${hi.tex}) = ${T(pc.R.e)}` });
        if (pc.L.limit) items.push({ m: lim(lo, pc.L.e, '+') });
        else items.push({ m: `F(${lo.tex}) = ${T(pc.L.e)}` });
        void Lt;
      } else {
        const hiE = a.v <= b.v ? pc.R.e : pc.L.e, loE = a.v <= b.v ? pc.L.e : pc.R.e;
        items.push({ m: `= ${T(hiE)} - ${wrap(T(loE))}` });
      }
      items.push({ m: `= ${T(V)}` });
    } else {
      items.push({ p: `The integrand is infinite at $${v} = ${sing.map((p) => C.tex(identify(p) || C.F(p), x)).join(', ')}$, so split the integral there and take one-sided limits.` });
      for (const pc of pieces) items.push({ m: `${T(pc.R.e)} - ${wrap(T(pc.L.e))}` });
      items.push({ m: `= ${T(V)}` });
    }
    if (shown) items.push({ p: `The term $${shown.droppedTex}$ is smaller than $10^{-300}$, far too small to change any digit shown, so to every digit shown the value is $${shown.tex}$.` });
    return { rule: 'Evaluate between the limits', items };
  }

  G.SOLVE = { solve, preview, quad, identify, parseBound, evalFn, tailAnalysis };
})(typeof window !== 'undefined' ? window : globalThis);
