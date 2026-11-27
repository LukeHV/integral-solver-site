/* integrate.js — rule-based symbolic integration that records its working.
 * Each rule returns { F, step } where step = { rule, items:[{p}|{m}|{s}] }:
 *   p = a sentence (inline maths in $…$), m = a display line of LaTeX, s = a nested step. */
(function (G) {
  'use strict';
  const C = G.CAS;
  const {
    N, S, E, PI, ZERO, ONE, NEG1, HALF, TWO, add, mul, pow, fn, sub, div, neg, has, subs, subsVar, diff, expand, expandBases,
    key, eq, isNum, isRat, isInt, val, isZero, isOne, toPoly, fromPoly, pdivmod, pdeg, pmul, rationalRoots, size,
    nadd, nmul, ndiv, nneg, syms,
  } = C;

  class Timeout extends Error {}

  // ---------- presentation helpers ----------
  const dvar = (x) => C.symTex(x);
  const T = (e, x) => C.tex(e, x);
  const P = (p) => ({ p });
  const M = (m) => ({ m });
  const K = (s) => (s ? { s } : null);
  function step(rule, ...items) { return { rule, items: items.filter(Boolean) }; }
  function intTex(f, x) {
    const t = T(f, x);
    return '\\int ' + (f.t === 'add' ? '\\left(' + t + '\\right)' : t) + '\\,d' + dvar(x);
  }
  const par = (e, x) => (e.t === 'add' || C.isNeg(e) ? '\\left(' + T(e, x) + '\\right)' : T(e, x));
  function coefTex(c, x) {
    if (isNum(c) && val(c) === -1) return '-';
    if (isOne(c)) return '';
    if (c.t === 'add') return '\\left(' + T(c, x) + '\\right)';
    const t = T(c, x);
    return t + (/\d$/.test(t) ? ' ' : '');
  }
  const isX = (e, x) => e.t === 'sym' && e.s === x;
  const absN = (q) => (val(q) < 0 ? nneg(q) : q);
  const hasJ = (e) => [...syms(e)].some((s) => s.startsWith('__I'));
  function isLinear(L, x) {
    if (!has(L, x)) return false;
    const d = diff(L, x);
    return !has(d, x) && !isZero(d);
  }
  const isSimple = (st) => st && !st.items.some((i) => i.s) && st.items.filter((i) => i.m).length <= 1;

  // ---------- driver ----------
  function integrate(f, x, opts = {}) {
    const ctx = {
      calls: 0, t0: Date.now(), limit: opts.limitMs || 4000, depth: 0, stack: new Set(), memo: new Map(),
      cyc: [], jid: 0, parts: 0, used: new Set([...syms(f), x]), explainedParts: false,
    };
    try {
      return I(f, x, ctx);
    } catch (e) {
      if (e instanceof Timeout) return { timeout: true };
      throw e;
    }
  }

  function I(f, x, ctx) {
    if (++ctx.calls > 8000 || Date.now() - ctx.t0 > ctx.limit) throw new Timeout();
    for (let i = ctx.cyc.length - 1; i >= 0; i--) {
      const cy = ctx.cyc[i];
      if (cy.x !== x) continue;
      const r = div(f, cy.f);
      if (!has(r, x) && !hasJ(r) && C.isConst(r) && isFinite(C.evalN(r, {}))) {
        const F = mul(r, cy.J);
        return { F, step: step('Original integral', P(`This is the integral $I$ we started with${isOne(r) ? '' : isNum(r) && val(r) === -1 ? ', with a minus sign' : `, multiplied by $${T(r, x)}$`}.`), M(`${intTex(f, x)} = ${T(F, x)}`)) };
      }
    }
    const k = key(f) + '|' + x;
    const m = ctx.memo.get(k);
    if (m) return m;
    if (ctx.stack.has(k) || ctx.depth > 20) return null;
    ctx.stack.add(k); ctx.depth++;
    try {
      for (const R of RULES) {
        const r = R(f, x, ctx);
        if (r) { if (!hasJ(r.F)) ctx.memo.set(k, r); return r; }
      }
      return null;
    } finally { ctx.stack.delete(k); ctx.depth--; }
  }

  function fresh(ctx, prefer) {
    for (const n of prefer || ['u', 'v', 'w', 's', 'p', 'q', 'r']) if (!ctx.used.has(n)) { ctx.used.add(n); return n; }
    for (let i = 1; ; i++) { const n = 'u' + i; if (!ctx.used.has(n)) { ctx.used.add(n); return n; } }
  }

  // ---------- 1. constants ----------
  function rConst(f, x) {
    if (has(f, x)) return null;
    const F = mul(f, S(x));
    return { F, step: step('Constant rule', P(`The integrand does not depend on $${dvar(x)}$, so it integrates to itself times $${dvar(x)}$.`), M(`${intTex(f, x)} = ${T(F, x)}`)) };
  }

  // ---------- 2. table of standard integrals ----------
  function table(f, x) {
    const X = S(x), v = dvar(x);
    const fx = (e, name) => e.t === 'fn' && e.f === name && isX(e.x, x);
    const pw = (e, name, n) => e.t === 'pow' && isInt(e.e) && e.e.n === n && fx(e.b, name);
    const R = (F, rule, text, formula) => ({ F, rule, text, formula });
    if (isX(f, x)) return R(mul(HALF, pow(X, TWO)), 'Power rule', 'Raise the power by one and divide by the new power.', `\\int ${v}\\,d${v} = \\frac{${v}^{2}}{2}`);
    if (f.t === 'pow' && isX(f.b, x) && !has(f.e, x)) {
      if (isNum(f.e) && val(f.e) === -1) return R(fn('ln', fn('abs', X)), 'Standard integral', `The power rule fails for $${v}^{-1}$; its integral is the natural logarithm.`, `\\int \\frac{1}{${v}}\\,d${v} = \\ln\\left|${v}\\right|`);
      const n1 = add(f.e, ONE);
      return R(mul(pow(X, n1), pow(n1, NEG1)), 'Power rule', 'Raise the power by one and divide by the new power.', `\\int ${v}^{n}\\,d${v} = \\frac{${v}^{n+1}}{n+1}`);
    }
    if (f.t === 'pow' && !has(f.b, x) && isX(f.e, x)) {
      if (f.b.t === 'sym' && f.b.s === 'e') return R(f, 'Standard integral', `$e^{${v}}$ is its own derivative, so it is its own integral.`, `\\int e^{${v}}\\,d${v} = e^{${v}}`);
      return R(mul(f, pow(fn('ln', f.b), NEG1)), 'Standard integral', 'An exponential with base $a$ integrates to itself divided by $\\ln a$.', `\\int a^{${v}}\\,d${v} = \\frac{a^{${v}}}{\\ln a}`);
    }
    const tb = {
      sin: [() => neg(fn('cos', X)), `\\int \\sin ${v}\\,d${v} = -\\cos ${v}`],
      cos: [() => fn('sin', X), `\\int \\cos ${v}\\,d${v} = \\sin ${v}`],
      tan: [() => fn('ln', fn('abs', fn('sec', X))), `\\int \\tan ${v}\\,d${v} = \\ln\\left|\\sec ${v}\\right|`],
      cot: [() => fn('ln', fn('abs', fn('sin', X))), `\\int \\cot ${v}\\,d${v} = \\ln\\left|\\sin ${v}\\right|`],
      sec: [() => fn('ln', fn('abs', add(fn('sec', X), fn('tan', X)))), `\\int \\sec ${v}\\,d${v} = \\ln\\left|\\sec ${v} + \\tan ${v}\\right|`],
      csc: [() => neg(fn('ln', fn('abs', add(fn('csc', X), fn('cot', X))))), `\\int \\csc ${v}\\,d${v} = -\\ln\\left|\\csc ${v} + \\cot ${v}\\right|`],
      sinh: [() => fn('cosh', X), `\\int \\sinh ${v}\\,d${v} = \\cosh ${v}`],
      cosh: [() => fn('sinh', X), `\\int \\cosh ${v}\\,d${v} = \\sinh ${v}`],
      tanh: [() => fn('ln', fn('cosh', X)), `\\int \\tanh ${v}\\,d${v} = \\ln\\cosh ${v}`],
      abs: [() => mul(HALF, X, fn('abs', X)), `\\int \\left|${v}\\right|\\,d${v} = \\frac{${v}\\left|${v}\\right|}{2}`],
    };
    for (const [name, [Ff, formula]] of Object.entries(tb)) if (fx(f, name)) return R(Ff(), 'Standard integral', 'This is a standard integral.', formula);
    const two = [
      [() => pw(f, 'sec', 2) || pw(f, 'cos', -2), () => fn('tan', X), `\\int \\sec^{2} ${v}\\,d${v} = \\tan ${v}`],
      [() => pw(f, 'csc', 2) || pw(f, 'sin', -2), () => neg(fn('cot', X)), `\\int \\csc^{2} ${v}\\,d${v} = -\\cot ${v}`],
      [() => pw(f, 'cosh', -2), () => fn('tanh', X), `\\int \\operatorname{sech}^{2} ${v}\\,d${v} = \\tanh ${v}`],
      [() => pw(f, 'sinh', -2), () => neg(mul(fn('cosh', X), pow(fn('sinh', X), NEG1))), `\\int \\operatorname{csch}^{2} ${v}\\,d${v} = -\\coth ${v}`],
    ];
    for (const [test, Ff, formula] of two) if (test()) return R(Ff(), 'Standard integral', 'This is a standard integral (the derivative of a trig function).', formula);
    if (f.t === 'mul' && f.a.length === 2) {
      const [a, b] = f.a;
      const both = (p, q) => (p(a) && q(b)) || (p(b) && q(a));
      if (both((e) => fx(e, 'sec'), (e) => fx(e, 'tan'))) return R(fn('sec', X), 'Standard integral', 'This is the derivative of $\\sec$.', `\\int \\sec ${v}\\tan ${v}\\,d${v} = \\sec ${v}`);
      if (both((e) => fx(e, 'csc'), (e) => fx(e, 'cot'))) return R(neg(fn('csc', X)), 'Standard integral', 'This is the derivative of $-\\csc$.', `\\int \\csc ${v}\\cot ${v}\\,d${v} = -\\csc ${v}`);
      if (both((e) => pw(e, 'cosh', -1), (e) => fx(e, 'tanh'))) return R(neg(pow(fn('cosh', X), NEG1)), 'Standard integral', 'This is the derivative of $-\\operatorname{sech}$.', `\\int \\operatorname{sech} ${v}\\tanh ${v}\\,d${v} = -\\operatorname{sech} ${v}`);
      if (both((e) => fx(e, 'sin'), (e) => pw(e, 'cos', -2))) return R(fn('sec', X), 'Standard integral', 'This is $\\sec\\,\\tan$, the derivative of $\\sec$.', `\\int \\frac{\\sin ${v}}{\\cos^{2} ${v}}\\,d${v} = \\sec ${v}`);
      if (both((e) => fx(e, 'cos'), (e) => pw(e, 'sin', -2))) return R(neg(fn('csc', X)), 'Standard integral', 'This is $\\csc\\,\\cot$, the derivative of $-\\csc$.', `\\int \\frac{\\cos ${v}}{\\sin^{2} ${v}}\\,d${v} = -\\csc ${v}`);
    }
    return null;
  }

  function rTable(f, x, ctx) {
    const t = table(f, x);
    if (t) return { F: t.F, step: step(t.rule, P(t.text), M(t.formula.startsWith(intTex(f, x)) ? t.formula : `${intTex(f, x)} = ${T(t.F, x)}`)) };
    // the same table with a linear expression ax + b in place of x (reverse chain rule)
    const inner = [];
    if (f.t === 'fn') inner.push(f.x);
    else if (f.t === 'pow') { if (!has(f.e, x)) { inner.push(f.b); if (f.b.t === 'fn') inner.push(f.b.x); } if (!has(f.b, x)) inner.push(f.e); }
    else if (f.t === 'mul' && f.a.length === 2) for (const q of f.a) { const b = q.t === 'pow' ? q.b : q; if (b.t === 'fn') inner.push(b.x); }
    for (const L of inner) {
      if (isX(L, x) || !isLinear(L, x)) continue;
      const a = diff(L, x);
      const w = '§';
      const g = subs(f, L, S(w));
      if (has(g, x)) continue;
      const tt = table(g, w);
      if (!tt) continue;
      const F = mul(pow(a, NEG1), subsVar(tt.F, w, L));
      const xv = dvar(x);
      const txt = isOne(a)
        ? `This is a standard integral with $${T(L, x)}$ in place of $${xv}$. Because $${T(L, x)}$ has derivative $1$, nothing else changes.`
        : `This is a standard integral with $${T(L, x)}$ in place of $${xv}$ (reverse chain rule): integrate as usual, then divide by $${T(a, x)}$, the coefficient of $${xv}$.`;
      return { F, step: step(isOne(a) ? tt.rule : 'Reverse chain rule', P(txt), M(`${intTex(f, x)} = ${T(F, x)}`)) };
    }
    return null;
  }

  // ---------- 3. sums ----------
  function rSum(f, x, ctx) {
    if (f.t !== 'add') return null;
    const terms = C.orderTerms(f.a, x);
    const parts = [];
    for (const t of terms) {
      const ng = C.isNeg(t);
      const r = I(ng ? neg(t) : t, x, ctx);
      if (!r) return null;
      parts.push({ F: ng ? neg(r.F) : r.F, step: r.step });
    }
    const F = add(...parts.map((p) => p.F));
    let line = '';
    terms.forEach((t, i) => {
      if (C.isNeg(t)) line += ' - ' + intTex(neg(t), x);
      else line += (i ? ' + ' : '') + intTex(t, x);
    });
    return { F, step: step('Sum rule', P('Integrate each term separately.'), M(`${intTex(f, x)} = ${line}`), ...parts.map((p) => K(p.step)), M(`${intTex(f, x)} = ${T(F, x)}`)) };
  }

  // ---------- 4. constant multiples ----------
  function rConstMul(f, x, ctx) {
    if (f.t !== 'mul') return null;
    const cs = f.a.filter((t) => !has(t, x)), vs = f.a.filter((t) => has(t, x));
    if (!cs.length || !vs.length) return null;
    const c = mul(...cs), g = vs.length === 1 ? vs[0] : mul(...vs);
    const r = I(g, x, ctx);
    if (!r) return null;
    const F = mul(c, r.F);
    const ct = coefTex(c, x);
    if (isSimple(r.step) && !hasJ(r.F)) {
      const ps = r.step.items.filter((i) => i.p).map((i) => i.p).join(' ');
      const mid = `${ct}${par(r.F, x)}`, fin = T(F, x);
      return { F, step: step(r.step.rule, P(ps + (isNum(c) && val(c) === -1 ? '' : ' The constant factor stays in front.')), M(`${intTex(f, x)} = ${ct}${intTex(g, x)} = ${mid}${mid === fin ? '' : ' = ' + fin}`)) };
    }
    return { F, step: step('Constant multiple', P(`Move the constant factor $${T(c, x)}$ outside the integral.`), M(`${intTex(f, x)} = ${ct}${intTex(g, x)}`), K(r.step), M(`= ${ct}${par(r.F, x)} = ${T(F, x)}`)) };
  }

  // ---------- 5. substitution ----------
  function candidates(f, x) {
    const out = new Map();
    const visit = (e) => {
      if (!has(e, x)) return;
      if (e.t !== 'sym' && !(e.t === 'fn' && e.f === 'abs')) out.set(key(e), e);
      // (…)^(-1/2) also suggests u = √(…)
      if (e.t === 'pow' && isRat(e.e) && e.e.d > 1 && e.e.n !== 1) { const p = pow(e.b, N(1, e.e.d)); out.set(key(p), p); }
      // x^4 also suggests u = x^2
      if (e.t === 'pow' && isX(e.b, x) && isInt(e.e) && e.e.n > 2) {
        for (let d = 2; d < e.e.n; d++) if (e.e.n % d === 0) { const p = pow(S(x), N(d)); out.set(key(p), p); }
      }
      if (e.t === 'add' || e.t === 'mul') e.a.forEach(visit);
      else if (e.t === 'pow') { visit(e.b); visit(e.e); }
      else if (e.t === 'fn') visit(e.x);
    };
    visit(f);
    out.delete(key(f));
    return [...out.values()];
  }
  // x in terms of u, for u = a·x^k + b, u = (ax+b)^(1/n) or u = e^(ax)
  function invert(u, x, U) {
    if (u.t === 'pow' && isRat(u.e) && u.e.n === 1 && u.e.d > 1) return invert(u.b, x, pow(U, N(u.e.d)));
    if (u.t === 'fn' && u.f === 'ln' && isLinear(u.x, x)) {
      const a = diff(u.x, x), b = subsVar(u.x, x, ZERO);
      return div(sub(pow(E, U), b), a);
    }
    if (u.t === 'pow' && u.b.t === 'sym' && u.b.s === 'e' && isLinear(u.e, x)) {
      const a = diff(u.e, x), b = subsVar(u.e, x, ZERO);
      return div(sub(fn('ln', U), b), a);
    }
    const e = expand(u);
    const ts = e.t === 'add' ? e.a : [e];
    const withX = ts.filter((t) => has(t, x));
    if (withX.length !== 1) return null;
    const [c, r] = C.splitCoef(withX[0]);
    let k;
    if (isX(r, x)) k = ONE;
    else if (r.t === 'pow' && isX(r.b, x) && isRat(r.e) && val(r.e) > 0) k = r.e;
    else return null;
    const b = add(...ts.filter((t) => !has(t, x)));
    const base = div(sub(U, b), c);
    return isOne(k) ? base : pow(base, pow(k, NEG1));
  }
  function niceInU(g, U) {
    const e = expand(g);
    const ts = e.t === 'add' ? e.a : [e];
    const powerOnly = ts.every((t) => {
      const [, r] = C.splitCoef(t);
      return isOne(r) || isX(r, U) || (r.t === 'pow' && isX(r.b, U) && isNum(r.e));
    });
    if (powerOnly) return true;
    const [nE, dE] = numDen(g);
    return !!(toPoly(nE, U) && toPoly(dE, U));
  }
  function rootOfSum(e, U) {
    if (e.t === 'pow' && e.b.t === 'add' && has(e.b, U) && !isInt(e.e)) return true;
    if (e.t === 'add' || e.t === 'mul') return e.a.some((t) => rootOfSum(t, U));
    if (e.t === 'pow') return rootOfSum(e.b, U) || rootOfSum(e.e, U);
    if (e.t === 'fn') return rootOfSum(e.x, U);
    return false;
  }
  function trySub(f, x, ctx, back) {
    const PH = '§u';
    const ok = [];
    // tan, cot, sec, csc factors written with sin and cos, for u = cos A or u = sin A (tan x ln(cos x))
    const scMap = { tan: (A) => mul(fn('sin', A), pow(fn('cos', A), NEG1)), cot: (A) => mul(fn('cos', A), pow(fn('sin', A), NEG1)), sec: (A) => pow(fn('cos', A), NEG1), csc: (A) => pow(fn('sin', A), NEG1) };
    const scFac = (t) => {
      const b = t.t === 'pow' && isInt(t.e) ? t.b : t, n = b === t ? 1 : t.e.n;
      if (b.t !== 'fn' || !scMap[b.f]) return null;
      return { from: b, to: pow(scMap[b.f](b.x), N(n)) };
    };
    const fFacs = f.t === 'mul' ? f.a : [f];
    const scHits = fFacs.map(scFac).filter(Boolean);
    // pure trig products are left to the trig rules (rTrig); this is for a trig factor times something else
    const fSC = scHits.length && !trigParts(f, x) ? mul(...fFacs.map((t) => { const h = scFac(t); return h ? h.to : t; })) : null;
    for (const u of candidates(f, x)) {
      if (isLinear(u, x) && !back) {
        // linear substitutions are only worth it when the table can't do it directly
      }
      const du = diff(u, x);
      if (isZero(du)) continue;
      let g = subs(div(f, du), u, S(PH));
      let inv = null, sc = false;
      // last resort: write tan as sin/cos first, so u = cos A can take the whole integrand
      if (has(g, x) && !back && fSC && u.t === 'fn' && (u.f === 'sin' || u.f === 'cos')) {
        const g2 = subs(div(fSC, du), u, S(PH));
        if (!has(g2, x) && has(g2, PH)) { g = g2; sc = true; }
      }
      if (has(g, x)) {
        if (!back) continue;
        inv = invert(u, x, S(PH));
        if (!inv) continue;
        g = expandBases(subsVar(g, x, inv));
        const lnSub = u.t === 'fn' && u.f === 'ln';
        if (has(g, x) || (!lnSub && !niceInU(g, PH))) continue;
      }
      if (!has(g, PH)) continue;
      // u = x^k that leaves a root of a sum (x^3 √(x²+1)) is worse than u = the sum itself
      if (!back && u.t === 'pow' && isX(u.b, x) && rootOfSum(g, PH)) continue;
      ok.push({ u, du, g, inv, sc, sz: size(g) + (isLinear(u, x) ? 0.5 : 0) + (sc ? 1000 : 0) });
    }
    ok.sort((a, b) => a.sz - b.sz);
    for (const c of ok.slice(0, 6)) {
      const name = fresh(ctx);
      const U = S(name);
      const g = subsVar(c.g, PH, U);
      // keep constant factors outside: ∫ g du = k ∫ h du
      const gf = g.t === 'mul' ? g.a : [g];
      const kc = gf.filter((t) => !has(t, name)), hv = gf.filter((t) => has(t, name));
      const k = kc.length ? mul(...kc) : ONE, h = hv.length === 1 ? hv[0] : mul(...hv);
      const r0 = I(h, name, ctx);
      ctx.used.delete(name);
      if (!r0) continue;
      const r = { F: mul(k, r0.F), step: r0.step };
      const F = subsVar(r.F, name, c.u);
      const xv = dvar(x), uv = name;
      const lin = isLinear(c.u, x);
      // du/dx written in u (d(e^x)/dx = e^x = u), so the jump to an integral in u is explained
      const duU = subs(c.du, c.u, U);
      const duInU = !has(duU, x) && has(duU, name) ? ` = ${T(duU, name)}` : '';
      const dxText = duInU ? `, so $d${xv} = \\frac{d${uv}}{${T(duU, name)}}$` : `, so $d${xv} = \\frac{d${uv}}{${T(c.du, x)}}$`;
      const scText = c.sc ? scHits.map((h) => `$${T(h.from, x)} = ${T(scMap[h.from.f](h.from.x), x)}$`).filter((t, i, a) => a.indexOf(t) === i).join(' and ') : '';
      const items = [
        P((scText ? `Write ${scText}. ` : '') + `Let $${uv} = ${T(c.u, x)}$. ` + (isOne(c.du) ? `Then $d${uv} = d${xv}$.` : `Then $\\frac{d${uv}}{d${xv}} = ${T(c.du, x)}${duInU}$${dxText}.`) +
          (c.inv ? ` Also $${xv} = ${T(subsVar(c.inv, PH, U), name)}$, to replace the remaining $${xv}$.` : '')),
        // never show a minus sign inside an integral: go straight to −c∫h when g is negative
        M(`${intTex(f, x)} = ${isOne(k) || !C.isNeg(g) ? intTex(g, name) + (isOne(k) ? '' : ' = ') : ''}${isOne(k) ? '' : coefTex(k, name) + intTex(h, name)}`),
        K(r0.step),
        isOne(k) ? null : M(`${coefTex(k, name)}${intTex(h, name)} = ${T(r.F, name)}`),
        P(`Substitute back $${uv} = ${T(c.u, x)}$.`),
        M(`= ${T(r.F, name)} = ${T(F, x)}`),
      ];
      return { F, step: step(lin ? 'Linear substitution' : 'Substitution', ...items) };
    }
    return null;
  }
  const rSubPure = (f, x, ctx) => trySub(f, x, ctx, false);
  const rSubBack = (f, x, ctx) => trySub(f, x, ctx, true);

  // ---------- 5b. a^x · b^x = (ab)^x ----------
  function rCombinePowers(f, x, ctx) {
    if (f.t !== 'mul') return null;
    const groups = new Map();
    // b^(c·u) with a whole number c is (b^c)^u, so 3^(2x) joins 2^x as 9^x
    for (const q of f.a) {
      if (q.t === 'pow' && isNum(q.b) && val(q.b) > 0 && has(q.e, x)) {
        const [c, u] = C.splitCoef(q.e);
        const whole = isInt(c) && val(c) !== 0 && Math.abs(val(c)) <= 6;
        const k = key(whole ? u : q.e);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push({ q, b: whole ? pow(q.b, c) : q.b, u: whole ? u : q.e });
      }
    }
    const found = [...groups.values()].find((g) => g.length > 1);
    if (!found) return null;
    const grp = found.map((o) => o.q);
    const base = found.reduce((b, o) => nmul(b, o.b), ONE);
    if (!isNum(base)) return null;
    const combined = pow(base, found[0].u);
    const g = mul(combined, ...f.a.filter((q) => !grp.includes(q)));
    const r = I(g, x, ctx);
    if (!r) return null;
    return { F: r.F, step: step('Combine the powers', P(found.some((o) => o.u !== o.q.e) ? `Write each power with the same exponent ($a^{ck} = (a^c)^k$), then multiply as $a^k b^k = (ab)^k$.` : `Powers with the same exponent multiply as $a^k b^k = (ab)^k$.`), M(`${T(mul(...grp), x)} = ${T(combined, x)}`), M(`${intTex(f, x)} = ${intTex(g, x)}`), K(r.step)) };
  }

  // ---------- 5c. double-angle identities, when the single angle also appears ----------
  function rDoubleAngle(f, x, ctx) {
    const doubles = [], singles = new Set();
    const visit = (e) => {
      if (e.t === 'fn' && ['sin', 'cos', 'tan', 'sec', 'csc', 'cot'].includes(e.f) && has(e.x, x)) {
        singles.add(key(e.x));
        if ((e.f === 'sin' || e.f === 'cos') && isLinear(e.x, x)) doubles.push(e);
      }
      if (e.a) e.a.forEach(visit);
      if (e.t === 'pow') { visit(e.b); visit(e.e); }
      if (e.t === 'fn') visit(e.x);
    };
    visit(f);
    for (const d of doubles) {
      const B = mul(HALF, d.x);
      if (!singles.has(key(B))) continue;
      const sB = fn('sin', B), cB = fn('cos', B);
      let rep, id;
      if (d.f === 'sin') { rep = mul(TWO, sB, cB); id = '\\sin 2A = 2\\sin A\\cos A'; }
      else {
        const hasS = has(f, sB), hasC = has(f, cB);
        if (hasC && !hasS) { rep = sub(mul(TWO, pow(cB, TWO)), ONE); id = '\\cos 2A = 2\\cos^2 A - 1'; }
        else if (hasS && !hasC) { rep = sub(ONE, mul(TWO, pow(sB, TWO))); id = '\\cos 2A = 1 - 2\\sin^2 A'; }
        else { rep = sub(pow(cB, TWO), pow(sB, TWO)); id = '\\cos 2A = \\cos^2 A - \\sin^2 A'; }
      }
      const g = subs(f, d, rep);
      if (eq(g, f)) continue;
      const r = I(g, x, ctx);
      if (!r) continue;
      return { F: r.F, step: step('Double-angle identity', P(`Use $${id}$ with $A = ${T(B, x)}$, so everything is in terms of the same angle.`), M(`${intTex(f, x)} = ${intTex(g, x)}`), K(r.step)) };
    }
    return null;
  }

  // ---------- 6. expand / split a fraction ----------
  function numDen(f) {
    const fs = f.t === 'mul' ? f.a : [f];
    const nu = [], de = [];
    for (const t of fs) {
      if (t.t === 'pow' && isInt(t.e) && t.e.n < 0) de.push(pow(t.b, N(-t.e.n)));
      else nu.push(t);
    }
    return [nu.length ? mul(...nu) : ONE, de.length ? mul(...de) : ONE];
  }
  function rExpand(f, x, ctx) {
    if (f.t === 'add') return null;
    const [, dE] = numDen(f);
    const denomHasSum = (dE.t === 'add') || (dE.t === 'pow' && dE.b.t === 'add') || (dE.t === 'mul' && dE.a.some((t) => t.t === 'add' || (t.t === 'pow' && t.b.t === 'add')));
    if (denomHasSum) return null;
    const e = expand(f);
    if (e.t !== 'add' || eq(e, f)) return null;
    const r = I(e, x, ctx);
    if (!r) return null;
    const splitting = !isOne(dE);
    return { F: r.F, step: step(splitting ? 'Split the fraction' : 'Expand', P(splitting ? 'Divide each term of the numerator by the denominator.' : 'Multiply out the brackets first.'), M(`${intTex(f, x)} = ${intTex(e, x)}`), K(r.step)) };
  }
  // a sum times powers of x, e.g. (x^2 + 1)/x or x(x + 3): multiply out first
  function rSplit(f, x, ctx) {
    if (f.t !== 'mul') return null;
    const sums = f.a.filter((t) => t.t === 'add');
    if (sums.length !== 1) return null;
    const ok = f.a.every((t) => t.t === 'add' || !has(t, x) || isX(t, x) || (t.t === 'pow' && isX(t.b, x) && isNum(t.e)));
    if (!ok) return null;
    return rExpand(f, x, ctx);
  }
  function rExpandAny(f, x, ctx) {
    if (f.t === 'add') return null;
    const e = expand(f);
    if (e.t !== 'add' || eq(e, f)) return null;
    const r = I(e, x, ctx);
    if (!r) return null;
    return { F: r.F, step: step('Expand', P('Multiply out to get a sum of simpler terms.'), M(`${intTex(f, x)} = ${intTex(e, x)}`), K(r.step)) };
  }

  // ---------- 7. standard forms with square roots ----------
  function rStdForms(f, x) {
    if (f.t !== 'pow' || !(isRat(f.e) && f.e.n === -1 && f.e.d === 2)) return null;
    const p = toPoly(f.b, x);
    if (!p || p.length !== 3 || !isZero(p[1])) return null;
    const al = p[0], be = p[2], X = S(x), v = dvar(x);
    const absb = absN(be);
    const a2 = absN(ndiv(al, absb));
    const scale = !(Math.abs(val(be)) === 1);
    const take = scale ? ` after taking $\\sqrt{${T(absb, x)}}$ out of the root` : '';
    if (val(al) > 0 && val(be) < 0) {
      const F = mul(pow(absb, N(-1, 2)), fn('asin', mul(X, pow(ndiv(absb, al), HALF))));
      return { F, step: step('Standard integral', P(`This matches the standard result below, with $a^2 = ${T(a2, x)}$${take}.`), M(`\\int \\frac{1}{\\sqrt{a^2 - ${v}^2}}\\,d${v} = \\arcsin\\frac{${v}}{a}`), M(`${intTex(f, x)} = ${T(F, x)}`)) };
    }
    if (val(be) > 0 && !isZero(al)) {
      const F = mul(pow(be, N(-1, 2)), fn('ln', fn('abs', add(mul(pow(be, HALF), X), pow(f.b, HALF)))));
      const sign = val(al) > 0 ? '+' : '-';
      return { F, step: step('Standard integral', P(`This matches the standard result below, with $a^2 = ${T(a2, x)}$${take}.`), M(`\\int \\frac{1}{\\sqrt{${v}^2 ${sign} a^2}}\\,d${v} = \\ln\\left|${v} + \\sqrt{${v}^2 ${sign} a^2}\\right|`), M(`${intTex(f, x)} = ${T(F, x)}`)) };
    }
    return null;
  }

  // the same standard forms when the constant is a letter (a² or k): taken to be positive
  function rLetterForms(f, x) {
    if (f.t !== 'pow' || f.b.t !== 'add') return null;
    const X = S(x), v = dvar(x), X2 = pow(X, TWO);
    const sq = f.b.a.filter((t) => eq(t, X2) || eq(t, neg(X2)));
    if (sq.length !== 1) return null;
    const rest = f.b.a.filter((t) => t !== sq[0]);
    if (!rest.length || rest.some((t) => has(t, x))) return null;
    const c = add(...rest);
    if (isNum(c) || !C.isNonneg(c)) return null;
    const plus = eq(sq[0], X2);
    const r = c.t === 'pow' && isInt(c.e) && c.e.n === 2 ? c.b : pow(c, HALF);
    const ct = T(c, x), rt = T(r, x);
    const say = rt === 'a' ? 'This matches the standard result below (taking $a > 0$).' : `This matches the standard result below, with $a = ${rt}$ (taken to be positive).`;
    const done = (F, formula) => ({ F, step: step('Standard integral', P(say), M(formula), M(`${intTex(f, x)} = ${T(F, x)}`)) });
    if (plus && isNum(f.e) && val(f.e) === -1) return done(mul(pow(r, NEG1), fn('atan', mul(X, pow(r, NEG1)))), `\\int \\frac{1}{${v}^2 + a^2}\\,d${v} = \\frac{1}{a}\\arctan\\frac{${v}}{a}`);
    if (!plus && isRat(f.e) && f.e.n === -1 && f.e.d === 2) return done(fn('asin', mul(X, pow(r, NEG1))), `\\int \\frac{1}{\\sqrt{a^2 - ${v}^2}}\\,d${v} = \\arcsin\\frac{${v}}{a}`);
    if (!plus && isRat(f.e) && f.e.n === 1 && f.e.d === 2) return done(mul(HALF, add(mul(X, f), mul(c, fn('asin', mul(X, pow(r, NEG1)))))), `\\int \\sqrt{a^2 - ${v}^2}\\,d${v} = \\frac{1}{2}\\left(${v}\\sqrt{a^2 - ${v}^2} + a^2 \\arcsin\\frac{${v}}{a}\\right)`);
    if (!plus && isNum(f.e) && val(f.e) === -1) return done(mul(HALF, pow(r, NEG1), sub(fn('ln', fn('abs', add(X, r))), fn('ln', fn('abs', sub(X, r))))), `\\int \\frac{1}{a^2 - ${v}^2}\\,d${v} = \\frac{1}{2a}\\ln\\left|\\frac{${v} + a}{${v} - a}\\right|`);
    if (plus && isRat(f.e) && f.e.n === -1 && f.e.d === 2) return done(fn('ln', fn('abs', add(X, pow(f.b, HALF)))), `\\int \\frac{1}{\\sqrt{${v}^2 + a^2}}\\,d${v} = \\ln\\left|${v} + \\sqrt{${v}^2 + a^2}\\right|`);
    if (plus && isRat(f.e) && f.e.n === 1 && f.e.d === 2) return done(mul(HALF, add(mul(X, f), mul(c, fn('ln', fn('abs', add(X, f)))))), `\\int \\sqrt{${v}^2 + a^2}\\,d${v} = \\frac{1}{2}\\left(${v}\\sqrt{${v}^2 + a^2} + a^2 \\ln\\left|${v} + \\sqrt{${v}^2 + a^2}\\right|\\right)`);
    return null;
  }
  // x² − a² with a letter constant a (taken to be positive)
  function rLetterFormsMinus(f, x) {
    if (f.t !== 'pow' || f.b.t !== 'add') return null;
    const X = S(x), v = dvar(x), X2 = pow(X, TWO);
    if (f.b.a.filter((t) => eq(t, X2)).length !== 1) return null;
    const rest = f.b.a.filter((t) => !eq(t, X2));
    if (!rest.length || rest.some((t) => has(t, x))) return null;
    const c = neg(add(...rest));
    if (isNum(c) || !C.isNonneg(c)) return null;
    const r = c.t === 'pow' && isInt(c.e) && c.e.n === 2 ? c.b : pow(c, HALF);
    const rt = T(r, x);
    const say = rt === 'a' ? 'This matches the standard result below (taking $a > 0$).' : `This matches the standard result below, with $a = ${rt}$ (taken to be positive).`;
    const done = (F, formula) => ({ F, step: step('Standard integral', P(say), M(formula), M(`${intTex(f, x)} = ${T(F, x)}`)) });
    if (isNum(f.e) && val(f.e) === -1) return done(mul(HALF, pow(r, NEG1), sub(fn('ln', fn('abs', sub(X, r))), fn('ln', fn('abs', add(X, r))))), `\\int \\frac{1}{${v}^2 - a^2}\\,d${v} = \\frac{1}{2a}\\ln\\left|\\frac{${v} - a}{${v} + a}\\right|`);
    if (isRat(f.e) && f.e.n === -1 && f.e.d === 2) return done(fn('ln', fn('abs', add(X, pow(f.b, HALF)))), `\\int \\frac{1}{\\sqrt{${v}^2 - a^2}}\\,d${v} = \\ln\\left|${v} + \\sqrt{${v}^2 - a^2}\\right|`);
    if (isRat(f.e) && f.e.n === 1 && f.e.d === 2) return done(mul(HALF, sub(mul(X, f), mul(c, fn('ln', fn('abs', add(X, f)))))), `\\int \\sqrt{${v}^2 - a^2}\\,d${v} = \\frac{1}{2}\\left(${v}\\sqrt{${v}^2 - a^2} - a^2 \\ln\\left|${v} + \\sqrt{${v}^2 - a^2}\\right|\\right)`);
    return null;
  }

  // ---------- 8. rational functions ----------
  function rRational(f, x, ctx) {
    const [nE, dE] = numDen(f);
    if (!has(dE, x)) return null;
    const Pp = toPoly(nE, x), Q = toPoly(dE, x);
    if (!Pp || !Q || pdeg(Q) < 1) return null;
    const X = S(x);
    if (pdeg(Pp) >= pdeg(Q)) {
      const [q, r] = pdivmod(Pp, Q);
      const qE = fromPoly(q, x), rE = fromPoly(r, x);
      const g = add(qE, mul(rE, pow(dE, NEG1)));
      const res = I(g, x, ctx);
      if (!res) return null;
      const rhs = r.length ? `${T(qE, x)} ${C.isNeg(rE) && rE.t !== 'add' ? '-' : '+'} \\frac{${T(C.isNeg(rE) && rE.t !== 'add' ? neg(rE) : rE, x)}}{${T(dE, x)}}` : T(qE, x);
      return { F: res.F, step: step('Polynomial division', P(`The numerator has degree ${pdeg(Pp)} and the denominator degree ${pdeg(Q)}, so divide first.`), M(`\\frac{${T(nE, x)}}{${T(dE, x)}} = ${rhs}`), M(`${intTex(f, x)} = ${intTex(g, x)}`), K(res.step)) };
    }
    if (pdeg(Q) === 1) {
      const a = Q[1];
      const F = mul(nE, pow(a, NEG1), fn('ln', fn('abs', dE)));
      return { F, step: step('Standard integral', P(`The numerator is a constant and the denominator is linear, so the result is a logarithm (divide by $${T(a, x)}$, the coefficient of $${dvar(x)}$).`), M(`${intTex(f, x)} = ${T(F, x)}`)) };
    }
    const { roots, rest } = rationalRoots(Q);
    if (pdeg(Q) === 2 && !roots.length) return quadDenominator(f, x, ctx, Pp, Q, dE, nE);
    if (pdeg(rest) > 2) return null;
    return partialFractions(f, x, ctx, Pp, Q, roots, rest, dE, nE);
  }

  function quadDenominator(f, x, ctx, Pp, Q, dE, nE) {
    const X = S(x), v = dvar(x);
    const [c0, b, a] = Q;
    const p = Pp[1] || ZERO, q = Pp[0] || ZERO;
    const disc = nadd(nmul(b, b), nneg(nmul(N(4), nmul(a, c0))));
    if (val(disc) > 0) {
      const sq = pow(disc, HALF);
      const al = div(add(neg(b), sq), mul(TWO, a)), bt = div(sub(neg(b), sq), mul(TWO, a));
      const A = div(add(mul(p, al), q), mul(a, sub(al, bt))), B = div(add(mul(p, bt), q), mul(a, sub(bt, al)));
      const F = add(mul(A, fn('ln', fn('abs', sub(X, al)))), mul(B, fn('ln', fn('abs', sub(X, bt)))));
      return { F, step: step('Partial fractions', P(`The denominator has two real roots (quadratic formula): $${v} = ${T(al, x)}$ and $${v} = ${T(bt, x)}$. Split into partial fractions.`),
        M(`\\frac{${T(nE, x)}}{${T(dE, x)}} = \\frac{${T(A, x)}}{${T(sub(X, al), x)}} + \\frac{${T(B, x)}}{${T(sub(X, bt), x)}}`), P('Each term integrates to a logarithm.'), M(`${intTex(f, x)} = ${T(F, x)}`)) };
    }
    const dQ = add(mul(TWO, a, X), b);
    const k1 = ndiv(p, nmul(TWO, a));
    const k2 = nadd(q, nneg(nmul(k1, b)));
    const items = [];
    let F = ZERO;
    const h = ndiv(b, nmul(TWO, a));
    const s2 = nadd(ndiv(c0, a), nneg(nmul(h, h)));
    const s = pow(s2, HALF);
    const u = add(X, h);
    const sq = isZero(h) ? pow(X, TWO) : pow(u, TWO);
    const QE = fromPoly(Q, x);
    const noSq = isZero(h) && isOne(a); // already a sum of squares: nothing to complete
    if (!isZero(p)) {
      const F1 = mul(k1, fn('ln', fn('abs', QE)));
      F = add(F, F1);
      items.push(P(`Write the numerator as a multiple of the denominator's derivative, $${T(dQ, x)}$, plus a constant.`));
      items.push(M(`\\frac{${T(nE, x)}}{${T(dE, x)}} = ${coefTex(k1, x)}\\frac{${T(dQ, x)}}{${T(QE, x)}}${isZero(k2) ? '' : (val(k2) < 0 ? ' - ' : ' + ') + '\\frac{' + T(absN(k2), x) + '}{' + T(QE, x) + '}'}`));
      items.push(P(`The first part has the form $\\frac{f'(${v})}{f(${v})}$, which integrates to $\\ln\\left|f(${v})\\right|$.`));
      items.push(M(`${coefTex(k1, x)}\\int \\frac{${T(dQ, x)}}{${T(QE, x)}}\\,d${v} = ${T(F1, x)}`));
    }
    if (!isZero(k2)) {
      const F2 = mul(k2, pow(a, NEG1), pow(s, NEG1), fn('atan', mul(u, pow(s, NEG1))));
      F = add(F, F2);
      const aTex = isOne(a) ? '' : T(a, x);
      if (!noSq) items.push(P(`Complete the square in the denominator${isZero(p) ? '' : ' for the constant part'}.`));
      if (!noSq) items.push(M(`${T(QE, x)} = ${aTex}${isOne(a) ? '' : '\\left('}${T(sq, x)} + ${T(s2, x)}${isOne(a) ? '' : '\\right)'}`));
      items.push(P(noSq ? `Use $\\int \\frac{1}{${v}^2 + k^2}\\,d${v} = \\frac{1}{k}\\arctan\\frac{${v}}{k}$ with $k = ${T(s, x)}$.` : `Use $\\int \\frac{1}{u^2 + k^2}\\,du = \\frac{1}{k}\\arctan\\frac{u}{k}$ with $u = ${T(u, x)}$ and $k = ${T(s, x)}$.`));
      items.push(M(`\\int \\frac{${T(k2, x)}}{${T(QE, x)}}\\,d${v} = ${T(F2, x)}`));
    }
    const last = `${intTex(f, x)} = ${T(F, x)}`;
    if (!items.length || items[items.length - 1].m !== last) items.push(M(last));
    return { F, step: step(isZero(p) ? (noSq ? 'Standard integral' : 'Completing the square') : 'Split the numerator', ...items) };
  }

  function solveLinear(A, bvec) { // exact Gaussian elimination
    const n = bvec.length;
    const m = A.map((row, i) => [...row, bvec[i]]);
    for (let c = 0; c < n; c++) {
      let piv = -1;
      for (let r = c; r < n; r++) if (!isZero(m[r][c])) { piv = r; break; }
      if (piv < 0) return null;
      [m[c], m[piv]] = [m[piv], m[c]];
      const pv = m[c][c];
      for (let k = c; k <= n; k++) m[c][k] = ndiv(m[c][k], pv);
      for (let r = 0; r < n; r++) {
        if (r === c || isZero(m[r][c])) continue;
        const fct = m[r][c];
        for (let k = c; k <= n; k++) m[r][k] = nadd(m[r][k], nneg(nmul(fct, m[c][k])));
      }
    }
    return m.map((row) => row[n]);
  }
  function intPoly(p) { // scale to integer coefficients with gcd 1 and positive lead
    let l = 1; for (const c of p) l = l * c.d / C.gcd(l, c.d);
    let ints = p.map((c) => c.n * (l / c.d));
    let g = 0; for (const c of ints) g = C.gcd(g, c);
    if (ints[ints.length - 1] < 0) g = -g;
    return ints.map((c) => N(c / g));
  }
  function partialFractions(f, x, ctx, Pp, Q, roots, rest, dE, nE) {
    const X = S(x), v = dvar(x);
    const lin = roots.map(({ r, m }) => ({ poly: [N(-r.n), N(r.d)], m }));
    let quad = pdeg(rest) === 2 ? intPoly(rest) : null;
    let prod = [ONE];
    for (const L of lin) for (let j = 0; j < L.m; j++) prod = pmul(prod, L.poly);
    if (quad) prod = pmul(prod, quad);
    const Kc = ndiv(Q[pdeg(Q)], prod[pdeg(prod)]);
    const target = Pp.map((c) => ndiv(c, Kc));
    const n = pdeg(Q);
    const basis = [], labels = [];
    const letters = 'ABCDEFGHJKLMN';
    for (const L of lin) for (let j = 1; j <= L.m; j++) {
      let b = [ONE];
      for (const L2 of lin) for (let k = 0; k < L2.m - (L2 === L ? j : 0); k++) b = pmul(b, L2.poly);
      if (quad) b = pmul(b, quad);
      basis.push(b); labels.push({ type: 'lin', L, j });
    }
    if (quad) {
      let b = [ONE];
      for (const L of lin) for (let k = 0; k < L.m; k++) b = pmul(b, L.poly);
      basis.push(pmul(b, [ZERO, ONE])); labels.push({ type: 'qx' });
      basis.push(b); labels.push({ type: 'qc' });
    }
    if (basis.length !== n) return null;
    const A = [];
    for (let row = 0; row < n; row++) A.push(basis.map((b) => b[row] || ZERO));
    const bvec = []; for (let row = 0; row < n; row++) bvec.push(target[row] || ZERO);
    const sol = solveLinear(A, bvec);
    if (!sol) return null;
    const terms = [], formTerms = [], vals = [];
    let li = 0;
    labels.forEach((lb, i) => {
      if (lb.type === 'lin') {
        const Le = fromPoly(lb.L.poly, x);
        const den = lb.j === 1 ? Le : pow(Le, N(lb.j));
        const letter = letters[li++];
        formTerms.push(`\\frac{${letter}}{${T(den, x)}}`);
        vals.push(`${letter} = ${T(sol[i], x)}`);
        if (!isZero(sol[i])) terms.push(mul(sol[i], pow(den, NEG1)));
      }
    });
    if (quad) {
      const qE = fromPoly(quad, x);
      const bx = sol[n - 2], bc = sol[n - 1];
      const lb = letters[li++], lc = letters[li++];
      formTerms.push(`\\frac{${lb}${v} + ${lc}}{${T(qE, x)}}`);
      vals.push(`${lb} = ${T(bx, x)}`, `${lc} = ${T(bc, x)}`);
      const numr = add(mul(bx, X), bc);
      if (!isZero(numr)) terms.push(mul(numr, pow(qE, NEG1)));
    }
    const g = add(...terms);
    const res = I(g, x, ctx);
    if (!res) return null;
    // factorised denominator for display
    const fparts = [];
    if (!isOne(Kc)) fparts.push(T(Kc, x));
    for (const L of lin) { const Le = fromPoly(L.poly, x); const t = Le.t !== 'sym' && (lin.length + (quad ? 1 : 0) > 1 || L.m > 1 || !isOne(Kc)) ?'\\left(' + T(Le, x) + '\\right)' : T(Le, x); fparts.push(L.m > 1 ? t + '^{' + L.m + '}' : t); }
    if (quad) fparts.push((lin.length || !isOne(Kc)) ? '\\left(' + T(fromPoly(quad, x), x) + '\\right)' : T(fromPoly(quad, x), x));
    const factored = fparts.join('');
    const items = [];
    if (factored.replace(/\\left|\\right/g, '') !== T(dE, x).replace(/\\left|\\right/g, '')) {
      items.push(P('Factorise the denominator.'), M(`${T(dE, x)} = ${factored}`));
    }
    const lhs = isOne(Kc) ? `\\frac{${T(nE, x)}}{${factored}}` : `\\frac{${T(mul(nE, pow(Kc, NEG1)), x)}}{${fparts.slice(1).join('')}}`;
    items.push(P('Split into partial fractions:'), M(`${lhs} = ${formTerms.join(' + ')}`));
    items.push(P(`Multiply through by the denominator, then compare coefficients (or substitute convenient values of $${v}$) to find the constants:`), M(vals.join(', \\quad ')));
    items.push(M(`${intTex(f, x)} = ${intTex(g, x)}`), K(res.step));
    return { F: res.F, step: step('Partial fractions', ...items) };
  }

  // ---------- 9. trigonometric powers and products ----------
  const TRIGS = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot'];
  function trigParts(f, x) {
    const fs = f.t === 'mul' ? f.a : [f];
    const pw = {}; let arg = null; const facs = [];
    for (const t of fs) {
      let b = t, n = 1;
      if (t.t === 'pow') { if (!isInt(t.e)) return null; b = t.b; n = t.e.n; }
      if (b.t !== 'fn' || !TRIGS.includes(b.f)) return null;
      facs.push({ f: b.f, arg: b.x, n });
      if (arg && !eq(arg, b.x)) arg = false;
      else if (arg !== false) arg = b.x;
      pw[b.f] = (pw[b.f] || 0) + n;
    }
    return { arg, pw, facs };
  }
  function rTrig(f, x, ctx) {
    const tp = trigParts(f, x);
    if (!tp) return null;
    const v = dvar(x);
    const rewrite = (rule, text, g) => {
      const r = I(g, x, ctx);
      if (!r) return null;
      return { F: r.F, step: step(rule, P(text), M(`${intTex(f, x)} = ${intTex(g, x)}`), K(r.step)) };
    };
    // product to sum for different arguments
    if (tp.arg === false) {
      if (tp.facs.length !== 2 || tp.facs.some((q) => q.n !== 1 || (q.f !== 'sin' && q.f !== 'cos') || !isLinear(q.arg, x))) return null;
      let [p, q] = tp.facs;
      if (p.f === 'cos' && q.f === 'sin') [p, q] = [q, p];
      const A = p.arg, B = q.arg, Ap = add(A, B), Am = sub(A, B);
      let g, id;
      if (p.f === 'sin' && q.f === 'cos') { g = mul(HALF, add(fn('sin', Ap), fn('sin', Am))); id = '\\sin A\\cos B = \\tfrac{1}{2}\\left[\\sin(A+B) + \\sin(A-B)\\right]'; }
      else if (p.f === 'cos') { g = mul(HALF, add(fn('cos', Am), fn('cos', Ap))); id = '\\cos A\\cos B = \\tfrac{1}{2}\\left[\\cos(A-B) + \\cos(A+B)\\right]'; }
      else { g = mul(HALF, sub(fn('cos', Am), fn('cos', Ap))); id = '\\sin A\\sin B = \\tfrac{1}{2}\\left[\\cos(A-B) - \\cos(A+B)\\right]'; }
      return rewrite('Product to sum', `Use the identity $${id}$.`, g);
    }
    const A = tp.arg;
    if (!isLinear(A, x)) return null;
    const pw = tp.pw;
    const names = Object.keys(pw).filter((k) => pw[k] !== 0);
    const only = (n) => names.length === 1 && names[0] === n;
    const s = fn('sin', A), c = fn('cos', A), t = fn('tan', A), se = fn('sec', A), cs = fn('csc', A), ct = fn('cot', A);
    const At = T(A, x), a = diff(A, x);
    // tan^n, cot^n
    if (only('tan') && pw.tan >= 2) {
      const n = pw.tan;
      const g = n === 2 ? sub(pow(se, TWO), ONE) : sub(mul(pow(t, N(n - 2)), pow(se, TWO)), pow(t, N(n - 2)));
      return rewrite('Trig identity', `Use $\\tan^2 ${At} = \\sec^2 ${At} - 1$.`, g);
    }
    if (only('cot') && pw.cot >= 2) {
      const n = pw.cot;
      const g = n === 2 ? sub(pow(cs, TWO), ONE) : sub(mul(pow(ct, N(n - 2)), pow(cs, TWO)), pow(ct, N(n - 2)));
      return rewrite('Trig identity', `Use $\\cot^2 ${At} = \\csc^2 ${At} - 1$.`, g);
    }
    // sec^n, csc^n
    const redSec = (n, isSec) => {
      const F0 = isSec ? mul(pow(se, N(n - 2)), t) : neg(mul(pow(cs, N(n - 2)), ct));
      const first = mul(N(1, n - 1), pow(a, NEG1), F0);
      const kf = N(n - 2, n - 1);
      const g = pow(isSec ? se : cs, N(n - 2));
      const r = I(g, x, ctx);
      if (!r) return null;
      const F = add(first, mul(kf, r.F));
      const nm = isSec ? '\\sec' : '\\csc', other = isSec ? '\\tan' : '\\cot', sg = isSec ? '' : '-';
      return { F, step: step('Reduction formula', P(`Use the reduction formula $\\int ${nm}^n u\\,du = ${sg}\\frac{${nm}^{n-2}u\\,${other} u}{n-1} + \\frac{n-2}{n-1}\\int ${nm}^{n-2}u\\,du$ with $n = ${n}$${isOne(a) ? '' : `, dividing the first term by $${T(a, x)}$ because $u = ${At}$`}.`),
        M(`${intTex(f, x)} = ${T(first, x)} + ${coefTex(kf, x)}${intTex(g, x)}`), K(r.step), M(`= ${T(F, x)}`)) };
    };
    if (only('sec') && pw.sec >= 3) {
      if (pw.sec % 2 === 0) return rewrite('Trig identity', `Write $\\sec^{${pw.sec}} ${At} = \\left(1 + \\tan^2 ${At}\\right)^{${(pw.sec - 2) / 2}}\\sec^2 ${At}$, ready for the substitution $u = \\tan ${At}$.`, mul(pow(add(ONE, pow(t, TWO)), N((pw.sec - 2) / 2)), pow(se, TWO)));
      return redSec(pw.sec, true);
    }
    if (only('csc') && pw.csc >= 3) {
      if (pw.csc % 2 === 0) return rewrite('Trig identity', `Write $\\csc^{${pw.csc}} ${At} = \\left(1 + \\cot^2 ${At}\\right)^{${(pw.csc - 2) / 2}}\\csc^2 ${At}$, ready for the substitution $u = \\cot ${At}$.`, mul(pow(add(ONE, pow(ct, TWO)), N((pw.csc - 2) / 2)), pow(cs, TWO)));
      return redSec(pw.csc, false);
    }
    if (names.length === 2 && pw.tan > 0 && pw.sec > 0) {
      const m = pw.tan, n = pw.sec;
      if (n % 2 === 0 && n > 2) return rewrite('Trig identity', `Keep one $\\sec^2 ${At}$ and write the rest using $\\sec^2 ${At} = 1 + \\tan^2 ${At}$, ready for $u = \\tan ${At}$.`, mul(pow(t, N(m)), pow(add(ONE, pow(t, TWO)), N((n - 2) / 2)), pow(se, TWO)));
      if (m % 2 === 1 && (m > 1 || n > 1)) return rewrite('Trig identity', `Keep one $\\sec ${At}\\tan ${At}$ and write the rest using $\\tan^2 ${At} = \\sec^2 ${At} - 1$, ready for $u = \\sec ${At}$.`, mul(pow(sub(pow(se, TWO), ONE), N((m - 1) / 2)), pow(se, N(n - 1)), se, t));
    }
    // general: sin^m cos^n
    const m = (pw.sin || 0) + (pw.tan || 0) - (pw.csc || 0) - (pw.cot || 0);
    const n = (pw.cos || 0) - (pw.tan || 0) - (pw.sec || 0) + (pw.cot || 0);
    const converted = names.some((k) => k !== 'sin' && k !== 'cos');
    const sc = mul(pow(s, N(m)), pow(c, N(n)));
    const conv = converted ? ` (first writing everything in terms of $\\sin$ and $\\cos$: $${T(sc, x)}$)` : '';
    if (m % 2 !== 0 && m > 0 && (m >= 3 || converted)) {
      return rewrite('Trig identity', `Keep one $\\sin ${At}$ and change the rest with $\\sin^2 ${At} = 1 - \\cos^2 ${At}$${conv}, ready for $u = \\cos ${At}$.`, mul(pow(sub(ONE, pow(c, TWO)), N((m - 1) / 2)), pow(c, N(n)), s));
    }
    if (n % 2 !== 0 && n > 0 && (n >= 3 || converted)) {
      return rewrite('Trig identity', `Keep one $\\cos ${At}$ and change the rest with $\\cos^2 ${At} = 1 - \\sin^2 ${At}$${conv}, ready for $u = \\sin ${At}$.`, mul(pow(sub(ONE, pow(s, TWO)), N((n - 1) / 2)), pow(s, N(m)), c));
    }
    const A2 = mul(TWO, A), c2 = fn('cos', A2);
    if (m >= 0 && n >= 0 && m % 2 === 0 && n % 2 === 0 && m + n >= 2) {
      if (m === n) return rewrite('Double angle', `Use $\\sin ${At}\\cos ${At} = \\tfrac{1}{2}\\sin ${T(A2, x)}$${conv}.`, mul(pow(N(1, 2), N(m)), pow(fn('sin', A2), N(m))));
      const g = expand(mul(pow(mul(HALF, sub(ONE, c2)), N(m / 2)), pow(mul(HALF, add(ONE, c2)), N(n / 2))));
      const ids = [m ? `\\sin^2 ${At} = \\tfrac{1}{2}\\left(1 - \\cos ${T(A2, x)}\\right)` : '', n ? `\\cos^2 ${At} = \\tfrac{1}{2}\\left(1 + \\cos ${T(A2, x)}\\right)` : ''].filter(Boolean).join('$ and $');
      return rewrite('Double angle', `Use $${ids}$${conv} to lower the powers.`, g);
    }
    if (m > 0 && m % 2 === 0 && n < 0) {
      if (-n - m >= 0) {
        const k = -n - m;
        const g = k === 0 ? pow(t, N(m)) : mul(pow(t, N(m)), pow(se, N(k)));
        if (eq(g, f)) {
          if (k % 2 === 1) return rewrite('Trig identity', `Use $\\tan^2 ${At} = \\sec^2 ${At} - 1$ and multiply out.`, expand(mul(pow(sub(pow(se, TWO), ONE), N(m / 2)), pow(se, N(k)))));
          return null;
        }
        return rewrite('Trig identity', `Write $\\frac{\\sin ${At}}{\\cos ${At}} = \\tan ${At}$ and $\\frac{1}{\\cos ${At}} = \\sec ${At}$.`, g);
      }
      return rewrite('Trig identity', `Use $\\sin^2 ${At} = 1 - \\cos^2 ${At}$ and multiply out${conv}.`, expand(mul(pow(sub(ONE, pow(c, TWO)), N(m / 2)), pow(c, N(n)))));
    }
    if (n > 0 && n % 2 === 0 && m < 0) {
      if (-m - n >= 0) {
        const k = -m - n;
        const g = k === 0 ? pow(ct, N(n)) : mul(pow(ct, N(n)), pow(cs, N(k)));
        if (eq(g, f)) {
          if (k % 2 === 1) return rewrite('Trig identity', `Use $\\cot^2 ${At} = \\csc^2 ${At} - 1$ and multiply out.`, expand(mul(pow(sub(pow(cs, TWO), ONE), N(n / 2)), pow(cs, N(k)))));
          return null;
        }
        return rewrite('Trig identity', `Write $\\frac{\\cos ${At}}{\\sin ${At}} = \\cot ${At}$ and $\\frac{1}{\\sin ${At}} = \\csc ${At}$.`, g);
      }
      return rewrite('Trig identity', `Use $\\cos^2 ${At} = 1 - \\sin^2 ${At}$ and multiply out${conv}.`, expand(mul(pow(sub(ONE, pow(s, TWO)), N(n / 2)), pow(s, N(m)))));
    }
    if (m === 0 && n < 0 && !only('sec')) return rewrite('Trig identity', `Write $\\frac{1}{\\cos ${At}} = \\sec ${At}$.`, pow(se, N(-n)));
    if (n === 0 && m < 0 && !only('csc')) return rewrite('Trig identity', `Write $\\frac{1}{\\sin ${At}} = \\csc ${At}$.`, pow(cs, N(-m)));
    if (m < 0 && n < 0) {
      const g = add(mul(pow(s, N(m + 2)), pow(c, N(n))), mul(pow(s, N(m)), pow(c, N(n + 2))));
      return rewrite('Trig identity', `Multiply the numerator by $\\sin^2 ${At} + \\cos^2 ${At} = 1$ and split the fraction.`, g);
    }
    if (converted && !eq(sc, f)) return rewrite('Trig identity', `Write everything in terms of $\\sin$ and $\\cos$.`, sc);
    return null;
  }

  // 1 + tan²A = sec²A and 1 + cot²A = csc²A, used wherever they appear
  function rPythag(f, x, ctx) {
    let hit = null;
    const go = (e) => {
      if (e.t === 'add' && e.a.length === 2) {
        const one = e.a.find((t) => isOne(t)), sq = e.a.find((t) => t.t === 'pow' && isInt(t.e) && t.e.n === 2 && t.b.t === 'fn' && (t.b.f === 'tan' || t.b.f === 'cot'));
        if (one && sq) { hit = sq.b.f; return pow(fn(sq.b.f === 'tan' ? 'sec' : 'csc', sq.b.x), TWO); }
      }
      return e.t === 'num' || e.t === 'sym' ? e : C.rebuild(e, go);
    };
    const g = go(f);
    if (!hit || eq(g, f)) return null;
    const r = I(g, x, ctx);
    if (!r) return null;
    const id = hit === 'tan' ? '1 + \\tan^2 A = \\sec^2 A' : '1 + \\cot^2 A = \\csc^2 A';
    return { F: r.F, step: step('Trig identity', P(`Use $${id}$.`), M(`${intTex(f, x)} = ${intTex(g, x)}`), K(r.step)) };
  }

  // ---------- 9b. hyperbolic squares, and 1/(1 ± cos) by the conjugate ----------
  function rHyper(f, x, ctx) {
    // odd powers: keep one factor and turn the rest into the other function (cosh² − sinh² = 1)
    if (f.t === 'pow' && isInt(f.e) && f.e.n >= 3 && f.e.n % 2 === 1 && f.b.t === 'fn' && (f.b.f === 'sinh' || f.b.f === 'cosh') && isLinear(f.b.x, x)) {
      const A = f.b.x, k = (f.e.n - 1) / 2, sh = f.b.f === 'sinh';
      const g = mul(f.b, pow(sh ? sub(pow(fn('cosh', A), TWO), ONE) : add(ONE, pow(fn('sinh', A), TWO)), N(k)));
      const r = I(g, x, ctx);
      if (!r) return null;
      const id = sh ? '\\sinh^2 A = \\cosh^2 A - 1' : '\\cosh^2 A = 1 + \\sinh^2 A';
      return { F: r.F, step: step('Hyperbolic identity', P(`Keep one $\\${f.b.f}$ and change the rest with $${id}$, ready for $u = \\${sh ? 'cosh' : 'sinh'} ${T(A, x)}$.`), M(`${intTex(f, x)} = ${intTex(g, x)}`), K(r.step)) };
    }
    // sech A = cosh A / cosh²A = cosh A / (1 + sinh²A), ready for u = sinh A
    if (f.t === 'pow' && isInt(f.e) && f.e.n === -1 && f.b.t === 'fn' && f.b.f === 'cosh' && isLinear(f.b.x, x)) {
      const A = f.b.x;
      const g = mul(f.b, pow(add(ONE, pow(fn('sinh', A), TWO)), NEG1));
      const r = I(g, x, ctx);
      if (!r) return null;
      const At = T(A, x);
      return { F: r.F, step: step('Hyperbolic identity', P(`Multiply top and bottom by $\\cosh ${At}$, then use $\\cosh^2 ${At} = 1 + \\sinh^2 ${At}$, ready for $u = \\sinh ${At}$.`), M(`${intTex(f, x)} = ${intTex(g, x)}`), K(r.step)) };
    }
    if (!(f.t === 'pow' && isInt(f.e) && f.e.n === 2 && f.b.t === 'fn' && (f.b.f === 'sinh' || f.b.f === 'cosh') && isLinear(f.b.x, x))) return null;
    const A = f.b.x, c2 = fn('cosh', mul(TWO, A));
    const g = f.b.f === 'sinh' ? mul(HALF, sub(c2, ONE)) : mul(HALF, add(c2, ONE));
    const r = I(g, x, ctx);
    if (!r) return null;
    const id = f.b.f === 'sinh' ? '\\sinh^2 A = \\tfrac{1}{2}\\left(\\cosh 2A - 1\\right)' : '\\cosh^2 A = \\tfrac{1}{2}\\left(\\cosh 2A + 1\\right)';
    return { F: r.F, step: step('Hyperbolic identity', P(`Use $${id}$.`), M(`${intTex(f, x)} = ${intTex(g, x)}`), K(r.step)) };
  }
  function rConjugate(f, x, ctx) {
    if (f.t !== 'pow' || !isInt(f.e) || f.e.n !== -1 || f.b.t !== 'add' || f.b.a.length !== 2) return null;
    const a = f.b.a.find(isNum), tr = f.b.a.find((t) => !isNum(t));
    if (!a || !tr) return null;
    const [k, t] = C.splitCoef(tr);
    if (!(t.t === 'fn' && (t.f === 'cos' || t.f === 'sin') && isLinear(t.x, x))) return null;
    if (Math.abs(val(k)) !== Math.abs(val(a))) return null;
    const conj = sub(a, mul(k, t));
    const other = fn(t.f === 'cos' ? 'sin' : 'cos', t.x);
    const den = mul(pow(a, TWO), pow(other, TWO));
    const g = expand(mul(conj, pow(den, NEG1)));
    const r = I(g, x, ctx);
    if (!r) return null;
    return { F: r.F, step: step('Multiply by the conjugate', P(`Multiply top and bottom by $${T(conj, x)}$, then use $\\sin^2 + \\cos^2 = 1$ in the denominator.`),
      M(`\\frac{1}{${T(f.b, x)}} = \\frac{${T(conj, x)}}{${T(den, x)}}`), M(`${intTex(f, x)} = ${intTex(g, x)}`), K(r.step)) };
  }

  // ---------- 10. integration by parts ----------
  const INVF = ['asin', 'acos', 'atan', 'asinh', 'acosh', 'atanh'];
  function liate(t, x) {
    let b = t;
    if (t.t === 'pow' && isInt(t.e) && t.e.n > 0) b = t.b;
    if (b.t === 'fn' && b.f === 'ln') return 5;
    if (b.t === 'fn' && INVF.includes(b.f)) return 4;
    if (toPoly(t, x)) return 3;
    if (t.t === 'pow' && isX(t.b, x) && isNum(t.e)) return 3;
    if (b.t === 'fn' && ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh'].includes(b.f)) return 2;
    if (t.t === 'pow' && !has(t.b, x)) return 1;
    return 0;
  }
  function rParts(f, x, ctx) {
    // up to 12 nested rounds: x^10 e^x needs ten (the recursion depth limit stops longer chains)
    if (ctx.parts >= 12) return null;
    const fs = f.t === 'mul' ? f.a : [f];
    if (fs.some((t) => !has(t, x))) return null;
    let u, dv;
    if (fs.length === 1) {
      if (liate(f, x) < 4) return null;
      u = f; dv = ONE;
    } else {
      const sc = fs.map((t) => [liate(t, x), t]).sort((p, q) => q[0] - p[0]);
      if (sc[0][0] === 0 || sc.slice(1).some((s2) => s2[0] === 0 && !toPoly(s2[1], x))) {
        if (sc[0][0] === 0) return null;
      }
      u = sc[0][1];
      dv = mul(...sc.slice(1).map((s2) => s2[1]));
      if (sc[0][0] === 3 && sc[1][0] >= 3) return null;
      // x^n times something that isn't trig/exp/log: leave it to substitution rules
      if (sc[0][0] === 3 && sc.some((s2) => s2[0] === 0)) return null;
    }
    ctx.parts++;
    const firstParts = !ctx.explainedParts;
    ctx.explainedParts = true;
    let success = false;
    try {
      const X = S(x), v = dvar(x);
      const du = diff(u, x);
      const vr = isOne(dv) ? { F: X, step: null } : I(dv, x, ctx);
      if (!vr || hasJ(vr.F)) return null;
      const V = vr.F;
      const w0 = mul(V, du);
      const flip = C.isNeg(w0);
      const w = flip ? neg(w0) : w0; // uv - ∫(-w) is written uv + ∫w
      const J = S('__I' + ctx.jid++);
      ctx.cyc.push({ f, x, J });
      let wr;
      try { wr = isZero(w) ? { F: ZERO, step: null } : I(w, x, ctx); } finally { ctx.cyc.pop(); }
      if (!wr) return null;
      const uv = mul(u, V);
      let F = flip ? add(uv, wr.F) : sub(uv, wr.F);
      const items = [];
      items.push(P(!firstParts
        ? 'Integrate by parts again.'
        : `Use integration by parts, $\\int u\\,\\frac{dv}{d${v}}\\,d${v} = uv - \\int v\\,\\frac{du}{d${v}}\\,d${v}$. Choose $u$ as the factor that gets simpler when differentiated (in the order logs, inverse trig, algebraic, trig, exponentials).`));
      items.push(M(`u = ${T(u, x)}, \\qquad \\frac{du}{d${v}} = ${T(du, x)}`));
      items.push(M(`\\frac{dv}{d${v}} = ${T(dv, x)}, \\qquad v = ${T(V, x)}`));
      if (vr.step && !isSimple(vr.step)) items.push(K(vr.step));
      items.push(M(`${intTex(f, x)} = ${T(uv, x)} ${flip ? '+' : '-'} ${intTex(w, x)}`));
      if (wr.step) items.push(K(wr.step));
      const Js = [...syms(F)].find((q) => q === J.s);
      if (Js) {
        const cJ = sub(subsVar(F, J.s, ONE), subsVar(F, J.s, ZERO));
        const A0 = subsVar(F, J.s, ZERO);
        if (has(cJ, x) || isOne(cJ) || hasJ(cJ)) return null;
        const one_c = sub(ONE, cJ);
        F = mul(pow(one_c, NEG1), A0);
        items.push(P(`The original integral has come back. Call it $I$ and solve for $I$:`));
        items.push(M(`I = ${T(A0, x)} ${C.isNeg(cJ) ? '-' : '+'} ${coefTex(C.isNeg(cJ) ? neg(cJ) : cJ, x)}I`));
        items.push(M(`${coefTex(one_c, x)}I = ${T(A0, x)} \\quad\\Rightarrow\\quad I = ${T(F, x)}`));
      } else {
        items.push(M(`= ${T(F, x)}`));
      }
      success = true;
      return { F, step: step('Integration by parts', ...items) };
    } finally { ctx.parts--; if (!success && firstParts) ctx.explainedParts = false; }
  }

  // ---------- 11. completing the square under a root ----------
  function rCompleteSquare(f, x, ctx) {
    let Q = null;
    const visit = (e) => {
      if (Q) return;
      if (e.t === 'pow' && e.b.t === 'add' && (!isInt(e.e) || val(e.e) <= -2)) {
        const p = toPoly(e.b, x);
        if (p && p.length === 3 && !isZero(p[1])) { Q = { e: e.b, p }; return; }
      }
      if (e.t === 'add' || e.t === 'mul') e.a.forEach(visit);
      else if (e.t === 'pow') { visit(e.b); visit(e.e); }
      else if (e.t === 'fn') visit(e.x);
    };
    visit(f);
    if (!Q) return null;
    const [c0, b, a] = Q.p;
    const h = ndiv(b, nmul(TWO, a));
    const k = nadd(c0, nneg(nmul(a, nmul(h, h))));
    const name = fresh(ctx);
    const U = S(name), X = S(x);
    const g = expandBases(subsVar(f, x, sub(U, h)));
    const r = I(g, name, ctx);
    ctx.used.delete(name);
    if (!r) return null;
    const u = add(X, h);
    const F = expandBases(subsVar(r.F, name, u));
    const sq = `${isOne(a) ? '' : T(a, x)}\\left(${T(u, x)}\\right)^{2}${isZero(k) ? '' : (val(k) < 0 ? ' - ' : ' + ') + T(val(k) < 0 ? nneg(k) : k, x)}`;
    return { F, step: step('Completing the square', P('Complete the square in the quadratic.'), M(`${T(Q.e, x)} = ${sq}`),
      P(`Let $${name} = ${T(u, x)}$, so $d${name} = d${dvar(x)}$.`), M(`${intTex(f, x)} = ${intTex(g, name)}`), K(r.step), P(`Substitute back $${name} = ${T(u, x)}$.`), M(`= ${T(F, x)}`)) };
  }

  // ---------- 12. trigonometric substitution ----------
  function expandMultiAngle(e, th) {
    const go = (n) => {
      if (n.t === 'fn' && (n.f === 'sin' || n.f === 'cos' || n.f === 'tan')) {
        const [k, r] = C.splitCoef(n.x);
        if (r.t === 'sym' && r.s === th && isInt(k) && k.n >= 2) {
          const sk = multi('sin', k.n), ck = multi('cos', k.n);
          return n.f === 'sin' ? sk : n.f === 'cos' ? ck : div(sk, ck);
        }
      }
      if (n.t === 'num' || n.t === 'sym') return n;
      return C.rebuild(n, go);
    };
    const s1 = fn('sin', S(th)), c1 = fn('cos', S(th));
    const memo = {};
    function multi(f, k) {
      if (k === 1) return f === 'sin' ? s1 : c1;
      const id = f + k;
      if (memo[id]) return memo[id];
      const sp = multi('sin', k - 1), cp = multi('cos', k - 1);
      const r = f === 'sin' ? expand(add(mul(s1, cp), mul(c1, sp))) : expand(sub(mul(c1, cp), mul(s1, sp)));
      memo[id] = r;
      return r;
    }
    return go(e);
  }
  function rTrigSub(f, x, ctx) {
    const fs = f.t === 'mul' ? f.a : [f];
    let m = 0, Qf = null, p2 = 0;
    for (const t of fs) {
      if (isX(t, x)) { m += 1; continue; }
      if (t.t === 'pow' && isX(t.b, x) && isInt(t.e)) { m += t.e.n; continue; }
      if (t.t === 'pow' && t.b.t === 'add' && isRat(t.e) && (t.e.d === 2 || t.e.d === 1)) {
        if (Qf) return null;
        Qf = t.b; p2 = t.e.d === 2 ? t.e.n : 2 * t.e.n; continue;
      }
      return null;
    }
    if (!Qf) return null;
    const pq = toPoly(Qf, x);
    if (!pq || pq.length !== 3 || !isZero(pq[1])) return null;
    const al = pq[0], be = pq[2];
    if (isZero(al)) return null;
    let kind;
    if (val(al) > 0 && val(be) < 0) kind = 'sin';
    else if (val(al) > 0 && val(be) > 0) kind = 'tan';
    else if (val(al) < 0 && val(be) > 0) kind = 'sec';
    else return null;
    if (ctx.used.has('theta')) return null;
    ctx.used.add('theta');
    try {
      const th = S('theta');
      const r = pow(ndiv(absN(al), absN(be)), HALF);
      const aa = val(al) > 0 ? al : nneg(al);
      const s = fn('sin', th), c = fn('cos', th), tn = fn('tan', th), se = fn('sec', th);
      let g, xsub, dx, Qsub, back, thetaOf, trigName;
      const half = N(p2, 2);
      if (kind === 'sin') {
        xsub = mul(r, s); dx = mul(r, c); Qsub = mul(aa, pow(c, TWO));
        g = mul(pow(r, N(m + 1)), pow(aa, half), pow(s, N(m)), pow(c, N(p2 + 1)));
        thetaOf = fn('asin', mul(S(x), pow(r, NEG1))); trigName = '\\sin';
      } else if (kind === 'tan') {
        xsub = mul(r, tn); dx = mul(r, pow(se, TWO)); Qsub = mul(aa, pow(se, TWO));
        g = mul(pow(r, N(m + 1)), pow(aa, half), pow(tn, N(m)), pow(se, N(p2 + 2)));
        thetaOf = fn('atan', mul(S(x), pow(r, NEG1))); trigName = '\\tan';
      } else {
        xsub = mul(r, se); dx = mul(r, se, tn); Qsub = mul(aa, pow(tn, TWO));
        g = mul(pow(r, N(m + 1)), pow(aa, half), pow(se, N(m + 1)), pow(tn, N(p2 + 1)));
        thetaOf = fn('acos', mul(r, pow(S(x), NEG1))); trigName = '\\sec';
      }
      const res = I(g, 'theta', ctx);
      if (!res) return null;
      const X = S(x), rootQ = pow(Qf, HALF), ra = pow(aa, HALF);
      let mp;
      if (kind === 'sin') { const sv = mul(X, pow(r, NEG1)), cv = mul(rootQ, pow(ra, NEG1)); mp = { sin: sv, cos: cv }; }
      else if (kind === 'tan') { const tv = mul(X, pow(r, NEG1)), sev = mul(rootQ, pow(ra, NEG1)); mp = { cos: pow(sev, NEG1), sin: mul(tv, pow(sev, NEG1)) }; }
      else { const sev = mul(X, pow(r, NEG1)), tv = mul(rootQ, pow(ra, NEG1)); mp = { cos: pow(sev, NEG1), sin: mul(tv, pow(sev, NEG1)) }; }
      mp.tan = div(mp.sin, mp.cos); mp.sec = pow(mp.cos, NEG1); mp.csc = pow(mp.sin, NEG1); mp.cot = div(mp.cos, mp.sin);
      const Fth = expandMultiAngle(res.F, 'theta');
      const backF = (e) => {
        if (e.t === 'sym' && e.s === 'theta') return thetaOf;
        if (e.t === 'fn' && mp[e.f] && e.x.t === 'sym' && e.x.s === 'theta') return mp[e.f];
        if (e.t === 'num' || e.t === 'sym') return e;
        return C.rebuild(e, backF);
      };
      const F = backF(Fth);
      if (has(F, 'theta')) return null;
      const form = kind === 'sin' ? 'a^2 - x^2' : kind === 'tan' ? 'a^2 + x^2' : 'x^2 - a^2';
      const v = dvar(x);
      const tri = kind === 'sin'
        ? `$\\sin\\theta = ${T(mp.sin, x)}$ and $\\cos\\theta = ${T(mp.cos, x)}$`
        : kind === 'tan' ? `$\\tan\\theta = ${T(div(X, r), x)}$ and $\\sec\\theta = ${T(pow(mp.cos, NEG1), x)}$`
          : `$\\sec\\theta = ${T(div(X, r), x)}$ and $\\tan\\theta = ${T(div(rootQ, ra), x)}$`;
      return { F, step: step('Trigonometric substitution',
        P(`The integrand contains $${T(p2 % 2 ? pow(Qf, HALF) : Qf, x)}$, and $${T(Qf, x)}$ has the form $${form.replace(/x/g, v)}$. Let $${v} = ${T(xsub, 'theta')}$, so $d${v} = ${T(dx, 'theta')}\\,d\\theta$ and $${T(Qf, x)} = ${T(Qsub, 'theta')}$` +
          (p2 % 2 ? `, taking $\\theta$ where $${T(kind === 'sin' ? c : kind === 'tan' ? se : tn, 'theta')} \\ge 0$.` : '.')),
        M(`${intTex(f, x)} = ${intTex(g, 'theta')}`),
        K(res.step),
        P(`Return to $${v}$ with a right-angled triangle: ${tri}, and $\\theta = ${T(thetaOf, x)}$.`),
        M(`= ${T(res.F, 'theta')}`),
        M(`= ${T(F, x)}`)) };
    } finally { ctx.used.delete('theta'); }
  }

  // ---------- 13. Gaussian → error function ----------
  function rErf(f, x) {
    if (f.t !== 'pow' || !(f.b.t === 'sym' && f.b.s === 'e')) return null;
    const p = toPoly(f.e, x);
    if (!p || p.length !== 3 || !isZero(p[1]) || !isZero(p[0]) || val(p[2]) >= 0) return null;
    const k = nneg(p[2]);
    const F = mul(pow(PI, HALF), HALF, pow(k, N(-1, 2)), fn('erf', mul(pow(k, HALF), S(x))));
    const v = dvar(x);
    return { F, step: step('Error function', P(`$e^{-${v}^2}$ has no antiderivative made from elementary functions. Its integral is written with the error function $\\operatorname{erf}(${v}) = \\frac{2}{\\sqrt{\\pi}}\\int_0^{${v}} e^{-t^2}\\,dt$.`), M(`${intTex(f, x)} = ${T(F, x)}`)) };
  }

  const RULES = [rConst, rTable, rSum, rConstMul, rCombinePowers, rSplit, rSubPure, rExpand, rStdForms, rLetterForms, rLetterFormsMinus, rRational, rPythag, rTrig, rHyper, rConjugate, rCompleteSquare, rSubBack, rDoubleAngle, rParts, rTrigSub, rErf, rExpandAny];

  // ---------- known non-elementary integrands ----------
  function nonElementary(f, x) {
    const X = S(x);
    const pats = [
      [mul(fn('sin', X), pow(X, NEG1)), 'the sine integral Si(x)'],
      [mul(fn('cos', X), pow(X, NEG1)), 'the cosine integral Ci(x)'],
      [mul(pow(E, X), pow(X, NEG1)), 'the exponential integral Ei(x)'],
      [pow(fn('ln', X), NEG1), 'the logarithmic integral li(x)'],
      [fn('sin', pow(X, TWO)), 'a Fresnel integral'],
      [fn('cos', pow(X, TWO)), 'a Fresnel integral'],
      [pow(E, pow(X, TWO)), 'the imaginary error function'],
      [pow(X, X), 'no named function'],
      [pow(fn('sin', X), HALF), 'an elliptic integral'],
      [pow(fn('cos', X), HALF), 'an elliptic integral'],
      [pow(add(ONE, pow(X, N(3))), HALF), 'an elliptic integral'],
      [pow(add(ONE, pow(X, N(4))), HALF), 'an elliptic integral'],
      [pow(E, pow(E, X)), 'the exponential integral'],
      [mul(pow(E, neg(pow(X, TWO))), pow(X, NEG1)), 'the exponential integral'],
    ];
    const [c, r] = C.splitCoef(f);
    for (const [p, name] of pats) if (eq(r, p)) return name;
    return null;
  }

  G.INTEGRATE = { integrate, nonElementary, intTex, Timeout };
})(typeof window !== 'undefined' ? window : globalThis);
