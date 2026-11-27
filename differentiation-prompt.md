Use the math-tool-builder skill. Read SKILL.md, references/symbolic-solver.md and references/pitfalls.md, and use assets/reference-integral/ (the Integral Solver) as the starting point.

Build a "Derivative Solver" website: the differentiation counterpart of my Integral Solver at https://lukehv.github.io/integral-solver-site/. It should look and feel like part of the same family: same layout, type, colours (pick a different single accent so the two are easy to tell apart), keypad, examples gallery and working panel. Put it in a new folder: ~/Mathematics Apps/derivative solver, and commit to git after each significant change.

What it must do
- I type a function the way I'd write it on paper (x sin x, e^2x, sin^2 x, √(1-x²), ln|x|, x^x, arctan(x/2)…). A live typeset preview shows how it was read. The variable is auto-detected and can be overridden.
- Modes:
  1. Derivative: first derivative, plus a selector for 2nd/3rd/nth order.
  2. At a point: evaluate f′(a) exactly (π/4, √3/2…) with "≈ decimal", and show the tangent line y = f(a) + f′(a)(x − a) and the normal line.
  3. Implicit: e.g. x² + y² = 25 or x³ + y³ = 6xy, giving dy/dx in terms of x and y, optionally at a point.
  4. Parametric: x = f(t), y = g(t), giving dy/dx (and d²y/dx²).
  5. Partial derivatives: ∂f/∂x, ∂f/∂y for f(x, y).
- Step-by-step working, textbook style, with each step's rule named:
  - Rules: constant, power, sum, constant multiple, product, quotient, chain (nested chains shown as layers u = …), exponential and log rules, trig/inverse trig/hyperbolic, logarithmic differentiation for xˣ-type and big products/quotients, implicit and parametric.
  - Then a final "Simplify" step that factorises and tidies the result (common factors, a single fraction, cancelled terms), showing both the raw and the simplified form.
- Self-checks: compare the symbolic derivative with a numerical central difference at ~14 points and show "Checked numerically". Say plainly if a check fails or the function isn't differentiable somewhere (|x| at 0, ∛x at 0).
- Graph: f in the accent colour and f′ dashed. In "at a point" mode, the tangent and normal lines with a draggable point, so I can slide a along the curve and watch f′(a) update. Mark stationary points where f′ = 0 and say whether each is a maximum, minimum or inflection (second-derivative test).
- Examples gallery, about 8 per tab: Basics, Chain rule, Product & quotient, Trig & inverse trig, Exponential & log, Logarithmic differentiation, Implicit, Parametric, Higher order. Plus Recent.
- Copy and Copy LaTeX for the answer, a "How to type" help dialog, and autosave of the last input.

Quality bar
- Every category 5/5: works, clarity, visual craft, copy, trust, responsive & accessible. Test at 1440, 768 and 390 px in light and dark mode with the human-eye-review skill.
- Write test.html with 100+ cases (easy to hard, including every mode) before building the UI. All must verify, with no case slower than ~20 ms. Then stress-test with a second list of harder inputs.
- Hand-check a sample, e.g. d/dx xˣ = xˣ(ln x + 1), d/dx arctan(x/2) = 2/(x² + 4), implicit x² + y² = 25 gives −x/y, parametric (cos t, sin t) gives −cot t.

Finish
- Add an SVG favicon.
- Publish as a Claude artifact (vendored KaTeX, files via publish_files) and with the publish-site skill to GitHub Pages: private source repo plus a public "-site" repo. Give me both links.
- Afterwards, add any new lessons to the math-tool-builder skill.
