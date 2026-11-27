/* app.js — wires the page: input, live preview, solving, answer, graph and working. */
{
  'use strict';
  const C = window.CAS, SV = window.SOLVE, PR = window.PARSE;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hasKatex = typeof window.katex !== 'undefined';
  const K = (tex, display = false) => {
    if (!hasKatex) return '<code>' + esc(tex) + '</code>';
    try { return window.katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml', strict: false }); }
    catch (e) { return '<code>' + esc(tex) + '</code>'; }
  };
  // sentence with $inline maths$
  const md = (s) => s.split(/(\$[^$]+\$)/g).map((p) => (p.startsWith('$') && p.endsWith('$') && p.length > 2 ? K(p.slice(1, -1)) : esc(p))).join('');
  const dvar = (x) => C.symTex(x);

  const EXAMPLES = [
    { name: 'Basics', items: [['x^3 + 2x - 5'], ['1/x'], ['sqrt(x)'], ['e^(3x)'], ['sin(2x)'], ['sec^2 x'], ['3^x'], ['(2x + 1)^5']] },
    { name: 'Substitution', items: [['2x cos(x^2)'], ['x e^(x^2)'], ['ln(x)/x'], ['x/(x^2 + 1)'], ['sin^3 x cos x'], ['e^x/(1 + e^(2x))'], ['x^3 sqrt(x^2 + 1)'], ['1/(1 + sqrt x)']] },
    { name: 'By parts', items: [['x e^x'], ['x^2 sin x'], ['ln x'], ['x ln x'], ['e^x sin x'], ['arctan x'], ['x sec^2 x'], ['e^(2x) cos(3x)']] },
    { name: 'Partial fractions', items: [['1/(x^2 - 1)'], ['(3x + 5)/(x^2 + x - 2)'], ['1/(x(x + 1)^2)'], ['(x^3 + 1)/(x^2 - x)'], ['1/(x^3 + x)'], ['1/(1 + e^x)'], ['(x + 1)/(x^2 + 2x + 5)'], ['1/(x^2 + 4x + 13)']] },
    { name: 'Trigonometric', items: [['sin^2 x'], ['cos^3 x'], ['tan^2 x'], ['sin^2 x cos^2 x'], ['sec^3 x'], ['sin(3x) cos(2x)'], ['tan^3 x'], ['1/(sin x cos x)']] },
    { name: 'Roots & trig sub', items: [['sqrt(1 - x^2)'], ['1/sqrt(4 - x^2)'], ['x^2/sqrt(1 - x^2)'], ['sqrt(1 + x^2)'], ['1/(1 + x^2)^(3/2)'], ['1/(x^2 sqrt(4 - x^2))'], ['1/sqrt(x^2 + 2x + 5)'], ['sqrt(3 - 2x - x^2)']] },
    { name: 'Definite', items: [['x sin x', '0', 'pi'], ['sin^2 x', '0', 'pi/2'], ['sqrt(4 - x^2)', '0', '2'], ['x^2 e^x', '0', '1'], ['1/(x^2 - 1)', '2', '3'], ['e^(-x^2)', '0', '1'], ['sin(x)/x', '0', 'pi'], ['|x - 1|', '0', '3']] },
    { name: 'Improper', items: [['e^(-x)', '0', 'inf'], ['1/(1 + x^2)', '-inf', 'inf'], ['ln x', '0', '1'], ['1/sqrt x', '0', '1'], ['1/x^2', '1', 'inf'], ['x e^(-x)', '0', 'inf'], ['1/x^2', '-1', '1'], ['1/x', '1', 'inf']] },
  ];
  const HELP = [
    ['x^2', 'x^{2}'], ['2x sin x', '2x\\sin x'], ['sin^2 x', '\\sin^{2} x'], ['sqrt(1-x^2)', '\\sqrt{1-x^{2}}'], ['e^2x', 'e^{2x}'],
    ['ln x / x', '\\frac{\\ln x}{x}'], ['|x|', '\\left|x\\right|'], ['abs(x)', '\\left|x\\right|'], ['arctan x', '\\arctan x'], ['sin^-1 x', '\\arcsin x'], ['x^(1/3)', 'x^{1/3}'], ['cbrt(x)', '\\sqrt[3]{x}'], ['exp(2x)', 'e^{2x}'], ['log x', '\\log_{10} x'], ['log_2 x', '\\log_{2} x'], ['log2(x)', '\\log_{2} x'], ['1e3', '1000'], ['pi', '\\pi'], ['a x + b', 'ax + b \\text{ (a, b constants)}'], ['x^2 dx', '\\int x^{2}\\,dx'], ['dx/x', '\\int \\frac{1}{x}\\,dx'], ['sin theta dtheta', '\\int \\sin\\theta\\,d\\theta'],
  ];

  const state = { mode: 'indefinite', lastFocus: null, result: null, timer: null, errTimer: null, showAll: true, recent: [], view: null, vw: null, viewKey: '' };
  const els = {
    expr: $('expr'), v: $('var'), lower: $('lower'), upper: $('upper'), bounds: $('bounds'), preview: $('preview'), msg: $('msg'),
    ansMath: $('ansMath'), ansText: $('ansText'), check: $('check'), ansActions: $('ansActions'), steps: $('steps'),
    legend: $('legend'), cv: $('cv'), fig: $('fig'), readout: $('readout'), toggleAll: $('toggleAll'), gHint: $('gHint'),
  };
  const STORE = 'integral-solver-v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; } };
  const save = () => {
    try { localStorage.setItem(STORE, JSON.stringify({ expr: els.expr.value, v: els.v.value, lower: els.lower.value, upper: els.upper.value, mode: state.mode, recent: state.recent })); } catch (e) { /* storage unavailable */ }
  };

  // ---------- mode ----------
  function setMode(m, focus = false) {
    state.mode = m;
    // radio group: only the checked option is in the tab order (arrow keys move between them)
    document.querySelectorAll('.modes button').forEach((b) => { b.setAttribute('aria-checked', String(b.dataset.mode === m)); b.tabIndex = b.dataset.mode === m ? 0 : -1; });
    els.bounds.hidden = m !== 'definite';
    document.querySelectorAll('.keypad [data-bound]').forEach((b) => { b.disabled = m !== 'definite'; });
    if (m === 'definite' && !els.lower.value && !els.upper.value) { els.lower.value = '0'; els.upper.value = '1'; }
    if (focus && m === 'definite') els.upper.focus();
  }
  document.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.mode, true); update(true); }));
  document.querySelector('.modes').addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const m = state.mode === 'definite' ? 'indefinite' : 'definite';
      setMode(m); document.querySelector(`.modes [data-mode="${m}"]`).focus(); update(true);
    }
  });

  // ---------- keypad ----------
  [els.expr, els.lower, els.upper, els.v].forEach((i) => i.addEventListener('focus', () => { state.lastFocus = i; }));
  // on touch screens the keypad shows only while a field is being edited; it goes ~250 ms
  // after focus leaves so a tap on a key still lands
  const problemCard = document.querySelector('.problem');
  let kpTimer = null;
  const editingNow = () => { const a = document.activeElement; return !!a && problemCard.contains(a) && a.matches('input, .keypad button'); };
  // focus landing on Solve or the mode switch ends editing at once (some phones focus buttons)
  problemCard.addEventListener('focusin', () => { clearTimeout(kpTimer); problemCard.classList.toggle('editing', editingNow()); });
  problemCard.addEventListener('focusout', () => { clearTimeout(kpTimer); kpTimer = setTimeout(() => { if (!editingNow()) problemCard.classList.remove('editing'); }, 250); });
  $('keypad').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  $('keypad').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    let target = state.lastFocus && state.lastFocus !== els.v ? state.lastFocus : els.expr;
    if (b.dataset.bound && target === els.expr) target = els.upper;
    const ins = b.dataset.ins, close = b.dataset.close || '';
    const s = target.selectionStart ?? target.value.length, en = target.selectionEnd ?? s;
    const sel = target.value.slice(s, en);
    target.value = target.value.slice(0, s) + ins + sel + close + target.value.slice(en);
    const caret = s + ins.length + sel.length + (sel ? close.length : 0);
    target.focus();
    target.setSelectionRange(caret, caret);
    update(false);
  });

  // ---------- examples ----------
  let exTab = 0;
  function renderTabs() {
    const tabs = [...EXAMPLES.map((g) => g.name), 'Recent'];
    $('exTabs').innerHTML = tabs.map((t, i) => `<button type="button" role="tab" id="tab${i}" aria-selected="${i === exTab}" tabindex="${i === exTab ? 0 : -1}">${esc(t)}</button>`).join('');
    renderExamples();
  }
  function exTex(it) {
    try {
      const { s } = PR.clean(it[0]);
      const t = PR.astTex(PR.parse(s));
      const v = SV.preview(it[0]).x;
      const bnd = it.length > 2 ? `_{${boundTex(it[1])}}^{${boundTex(it[2])}}` : '';
      return `\\int${bnd} ${t}\\,d${dvar(v)}`;
    } catch (e) { return it[0]; }
  }
  function boundTex(s) {
    const t = s.trim().toLowerCase();
    if (/^\+?(inf|∞)$/.test(t)) return '\\infty';
    if (/^-(inf|∞)$/.test(t)) return '-\\infty';
    try { return PR.astTex(PR.parse(s)); } catch (e) { return s; }
  }
  function renderExamples() {
    const items = exTab < EXAMPLES.length ? EXAMPLES[exTab].items : state.recent;
    $('exList').setAttribute('aria-labelledby', 'tab' + exTab);
    if (!items.length) { $('exList').innerHTML = '<p class="empty">Integrals you solve will appear here.</p>'; return; }
    $('exList').innerHTML = items.map((it, i) => `<button type="button" data-i="${i}" aria-label="${esc(it.length > 2 ? `Integral of ${it[0]} from ${it[1]} to ${it[2]}` : `Integral of ${it[0]}`)}">${K(exTex(it))}</button>`).join('');
  }
  $('exTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    exTab = [...$('exTabs').children].indexOf(b); renderTabs(); $('tab' + exTab).focus();
  });
  $('exTabs').addEventListener('keydown', (e) => {
    const n = EXAMPLES.length + 1;
    const to = { ArrowRight: (exTab + 1) % n, ArrowLeft: (exTab + n - 1) % n, Home: 0, End: n - 1 }[e.key];
    if (to !== undefined) { exTab = to; renderTabs(); $('tab' + exTab).focus(); e.preventDefault(); }
  });
  $('exList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const items = exTab < EXAMPLES.length ? EXAMPLES[exTab].items : state.recent;
    loadProblem(items[+b.dataset.i]);
    if (window.matchMedia('(max-width: 900px)').matches) document.querySelector('.problem').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  function loadProblem(it) {
    els.expr.value = it[0];
    els.v.value = '';
    if (it.length > 2) { setMode('definite'); els.lower.value = it[1]; els.upper.value = it[2]; }
    else setMode('indefinite');
    update(true);
  }

  // ---------- input handling ----------
  function update(now) {
    clearTimeout(state.timer);
    renderPreview();
    if (now) solveNow();
    else state.timer = setTimeout(solveNow, 450);
  }
  function setStale(on) { document.querySelectorAll('.answer, .graph, .working').forEach((c) => c.classList.toggle('stale', on)); }
  function showMsg(text, kind) {
    els.msg.textContent = text || '';
    els.msg.className = 'msg' + (kind ? ' ' + kind : '');
  }
  function renderPreview() {
    clearTimeout(state.errTimer);
    els.expr.classList.remove('bad'); els.lower.classList.remove('bad'); els.upper.classList.remove('bad');
    let p;
    try { p = SV.preview(els.expr.value, els.v.value.trim()); }
    catch (e) {
      els.preview.classList.add('empty');
      els.preview.innerHTML = '';
      const typing = document.activeElement === els.expr;
      if (e.incomplete && typing) { showMsg('Keep typing…'); state.errTimer = setTimeout(() => { showMsg(e.message, 'error'); els.expr.classList.add('bad'); }, 1400); }
      else if (typing) { showMsg(''); state.errTimer = setTimeout(() => { showMsg(e.message, 'error'); els.expr.classList.add('bad'); }, 850); }
      else { showMsg(e.message, 'error'); els.expr.classList.add('bad'); }
      return null;
    }
    if (p.empty) {
      els.preview.classList.add('empty');
      els.preview.innerHTML = 'Your integral will appear here as it is read.';
      showMsg('');
      return null;
    }
    els.preview.classList.remove('empty');
    if (!els.v.value.trim()) els.v.placeholder = C.symTxt(p.x);
    let lim = '';
    if (state.mode === 'definite') lim = `_{${els.lower.value.trim() ? boundTex(els.lower.value) : '\\square'}}^{${els.upper.value.trim() ? boundTex(els.upper.value) : '\\square'}}`;
    els.preview.innerHTML = K(`\\int${lim} ${p.tex}\\,d${dvar(p.x)}`, true);
    showMsg('');
    return p;
  }
  els.expr.addEventListener('input', () => update(false));
  [els.lower, els.upper, els.v].forEach((i) => i.addEventListener('input', () => update(false)));
  [els.expr, els.lower, els.upper, els.v].forEach((i) => {
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); update(true); } });
    i.addEventListener('blur', () => { if (els.msg.textContent === 'Keep typing…') renderPreview(); });
  });
  $('solveBtn').addEventListener('click', () => update(true));

  // ---------- solving ----------
  const ICON_OK = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M6.5 10.2l2.4 2.4 4.6-5"/></svg>';
  const ICON_WARN = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3l8 14H2z"/><path d="M10 8.5v3.8M10 14.6v.2"/></svg>';
  function solveNow() {
    clearTimeout(state.timer);
    let r;
    try {
      r = SV.solve({ integrand: els.expr.value, mode: state.mode, lower: els.lower.value, upper: els.upper.value, variable: els.v.value.trim() });
    } catch (e) {
      if (e instanceof PR.ParseError) {
        const where = /^(A|That) limit/.test(e.message) ? (document.activeElement === els.lower ? els.lower : els.upper) : null;
        if (where) where.classList.add('bad');
        if (!(e.incomplete && document.activeElement === els.expr)) showMsg(e.message, 'error');
        setStale(true);
        return;
      }
      console.error(e);
      showMsg('Something went wrong while solving this one.', 'error');
      setStale(true);
      return;
    }
    setStale(false);
    if (r.empty) { state.result = null; state.view = null; renderEmpty(); save(); return; }
    r.mode = state.mode;
    const vk = [state.mode, els.expr.value.trim(), els.v.value.trim(), state.mode === 'definite' ? els.lower.value.trim() + '|' + els.upper.value.trim() : ''].join('|');
    if (vk !== state.viewKey) { state.view = null; state.viewKey = vk; }
    state.result = r;
    els.readout.hidden = true;
    renderAnswer(r);
    renderSteps(r);
    drawGraph();
    remember(r);
    save();
  }
  function renderEmpty() {
    els.ansMath.dataset.tex = '';
    els.ansMath.innerHTML = '<span class="placeholder">Type an integrand, or pick an example.</span>';
    els.ansText.textContent = ''; els.check.innerHTML = ''; els.check.className = 'check'; els.ansActions.hidden = true;
    markAnswerScroll();
    els.steps.innerHTML = ''; els.toggleAll.hidden = true; els.legend.innerHTML = ''; els.gHint.textContent = '';
    drawGraph();
  }
  function intHead(r) {
    const lim = r.a && r.b ? `_{${r.a.tex}}^{${r.b.tex}}` : '';
    return `\\int${lim} ${r.integrandTex}\\,d${dvar(r.x)}`;
  }
  // "its integral defines the sine integral Si(x)" only when the function has a name
  const neClause = (r) => (r.nonElementary && r.nonElementary !== 'no named function' ? ` (its integral defines ${esc(r.nonElementary)})` : '');
  // numeric check shown to as many digits as agree with the exact value (6 to 10)
  function agreeDigits(a, b) {
    const rel = Math.abs(a - b) / (Math.abs(b) || 1);
    return rel === 0 ? 10 : Math.max(6, Math.min(10, Math.floor(-Math.log10(rel))));
  }
  // significant figures a numerical value supports, from its error estimate (3 to 10)
  function numDigits(n) {
    if (!n || !(n.error > 0)) return 10;
    const rel = n.error / Math.max(Math.abs(n.value), 1e-300);
    return Math.max(3, Math.min(10, Math.floor(-Math.log10(rel))));
  }
  const texNum = (nv) => nv.replace(' × 10^', '\\times 10^{') + (nv.includes('×') ? '}' : '');
  function setCheck(kind, html) { els.check.className = 'check ' + kind; els.check.innerHTML = (kind === 'ok' ? ICON_OK : ICON_WARN) + `<span>${html}</span>`; }

  function renderAnswer(r) {
    els.check.innerHTML = ''; els.check.className = 'check';
    els.ansText.classList.remove('show');
    const head = intHead(r);
    const v = dvar(r.x);
    state.copy = null;
    if (state.mode !== 'definite') {
      if (r.F) {
        setAns(`${head} = ${r.Ftex} + C`);
        els.ansText.textContent = r.Ftext + ' + C';
        state.copy = { text: r.Ftext + ' + C', tex: r.Ftex + ' + C' };
        if (r.verify.ok) setCheck('ok', `Checked: differentiating the answer gives back the integrand.${r.params.length ? ` Letters ${r.params.map((p) => '$' + C.symTex(p) + '$').join(', ')} are treated as constants.` : ''}`.replace(/\$([^$]+)\$/g, (m, t) => K(t)));
        else setCheck('warn', 'The automatic check could not confirm this answer at enough points, so treat it with care.');
      } else {
        setAns(`${head}`);
        els.ansText.textContent = '';
        if (r.nonElementary) setCheck('warn', `This integral has no antiderivative made of elementary functions${neClause(r)}. Switch to <b>Definite</b> to get a numerical value.`);
        else if (r.absInside) setCheck('warn', 'Absolute values around expressions in the variable aren’t supported for indefinite integrals here: the answer changes form wherever the inside changes sign. Split it into cases by hand, or switch to <b>Definite</b> for a value over an interval.');
        else if (r.timeout) setCheck('warn', 'This one took too long, so the search was stopped. Try simplifying it, or switch to <b>Definite</b> for a numerical value.');
        else setCheck('warn', 'No antiderivative found with the methods available here. That doesn’t mean there isn’t one: it may need a method this tool doesn’t cover (or a longer chain of steps than it tries), or it may have no elementary antiderivative. Switch to <b>Definite</b> for a numerical value.');
      }
    } else {
      if (r.needBounds) {
        setAns(head);
        els.ansText.textContent = '';
        setCheck('warn', 'Enter both limits to evaluate the definite integral.');
      } else if (r.undefinedPart) {
        setAns(head);
        els.ansText.textContent = '';
        setCheck('warn', esc(r.notes[0]));
      } else if (r.diverges) {
        setAns(`${head} \\text{ diverges}`);
        els.ansText.textContent = 'diverges';
        state.copy = { text: 'diverges', tex: head + '\\text{ diverges}' };
        const at = r.divergesAt;
        const where = at === undefined ? '' : Number.isFinite(at) ? ` near $${v} = ${C.tex(SV.identify(at) || C.F(at), r.x)}$` : ` as $${v} \\to ${at > 0 ? '\\infty' : '-\\infty'}$`;
        if (r.oscillates) setCheck('warn', md(`The area never settles${where}: it keeps swinging up and down without approaching a limit, so this improper integral has no value.`));
        else setCheck('warn', md(`The area is infinite${where}, so this improper integral has no finite value.`));
      } else if (r.tooLarge) {
        // finite (the integrand is continuous on the closed interval) but beyond 10^308
        const big = r.tooLarge;
        setAns(big.exact ? `${head} = ${big.exactTex} \\approx ${big.tex}` : `${head} \\approx ${big.tex}`);
        els.ansText.textContent = big.exact ? `${big.exactText} ≈ ${big.text}` : `≈ ${big.text}`;
        state.copy = big.exact ? { text: big.exactText, tex: big.exactTex } : { text: big.text.replace('−', '-'), tex: big.tex };
        const how = big.how === 'antiderivative'
          ? `from the antiderivative${r.verify && r.verify.ok ? ', which was checked by differentiating it' : ''}`
          : 'by numerical integration of a scaled-down copy of the integrand';
        setCheck(big.how === 'antiderivative' && !(r.verify && r.verify.ok) ? 'warn' : 'ok', md(`The integrand is continuous on the whole interval, so the integral is finite. Its value is beyond 10³⁰⁸, the largest number ordinary computer arithmetic can hold, so its size was worked out with logarithms, ${how}.`));
      } else if (r.undecided && r.overflow) {
        setAns(`${head} \\quad \\text{(too large to compute)}`);
        els.ansText.textContent = 'too large to compute';
        setCheck('warn', 'The integrand is larger than about 10³⁰⁸ on part of the interval, beyond the range of the numbers this tool can compute with, so no value can be given.');
      } else if (r.undecided) {
        // the engine could not tell whether this converges: say so, and show any estimate as uncertain
        const est = r.numeric && r.numeric.plausible;
        const nv = est ? C.fmtNum(r.numeric.value, Math.min(6, numDigits(r.numeric))) : '';
        setAns(est ? `${head} \\approx ${texNum(nv)} \\;\\text{(uncertain)}` : `${head} \\quad \\text{(undecided)}`);
        els.ansText.textContent = est ? `≈ ${nv} (uncertain)` : 'undecided';
        state.copy = est ? { text: `≈ ${nv} (uncertain)`, tex: `\\approx ${texNum(nv)}` } : null;
        const at = r.undecidedAt;
        const where = at === undefined ? '' : Number.isFinite(at) ? ` near $${v} = ${C.tex(SV.identify(at) || C.F(at), r.x)}$` : ` as $${v} \\to ${at > 0 ? '\\infty' : '-\\infty'}$`;
        const why = r.F ? `it is unclear whether the antiderivative has a limit${where}: it neither settles nor clearly runs off to infinity`
          : r.endUnclear ? `the integrand grows without a clear pattern${where}, and numerical integration did not settle there`
          : `the pieces of area${where.replace(' as ', ' towards ')} do not shrink in a pattern that can be pinned down`;
        setCheck('warn', md(`Couldn’t decide whether this integral converges: ${why}.${est ? ` Numerical integration gives about ${nv}, but treat that as uncertain: it may diverge.` : ''}`));
      } else if (r.value && !r.value.mismatch && r.value.shown) {
        // the exact value has a term far below display precision (1 − 1/e^1000000000)
        const sh = r.value.shown, approx = C.fmtNum(r.value.v, 10);
        const plain = !/[a-z\\]/i.test(sh.tex) && String(r.value.v) === sh.tex;
        setAns(`${head} \\approx ${sh.tex}${plain ? '' : ' \\approx ' + texNum(approx)}`);
        els.ansText.textContent = `≈ ${C.txt(sh.e, r.x)}${plain ? '' : ` ≈ ${approx}`}`;
        state.copy = { text: C.txt(sh.e, r.x), tex: sh.tex };
        const chk = r.numeric && r.numeric.ok && Math.abs(r.numeric.value - r.value.v) < 1e-6 * (1 + Math.abs(r.value.v)) ? ` Checked numerically: ${C.fmtNum(r.numeric.value, agreeDigits(r.numeric.value, r.value.v))}.` : '';
        setCheck(chk ? 'ok' : 'warn', md(`The exact value is $${sh.exactTex}$; the term $${sh.droppedTex}$ is smaller than $10^{-300}$, far too small to change any digit shown.${chk}`));
      } else if (r.value && !r.value.mismatch) {
        const exact = r.value.tex, approx = C.fmtNum(r.value.v, 10);
        const isDec = !/[a-z\\]/i.test(exact) && String(r.value.v) === exact;
        setAns(`${head} = ${exact}${isDec || !Number.isFinite(r.value.v) ? '' : ' \\approx ' + approx.replace(' × 10^', '\\times 10^{') + (approx.includes('×') ? '}' : '')}`);
        els.ansText.textContent = C.txt(r.value.e, r.x) + (isDec ? '' : ` ≈ ${approx}`);
        state.copy = { text: C.txt(r.value.e, r.x), tex: exact };
        if (r.equalLimits) setCheck('ok', 'The limits are equal, so the interval has no width.');
        else if (r.numeric && r.numeric.ok && Math.abs(r.numeric.value - r.value.v) < 1e-6 * (1 + Math.abs(r.value.v))) setCheck('ok', `Checked numerically: ${esc(C.fmtNum(r.numeric.value, agreeDigits(r.numeric.value, r.value.v)))}.`);
        else if (r.params.length) setCheck('ok', 'Letters other than the variable are treated as constants.');
        else if (r.numeric && !r.numeric.ok) setCheck('warn', `Numerical integration could not settle on this range, so this value rests on the antiderivative alone${r.verify && r.verify.ok ? ', which was checked by differentiating it' : ''}.`);
        else setCheck('warn', 'The numerical check did not agree closely; the value may be approximate.');
      } else if (r.numeric && !r.numeric.ok) {
        // the quadrature did not settle: never show this as a plain "≈ value"
        const nv = C.fmtNum(r.numeric.value, Math.min(3, numDigits(r.numeric)));
        setAns(`${head} \\approx ${texNum(nv)} \\;\\text{(uncertain)}`);
        els.ansText.textContent = `≈ ${nv} (uncertain)`;
        state.copy = { text: `≈ ${nv} (uncertain)`, tex: `\\approx ${texNum(nv)}` };
        if (r.roughNumeric && r.endSingular) setCheck('warn', `${r.nonElementary ? `There is no elementary antiderivative${neClause(r)}. ` : 'No exact antiderivative was found. '}The integrand is infinite at an end of a piece of the interval, and numerical integration loses accuracy right next to such a point, so treat ${esc(nv)} as a rough estimate.`);
        else if (r.roughNumeric) setCheck('warn', `${r.nonElementary ? `There is no elementary antiderivative${neClause(r)}. ` : 'No exact antiderivative was found. '}The integrand stays bounded on this interval, so the integral exists, but numerical integration could not settle to full accuracy (the integrand changes too quickly), so treat ${esc(nv)} as a rough estimate.`);
        else setCheck('warn', `Numerical integration did not settle, so ${esc(nv)} is uncertain: the integral may not converge.`);
      } else if (r.numeric) {
        const nv = C.fmtNum(r.numeric.value, numDigits(r.numeric));
        setAns(`${head} \\approx ${texNum(nv)}`);
        els.ansText.textContent = '≈ ' + nv;
        state.copy = { text: nv, tex: nv };
        if (r.value && r.value.mismatch) setCheck('warn', `The antiderivative gives ${esc(C.fmtNum(r.value.v, 10))} here, but numerical integration gives ${esc(nv)}. They disagree, which usually means the antiderivative jumps somewhere inside the interval, so the numerical value is shown. Treat it with care.`);
        else if (r.extrapolated) setCheck('warn', `${r.nonElementary ? `There is no elementary antiderivative${neClause(r)}. ` : r.F ? '' : 'No exact antiderivative was found. '}This value is an estimate: the area was added up in pieces that double in length and the shrinking remainder was extrapolated, so only the ${numDigits(r.numeric)} significant figures shown are reliable.` + matchNote(r));
        else if (r.conditional) setCheck('ok', `${r.nonElementary ? `There is no elementary antiderivative${neClause(r)}. ` : r.F ? '' : 'No exact antiderivative was found. '}The integrand keeps changing sign, so the value comes from adding the shrinking areas between its zeros. The integral converges, though not absolutely.` + matchNote(r));
        else setCheck('ok', r.nonElementary ? `There is no elementary antiderivative${neClause(r)}, so this value comes from numerical integration (adaptive Gauss–Kronrod).` : 'No exact antiderivative was found, so this value comes from numerical integration (adaptive Gauss–Kronrod).');
      }
    }
    els.ansActions.hidden = !state.copy;
    fitAnswer();
  }
  // "It matches π/2 to 10 significant figures." when the decimal is recognised
  function matchNote(r) {
    const m = r.numeric && r.numeric.ok ? SV.identify(r.numeric.value) : null;
    return m && !C.isNum(m) ? ` It matches ${K(C.tex(m, r.x))} to 10 significant figures.` : '';
  }
  function setAns(tex) { els.ansMath.dataset.tex = tex; els.ansMath.innerHTML = K(tex, true); }
  // too wide for the card? put "= answer" on its own line
  function fitAnswer() { fitAnswerLines(); markAnswerScroll(); }
  // an answer still wider than the card after line-breaking scrolls sideways: fade the cut edge
  // and let the keyboard reach it, as for the working lines
  function markAnswerScroll() {
    const m = els.ansMath;
    const over = m.scrollWidth > m.clientWidth + 1;
    setFade(m);
    if (over) { m.tabIndex = 0; m.setAttribute('role', 'region'); m.setAttribute('aria-label', 'Answer, scrolls sideways'); }
    else { m.removeAttribute('tabindex'); m.removeAttribute('role'); m.removeAttribute('aria-label'); }
  }
  function fitAnswerLines() {
    const box = els.ansMath;
    const tex = box.dataset.tex;
    if (!tex || !box.clientWidth) return;
    box.innerHTML = K(tex, true);
    if (box.scrollWidth <= box.clientWidth + 1) return;
    let i = tex.indexOf(' = ');
    if (i < 0) {
      // a numerical answer (≈ value) or a verdict: put that part on its own line
      const j = tex.search(/ \\approx | \\quad /);
      if (j < 0) return;
      box.innerHTML = K(`\\begin{aligned} &${tex.slice(0, j)} \\\\ &${tex.slice(j + 1).replace(/^\\quad /, '')} \\end{aligned}`, true);
      return;
    }
    const parts = tex.slice(i + 3).split(/ (?=\\approx )/);
    box.innerHTML = K(`\\begin{aligned} &${tex.slice(0, i)} \\\\ &= ${parts.join(' \\\\ &')} \\end{aligned}`, true);
  }

  // ---------- working ----------
  function stepHTML(st, depth) {
    let h = `<li class="step"><span class="rule">${esc(st.rule)}</span>`;
    for (const it of st.items) {
      if (it.p) h += `<p>${md(it.p)}</p>`;
      else if (it.m) h += `<div class="m">${K(it.m, true)}</div>`;
      else if (it.s) {
        const open = depth < 2;
        const id = 'sb' + (++stepHTML.n);
        h += `<div class="sub"><button type="button" class="sub-toggle" aria-expanded="${open}" aria-controls="${id}"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 5l4 4 4-4"/></svg>${open ? 'Hide' : 'Show'} working: ${esc(it.s.rule.toLowerCase())}</button>` +
          `<div class="sub-body" id="${id}"${open ? '' : ' hidden'}><ol class="steps">${stepHTML(it.s, depth + 1)}</ol></div></div>`;
      }
    }
    return h + '</li>';
  }
  stepHTML.n = 0;
  function renderSteps(r) {
    stepHTML.n = 0;
    let h = '';
    if (r.step) h += stepHTML(r.step, 0);
    if (r.F && state.mode !== 'definite') {
      h += `<li class="step"><span class="rule">Answer</span><p>Add the constant of integration, $C$${''}.</p>`.replace(/\$C\$/, K('C'));
      h += `<div class="m">${K(`${intHead(r)} = ${r.Ftex} + C`, true)}</div></li>`;
    }
    if (r.evalStep) h += stepHTML(r.evalStep, 0);
    if (r.undecided && r.F) {
      h += `<li class="step"><span class="rule">Check the limits</span><p>${md(`The antiderivative $F(${dvar(r.x)}) = ${r.Ftex}$ neither settles to a limit nor clearly runs off to infinity near one end of the interval, so whether the integral converges could not be decided.`)}</p></li>`;
    }
    if (r.tooLarge && r.tooLarge.how === 'numeric') {
      const txt = `${r.nonElementary ? 'There is no elementary antiderivative, so ' : 'No antiderivative was found, so '}the area is computed numerically. The integrand is continuous on the whole interval, so the area is finite, but its values pass 10³⁰⁸, the largest number ordinary computer arithmetic can hold. So the integrand is divided by about its largest value, $e^{M}$, that scaled copy is integrated with adaptive Gauss–Kronrod quadrature, and the result is multiplied back by $e^{M}$ using logarithms.`;
      h += `<li class="step"><span class="rule">Numerical integration</span><p>${md(txt)}</p><div class="m">${K(`${intHead(r)} \\approx ${r.tooLarge.tex}`, true)}</div></li>`;
    }
    if ((!r.step || r.undecided) && !r.tooLarge && state.mode === 'definite' && r.numeric && !r.diverges && !r.undefinedPart && !r.needBounds && (!r.undecided || r.numeric.plausible)) {
      const rough = !r.undecided && !r.numeric.ok;
      const why = r.undecided && r.F ? 'As a rough guide, ' : r.nonElementary ? 'There is no elementary antiderivative, so ' : 'No antiderivative was found, so ';
      const how = r.undecided
        ? `adaptive Gauss–Kronrod quadrature gives the estimate below. ${r.F ? 'It' : 'The far pieces of the area did not shrink in a recognisable pattern, so it'} is uncertain: the integral may diverge.`
        : r.conditional
        ? 'the integrand changes sign again and again, so the area is added up between its zeros (each piece by adaptive Gauss–Kronrod quadrature) and the resulting alternating sum is accelerated by repeated averaging.'
        : r.extrapolated ? 'the area is added up in pieces that double in length (each by adaptive Gauss–Kronrod quadrature); they shrink by a steady ratio, so the rest is extrapolated as a geometric series.'
        : rough ? `the area is computed numerically with adaptive Gauss–Kronrod quadrature, but ${r.endSingular ? 'the integrand is infinite at an end of the interval (or of a piece of it), where the computation loses accuracy' : 'the error estimate did not become small'}, so the value below is only a rough estimate.`
        : 'the area is computed numerically with adaptive Gauss–Kronrod quadrature, splitting the interval until the error estimate is tiny.';
      const nv = C.fmtNum(r.numeric.value, r.undecided ? Math.min(6, numDigits(r.numeric)) : rough ? Math.min(3, numDigits(r.numeric)) : numDigits(r.numeric));
      h += `<li class="step"><span class="rule">Numerical integration</span><p>${why}${how}</p><div class="m">${K(`${intHead(r)} \\approx ${texNum(nv)}${r.undecided || rough ? '\\;\\text{?}' : ''}`, true)}</div></li>`;
    }
    if (r.diverges && r.F) {
      h += `<li class="step"><span class="rule">Check the limits</span><p>${md(`The antiderivative $F(${dvar(r.x)}) = ${r.Ftex}$ ${r.oscillates ? 'keeps oscillating instead of approaching a limit at one end of the interval, so the integral has no value.' : 'has no finite limit at one end of the interval (or at a point inside it where the integrand is infinite), so the integral diverges.'}`)}</p></li>`;
    }
    if (!h) h = `<li class="step notice">${r.F === null ? 'No working to show: no antiderivative was found.' : ''}</li>`;
    els.steps.innerHTML = h;
    const hasSubs = !!els.steps.querySelector('.sub-toggle');
    els.toggleAll.hidden = !hasSubs;
    state.showAll = true;
    els.toggleAll.textContent = 'Collapse all';
    markScrollers();
  }
  // a working line wider than the card scrolls sideways; fade its right edge so the cut is visible,
  // and let the keyboard reach it
  // fade only the side(s) that have more to see: the right edge until the end is reached, the
  // left edge once the line has been scrolled away from its start
  function setFade(m) {
    const over = m.scrollWidth > m.clientWidth + 1;
    m.classList.toggle('fade-r', over && Math.ceil(m.scrollLeft + m.clientWidth) < m.scrollWidth - 2);
    m.classList.toggle('fade-l', over && m.scrollLeft > 2);
  }
  function markScrollers() {
    els.steps.querySelectorAll('.step .m').forEach((m) => {
      const over = m.scrollWidth > m.clientWidth + 1;
      setFade(m);
      if (over) { m.tabIndex = 0; m.setAttribute('role', 'region'); m.setAttribute('aria-label', 'Working line, scrolls sideways'); }
      else { m.removeAttribute('tabindex'); m.removeAttribute('role'); m.removeAttribute('aria-label'); }
    });
  }
  const onScroll = (e) => { const m = e.target; if (m.classList && m.matches('.step .m')) setFade(m); };
  els.steps.addEventListener('scroll', onScroll, true);
  els.ansMath.addEventListener('scroll', () => setFade(els.ansMath));
  els.steps.addEventListener('scrollend', onScroll, true);
  window.addEventListener('resize', () => { clearTimeout(markScrollers.t); markScrollers.t = setTimeout(markScrollers, 150); });
  els.steps.addEventListener('click', (e) => {
    const b = e.target.closest('.sub-toggle'); if (!b) return;
    const open = b.getAttribute('aria-expanded') !== 'true';
    setSub(b, open);
  });
  function setSub(b, open) {
    b.setAttribute('aria-expanded', String(open));
    $(b.getAttribute('aria-controls')).hidden = !open;
    b.lastChild.textContent = b.lastChild.textContent.replace(/^(Hide|Show)/, open ? 'Hide' : 'Show');
    if (open) markScrollers();
  }
  els.toggleAll.addEventListener('click', () => {
    state.showAll = !state.showAll;
    els.steps.querySelectorAll('.sub-toggle').forEach((b) => setSub(b, state.showAll));
    els.toggleAll.textContent = state.showAll ? 'Collapse all' : 'Expand all';
  });

  // ---------- copy ----------
  function toast(t) {
    const el = $('toast'); el.textContent = t; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 1600);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch (e) {
      els.ansText.textContent = text;
      els.ansText.classList.add('show');
      const r = document.createRange(); r.selectNodeContents(els.ansText);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      toast('Press Ctrl+C or ⌘C to copy the selected text');
    }
  }
  $('copyText').addEventListener('click', () => state.copy && copy(state.copy.text));
  $('copyTex').addEventListener('click', () => state.copy && copy(state.copy.tex));

  // ---------- recent ----------
  function remember(r) {
    const it = state.mode === 'definite' && r.a && r.b ? [els.expr.value.trim(), els.lower.value.trim(), els.upper.value.trim()] : [els.expr.value.trim()];
    if (!it[0]) return;
    state.recent = [it, ...state.recent.filter((q) => JSON.stringify(q) !== JSON.stringify(it))].slice(0, 8);
    if (exTab === EXAMPLES.length) renderExamples();
  }

  // ---------- graph ----------
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function niceStep(span, px) {
    const raw = span / Math.max(2, px / 80);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }
  const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
  function fmtTick(v, st) {
    if (Math.abs(v) < st * 1e-6) return '0';
    // past six digits (or below 0.0001) use m×10ⁿ, so labels such as 2000000000000 do not run
    // into each other and tiny ones never show as computer notation (1e-8)
    if (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-4) {
      const E = Math.floor(Math.log10(Math.abs(v)) + 1e-9);
      const d = Math.min(6, Math.max(0, E - Math.floor(Math.log10(st) + 1e-9)));
      const m = +(v / Math.pow(10, E)).toFixed(d);
      return ((m === 1 ? '' : m === -1 ? '-' : m + '×') + '10' + String(E).replace(/./g, (c) => SUP[c])).replace('-', '−');
    }
    const d = Math.max(0, -Math.floor(Math.log10(st) + 1e-9));
    return (+v.toFixed(d)).toString().replace('-', '−');
  }
  // the functions to plot, built once per result
  function graphFns(r) {
    if (r._g) return r._g;
    const params = {}; r.params.forEach((p, i) => { params[p] = 1.3 + 0.37 * i; });
    const f = SV.evalFn(r.f, r.x, { ...params });
    const def = r.mode === 'definite' && !!(r.a && r.b);
    const Fn = !def && r.F ? SV.evalFn(r.F, r.x, { ...params }) : null;
    return (r._g = { f, Fn, def });
  }
  // a first view that shows the interesting part: the limits (padded) or −5…5, y from the 5th–95th percentile
  function autoView(r, fns, W) {
    const { f, Fn, def } = fns;
    let x0 = -5, x1 = 5;
    if (def) {
      let a = Math.min(r.a.v, r.b.v), b = Math.max(r.a.v, r.b.v);
      if (!Number.isFinite(a) && !Number.isFinite(b)) { a = -8; b = 8; }
      else if (!Number.isFinite(a)) a = b - 10;
      else if (!Number.isFinite(b)) b = a + 10;
      const pad = Math.max((b - a) * 0.18, 0.5);
      x0 = a - pad; x1 = b + pad;
    } else {
      let neg = 0, n = 0;
      for (let t = -6; t < 0; t += 0.25) { n++; if (Number.isNaN(f(t))) neg++; }
      if (neg / n > 0.5) { x0 = -0.6; x1 = 8; }
    }
    const ys = [];
    for (let i = 0; i <= 400; i++) {
      const t = x0 + (x1 - x0) * i / 400;
      const y = f(t); if (Number.isFinite(y)) ys.push(y);
      if (Fn) { const y2 = Fn(t); if (Number.isFinite(y2)) ys.push(y2); }
    }
    ys.sort((p, q) => p - q);
    let y0 = -1, y1 = 1;
    if (ys.length) {
      y0 = ys[Math.floor(ys.length * 0.05)]; y1 = ys[Math.ceil(ys.length * 0.95) - 1];
      y0 = Math.min(y0, 0); y1 = Math.max(y1, 0);
      if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
      const m = (y1 - y0) * 0.14; y0 -= m; y1 += m;
    }
    return { x0, x1, y0, y1 };
  }
  function drawGraph(opts = {}) {
    const cv = els.cv, W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const r = state.result;
    state.vw = null;
    if (!r || !r.f) { els.legend.innerHTML = ''; els.gHint.textContent = ''; return; }
    const fns = graphFns(r), { f, Fn, def } = fns;
    if (!state.view) state.view = autoView(r, fns, W);
    const { x0, x1, y0, y1 } = state.view;
    const sx = (t) => (t - x0) / (x1 - x0) * W, sy = (y) => H - (y - y0) / (y1 - y0) * H;
    const wx = (px) => x0 + px / W * (x1 - x0), wy = (py) => y0 + (H - py) / H * (y1 - y0);
    state.vw = { sx, sy, wx, wy, f, Fn, W, H, x0, x1, y0, y1 };
    const C_AX = css('--axis');
    // grid
    const stx = niceStep(x1 - x0, W), sty = niceStep(y1 - y0, H);
    g.lineWidth = 1; g.strokeStyle = css('--grid');
    g.beginPath();
    for (let t = Math.ceil(x0 / stx) * stx; t <= x1; t += stx) { const p = Math.round(sx(t)) + 0.5; g.moveTo(p, 0); g.lineTo(p, H); }
    for (let t = Math.ceil(y0 / sty) * sty; t <= y1; t += sty) { const p = Math.round(sy(t)) + 0.5; g.moveTo(0, p); g.lineTo(W, p); }
    g.stroke();
    // shaded signed area between the limits
    const shaded = { pos: false, neg: false };
    if (def) {
      const a = Math.max(Math.min(r.a.v, r.b.v), x0), b = Math.min(Math.max(r.a.v, r.b.v), x1);
      if (b > a) {
        const pa = sx(a), pb = sx(b), zy = Math.max(-2, Math.min(H + 2, sy(0)));
        for (const sign of [1, -1]) {
          g.fillStyle = sign > 0 ? css('--fill-pos') : css('--fill-neg');
          g.beginPath();
          let open = false;
          for (let px = pa; px <= pb + 0.01; px += 0.5) {
            const t = wx(Math.min(px, pb));
            let y = f(t);
            if (!Number.isFinite(y)) { if (open) { g.lineTo(px, zy); g.closePath(); open = false; } continue; }
            if (sign > 0 ? y > 0 : y < 0) shaded[sign > 0 ? 'pos' : 'neg'] = true;
            y = sign > 0 ? Math.max(y, 0) : Math.min(y, 0);
            const py = Math.max(-2, Math.min(H + 2, sy(y)));
            if (!open) { g.moveTo(px, zy); open = true; }
            g.lineTo(px, py);
          }
          if (open) { g.lineTo(pb, zy); g.closePath(); }
          g.fill();
        }
      }
      // limit lines
      g.setLineDash([4, 4]); g.strokeStyle = C_AX; g.lineWidth = 1;
      g.beginPath();
      for (const t of [r.a.v, r.b.v]) if (Number.isFinite(t) && t >= x0 && t <= x1) { const p = Math.round(sx(t)) + 0.5; g.moveTo(p, 0); g.lineTo(p, H); }
      g.stroke(); g.setLineDash([]);
    }
    // axes
    g.strokeStyle = C_AX; g.lineWidth = 1.2;
    g.beginPath();
    if (y0 <= 0 && y1 >= 0) { const p = Math.round(sy(0)) + 0.5; g.moveTo(0, p); g.lineTo(W, p); }
    if (x0 <= 0 && x1 >= 0) { const p = Math.round(sx(0)) + 0.5; g.moveTo(p, 0); g.lineTo(p, H); }
    g.stroke();
    // curves
    const curve = (fn, color, dash, width = 2.4) => {
      g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []); g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath();
      let pen = false, lastY = null;
      for (let px = 0; px <= W; px += 0.5) {
        const y = fn(wx(px));
        if (!Number.isFinite(y)) { pen = false; continue; }
        const py = sy(y);
        if (pen && lastY !== null && Math.abs(py - lastY) > H * 1.5) pen = false;
        const cy = Math.max(-H, Math.min(2 * H, py));
        if (pen) g.lineTo(px, cy); else g.moveTo(px, cy);
        pen = true; lastY = py;
      }
      g.stroke(); g.setLineDash([]);
    };
    if (Fn) curve(Fn, css('--anti'), [7, 5], 2.2);
    curve(f, css('--accent'));
    // tick labels (kept clear of the canvas edges and the zoom buttons)
    // drawn after the curves, each with a halo in the card colour, so a dense curve can't hide them
    g.font = '12px Inter, system-ui, sans-serif'; g.fillStyle = css('--muted');
    g.strokeStyle = css('--card'); g.lineWidth = 3; g.lineJoin = 'round'; g.setLineDash([]);
    const ax = Math.min(Math.max(sy(0), 4), H - 18), ay = Math.min(Math.max(sx(0), 4), W - 30);
    // keep labels out from under the zoom buttons (taller on touch screens)
    const zr = document.querySelector('.zoom').getBoundingClientRect(), cr = cv.getBoundingClientRect();
    const zL = zr.width ? zr.left - cr.left - 6 : W - 48, zB = zr.width ? zr.bottom - cr.top + 4 : 118;
    g.textAlign = 'center'; g.textBaseline = 'top';
    // skip a label that would overlap the previous one or run off the canvas
    let lastRight = -Infinity;
    for (let t = Math.ceil(x0 / stx) * stx; t <= x1; t += stx) {
      if (Math.abs(t) < stx / 2) continue;
      const px = sx(t); if (px < 10 || px > W - 10) continue;
      const lab = fmtTick(t, stx), hw = g.measureText(lab).width / 2;
      if (px - hw < lastRight + 8 || px - hw < 2 || px + hw > W - 2 || (px + hw > zL && ax + 4 < zB)) continue;
      g.strokeText(lab, px, ax + 4); g.fillText(lab, px, ax + 4); lastRight = px + hw;
    }
    g.textAlign = 'left'; g.textBaseline = 'middle';
    for (let t = Math.ceil(y0 / sty) * sty; t <= y1; t += sty) { if (Math.abs(t) < sty / 2) continue; const py = sy(t); if (py < 8 || py > H - 8) continue; const lab = fmtTick(t, sty); if (py - 8 < zB && ay + 5 + g.measureText(lab).width > zL) continue; g.strokeText(lab, ay + 5, py); g.fillText(lab, ay + 5, py); }
    // more sign changes than pixel columns: the curve can only show as a solid band
    let flips = 0, prev = 0;
    for (let px = 0; px <= W; px += 0.5) { const y = f(wx(px)); if (Number.isFinite(y) && y !== 0) { const sg = Math.sign(y); if (prev && sg !== prev) flips++; prev = sg; } }
    const v = esc(C.symTxt(r.x));
    els.legend.innerHTML = `<span><i></i>f(${v})</span>` + (Fn ? `<span><i class="anti"></i>F(${v}), with C = 0</span>` : '') +
      (shaded.pos ? '<span><i class="pos"></i>area above the axis</span>' : '') + (shaded.neg ? '<span><i class="neg"></i>area below (counts as negative)</span>' : '');
    els.gHint.textContent = flips > W / 3 ? 'The integrand swings up and down too often to draw at this scale, so its curve shows as a solid band. Zoom in to see its shape.' : '';
    els.cv.setAttribute('aria-label', `Graph of the integrand${Fn ? ' and its antiderivative' : ''}${def ? ', with the area between the limits shaded' : ''}. Use the arrow keys to pan, + and − to zoom, 0 to reset.`);
    if (opts.hover) {
      g.fillStyle = css('--accent'); g.strokeStyle = css('--card'); g.lineWidth = 2;
      g.beginPath(); g.arc(opts.hover.px, opts.hover.py, 4.5, 0, 7); g.fill(); g.stroke();
    }
  }

  // ---------- graph interaction ----------
  function hover(px) {
    const vw = state.vw; if (!vw) return;
    const t = vw.wx(px), y = vw.f(t);
    if (!Number.isFinite(y)) { els.readout.hidden = true; drawGraph(); return; }
    const v = C.symTxt(state.result.x);
    els.readout.textContent = `${v} = ${C.fmtNum(t, 4)},  f = ${C.fmtNum(y, 4)}` + (vw.Fn && Number.isFinite(vw.Fn(t)) ? `,  F = ${C.fmtNum(vw.Fn(t), 4)}` : '');
    els.readout.hidden = false;
    const rect = els.cv.getBoundingClientRect(), w = els.readout.offsetWidth;
    els.readout.style.left = Math.min(Math.max(4, px + 12), rect.width - w - 48) + 'px';
    els.readout.style.top = Math.min(Math.max(4, vw.sy(y) - 34), rect.height - 30) + 'px';
    drawGraph({ hover: { px, py: vw.sy(y) } });
  }
  let drag = null;
  els.cv.addEventListener('pointerdown', (e) => {
    if (!state.vw) return;
    const rect = els.cv.getBoundingClientRect();
    drag = { px: e.clientX - rect.left, py: e.clientY - rect.top, v: { ...state.view } };
    els.cv.setPointerCapture(e.pointerId);
    els.cv.classList.add('dragging');
    els.readout.hidden = true;
  });
  els.cv.addEventListener('pointermove', (e) => {
    const rect = els.cv.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
    if (drag) {
      const v = drag.v, dx = (px - drag.px) / rect.width * (v.x1 - v.x0), dy = (py - drag.py) / rect.height * (v.y1 - v.y0);
      state.view = { x0: v.x0 - dx, x1: v.x1 - dx, y0: v.y0 + dy, y1: v.y1 + dy };
      drawGraph();
      return;
    }
    hover(px);
  });
  const hideReadout = () => { if (!els.readout.hidden) { els.readout.hidden = true; drawGraph(); } };
  const endDrag = (e) => { drag = null; els.cv.classList.remove('dragging'); if (e && e.pointerType !== 'mouse') hideReadout(); };
  els.cv.addEventListener('pointerup', endDrag);
  els.cv.addEventListener('pointercancel', endDrag);
  els.cv.addEventListener('pointerleave', () => { if (!drag) hideReadout(); });
  els.cv.addEventListener('blur', hideReadout);
  els.cv.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !state.vw) return;
    e.preventDefault();
    const rect = els.cv.getBoundingClientRect();
    zoomAt(Math.exp(e.deltaY * 0.01), state.vw.wx(e.clientX - rect.left), state.vw.wy(e.clientY - rect.top));
  }, { passive: false });
  // keep the view between 10⁻⁴ and 10⁶ wide (and tall) so the axes never lose their numbers
  const clampK = (k, span) => Math.min(Math.max(k, 1e-4 / span), 1e6 / span);
  function zoomAt(k, cx, cy) {
    const v = state.view; if (!v) return;
    const kx = clampK(k, v.x1 - v.x0), ky = clampK(k, v.y1 - v.y0);
    state.view = { x0: cx + (v.x0 - cx) * kx, x1: cx + (v.x1 - cx) * kx, y0: cy + (v.y0 - cy) * ky, y1: cy + (v.y1 - cy) * ky };
    drawGraph();
  }
  const zoomCentre = (k) => { const v = state.view; if (v) zoomAt(k, (v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2); };
  $('zIn').addEventListener('click', () => zoomCentre(1 / 1.5));
  $('zOut').addEventListener('click', () => zoomCentre(1.5));
  $('zReset').addEventListener('click', () => { state.view = null; drawGraph(); });
  els.cv.addEventListener('keydown', (e) => {
    const v = state.view; if (!v) return;
    const w = v.x1 - v.x0, h = v.y1 - v.y0;
    let handled = true;
    if (e.key === 'ArrowLeft') state.view = { ...v, x0: v.x0 - w * 0.1, x1: v.x1 - w * 0.1 };
    else if (e.key === 'ArrowRight') state.view = { ...v, x0: v.x0 + w * 0.1, x1: v.x1 + w * 0.1 };
    else if (e.key === 'ArrowUp') state.view = { ...v, y0: v.y0 + h * 0.1, y1: v.y1 + h * 0.1 };
    else if (e.key === 'ArrowDown') state.view = { ...v, y0: v.y0 - h * 0.1, y1: v.y1 - h * 0.1 };
    else if (e.key === '+' || e.key === '=') { zoomCentre(1 / 1.5); return e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { zoomCentre(1.5); return e.preventDefault(); }
    else if (e.key === '0') state.view = null;
    else handled = false;
    if (handled) { e.preventDefault(); drawGraph(); }
  });
  const ro = new ResizeObserver(() => drawGraph());
  ro.observe(els.fig);
  let lastAnsW = 0;
  const roAns = new ResizeObserver(() => { const w = els.ansMath.clientWidth; if (Math.abs(w - lastAnsW) > 2) { lastAnsW = w; fitAnswer(); } });
  roAns.observe(els.ansMath);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', () => drawGraph());

  // ---------- help ----------
  $('helpRows').innerHTML = HELP.map(([a, b]) => `<tr><td><code>${esc(a)}</code></td><td>${K(b)}</td></tr>`).join('');
  $('helpBtn').addEventListener('click', () => { const d = $('help'); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); });
  $('help').addEventListener('click', (e) => { if (e.target === $('help')) $('help').close(); });

  // ---------- start ----------
  const saved = load();
  if (saved && saved.expr !== undefined) {
    els.expr.value = saved.expr; els.v.value = saved.v || ''; els.lower.value = saved.lower || ''; els.upper.value = saved.upper || '';
    state.recent = Array.isArray(saved.recent) ? saved.recent.filter((q) => Array.isArray(q) && typeof q[0] === 'string').slice(0, 8) : [];
    setMode(saved.mode === 'definite' ? 'definite' : 'indefinite');
  } else {
    els.expr.value = 'x sin x'; els.lower.value = '0'; els.upper.value = 'pi';
    setMode('definite');
  }
  renderTabs();
  update(true);
  window.addEventListener('beforeunload', save);
  if (window.matchMedia('(pointer: fine)').matches) els.expr.focus();
  window.__integral = { state, solve: SV.solve, load: loadProblem };
}
