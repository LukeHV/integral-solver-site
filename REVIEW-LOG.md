# Review log

A review-and-fix loop held to the `math-tool-builder` skill. The reviewer (Sonnet) is read-only and only reports; the fixer (Opus) applies the findings; the publisher (Haiku) ships each committed change to https://lukehv.github.io/integral-solver-site/. Agent definitions: `.claude/agents/`.

## Restyle (c139393)

Brought into the Derivative Solver's family: shared neutral tokens in light and dark, card, tab, chip, keypad and mode styling, header and spacing, graph chrome (full-bleed plot, zoom buttons, pan, ⌘/ctrl-scroll, arrow / + / − / 0 keys). Kept the blue accent (the sibling is teal) and the ∫ mark. Also: results dim while input is invalid, the preview clears, and the legend names only the area actually shaded.

## Round 1 (reviewed c139393; fixed in 401cb40, db04e31, f3c8a94)

Found: 3 bugs, 7 glitches, 6 improvements. Battery after fixes: `fails: 2 / 94` (only the non-elementary sin x/x and xˣ), 25 definite cases all correct.

| # | Kind | Finding | Outcome |
|---|---|---|---|
| 1 | bug | ∫₀^{π/2} tan x gave "ln(sec π/2) ≈ 37.33" | Fixed: diverges near π/2 |
| 2 | bug | ∫₀^∞ sin x/x called divergent; oscillating tails called "infinite" | Fixed: ≈ π/2 (conditionally convergent); cos x, sin x on [0, ∞) "never settles" |
| 3 | bug | ∫₀¹ ln x/√x and ∫₋₁¹ x^(−2/3) called divergent | Fixed: −4 and 6 |
| 4 | glitch | 1/0, ln 0, x^(1/0) accepted | Fixed: plain errors |
| 5 | glitch | False "check did not agree" on ∫₋₁¹ 1/√(1−x²) = π | Fixed: endpoint-aware numerical check |
| 6 | glitch | "defines no named function" wording | Fixed |
| 7 | glitch | Help button 30 px wide on phones | Fixed: 44 px |
| 8 | glitch | Keypad always shown on phones | Fixed: only while editing |
| 9 | glitch | Vague error for `sin(` | Fixed: "Add what goes inside sin( ), then close the bracket" |
| 10 | glitch | `1.5.2x`, bare `dx` read oddly | Fixed |
| 11 | improvement | 2ˣ3ˣ, sin 2x/sin x, ax + b ordering, 1/(x⁴+1), ln²x ordering | Partly: first three fixed; 1/(x⁴+1) needs surd partial fractions (left); ln²x order left to avoid reordering correct answers |
| 12 | improvement | Substitution skipped "eˣ = u" | Fixed; ½ln(3/2) form left (ln 3/2 − ln 2/2 is correct) |
| 13 | improvement | Unclamped zoom, canvas role, mode/tab keys | Fixed |
| 14 | improvement | Sticky left column cut off on short screens | Fixed |
| 15 | improvement | Help missing log, abs, exp, cbrt, dx; limit error missing ∞ | Fixed |
| 16 | improvement | Touch size of d□ box, stale hover readout, by-parts spacing | Fixed |

## Round 2 (reviewed 26b543e; fixed in 4d50a3f, b085538, 272b2f4)

Found: 4 bugs (3 of them regressions from round 1), 6 glitches, 5 improvements. All round-1 fixes re-tested and confirmed. Battery after fixes: `fails: 2 / 114`, 49 definite cases, the original 17 unchanged.

