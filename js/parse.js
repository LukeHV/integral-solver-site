/* parse.js — reads maths typed the way it is written on paper.
 * "x sin x", "2x e^(x^2)", "sin^2 x", "√(1-x²)", "|x|", "e^2x", "ln x / x".
 * Produces a syntax tree (for a faithful typeset preview) and converts it to CAS expressions. */
(function (G) {
  'use strict';
  const C = G.CAS;

  const FUNCS = {
    sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cosec: 'csc', cot: 'cot',
    arcsin: 'asin', asin: 'asin', arccos: 'acos', acos: 'acos', arctan: 'atan', atan: 'atan',
    sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', sech: 'sech', csch: 'csch', cosech: 'csch', coth: 'coth',
    arsinh: 'asinh', arcsinh: 'asinh', asinh: 'asinh', arcosh: 'acosh', arccosh: 'acosh', acosh: 'acosh',
    artanh: 'atanh', arctanh: 'atanh', atanh: 'atanh',
    ln: 'ln', log: 'log', exp: 'exp', sqrt: 'sqrt', cbrt: 'cbrt', abs: 'abs', erf: 'erf',
  };
  const CONSTS = { pi: 'pi', 'π': 'pi', e: 'e', inf: 'inf', infinity: 'inf', oo: 'inf', '∞': 'inf' };
  const GREEK = { theta: 'theta', 'θ': 'theta', alpha: 'alpha', 'α': 'alpha', beta: 'beta', 'β': 'beta', phi: 'phi', 'φ': 'phi', lambda: 'lambda', 'λ': 'lambda', mu: 'mu', 'μ': 'mu', omega: 'omega', 'ω': 'omega' };
  // other Greek letter names and symbols are refused with a message, never split into letters
  // (“eta” as e·t·a) or read as products (“gamma(x)” as γ·x)
  const GREEK_OTHER = { epsilon: 'ε', upsilon: 'υ', omicron: 'ο', kappa: 'κ', gamma: 'γ', delta: 'δ', sigma: 'σ', iota: 'ι', zeta: 'ζ', tau: 'τ', rho: 'ρ', psi: 'ψ', chi: 'χ', eta: 'η', nu: 'ν', xi: 'ξ' };
  const GREEK_OTHER_SYM = Object.fromEntries(Object.entries(GREEK_OTHER).map(([k, v]) => [v, k]).concat([['ς', 'sigma'], ['ϵ', 'epsilon']]));
  const GREEK_LONG = Object.keys(GREEK_OTHER).filter((k) => k.length > 2).sort((a, b) => b.length - a.length);
  const greekError = (name, partial = false) => new ParseError(`“${name}” (${GREEK_OTHER[name]}) isn't a letter I read here. Greek letters I read: θ, α, β, φ, λ, μ and ω (or their names: theta, alpha, beta, phi, lambda, mu, omega). For another constant, use a single Latin letter such as k.`, partial);
  // inverse functions not available here, with how to write each one using functions that are
  const NO_FN = {
    arcsec: 'arcsec x = arccos(1/x)', asec: 'arcsec x = arccos(1/x)',
    arccsc: 'arccsc x = arcsin(1/x)', arccosec: 'arccsc x = arcsin(1/x)', acsc: 'arccsc x = arcsin(1/x)',
    arccot: 'arccot x = π/2 − arctan x', acot: 'arccot x = π/2 − arctan x',
    arcsech: 'arsech x = arcosh(1/x)', arsech: 'arsech x = arcosh(1/x)', asech: 'arsech x = arcosh(1/x)',
    arccsch: 'arcsch x = arsinh(1/x)', arcsch: 'arcsch x = arsinh(1/x)', acsch: 'arcsch x = arsinh(1/x)', arccosech: 'arcsch x = arsinh(1/x)', arcosech: 'arcsch x = arsinh(1/x)',
    arccoth: 'arcoth x = artanh(1/x)', arcoth: 'arcoth x = artanh(1/x)', acoth: 'arcoth x = artanh(1/x)',
  };
  const NO_FN_KEYS = Object.keys(NO_FN).sort((a, b) => b.length - a.length);
  const WORDS = [...Object.keys(FUNCS), ...Object.keys(CONSTS), ...Object.keys(GREEK)].filter((w) => w.length > 1).sort((a, b) => b.length - a.length);
  const SUPS = { '²': '2', '³': '3', '⁴': '4', '¹': '1', '⁰': '0', '⁵': '5', '⁶': '6', '⁻': '-' };

  class ParseError extends Error { constructor(msg, incomplete = false) { super(msg); this.incomplete = incomplete; } }

  function tokenize(src) {
    const toks = [];
    let i = 0;
    const s = src.replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/');
    while (i < s.length) {
      const ch = s[i];
      const space = i > 0 && /\s/.test(s[i - 1]);
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9.]/.test(ch)) {
        const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
        if (!m) throw new ParseError('“.” needs a digit after it');
        if (s[i + m[1].length] === '.') {
          const bad = /^[\d.]+/.exec(s.slice(i))[0];
          throw new ParseError(`“${bad}” isn't a number: it has more than one decimal point`);
        }
        let v = m[1], len = m[1].length;
        // scientific notation written tight: 1e3 = 1000, 2.5e2 = 250 (e followed by a digit)
        const sci = /^[eE](\d+)/.exec(s.slice(i + len));
        if (sci) {
          const n = Number(v + 'e' + sci[1]);
          if (!(n < 1e15)) throw new ParseError(`“${v}${s.slice(i + len, i + len + sci[0].length)}” is too large to work with here (keep numbers below 10¹⁵)`);
          v = String(n); len += sci[0].length;
        } else if (/^[eE][+-]\d/.test(s.slice(i + len)) && !/\s/.test(s[i + len + 1] || '')) {
          const t = /^[eE][+-]\d+/.exec(s.slice(i + len))[0];
          throw new ParseError(`“${v}${t}” is ambiguous: for a power of ten write ${v}·10^(${t.slice(1).replace(/^\+/, '')}); for ${v}e ${t[1] === '-' ? '−' : '+'} ${t.slice(2)} put spaces round the sign`);
        }
        if (!v.includes('.') && v.replace(/^0+/, '').length > 15) throw new ParseError(`“${v}” is too large to work with here (keep numbers below 10¹⁵)`);
        toks.push({ k: 'num', v, space }); i += len; continue;
      }
      if (SUPS[ch] !== undefined) {
        let j = i, t = '';
        while (j < s.length && SUPS[s[j]] !== undefined) t += SUPS[s[j++]];
        toks.push({ k: 'op', v: '^', space }); toks.push({ k: 'num', v: t.replace('-', ''), neg: t.startsWith('-'), space: false });
        i = j; continue;
      }
      if (/[A-Za-zα-ωπθ∞]/.test(ch)) {
        let j = i;
        while (j < s.length && /[A-Za-zα-ωπθ∞]/.test(s[j])) j++;
        const word = s.slice(i, j);
        // split a run of letters into known words and single letters
        let p = 0, first = true, run = 0, runMax = 0;
        while (p < word.length) {
          const rest = word.slice(p).toLowerCase();
          // "oo" and "inf" mean ∞ only on their own, never inside a word such as "floor" or "info"
          const w = WORDS.find((k) => rest.startsWith(k) && (CONSTS[k] !== 'inf' || word.toLowerCase() === k));
          // arcsec, arccot, arccsc and the like: say how to write them instead of reading a·r·c·sec
          const nf = NO_FN_KEYS.find((k) => rest.startsWith(k));
          if (nf && (!w || nf.length > w.length)) {
            const piece = word.slice(p, p + nf.length), plain = nf.replace(/^a(rc?)?/, '');
            throw new ParseError(`“${piece}” isn't available here. Write it with a function I can read: ${NO_FN[nf]}.${nf[1] !== 'r' ? ` (For a times ${plain} x, put a space: a ${plain} x.)` : ''}`, j === s.length);
          }
          if (!w) {
            const gk = GREEK_LONG.find((k) => rest.startsWith(k)) || (GREEK_OTHER[word.toLowerCase()] && p === 0 ? word.toLowerCase() : null);
            if (gk) throw greekError(gk, j === s.length && WORDS.some((k) => k.startsWith(rest)));
            if (GREEK_OTHER_SYM[word[p]]) throw greekError(GREEK_OTHER_SYM[word[p]]);
          }
          run = !w && /[A-Za-z]/.test(word[p]) ? run + 1 : 0;
          runMax = Math.max(runMax, run);
          const piece = w ? word.slice(p, p + w.length) : word[p];
          const low = piece.toLowerCase();
          const sp = first ? space : false;
          // a base written after log: "log10 x", "log2(x)", "log_2 x" (but "log2x" stays log(2x))
          const baseM = low === 'log' && p + 3 === word.length ? /^(_\{?(\d+)\}?|(\d+)(?=\s|\(|$))/.exec(s.slice(j)) : null;
          if (baseM) {
            toks.push({ k: 'fn', v: 'log', raw: piece, base: baseM[2] || baseM[3], space: sp });
            j += baseM[1].length; p += piece.length; first = false; continue;
          }
          if (FUNCS[low] && (w || low.length > 1)) toks.push({ k: 'fn', v: FUNCS[low], raw: piece, space: sp });
          else if (CONSTS[low] && (low !== 'e' || piece === 'e')) toks.push({ k: 'const', v: CONSTS[low], space: sp });
          else if (GREEK[low]) toks.push({ k: 'var', v: GREEK[low], space: sp });
          else toks.push({ k: 'var', v: piece, space: sp });
          p += piece.length; first = false;
        }
        // a word that is not a known function ("ceil(x)", "sgn(x)", "delta"): four or more
        // unknown letters in a row, or three before a bracket, would otherwise be read as a
        // product of single letters; say so instead
        if (runMax >= 4 || (run >= 3 && s[j] === '(')) {
          // still being typed ("arcs" on the way to "arcsin")?
          const partial = j === s.length && WORDS.some((k) => k.startsWith(word.toLowerCase()));
          throw new ParseError(`“${word}” isn't a function or name I know. Functions I can read: sin, cos, tan, sec, csc, cot, arcsin, arccos, arctan, sinh, cosh, tanh, sech, csch, coth, arsinh, arcosh, artanh, ln, log, exp, sqrt, cbrt, abs and erf. For a product of letters, put spaces between them.`, partial);
        }
        i = j; continue;
      }
      if (ch === '√') { toks.push({ k: 'fn', v: 'sqrt', raw: '√', space }); i++; continue; }
      if (ch === '∛') { toks.push({ k: 'fn', v: 'cbrt', raw: '∛', space }); i++; continue; }
      if (ch === '*' && s[i + 1] === '*') { toks.push({ k: 'op', v: '^', space }); i += 2; continue; }
      if (ch === ',' && /\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '')) throw new ParseError('Use a point for decimals: write 1.5, not 1,5');
      if ('+-*/^(),|'.includes(ch)) { toks.push({ k: 'op', v: ch, space }); i++; continue; }
      if ('[{'.includes(ch)) { toks.push({ k: 'op', v: '(', space }); i++; continue; }
      if (']}'.includes(ch)) { toks.push({ k: 'op', v: ')', space }); i++; continue; }
      if (ch === '_' && /log$/i.test(s.slice(0, i))) throw new ParseError('Write the base of the logarithm as a number, for example log_2 x');
      throw new ParseError(`“${ch}” isn't something I can read here`);
    }
    return toks;
  }

  function parse(src) {
    const toks = tokenize(src);
    let i = 0, absDepth = 0;
    const peek = () => toks[i];
    const isOp = (t, v) => t && t.k === 'op' && t.v === v;
    const startsPrimary = (t) => t && (t.k === 'num' || t.k === 'var' || t.k === 'const' || t.k === 'fn' || isOp(t, '(') || (isOp(t, '|') && absDepth === 0));

    function expr() {
      let a = term();
      while (peek() && (isOp(peek(), '+') || isOp(peek(), '-'))) {
        const op = toks[i++].v;
        if (!peek()) throw new ParseError(`Something is missing after “${op}”`, true);
        a = { k: 'bin', op, a, b: term() };
      }
      return a;
    }
    function term() {
      let a = unary();
      for (;;) {
        const t = peek();
        if (isOp(t, '*') || isOp(t, '/')) {
          i++;
          if (!peek()) throw new ParseError(`Something is missing after “${t.v}”`, true);
          a = { k: 'bin', op: t.v, a, b: unary() };
        } else if (startsPrimary(t) || (isOp(t, '|') && absDepth === 0)) {
          a = { k: 'bin', op: '*', a, b: power(), implicit: true };
        } else break;
      }
      return a;
    }
    function unary() {
      const t = peek();
      if (isOp(t, '-')) { i++; if (!peek()) throw new ParseError('Something is missing after “−”', true); return { k: 'neg', a: unary() }; }
      if (isOp(t, '+')) { i++; return unary(); }
      return power();
    }
    function power() {
      const base = primary();
      if (isOp(peek(), '^')) { i++; return { k: 'bin', op: '^', a: base, b: exponent() }; }
      return base;
    }
    // exponents: "e^2x" means e^(2x), "e^-x" means e^(-x)
    function exponent() {
      const t = peek();
      if (!t) throw new ParseError('The power is missing after “^”', true);
      if (isOp(t, '-')) { i++; return { k: 'neg', a: exponent() }; }
      if (t.k === 'num' && t.neg) { t.neg = false; return { k: 'neg', a: exponent() }; }
      let a = primary();
      while (peek() && !peek().space && (peek().k === 'var' || peek().k === 'const') && (a.k === 'num' || a.k === 'var' || a.k === 'const' || a.k === 'bin')) {
        a = { k: 'bin', op: '*', a, b: primary(), implicit: true };
      }
      if (isOp(peek(), '^')) { i++; return { k: 'bin', op: '^', a, b: exponent() }; }
      return a;
    }
    function fnArg() {
      // no brackets: "sin 2x", "ln x" — a run of numbers, letters and their powers
      const t = peek();
      if (!t) throw new ParseError('The function needs something after it', true);
      if (isOp(t, '-')) { i++; return { k: 'neg', a: fnArg() }; }
      if (t.k === 'fn' || isOp(t, '|')) return power();
      let a = power();
      // keep reading only while written tight: "sin 2x" = sin(2x), but "sin x e^x" = sin(x)·e^x
      while (peek() && !peek().space && (peek().k === 'var' || peek().k === 'const' || (peek().k === 'num' && a.k !== 'num')) && !isOp(peek(), '(')) {
        a = { k: 'bin', op: '*', a, b: power(), implicit: true };
      }
      return a;
    }
    function primary() {
      const t = toks[i];
      if (!t) throw new ParseError('Something is missing at the end', true);
      if (t.k === 'num') { i++; return { k: 'num', v: t.v }; }
      if (t.k === 'var') { i++; return { k: 'var', v: t.v }; }
      if (t.k === 'const') { i++; return { k: 'const', v: t.v }; }
      if (isOp(t, '(')) {
        i++;
        if (!peek()) throw new ParseError('Add what goes inside the bracket, then close it', true);
        if (isOp(peek(), ')')) throw new ParseError('Empty brackets “()”');
        const a = expr();
        if (!isOp(peek(), ')')) throw new ParseError('Missing a closing bracket “)”', !peek());
        i++;
        return { k: 'paren', a };
      }
      if (isOp(t, '|')) {
        i++; absDepth++;
        const a = expr();
        absDepth--;
        if (!isOp(peek(), '|')) throw new ParseError('Missing a closing bar “|”', !peek());
        i++;
        return { k: 'abs', a };
      }
      if (t.k === 'fn') {
        i++;
        let pw = null;
        if (isOp(peek(), '^')) {
          i++;
          if (isOp(peek(), '(')) pw = primary();
          else if (isOp(peek(), '-')) { i++; const n = primary(); pw = { k: 'neg', a: n }; }
          else if (peek() && peek().k === 'num' && peek().neg) { const n = primary(); pw = { k: 'neg', a: n }; }
          else pw = primary();
        }
        let arg;
        if (isOp(peek(), '(') && !toks[i + 1]) throw new ParseError(`Add what goes inside ${t.raw || t.v}( ), then close the bracket`, true);
        if (isOp(peek(), '(')) arg = primary();
        else arg = fnArg();
        return { k: 'fn', f: t.v, raw: t.raw, arg, pw, base: t.base };
      }
      if (isOp(t, ')')) throw new ParseError('There is a “)” without a matching “(”');
      if (isOp(t, '|')) throw new ParseError('Unexpected “|”');
      throw new ParseError(`Something is missing before “${t.v}”`, false);
    }

    const tree = expr();
    if (i < toks.length) {
      const t = toks[i];
      if (isOp(t, ')')) throw new ParseError('There is a “)” without a matching “(”');
      throw new ParseError(`Unexpected “${t.v}”`);
    }
    return tree;
  }

  // ---------- syntax tree → CAS expression ----------
  const strip = (n) => (n.k === 'paren' ? strip(n.a) : n);
  function numFromString(s) {
    if (!s.includes('.')) return C.N(Number(s));
    const [a, b] = s.split('.');
    const d = Math.pow(10, b.length);
    return C.N(Number(a || '0') * d + Number(b || '0'), d);
  }
  function toExpr(n) {
    const { N, S, add, mul, pow, fn, NEG1, HALF } = C;
    switch (n.k) {
      case 'num': return numFromString(n.v);
      case 'var': return S(n.v);
      case 'const': if (n.v === 'inf') return C.F(Infinity); return S(n.v);
      case 'paren': return toExpr(n.a);
      case 'neg': return mul(NEG1, toExpr(n.a));
      case 'abs': return fn('abs', toExpr(n.a));
      case 'bin': {
        const a = toExpr(n.a), b = toExpr(n.b);
        switch (n.op) {
          case '+': return add(a, b);
          case '-': return add(a, mul(NEG1, b));
          case '*': return mul(a, b);
          case '/': return mul(a, pow(b, NEG1));
          case '^': return pow(a, b);
        }
        break;
      }
      case 'fn': {
        const x = toExpr(n.arg);
        let pw = n.pw ? toExpr(n.pw) : null;
        let f = n.f;
        const INV = { sin: 'asin', cos: 'acos', tan: 'atan', sinh: 'asinh', cosh: 'acosh', tanh: 'atanh' };
        if (pw && C.isNum(pw) && C.val(pw) === -1 && INV[f]) { f = INV[f]; pw = null; }
        let r;
        switch (f) {
          case 'sqrt': r = pow(x, HALF); break;
          case 'cbrt': r = pow(x, N(1, 3)); break;
          case 'exp': r = pow(C.E, x); break;
          case 'log': r = mul(fn('ln', x), pow(fn('ln', N(Number(n.base || 10))), NEG1)); break;
          case 'sech': r = pow(fn('cosh', x), NEG1); break;
          case 'csch': r = pow(fn('sinh', x), NEG1); break;
          case 'coth': r = mul(fn('cosh', x), pow(fn('sinh', x), NEG1)); break;
          default: r = fn(f, x);
        }
        return pw ? pow(r, pw) : r;
      }
    }
    throw new ParseError('Could not understand this expression');
  }

  // ---------- reject constant parts that are not real numbers: 1/0, ln(0), √(−1) ----------
  const FN_TXT = { asin: 'arcsin', acos: 'arccos', atan: 'arctan', asinh: 'arsinh', acosh: 'arcosh', atanh: 'artanh' };
  function astText(n) {
    switch (n.k) {
      case 'num': return n.v;
      case 'var': return n.v;
      case 'const': return n.v === 'pi' ? 'π' : n.v === 'inf' ? '∞' : 'e';
      case 'paren': return '(' + astText(n.a) + ')';
      case 'abs': return '|' + astText(n.a) + '|';
      case 'neg': return '−' + astText(n.a);
      case 'bin': return astText(n.a) + (n.implicit ? ' ' : n.op === '-' ? ' − ' : n.op === '+' ? ' + ' : n.op) + astText(n.b);
      case 'fn': {
        const a = strip(n.arg);
        const inner = n.f === 'sqrt' && n.raw === '√' ? '√' : (FN_TXT[n.f] || n.f);
        return inner + (n.pw ? '^' + astText(n.pw) : '') + '(' + astText(a) + ')';
      }
    }
    return '';
  }
  function checkFinite(n) {
    if (!n || typeof n !== 'object') return;
    for (const k of ['a', 'b', 'arg', 'pw']) if (n[k]) checkFinite(n[k]);
    const zero = (m) => !vars(m).size && C.evalN(toExpr(m), {}) === 0;
    if (n.k === 'bin' && n.op === '/' && zero(n.b)) throw new ParseError(`Division by zero: ${astText(n)} is undefined`);
    if (n.k === 'bin' && n.op === '^' && !vars(n.a).size && vars(n.b).size && C.evalN(toExpr(n.a), {}) < 0) {
      const b = strip(n.a), v = [...vars(n.b)][0];
      const vt = { theta: 'θ', alpha: 'α', beta: 'β', phi: 'φ', lambda: 'λ', mu: 'μ', omega: 'ω' }[v] || v;
      throw new ParseError(`${astText(n)} isn't a real-valued function: a negative number raised to a power that depends on ${vt} is not a real number for most values of ${vt}.${b.k === 'neg' && astText(b.a) !== '1' ? ` To mean −(${astText(b.a)}^${astText(strip(n.b))}), write −${astText(b.a)}^${n.b.k === 'paren' ? astText(n.b) : astText(strip(n.b))}.` : ''}`);
    }
    if (n.k === 'paren' || vars(n).size) return;
    if (n.k === 'const' && n.v === 'inf') throw new ParseError('∞ can only be used as a limit, not inside the integrand');
    const v = C.evalN(toExpr(n), {});
    if (Number.isFinite(v) && Math.abs(v) >= 1e15) {
      if (n.k === 'fn' && ['tan', 'sec', 'csc', 'cot'].includes(n.f)) throw new ParseError(`${astText(n)} is undefined`);
      throw new ParseError(`${astText(n)} is too large to work with here (keep numbers below 10¹⁵)`);
    }
    if (Number.isFinite(v)) return;
    if (n.k === 'bin' && n.op === '^' && zero(n.a)) throw new ParseError(`${astText(n)} is undefined (it means dividing by zero)`);
    if (n.k === 'fn' && (n.f === 'ln' || n.f === 'log') && zero(n.arg)) throw new ParseError(`${astText(n)} is undefined`);
    throw new ParseError(Number.isNaN(v) ? `${astText(n)} is not a real number` : `${astText(n)} is undefined`);
  }

  // ---------- syntax tree → LaTeX (faithful to what was typed) ----------
  const FN_TEX = {
    sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc', cot: '\\cot', asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan',
    sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', sech: '\\operatorname{sech}', csch: '\\operatorname{csch}', coth: '\\coth',
    asinh: '\\operatorname{arsinh}', acosh: '\\operatorname{arcosh}', atanh: '\\operatorname{artanh}', ln: '\\ln', log: '\\log_{10}', exp: '\\exp', erf: '\\operatorname{erf}', abs: '',
  };
  const GT = { theta: '\\theta', alpha: '\\alpha', beta: '\\beta', phi: '\\phi', lambda: '\\lambda', mu: '\\mu', omega: '\\omega' };
  function prec(n) {
    switch (n.k) {
      case 'bin': return { '+': 1, '-': 1, '*': 2, '/': 3, '^': 4 }[n.op];
      case 'neg': return 1.5;
      default: return 5;
    }
  }
  function astTex(n) {
    switch (n.k) {
      case 'num': return n.v;
      case 'var': return GT[n.v] || n.v;
      case 'const': return n.v === 'pi' ? '\\pi' : n.v === 'inf' ? '\\infty' : 'e';
      case 'paren': return '\\left(' + astTex(n.a) + '\\right)';
      case 'abs': return '\\left|' + astTex(n.a) + '\\right|';
      case 'neg': { const a = astTex(n.a); return '-' + (prec(n.a) <= 1.5 && n.a.k !== 'paren' ? '\\left(' + a + '\\right)' : a); }
      case 'bin': {
        if (n.op === '/') return '\\frac{' + astTex(strip(n.a)) + '}{' + astTex(strip(n.b)) + '}';
        if (n.op === '^') {
          const b = n.a;
          let bt = astTex(b);
          if (b.k === 'fn' && !b.pw && ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh'].includes(b.f)) {
            // sin(x)^2 shows as sin²(x)
            return FN_TEX[b.f] + '^{' + astTex(strip(n.b)) + '}' + argTex(b.arg);
          }
          if (b.k === 'bin' || b.k === 'neg' || (b.k === 'fn' && b.f !== 'sqrt' && b.f !== 'abs')) bt = '\\left(' + bt + '\\right)';
          return bt + '^{' + astTex(strip(n.b)) + '}';
        }
        const a = astTex(n.a), b = astTex(n.b);
        if (n.op === '+') return a + ' + ' + b;
        if (n.op === '-') return a + ' - ' + (prec(n.b) <= 1 ? '\\left(' + b + '\\right)' : b);
        const wa = prec(n.a) < 2 ? '\\left(' + a + '\\right)' : a;
        const wb = prec(n.b) < 2 ? '\\left(' + b + '\\right)' : b;
        if (n.implicit) {
          const lastA = rightmost(n.a), firstB = leftmost(n.b);
          if (lastA.k === 'num' && firstB.k === 'num') return wa + ' \\cdot ' + wb;
          return wa + (/[a-zA-Z0-9}]$/.test(wa) && /^[a-zA-Z]/.test(wb) ? ' ' : '') + wb;
        }
        const lastA = rightmost(n.a), firstB = leftmost(n.b);
        if (firstB.k === 'num' || (lastA.k === 'num' && firstB.k === 'num')) return wa + ' \\cdot ' + wb;
        return wa + (/[a-zA-Z0-9}]$/.test(wa) && /^[a-zA-Z]/.test(wb) ? ' ' : '') + wb;
      }
      case 'fn': {
        if (n.f === 'sqrt') return '\\sqrt{' + astTex(strip(n.arg)) + '}' + (n.pw ? '^{' + astTex(strip(n.pw)) + '}' : '');
        if (n.f === 'cbrt') return '\\sqrt[3]{' + astTex(strip(n.arg)) + '}';
        if (n.f === 'abs') return '\\left|' + astTex(strip(n.arg)) + '\\right|';
        if (n.f === 'exp') return 'e^{' + astTex(strip(n.arg)) + '}';
        const name = n.f === 'log' && n.base ? `\\log_{${n.base}}` : FN_TEX[n.f] || '\\operatorname{' + n.f + '}';
        const pw = n.pw ? '^{' + astTex(strip(n.pw)) + '}' : '';
        return name + pw + argTex(n.arg);
      }
    }
    return '';
  }
  function argTex(a) {
    const s = strip(a);
    if (s.k === 'var' || s.k === 'const' || s.k === 'num') return ' ' + astTex(s);
    return '\\left(' + astTex(s) + '\\right)';
  }
  function leftmost(n) { while (n.k === 'bin' && n.op !== '/') n = n.a; return n; }
  function rightmost(n) { while (n.k === 'bin' && n.op !== '/' && n.op !== '^') n = n.b; return n; }

  function vars(n, out = new Set()) {
    if (!n) return out;
    if (n.k === 'var') out.add(n.v);
    for (const k of ['a', 'b', 'arg', 'pw']) if (n[k]) vars(n[k], out);
    return out;
  }

  // Strip a leading ∫ / "int" and a trailing "dx" if the user typed them.
  // the variable of integration: a single Latin letter, or θ, α, β, φ, λ, μ, ω by symbol or name
  const VAR_RE = '(theta|alpha|beta|phi|lambda|mu|omega|[a-zθαβφλμω])';
  function normVar(w) {
    const t = String(w || '').trim();
    if (!t) return '';
    const k = t.toLowerCase();
    if (GREEK[k] || GREEK[t]) return GREEK[k] || GREEK[t];
    if (/^[A-Za-z]$/.test(t)) return t;
    if (GREEK_OTHER[k]) throw greekError(k);
    if (GREEK_OTHER_SYM[t]) throw greekError(GREEK_OTHER_SYM[t]);
    throw new ParseError(`“${t}” can't be the variable: use a single letter such as x or t, or one of θ, α, β, φ, λ, μ, ω.`);
  }
  // Strip a leading ∫ / "int" and a trailing "dx" if the user typed them.
  function clean(src) {
    // LaTeX spacing (x^2\,dx) is just a space; a full stop after the differential is punctuation
    let s = src.trim().replace(/^(∫|int\b|integral\b)\s*/i, '').replace(/\\[,;:! ]/g, ' ');
    s = s.replace(new RegExp('(d\\s*' + VAR_RE + ')\\s*[.;]\\s*$', 'i'), '$1');
    let v = null;
    const V = (w) => normVar(w);
    const only = new RegExp('^d\\s*' + VAR_RE + '$', 'i').exec(s);
    if (only) return { s: '1', v: V(only[1]) };
    // "dx/x" or "dx / (1 + x²)": the textbook way of writing ∫ 1/x dx
    const over = new RegExp('^d\\s*' + VAR_RE + '\\s*\\/(.+)$', 'i').exec(s);
    if (over && !/^\s*d/i.test(over[2])) return { s: '1/(' + over[2].trim() + ')', v: V(over[1]) };
    // "x^2 dx", "sin(x)dx", and written tight after a letter: "xdx", "tdt"
    let m = new RegExp('(?:^|[\\s)\\]}\\d*|A-Za-zθαβφλμω])d\\s*' + VAR_RE + '\\s*$', 'i').exec(s);
    // (a letter before the d, but not the end of “lambda”)
    if (m && /^[A-Za-zθαβφλμω]/.test(m[0]) && /lambda$/i.test(s)) m = null;
    if (m && s.length > m[0].length - 1) {
      const cut = s.length - m[0].length + (m[0][0] === 'd' && m.index === 0 ? 0 : 1);
      if (cut > 0) { v = V(m[1]); s = s.slice(0, cut).trim(); }
    }
    if (!v) {
      // a trailing "dtau" or "dxy": a differential whose variable isn't a single letter
      const dw = /(?:^|[\s)\]}\d*])d([A-Za-zα-ω]{2,})\s*$/.exec(s);
      if (dw) {
        const g = dw[1].toLowerCase();
        if (GREEK_OTHER['d' + g]) throw greekError('d' + g);
        if (GREEK_OTHER[g]) throw greekError(g);
        throw new ParseError(`“d${dw[1]}” at the end reads as d times ${dw[1]}. The variable of integration has to be a single letter (dx, dt) or a Greek letter such as dθ.`);
      }
    }
    // a "dx" anywhere else ("e^x dx + 1", "dx x") would be read as d times x: say where it goes
    // (LaTeX left in the input is reported by the reader instead)
    const stray = s.includes('\\') ? null : /(?:^|[^A-Za-z])(d(?:theta|θ|[A-Za-z]))(?![A-Za-z^(])/.exec(s);
    if (stray) throw new ParseError(`“${stray[1]}” has to go at the very end, as in “x^2 ${stray[1]}” (or at the start for “${stray[1]}/x”)`);
    return { s, v };
  }

  G.PARSE = { parse, toExpr, astTex, vars, clean, ParseError, strip, checkFinite, normVar };
})(typeof window !== 'undefined' ? window : globalThis);
