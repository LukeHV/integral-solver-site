/* cas.js — a small computer-algebra core.
 * Exact rationals, canonical expression trees (built through simplifying
 * constructors), differentiation, expansion, polynomials, substitution,
 * numeric evaluation and LaTeX / plain-text output. */
(function (G) {
  'use strict';

  // ---------- numbers ----------
  const LIM = 2 ** 52;
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
  function F(v) {
    if (Number.isFinite(v) && Number.isInteger(v) && Math.abs(v) <= LIM) return { t: 'num', n: v, d: 1 };
    return { t: 'num', f: v };
  }
  function N(n, d = 1) {
    if (d === 0) return { t: 'num', f: n === 0 ? NaN : n > 0 ? Infinity : -Infinity };
    if (!Number.isInteger(n) || !Number.isInteger(d) || Math.abs(n) > LIM || Math.abs(d) > LIM) return F(n / d);
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d) || 1;
    return { t: 'num', n: n / g, d: d / g };
  }
  const isNum = (e) => e.t === 'num';
  const isRat = (e) => e.t === 'num' && e.f === undefined;
  const val = (e) => (e.f !== undefined ? e.f : e.n / e.d);
  const isZero = (e) => isNum(e) && val(e) === 0;
  const isOne = (e) => isRat(e) && e.n === 1 && e.d === 1;
  const isInt = (e) => isRat(e) && e.d === 1;
  const nadd = (a, b) => (isRat(a) && isRat(b) ? N(a.n * b.d + b.n * a.d, a.d * b.d) : F(val(a) + val(b)));
  const nmul = (a, b) => (isRat(a) && isRat(b) ? N(a.n * b.n, a.d * b.d) : F(val(a) * val(b)));
  const ninv = (a) => (isRat(a) ? N(a.d, a.n) : F(1 / val(a)));
  const nneg = (a) => (isRat(a) ? N(-a.n, a.d) : F(-a.f));
  const ndiv = (a, b) => nmul(a, ninv(b));

  const ZERO = N(0), ONE = N(1), NEG1 = N(-1), HALF = N(1, 2), TWO = N(2);
  const S = (s) => ({ t: 'sym', s });
  const PI = S('pi'), E = S('e');

  // ---------- keys & ordering ----------
  function key(e) {
    if (e._k) return e._k;
    let k;
    switch (e.t) {
      case 'num': k = e.f !== undefined ? 'f' + e.f : e.d === 1 ? '' + e.n : e.n + '/' + e.d; break;
      case 'sym': k = '$' + e.s; break;
      case 'add': k = '+(' + e.a.map(key).join(',') + ')'; break;
      case 'mul': k = '*(' + e.a.map(key).join(',') + ')'; break;
      case 'pow': k = '^(' + key(e.b) + ',' + key(e.e) + ')'; break;
      case 'fn': k = e.f + '(' + key(e.x) + ')'; break;
    }
    Object.defineProperty(e, '_k', { value: k, enumerable: false });
    return k;
  }
  const cmp = (a, b) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; };
  const eq = (a, b) => key(a) === key(b);

  // ---------- simplifying constructors ----------
  function splitCoef(t) {
    if (t.t === 'mul' && isNum(t.a[0])) return [t.a[0], t.a.length === 2 ? t.a[1] : { t: 'mul', a: t.a.slice(1) }];
    if (isNum(t)) return [t, ONE];
    return [ONE, t];
  }
  function withCoef(c, r) {
    if (isOne(r)) return c;
    if (isOne(c)) return r;
    if (isZero(c)) return ZERO;
    if (r.t === 'mul') return { t: 'mul', a: [c, ...r.a] };
    return { t: 'mul', a: [c, r] };
  }

  function add(...ts) {
    const flat = [];
    for (const t of ts) { if (t.t === 'add') flat.push(...t.a); else flat.push(t); }
    let c = ZERO;
    const map = new Map();
    for (const t of flat) {
      if (isNum(t)) { c = nadd(c, t); continue; }
      const [co, rest] = splitCoef(t);
      const k = key(rest);
      const m = map.get(k);
      if (m) m.c = nadd(m.c, co); else map.set(k, { r: rest, c: co });
    }
    const out = [];
    for (const { r, c: co } of map.values()) {
      if (isZero(co) || (!isRat(co) && Math.abs(val(co)) < 1e-13)) continue;
      out.push(withCoef(co, r));
    }
    if (!isZero(c)) out.push(c);
    if (!out.length) return ZERO;
    if (out.length === 1) return out[0];
    out.sort(cmp);
    return { t: 'add', a: out };
  }

  function mul(...fs) {
    const flat = [];
    for (const f of fs) { if (f.t === 'mul') flat.push(...f.a); else flat.push(f); }
    let c = ONE;
    const map = new Map();
    for (const f of flat) {
      if (isNum(f)) { c = nmul(c, f); continue; }
      let b = f, ex = ONE;
      if (f.t === 'pow') { b = f.b; ex = f.e; }
      const k = key(b);
      const m = map.get(k);
      if (m) m.e.push(ex); else map.set(k, { b, e: [ex] });
    }
    if (isZero(c)) return ZERO;
    const out = [], extra = [];
    for (const { b, e } of map.values()) {
      const p = pow(b, e.length === 1 ? e[0] : add(...e));
      if (isNum(p)) c = nmul(c, p);
      else if (p.t === 'mul') extra.push(p);
      else out.push(p);
    }
    if (extra.length) return mul(c, ...out, ...extra.flatMap((m) => m.a));
    if (isZero(c)) return ZERO;
    out.sort(cmp);
    if (!out.length) return c;
    // distribute a number over a single sum: 2(x+1) -> 2x + 2
    if (out.length === 1 && out[0].t === 'add' && !isOne(c)) return add(...out[0].a.map((t) => mul(c, t)));
    if (isOne(c)) return out.length === 1 ? out[0] : { t: 'mul', a: out };
    return { t: 'mul', a: [c, ...out] };
  }

  function intRoot(m, q) { // largest k with k^q | m, returns [k, rest]
    let k = 1, rest = m;
    for (let p = 2; Math.pow(p, q) <= rest && p < 2000; p++) {
      const pq = Math.pow(p, q);
      while (rest % pq === 0) { rest /= pq; k *= p; }
    }
    return [k, rest];
  }
  function numPow(b, e) {
    if (!isRat(b) || !isRat(e)) {
      const v = Math.pow(val(b), val(e));
      return F(v);
    }
    let p = e.n, q = e.d;
    if (b.n === 0) return p > 0 ? ZERO : F(Infinity);
    let bn = b.n, bd = b.d;
    if (p < 0) { p = -p; [bn, bd] = [bd, bn]; if (bd < 0) { bn = -bn; bd = -bd; } }
    if (q === 1) {
      const n = Math.pow(bn, p), d = Math.pow(bd, p);
      return N(n, d);
    }
    let sign = 1;
    if (bn < 0) { if (q % 2 === 0) return { t: 'pow', b, e }; sign = p % 2 ? -1 : 1; bn = -bn; }
    // (bn/bd)^(1/q) = (bn*bd^(q-1))^(1/q) / bd
    const m = bn * Math.pow(bd, q - 1);
    if (m > 1e12) return { t: 'pow', b, e };
    const [k, r] = intRoot(m, q);
    // result = (k/bd)^p * r^(p/q)
    const whole = Math.floor(p / q), frac = p % q;
    let coef = N(sign * Math.pow(k, p) * Math.pow(r, whole), Math.pow(bd, p));
    if (r === 1 || frac === 0) return coef;
    const g = gcd(frac, q);
    const rp = { t: 'pow', b: N(r), e: N(frac / g, q / g) };
    if (isOne(coef)) return rp;
    return { t: 'mul', a: [coef, rp] };
  }

  function pow(b, e) {
    if (isZero(e)) return ONE;
    if (isOne(e)) return b;
    if (isOne(b)) return ONE;
    if (isZero(b)) return isNum(e) && val(e) < 0 ? F(Infinity) : ZERO;
    if (isNum(b) && isNum(e)) return numPow(b, e);
    if (b.t === 'pow' && isInt(e)) return pow(b.b, mul(b.e, e));
    if (b.t === 'pow' && isRat(b.e) && isRat(e) && b.e.d % 2 === 1 && val(b.e) * val(e) !== 0 && b.e.n % 2 === 1) return pow(b.b, mul(b.e, e));
    if (b.t === 'mul' && isInt(e)) return mul(...b.a.map((f) => pow(f, e)));
    if (b.t === 'mul' && isNum(b.a[0]) && val(b.a[0]) > 0 && isNum(e)) {
      return mul(pow(b.a[0], e), pow(b.a.length === 2 ? b.a[1] : { t: 'mul', a: b.a.slice(1) }, e));
    }
    if (b.t === 'fn' && b.f === 'abs' && isInt(e) && e.n % 2 === 0) return pow(b.x, e);
    if (b.t === 'sym' && b.s === 'e') {
      if (e.t === 'fn' && e.f === 'ln') return stripAbsPos(e.x);
      if (e.t === 'mul' && e.a.length === 2 && isNum(e.a[0]) && e.a[1].t === 'fn' && e.a[1].f === 'ln') return pow(stripAbsPos(e.a[1].x), e.a[0]);
    }
    return { t: 'pow', b, e };
  }
  function stripAbsPos(x) { return x.t === 'fn' && x.f === 'abs' ? x.x : x; }

  // ----- exact trig values -----
  const sqrtN = (k) => pow(N(k), HALF);
  function piMultiple(x) { // x = c·π with rational c ?
    if (x.t === 'sym' && x.s === 'pi') return ONE;
    if (x.t === 'mul' && x.a.length === 2 && isRat(x.a[0]) && x.a[1].t === 'sym' && x.a[1].s === 'pi') return x.a[0];
    if (isZero(x)) return ZERO;
    return null;
  }
  function sinPi(c) { // sin(c·π) exact for denominators 1,2,3,4,6, else null
    let r = ((c.n % (2 * c.d)) + 2 * c.d) % (2 * c.d); // in [0, 2d)
    let sign = 1;
    if (r >= c.d) { r -= c.d; sign = -1; } // sin(t+π) = -sin t
    if (2 * r > c.d) r = c.d - r; // sin(π - t) = sin t
    const q = N(r, c.d);
    const tbl = { '0': ZERO, '1/6': HALF, '1/4': mul(HALF, sqrtN(2)), '1/3': mul(HALF, sqrtN(3)), '1/2': ONE };
    const v = tbl[key(q)];
    return v ? mul(N(sign), v) : null;
  }
  const INV_TABLE = {
    asin: [[0, ZERO], [0.5, N(1, 6)], [Math.SQRT1_2, N(1, 4)], [Math.sqrt(3) / 2, N(1, 3)], [1, N(1, 2)]],
    atan: [[0, ZERO], [1 / Math.sqrt(3), N(1, 6)], [1, N(1, 4)], [Math.sqrt(3), N(1, 3)]],
  };
  function invTrigExact(f, x) {
    if (!isConst(x)) return null;
    const v = evalN(x, {});
    if (!Number.isFinite(v)) {
      if (f === 'atan' && Math.abs(v) === Infinity) return mul(N(Math.sign(v), 2), PI);
      return null;
    }
    if (f === 'acos') { const s = invTrigExact('asin', x); return s ? add(mul(HALF, PI), mul(NEG1, s)) : null; }
    const tb = INV_TABLE[f];
    if (!tb) return null;
    for (const [t, c] of tb) if (Math.abs(Math.abs(v) - t) < 1e-12) return mul(N(Math.sign(v) || 1), c, PI);
    return null;
  }

  const ODD = new Set(['sin', 'tan', 'csc', 'cot', 'asin', 'atan', 'sinh', 'tanh', 'asinh', 'atanh', 'erf']);
  const EVEN = new Set(['cos', 'sec', 'cosh']);
  function fn(f, x) {
    if (f === 'ln') {
      if (isOne(x)) return ZERO;
      if (isZero(x)) return F(-Infinity);
      if (x.t === 'sym' && x.s === 'e') return ONE;
      if (x.t === 'pow' && x.b.t === 'sym' && x.b.s === 'e') return x.e;
      if (x.t === 'fn' && x.f === 'abs' && x.x.t === 'pow' && x.x.b.t === 'sym' && x.x.b.s === 'e') return x.x.e;
      if (isRat(x) && x.n > 0) {
        if (x.d !== 1) return add(fn('ln', N(x.n)), mul(NEG1, fn('ln', N(x.d))));
        for (let k = 6; k >= 2; k--) { const r = Math.round(Math.pow(x.n, 1 / k)); if (r > 1 && Math.pow(r, k) === x.n) return mul(N(k), fn('ln', N(r))); }
      }
      if (x.t === 'pow' && isRat(x.b) && val(x.b) > 0 && isNum(x.e)) return mul(x.e, fn('ln', x.b));
      // ln|u^n| = n ln|u|, ln(u^(p/q)) = (p/q) ln u for positive u
      const inner = x.t === 'fn' && x.f === 'abs' ? x.x : x;
      if (inner.t === 'pow' && isInt(inner.e) && !isNum(inner.b)) return mul(inner.e, fn('ln', fn('abs', inner.b)));
      if (inner.t === 'pow' && isRat(inner.e) && !isNum(inner.b) && isPos(inner.b)) return mul(inner.e, fn('ln', inner.b));
      if (isNum(x) && val(x) < 0) return F(NaN);
    }
    if (f === 'abs') {
      if (isNum(x)) return val(x) < 0 ? (isRat(x) ? N(-x.n, x.d) : F(-x.f)) : x;
      if (x.t === 'fn' && x.f === 'abs') return x;
      if (isPos(x)) return x;
      if (isConst(x)) { const v = evalN(x, {}); if (v < 0) return mul(NEG1, x); if (v > 0) return x; }
      const [c, r] = splitCoef(x);
      if (!isOne(c)) return mul(fn('abs', c), fn('abs', r));
      if (x.t === 'mul') { // |a·b| with a > 0
        const pos = x.a.filter(isPos), rest = x.a.filter((t) => !isPos(t));
        if (pos.length && rest.length) return mul(...pos, fn('abs', rest.length === 1 ? rest[0] : { t: 'mul', a: rest }));
      }
    }
    if (ODD.has(f) || EVEN.has(f)) {
      const [c] = splitCoef(x);
      if ((x.t === 'mul' && isNum(c) && val(c) < 0) || (isNum(x) && val(x) < 0)) {
        const inner = fn(f, mul(NEG1, x));
        return ODD.has(f) ? mul(NEG1, inner) : inner;
      }
    }
    const c = piMultiple(x);
    if (c && isRat(c)) {
      const s = (cc) => sinPi(cc), co = (cc) => sinPi(nadd(cc, HALF));
      let v = null;
      if (f === 'sin') v = s(c);
      else if (f === 'cos') v = co(c);
      else if (f === 'tan' || f === 'sec' || f === 'csc' || f === 'cot') {
        const sv = s(c), cv = co(c);
        if (sv && cv) {
          const num = { tan: sv, sec: ONE, csc: ONE, cot: cv }[f], den = { tan: cv, sec: cv, csc: sv, cot: sv }[f];
          if (!isZero(den)) v = mul(num, pow(den, NEG1));
        }
      }
      if (v) return v;
    }
    if (isZero(x)) {
      const z = { sin: ZERO, tan: ZERO, sinh: ZERO, tanh: ZERO, asin: ZERO, atan: ZERO, erf: ZERO, asinh: ZERO, atanh: ZERO, cos: ONE, sec: ONE, cosh: ONE, acos: mul(HALF, PI) }[f];
      if (z) return z;
    }
    if (isNum(x) && isRat(x) && x.n === 1 && x.d === 1 && f === 'acosh') return ZERO;
    if (f === 'asin' || f === 'acos' || f === 'atan') { const v = invTrigExact(f, x); if (v) return v; }
    if (isNum(x) && !isRat(x)) return F(evalN({ t: 'fn', f, x }, {}));
    return { t: 'fn', f, x };
  }

  // ---------- predicates ----------
  function has(e, s) {
    switch (e.t) {
      case 'num': return false;
      case 'sym': return e.s === s;
      case 'add': case 'mul': return e.a.some((t) => has(t, s));
      case 'pow': return has(e.b, s) || has(e.e, s);
      case 'fn': return has(e.x, s);
    }
    return false;
  }
  function syms(e, out = new Set()) {
    if (e.t === 'sym') out.add(e.s);
    else if (e.t === 'add' || e.t === 'mul') e.a.forEach((t) => syms(t, out));
    else if (e.t === 'pow') { syms(e.b, out); syms(e.e, out); }
    else if (e.t === 'fn') syms(e.x, out);
    return out;
  }
  function isConst(e) { for (const s of syms(e)) if (s !== 'pi' && s !== 'e') return false; return true; }
  // conservative sign tests (true only when certain)
  function isNonneg(e) {
    if (isNum(e)) return val(e) >= 0;
    if (e.t === 'sym') return e.s === 'pi' || e.s === 'e';
    if (e.t === 'pow') {
      if (isInt(e.e) && e.e.n % 2 === 0) return true;
      if (e.b.t === 'sym' && e.b.s === 'e') return true;
      if (isRat(e.e) && e.e.d % 2 === 0) return true; // principal root
      return isNonneg(e.b);
    }
    if (e.t === 'fn') return e.f === 'abs' || e.f === 'cosh';
    if (e.t === 'mul') return e.a.every(isNonneg);
    if (e.t === 'add') return e.a.every(isNonneg);
    return false;
  }
  function isPos(e) {
    if (isNum(e)) return val(e) > 0;
    if (e.t === 'sym') return e.s === 'pi' || e.s === 'e';
    if (e.t === 'pow') return (e.b.t === 'sym' && e.b.s === 'e') || isPos(e.b);
    if (e.t === 'fn') return e.f === 'cosh';
    if (e.t === 'mul') return e.a.every(isPos);
    if (e.t === 'add') {
      if (e.a.every(isNonneg) && e.a.some(isPos)) return true;
      // quadratic with no real roots and positive leading coefficient
      const vs = [...syms(e)].filter((s) => s !== 'pi' && s !== 'e');
      if (vs.length === 1) {
        const p = toPoly(e, vs[0]);
        if (p && p.length === 3) {
          const [c0, b, a] = p.map(val);
          if (a > 0 && b * b - 4 * a * c0 < 0) return true;
        }
      }
    }
    return false;
  }

  // ---------- substitution ----------
  function rebuild(e, f) {
    switch (e.t) {
      case 'add': return add(...e.a.map(f));
      case 'mul': return mul(...e.a.map(f));
      case 'pow': return pow(f(e.b), f(e.e));
      case 'fn': return fn(e.f, f(e.x));
    }
    return e;
  }
  // replace every occurrence of `target` with `repl`; powers of the target are matched too
  function subs(e, target, repl) {
    const tk = key(target);
    const go = (n) => {
      if (key(n) === tk) return repl;
      if (n.t === 'pow' && target.t === 'pow' && eq(n.b, target.b)) {
        const r = mul(n.e, pow(target.e, NEG1));
        if (isInt(r)) return pow(repl, r);
      }
      if (n.t === 'pow' && target.t !== 'pow' && target.t !== 'num' && eq(n.b, target)) return pow(repl, go(n.e));
      if (n.t === 'num') return n;
      if (n.t === 'sym') return n;
      return rebuild(n, go);
    };
    return go(e);
  }
  const subsVar = (e, s, repl) => subs(e, S(s), repl);

  // ---------- calculus ----------
  const sub = (a, b) => add(a, mul(NEG1, b));
  const div = (a, b) => mul(a, pow(b, NEG1));
  function diff(e, x) {
    if (!has(e, x)) return ZERO;
    switch (e.t) {
      case 'sym': return ONE;
      case 'add': return add(...e.a.map((t) => diff(t, x)));
      case 'mul': {
        const parts = [];
        e.a.forEach((f, i) => { if (has(f, x)) parts.push(mul(...e.a.map((g, j) => (i === j ? diff(f, x) : g)))); });
        return add(...parts);
      }
      case 'pow': {
        const { b, e: p } = e;
        if (!has(p, x)) return mul(p, pow(b, sub(p, ONE)), diff(b, x));
        if (!has(b, x)) return mul(e, fn('ln', b), diff(p, x));
        return mul(e, add(mul(diff(p, x), fn('ln', b)), mul(p, diff(b, x), pow(b, NEG1))));
      }
      case 'fn': {
        const u = e.x, du = diff(u, x);
        const d = derivFn(e.f, u);
        return mul(d, du);
      }
    }
    return ZERO;
  }
  function derivFn(f, u) {
    switch (f) {
      case 'sin': return fn('cos', u);
      case 'cos': return mul(NEG1, fn('sin', u));
      case 'tan': return pow(fn('sec', u), TWO);
      case 'sec': return mul(fn('sec', u), fn('tan', u));
      case 'csc': return mul(NEG1, fn('csc', u), fn('cot', u));
      case 'cot': return mul(NEG1, pow(fn('csc', u), TWO));
      case 'ln': return u.t === 'fn' && u.f === 'abs' ? ONE : pow(u, NEG1); // handled specially below
      case 'abs': return mul(u, pow(fn('abs', u), NEG1));
      case 'asin': return pow(sub(ONE, pow(u, TWO)), N(-1, 2));
      case 'acos': return mul(NEG1, pow(sub(ONE, pow(u, TWO)), N(-1, 2)));
      case 'atan': return pow(add(ONE, pow(u, TWO)), NEG1);
      case 'sinh': return fn('cosh', u);
      case 'cosh': return fn('sinh', u);
      case 'tanh': return pow(fn('cosh', u), N(-2));
      case 'asinh': return pow(add(pow(u, TWO), ONE), N(-1, 2));
      case 'acosh': return pow(sub(pow(u, TWO), ONE), N(-1, 2));
      case 'atanh': return pow(sub(ONE, pow(u, TWO)), NEG1);
      case 'erf': return mul(TWO, pow(PI, N(-1, 2)), pow(E, mul(NEG1, pow(u, TWO))));
    }
    throw new Error('no derivative for ' + f);
  }
  // d/dx ln|u| = u'/u : patch diff for ln(abs(u))
  const _diff = diff;
  function diffFull(e, x) {
    if (!has(e, x)) return ZERO;
    if (e.t === 'fn' && e.f === 'ln') {
      const u = e.x.t === 'fn' && e.x.f === 'abs' ? e.x.x : e.x;
      return mul(diffFull(u, x), pow(u, NEG1));
    }
    switch (e.t) {
      case 'add': return add(...e.a.map((t) => diffFull(t, x)));
      case 'mul': {
        const parts = [];
        e.a.forEach((f, i) => { if (has(f, x)) parts.push(mul(...e.a.map((g, j) => (i === j ? diffFull(f, x) : g)))); });
        return add(...parts);
      }
      case 'pow': {
        const { b, e: p } = e;
        if (!has(p, x)) return mul(p, pow(b, sub(p, ONE)), diffFull(b, x));
        if (!has(b, x)) return mul(e, fn('ln', b), diffFull(p, x));
        return mul(e, add(mul(diffFull(p, x), fn('ln', b)), mul(p, diffFull(b, x), pow(b, NEG1))));
      }
      case 'fn': return mul(derivFn(e.f, e.x), diffFull(e.x, x));
    }
    return _diff(e, x);
  }

  // ---------- expansion ----------
  // multiply two expressions term by term (never re-forms a power of a sum)
  function distribute(A, B) {
    const as = A.t === 'add' ? A.a : [A], bs = B.t === 'add' ? B.a : [B];
    const out = [];
    for (const a of as) for (const b of bs) {
      const p = mul(a, b);
      out.push(p.t === 'add' || p.t === 'pow' && p.b.t === 'add' && isInt(p.e) && p.e.n > 1 ? expand(p) : p);
    }
    return add(...out);
  }
  function expand(e) {
    switch (e.t) {
      case 'add': return add(...e.a.map(expand));
      case 'mul': {
        let acc = ONE;
        for (const f0 of e.a) {
          acc = distribute(acc, expand(f0));
          if (acc.t === 'add' && acc.a.length > 400) return e;
        }
        return acc;
      }
      case 'pow': {
        const b = expand(e.b);
        if (b.t === 'add' && isInt(e.e) && e.e.n > 1 && e.e.n <= 12) {
          let r = b;
          for (let i = 1; i < e.e.n; i++) r = distribute(r, b);
          return r;
        }
        return pow(b, expand(e.e));
      }
      case 'fn': return fn(e.f, expand(e.x));
    }
    return e;
  }
  // expand only the bases of powers (keeps structure otherwise)
  function expandBases(e) {
    if (e.t === 'pow') return pow(expand(expandBases(e.b)), expandBases(e.e));
    if (e.t === 'num' || e.t === 'sym') return e;
    return rebuild(e, expandBases);
  }

  // ---------- polynomials (arrays of rational nums, index = degree) ----------
  function toPoly(e, x) {
    e = expand(e);
    const terms = e.t === 'add' ? e.a : [e];
    const p = [];
    for (const t of terms) {
      const [c, r] = splitCoef(t);
      if (!isRat(c)) return null;
      let d;
      if (isOne(r)) d = 0;
      else if (r.t === 'sym' && r.s === x) d = 1;
      else if (r.t === 'pow' && r.b.t === 'sym' && r.b.s === x && isInt(r.e) && r.e.n > 0) d = r.e.n;
      else return null;
      p[d] = p[d] ? nadd(p[d], c) : c;
    }
    for (let i = 0; i < p.length; i++) if (!p[i]) p[i] = ZERO;
    return ptrim(p);
  }
  function ptrim(p) { p = p.slice(); while (p.length && isZero(p[p.length - 1])) p.pop(); return p; }
  const pdeg = (p) => p.length - 1;
  function fromPoly(p, x) { return add(...p.map((c, i) => mul(c, pow(S(x), N(i))))); }
  function padd(a, b) { const r = []; for (let i = 0; i < Math.max(a.length, b.length); i++) r[i] = nadd(a[i] || ZERO, b[i] || ZERO); return ptrim(r); }
  function pscale(a, c) { return ptrim(a.map((t) => nmul(t, c))); }
  function pmul(a, b) {
    if (!a.length || !b.length) return [];
    const r = new Array(a.length + b.length - 1).fill(ZERO);
    a.forEach((x, i) => b.forEach((y, j) => { r[i + j] = nadd(r[i + j], nmul(x, y)); }));
    return ptrim(r);
  }
  function pdivmod(a, b) {
    let r = a.slice(); const q = [];
    const db = pdeg(b), lb = b[db];
    while (r.length && pdeg(r) >= db) {
      const k = pdeg(r) - db, c = ndiv(r[pdeg(r)], lb);
      q[k] = c;
      for (let i = 0; i <= db; i++) r[i + k] = nadd(r[i + k], nneg(nmul(c, b[i])));
      r = ptrim(r);
      if (r.length > a.length) break;
    }
    for (let i = 0; i < q.length; i++) if (!q[i]) q[i] = ZERO;
    return [ptrim(q), r];
  }
  function peval(p, v) { let s = ZERO; for (let i = p.length - 1; i >= 0; i--) s = nadd(nmul(s, v), p[i]); return s; }
  function divisors(n) {
    n = Math.abs(n); const out = [];
    if (n > 1e7) return [1];
    for (let i = 1; i * i <= n; i++) if (n % i === 0) { out.push(i); if (i * i !== n) out.push(n / i); }
    return out;
  }
  // rational roots with multiplicities; returns {roots:[{r, m}], rest}
  function rationalRoots(p) {
    const roots = [];
    let rest = p.slice();
    if (!rest.every(isRat)) return { roots, rest };
    while (rest.length > 1 && isZero(rest[0])) { rest = rest.slice(1); const f = roots.find((t) => isZero(t.r)); if (f) f.m++; else roots.push({ r: ZERO, m: 1 }); }
    const ints = () => { let l = 1; for (const c of rest) l = l * c.d / gcd(l, c.d); return rest.map((c) => c.n * (l / c.d)); };
    let changed = true;
    while (changed && rest.length > 2) {
      changed = false;
      const ic = ints();
      const a0 = ic[0], an = ic[ic.length - 1];
      for (const pp of divisors(a0)) {
        for (const qq of divisors(an)) {
          for (const s of [1, -1]) {
            const r = N(s * pp, qq);
            if (isZero(peval(rest, r))) {
              const [q] = pdivmod(rest, [nneg(r), ONE]);
              rest = q;
              const f = roots.find((t) => eq(t.r, r));
              if (f) f.m++; else roots.push({ r, m: 1 });
              changed = true;
              break;
            }
          }
          if (changed) break;
        }
        if (changed) break;
      }
    }
    if (rest.length === 2) { // linear leftover
      const r = ndiv(nneg(rest[0]), rest[1]);
      const f = roots.find((t) => eq(t.r, r));
      if (f) f.m++; else roots.push({ r, m: 1 });
      rest = [rest[1]];
    }
    return { roots, rest };
  }

  // ---------- numeric evaluation ----------
  function erf(x) {
    const ax = Math.abs(x);
    if (ax < 2.5) {
      let sum = x, term = x, n = 0;
      while (Math.abs(term) > 1e-17 * Math.abs(sum) && n < 200) { n++; term *= -x * x / n; sum += term / (2 * n + 1); }
      return 2 / Math.sqrt(Math.PI) * sum;
    }
    if (ax > 6) return Math.sign(x);
    let f = 0;
    for (let k = 60; k >= 1; k--) f = (k / 2) / (ax + f);
    const erfc = Math.exp(-ax * ax) / Math.sqrt(Math.PI) / (ax + f);
    return Math.sign(x) * (1 - erfc);
  }
  function evalN(e, env) {
    switch (e.t) {
      case 'num': return val(e);
      case 'sym': if (e.s === 'pi') return Math.PI; if (e.s === 'e') return Math.E; return e.s in env ? env[e.s] : NaN;
      case 'add': { let s = 0; for (const t of e.a) s += evalN(t, env); return s; }
      case 'mul': { let p = 1; for (const t of e.a) p *= evalN(t, env); return p; }
      case 'pow': {
        const b = evalN(e.b, env), p = evalN(e.e, env);
        if (b < 0 && isRat(e.e) && e.e.d % 2 === 1) return (e.e.n % 2 ? -1 : 1) * Math.pow(-b, p);
        if (b === 0 && p < 0) return Infinity;
        return Math.pow(b, p);
      }
      case 'fn': {
        const v = evalN(e.x, env);
        switch (e.f) {
          case 'sin': return Math.sin(v); case 'cos': return Math.cos(v); case 'tan': return Math.tan(v);
          case 'sec': return 1 / Math.cos(v); case 'csc': return 1 / Math.sin(v); case 'cot': return 1 / Math.tan(v);
          case 'asin': return Math.asin(v); case 'acos': return Math.acos(v); case 'atan': return Math.atan(v);
          case 'sinh': return Math.sinh(v); case 'cosh': return Math.cosh(v); case 'tanh': return Math.tanh(v);
          case 'asinh': return Math.asinh(v); case 'acosh': return Math.acosh(v); case 'atanh': return Math.atanh(v);
          case 'ln': return v < 0 ? NaN : Math.log(v);
          case 'abs': return Math.abs(v);
          case 'erf': return erf(v);
        }
      }
    }
    return NaN;
  }
  function size(e) {
    switch (e.t) {
      case 'add': case 'mul': return 1 + e.a.reduce((s, t) => s + size(t), 0);
      case 'pow': return 1 + size(e.b) + size(e.e);
      case 'fn': return 1 + size(e.x);
    }
    return 1;
  }

  // ---------- number formatting ----------
  function fmtNum(v, sig = 6) {
    if (Number.isNaN(v)) return 'undefined';
    if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
    if (Math.abs(v) < 1e-12) return '0';
    let s = Number(v.toPrecision(sig)).toString();
    if (/e/.test(s)) {
      const [m, ex] = v.toExponential(sig - 1).split('e');
      s = String(Number(m)) + ' × 10^' + Number(ex);
    }
    return s;
  }

  // ---------- LaTeX output ----------
  const FN_TEX = {
    sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc', cot: '\\cot',
    asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan', sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh',
    asinh: '\\operatorname{arsinh}', acosh: '\\operatorname{arcosh}', atanh: '\\operatorname{artanh}', ln: '\\ln', erf: '\\operatorname{erf}',
  };
  const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh']);
  const GREEK_TEX = { pi: '\\pi', theta: '\\theta', alpha: '\\alpha', beta: '\\beta', phi: '\\phi', lambda: '\\lambda', mu: '\\mu', omega: '\\omega', sigma: '\\sigma', tau: '\\tau', rho: '\\rho' };
  const GREEK_TXT = { pi: 'π', theta: 'θ', alpha: 'α', beta: 'β', phi: 'φ', lambda: 'λ', mu: 'μ', omega: 'ω' };
  const isNeg = (e) => (isNum(e) ? val(e) < 0 : e.t === 'mul' && isNum(e.a[0]) && val(e.a[0]) < 0);
  const neg = (e) => mul(NEG1, e);

  function numTex(e) {
    if (!isRat(e)) return fmtNum(e.f).replace('∞', '\\infty').replace('−', '-').replace(' × 10^', '\\times 10^{').replace(/(\{-?\d+)$/, '$1}');
    if (e.d === 1) return String(e.n);
    return (e.n < 0 ? '-' : '') + '\\frac{' + Math.abs(e.n) + '}{' + e.d + '}';
  }
  function symTex(s) {
    if (GREEK_TEX[s]) return GREEK_TEX[s];
    if (s.startsWith('__I')) return 'I';
    const m = /^([A-Za-z]+)_?(\d+)$/.exec(s);
    if (m) return m[1] + '_{' + m[2] + '}';
    return s;
  }
  function polyDeg(t, v) { // degree if t = c·v^n (c may contain other letters, as in a x²/2), else null
    let [, r] = splitCoef(t);
    if (r.t === 'mul') {
      const withV = r.a.filter((f) => has(f, v));
      if (withV.length === 1) r = withV[0];
    }
    if (isOne(r)) return 0;
    if (r.t === 'sym' && r.s === v) return 1;
    if (r.t === 'pow' && r.b.t === 'sym' && r.b.s === v && isNum(r.e)) return val(r.e);
    return null;
  }
  function orderTerms(ts, v) {
    const poly = [], other = [], cons = [];
    for (const t of ts) {
      if (!has(t, v)) cons.push(t);
      else { const d = polyDeg(t, v); if (d !== null) poly.push([d, t]); else other.push(t); }
    }
    poly.sort((a, b) => b[0] - a[0]);
    const out = [...poly.map((p) => p[1]), ...other, ...cons];
    if (out.length > 1 && isNeg(out[0])) {
      const i = out.findIndex((t) => !isNeg(t));
      if (i > 0) out.unshift(out.splice(i, 1)[0]);
    }
    return out;
  }
  function factorRank(f, v) {
    if (isNum(f)) return 0;
    if (!has(f, v)) return f.t === 'pow' && isNum(f.b) ? 0.5 : 0.6;
    if (f.t === 'sym') return 1;
    if (f.t === 'pow' && f.b.t === 'sym' && f.b.s === v) return 1;
    if (f.t === 'pow' && f.b.t === 'add') return 2;
    if (f.t === 'add') return 2;
    if (f.t === 'pow' && (isNum(f.b) || (f.b.t === 'sym' && f.b.s === 'e'))) return 3;
    if (f.t === 'fn' || f.t === 'pow') return 4;
    return 5;
  }
  function orderFactors(fs, v) {
    return fs.map((f, i) => [factorRank(f, v), i, f]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((a) => a[2]);
  }

  function tex(e, v = 'x') {
    switch (e.t) {
      case 'num': return numTex(e);
      case 'sym': return symTex(e.s);
      case 'add': {
        const ts = orderTerms(e.a, v);
        let s = '';
        ts.forEach((t, i) => {
          if (i === 0) s += tex(t, v);
          else if (isNeg(t)) s += ' - ' + tex(neg(t), v);
          else s += ' + ' + tex(t, v);
        });
        return s;
      }
      case 'mul': return mulTex(e.a, v);
      case 'pow': {
        if (isNum(e.e) && val(e.e) < 0) return mulTex([e], v);
        if (isRat(e.e) && e.e.n === 1 && e.e.d === 2) return '\\sqrt{' + combinedTex(e.b, v) + '}';
        if (isRat(e.e) && e.e.n === 1 && e.e.d === 3) return '\\sqrt[3]{' + tex(e.b, v) + '}';
        if (e.b.t === 'fn' && TRIG.has(e.b.f) && isInt(e.e) && e.e.n > 0) return FN_TEX[e.b.f] + '^{' + e.e.n + '}' + fnArg(e.b.x, v);
        let base = tex(e.b, v);
        const bt = e.b.t;
        if (bt === 'add' || bt === 'mul' || bt === 'pow' || bt === 'fn' || (isNum(e.b) && (val(e.b) < 0 || (isRat(e.b) && e.b.d !== 1)))) base = '\\left(' + base + '\\right)';
        const ex = isRat(e.e) && e.e.d !== 1 ? (e.e.n < 0 ? '-' : '') + Math.abs(e.e.n) + '/' + e.e.d : tex(e.e, v);
        return base + '^{' + ex + '}';
      }
      case 'fn': {
        if (e.f === 'abs') return '\\left|' + tex(e.x, v) + '\\right|';
        if (e.f === 'ln' && e.x.t === 'fn' && e.x.f === 'abs') return '\\ln\\left|' + tex(e.x.x, v) + '\\right|';
        return FN_TEX[e.f] + fnArg(e.x, v);
      }
    }
    return '?';
  }
  function fnArg(x, v) {
    if (x.t === 'sym' || (isRat(x) && x.d === 1 && x.n >= 0)) return ' ' + tex(x, v);
    return '\\left(' + combinedTex(x, v) + '\\right)';
  }
  // x/3 + 2/3 -> (x + 2)/3 inside function arguments and roots
  function combinedTex(e, v) {
    if (e.t === 'add') {
      let L = 1;
      for (const t of e.a) { const [c] = splitCoef(t); if (!isRat(c)) return tex(e, v); L = L * c.d / gcd(L, c.d); }
      if (L > 1 && L < 1000) return '\\frac{' + tex(add(...e.a.map((t) => mul(N(L), t))), v) + '}{' + L + '}';
    }
    return tex(e, v);
  }
  function needsParenInProduct(f) { return f.t === 'add' || (isNum(f) && val(f) < 0); }
  function joinFactors(coefStr, fs, v) {
    let s = coefStr;
    for (const f of fs) {
      let t = tex(f, v);
      if (needsParenInProduct(f) && (fs.length > 1 || coefStr)) t = '\\left(' + t + '\\right)';
      if (s && (/^[\d.]/.test(t) || (/\d$/.test(s) && /^\\frac/.test(t)))) s += ' \\cdot ' + t;
      else s += (s && /[a-zA-Z}]$/.test(s) && /^[a-zA-Z]/.test(t) ? ' ' : '') + t;
    }
    return s;
  }
  function mulTex(fs, v) {
    let c = ONE;
    const nu = [], de = [];
    for (const f of fs) {
      if (isNum(f)) { c = nmul(c, f); continue; }
      if (f.t === 'pow' && isNum(f.e) && val(f.e) < 0) de.push(pow(f.b, nneg(f.e)));
      else nu.push(f);
    }
    let sign = '';
    if (val(c) < 0) { sign = '-'; c = nneg(c); }
    const cn = isRat(c) ? c.n : null, cd = isRat(c) ? c.d : 1;
    const cnStr = isRat(c) ? (cn === 1 && nu.length ? '' : String(cn)) : numTex(c);
    const top = joinFactors(cnStr, orderFactors(nu, v), v) || '1';
    if (!de.length && cd === 1) return sign + top;
    const deo = orderFactors(de, v);
    let bot;
    if (deo.length === 1 && cd === 1) bot = tex(deo[0], v);
    else bot = joinFactors(cd === 1 ? '' : String(cd), deo, v);
    return sign + '\\frac{' + top + '}{' + bot + '}';
  }

  // ---------- plain text output (re-parsable) ----------
  const FN_TXT = { asin: 'arcsin', acos: 'arccos', atan: 'arctan', asinh: 'arsinh', acosh: 'arcosh', atanh: 'artanh' };
  function txt(e, v = 'x') {
    switch (e.t) {
      case 'num': {
        if (!isRat(e)) return fmtNum(e.f, 10).replace(' × 10^', 'e');
        return e.d === 1 ? String(e.n) : e.n + '/' + e.d;
      }
      case 'sym': return GREEK_TXT[e.s] || (e.s.startsWith('__I') ? 'I' : e.s);
      case 'add': {
        const ts = orderTerms(e.a, v);
        let s = '';
        ts.forEach((t, i) => {
          if (i === 0) s += txt(t, v);
          else if (isNeg(t)) s += ' - ' + txt(neg(t), v);
          else s += ' + ' + txt(t, v);
        });
        return s;
      }
      case 'mul': return mulTxt(e.a, v);
      case 'pow': {
        if (isNum(e.e) && val(e.e) < 0) return mulTxt([e], v);
        if (isRat(e.e) && e.e.n === 1 && e.e.d === 2) return 'sqrt(' + txt(e.b, v) + ')';
        let base = txt(e.b, v);
        if (e.b.t !== 'sym' && e.b.t !== 'fn' && !(isRat(e.b) && e.b.d === 1 && e.b.n >= 0)) base = '(' + base + ')';
        const ex = isRat(e.e) ? (e.e.d === 1 ? String(e.e.n) : '(' + e.e.n + '/' + e.e.d + ')') : (e.e.t === 'sym' ? txt(e.e, v) : '(' + txt(e.e, v) + ')');
        return base + '^' + ex;
      }
      case 'fn': {
        if (e.f === 'abs') return '|' + txt(e.x, v) + '|';
        if (e.f === 'ln' && e.x.t === 'fn' && e.x.f === 'abs') return 'ln|' + txt(e.x.x, v) + '|';
        return (FN_TXT[e.f] || e.f) + '(' + txt(e.x, v) + ')';
      }
    }
    return '?';
  }
  function factorTxt(f, v) {
    const t = txt(f, v);
    return f.t === 'add' || (isNum(f) && val(f) < 0) ? '(' + t + ')' : t;
  }
  function mulTxt(fs, v) {
    let c = ONE;
    const nu = [], de = [];
    for (const f of fs) {
      if (isNum(f)) { c = nmul(c, f); continue; }
      if (f.t === 'pow' && isNum(f.e) && val(f.e) < 0) de.push(pow(f.b, nneg(f.e)));
      else nu.push(f);
    }
    let sign = '';
    if (val(c) < 0) { sign = '-'; c = nneg(c); }
    const cd = isRat(c) ? c.d : 1;
    const parts = [];
    if (!isRat(c)) parts.push(txt(c, v));
    else if (c.n !== 1 || !nu.length) parts.push(String(c.n));
    for (const f of orderFactors(nu, v)) parts.push(factorTxt(f, v));
    const joinT = (ps) => {
      let s = '';
      ps.forEach((p, i) => {
        if (i === 0) s = p;
        else if (/^\d/.test(p)) s += '*' + p;
        else if (/^\d+$/.test(s) && i === 1) s += p;
        else s += ' ' + p;
      });
      return s;
    };
    const top = joinT(parts);
    if (!de.length && cd === 1) return sign + top;
    const deo = orderFactors(de, v);
    const dparts = [];
    if (cd !== 1) dparts.push(String(cd));
    for (const f of deo) dparts.push(factorTxt(f, v));
    let bot = joinT(dparts);
    if (dparts.length > 1 || /[+\-*/^ ]/.test(bot.replace(/^\(.*\)$/, ''))) bot = '(' + bot + ')';
    return sign + top + '/' + bot;
  }

  G.CAS = {
    N, F, S, PI, E, ZERO, ONE, NEG1, HALF, TWO, isNum, isRat, isInt, val, isZero, isOne,
    nadd, nmul, ndiv, nneg, ninv, gcd,
    key, eq, add, mul, pow, fn, sub, div, neg, isNeg, splitCoef, has, syms, isConst, isPos, isNonneg,
    subs, subsVar, diff: diffFull, expand, expandBases, rebuild, sqrtN,
    toPoly, fromPoly, padd, pmul, pscale, pdivmod, pdeg, peval, ptrim, rationalRoots,
    evalN, erf, size, fmtNum, tex, txt, orderTerms, symTex, symTxt: (s) => GREEK_TXT[s] || s,
  };
})(typeof window !== 'undefined' ? window : globalThis);