| # | Kind | Finding | Outcome |
|---|---|---|---|
| 1 | bug (regression) | Divergent integrals (∫₀^∞ ln x, ∫₀^∞ x, ∫₀^{π/2} sec²x, …) shown as huge finite numbers with a green tick — live for about an hour | Fixed: a limit running off to ±∞ means diverges; undecidable cases say "couldn't decide" with an uncertain estimate |
| 2 | bug (regression) | Slow limits gave wrong "settled" values (∫₂^∞ 1/(x ln²x) shown as 1.4159) | Fixed: exact 1/ln 2, 1, 1/(2 ln²2) via a symbolic large-u probe |
| 3 | bug (regression) | ∫₂^∞ 1/ln x shown finite | Fixed: tail summed in doubling pieces; diverges |
| 4 | bug | ∫₀^∞ (sin x/x)², (1−cos x)/x², x^(−1.01), sin(100x)/x called divergent | Fixed: π/2, π/2 (as marked estimates), 100, π/2 |
| 5 | glitch | Touch keypad stayed open after Solve | Fixed |
| 6 | glitch | `1e3` read as 1·e·3 | Fixed: 1000; `2e-3` asks for 10^(…) |
| 7 | glitch | `log10 x`, `dtheta`, `dx/x` misread | Fixed |
| 8 | glitch | ∫₀¹ e^(−1/x)/x² showed "1/e − 1/e^∞" | Fixed: 1/e |
| 9 | glitch | 10^100, tan(π/2) accepted as constants | Fixed: plain errors |
| 10 | glitch | "∫ −…" in substitution working | Fixed |
| 11 | improvement | Clipped working lines on phones | Fixed: right-edge fade, keyboard-scrollable |
| 12 | improvement | Missed antiderivatives | Partly: sinh³x, 1 + tan², 1/(x²+a²), √(a²−x²), 1/√(a²−x²), 2ˣ3^(2x), sin²2x/sin²x, a clear message for \|…\| inside functions; left 1/(1+tan x), 1/(x⁵+x), 2ˣ/(1+4ˣ) (still reported honestly) |
| 13 | improvement | e^x sin(e^x) on ℝ froze the page for ~3.5 s | Fixed: ~70 ms, "couldn't decide" |
| 14 | improvement | Wording of "not a real number", comma decimals, 1/x to 10^100 | Fixed |
| 15 | improvement | Dark placeholder contrast 3.7:1 | Fixed: 5.7:1 |

## Round 3 (reviewed 67ee8f8; fixed in 0c6e62a, 4b7bd3b) — final round, then paused

Found: 0 bugs, 6 glitches, 6 improvements. Battery after fixes: `fails: 2 / 127` (only sin x/x and xˣ), 72 definite cases; the 49 earlier DEF values unchanged.

| # | Kind | Finding | Outcome |
|---|---|---|---|
| 1 | glitch | No-antiderivative definite integrals with an endpoint pole (∫₀¹ eˣ/x …) shown as a plain "≈ 118" | Fixed: endpoint growth test → diverges; unsettled values always marked "(uncertain)" |
| 2 | glitch | ∫₀^∞ eˣ, cosh x, 2ˣ … "undecided" | Fixed: diverges |
| 3 | glitch | ∫₀^(10⁹) e^(−x) shown "≈ 0" | Fixed: 1 (wide intervals split by decades) |
| 4 | glitch | `floor(x)` gave an ∞ error; `ceil(x)` read as letters | Fixed: "unknown function" error listing supported ones |
| 5 | glitch | Stray `dx` mid-input accepted | Fixed: error saying where dx goes |
| 6 | glitch | Overlapping huge tick labels | Fixed: m×10ⁿ labels, overlap skipped |
| 7 | improvement | x⁸eˣ etc. "no antiderivative" | Fixed (parts cap 7 → 12); x¹²eˣ still beyond the depth limit, with an honest message |
| 8 | improvement | Working fade stays at scroll end | Fixed (checked with simulated scroll only) |
| 9 | improvement | Symbolic-a forms 1/(a²−x²), 1/√(x²±a²), √(x²+a²); tan x ln cos x; 1/cosh x | Not attempted |
| 10 | improvement | ∫₀² 1/√\|x−1\| shown 3.999999963 | Fixed: 4 |
| 11 | improvement | Help lacked new input forms | Fixed |
| 12 | improvement | Wording of 2e+3x and log_b hints | Fixed; x^2y = x^(2y) kept (matches e^2x) |

## Paused and resumed (2026-11-27 → 2026-11-28)

Paused at the user's request (usage limit) after round 3's fixes, then resumed: the remaining round 3 items were fixed, round 3's fixes got one final review, and its findings were fixed. This section is closed.

### Remaining round 3 items (037b754)

- Item 9 fixed: 1/(a²−x²), 1/(x²−a²), 1/√(x²±a²), √(x²±a²) with a letter constant (taken as a > 0, stated in the working); tan x·ln(cos x) = −½ln²(cos x); 1/cosh x = arctan(sinh x).
- Cosmetic fixed: ∫₀^(10⁹) e^(−x) shows ≈ 1, with the exact 1 − e^(−10⁹) explained in the note.

### Final review (reviewed 037b754; fixed in 80e8359, c4e4b21)

All round 3 fixes confirmed, including the visual checks left open at the pause (768 light and dark, 390 dark, 1440 light, help dialog, working fade with real scrolling). Found: 0 bugs, 6 glitches, 4 improvements.

| # | Kind | Finding | Outcome |
|---|---|---|---|
| 1 | glitch | (−2)ˣ gave "undefined(−2)ˣ + C" | Fixed: "not a real-valued function" error; "undefined" can no longer reach the display |
| 2 | glitch | θ typed in the variable box gave a wrong answer with a green tick | Fixed: box normalised like the integrand; Greek letters shown as symbols everywhere |
| 3 | glitch | ∫₀^1000 eˣ and other huge finite values called "couldn't decide" | Fixed: "finite but too large to show", e.g. e^1000 − 1 ≈ 1.97007 × 10^434 (only when the integrand is provably continuous) |
| 4 | glitch | ∫₀^∞ e^(−x)/x², cos x/x blamed the ∞ end | Fixed: diverges near x = 0 |
| 5 | glitch | arcsec, arccot, arccsc read as a·r·c·…; Greek names inconsistent | Fixed: refused with a rewrite hint (arcsec x = arccos(1/x)); θ α β φ λ μ ω read, other Greek names refused consistently |
| 6 | glitch | dφ, dα, dμ, dλ misread | Fixed |
| 7 | improvement | Wide answer line clipped on phones | Fixed: fade plus keyboard scrolling |
| 8 | improvement | sech x tanh x; a-forms with k·x² | Partly: sech x tanh x = −sech x added; k·x² forms left |
| 9 | improvement | `xdx`, `x^2\,dx`, "dx." | Fixed |
| 10 | improvement | Dense graph for ∫₀^(10⁹) sin x/x hid tick labels | Fixed: labels drawn on top with a halo, a note when the curve is too dense to draw |

Battery: `fails: 2 / 159` (only the non-elementary sin x/x and xˣ), 85 definite cases; every earlier result unchanged.

## Final outcome

Done: the family restyle, three review-and-fix rounds plus a final review of round 3's fixes, all committed, tests passing and published at https://lukehv.github.io/integral-solver-site/. The Derivative Solver was read only (shell access to it was denied by `.claude/settings.json` throughout).

Left as suggestions:
- Integrals not found: 1/(x⁴+1) (needs surd partial fractions), 1/(1+tan x), 1/(x⁵+x), 2ˣ/(1+4ˣ) (times out, reported honestly), x¹²eˣ beyond the depth limit in some forms, the letter-constant forms with a coefficient on x² (1/(a²−4x²)), and bare-letter constants such as 1/(k−x²).
- Presentation: ln²x term order, ½ln(3/2) instead of ln 3/2 − ln 2/2.
- ∫₀^(10⁹) sin x/x shows "≈ 1.62 (uncertain)"; the true value is about 1.571. It is flagged as uncertain, but the estimate itself is poor.
- When new input fails to read, the variable placeholder keeps the previous variable.
- The publish script copies the whole folder, so `handoff-prompt.md`, `differentiation-prompt.md`, `test.html` and this log are public on the site.
