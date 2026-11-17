# Sorting Hat · House Draft

A browser app that splits employees into houses fairly (see `../Data/HOUSE_DRAFT_SPEC.md`).
It runs entirely in the browser. Nothing is uploaded, and no install or server is needed.

## Run it

Open `index.html` in Chrome, Edge or Firefox (double-click works). Then:

1. Pick **Full Shuffle** (the yearly draft) or **Assign New** (people joining during the year).
2. Select the employee data file. In Assign New, also select the last `House_Assignments_….xlsx` this app exported.
3. **Validate**, then **Generate draft**. The seed makes the result reproducible.
4. Preview and edit. Click a person, then either click a house to **move** them or click someone in another house to **swap**. Undo (Ctrl+Z) and Reset are available. The event filter in the toolbar shows only one event's star players, with a per-house count, and you can still move or swap people while it's on. The cost and balance summary update after every edit.
5. **Finalize & export** downloads `House_Assignments_YYYY-MM-DD_HHMM.xlsx`. Keep this file, because the next Assign New run needs it.

## How balancing works

`cost = balance_weight × Σ spreads + previous_house_weight × repeats`

A *spread* is the gap between the highest and lowest house on one figure. The figures, all taken per gender, are head count, rating points, the count at each rating level and the star players per event. Overall head count and points are also included, so people with a blank gender still count. In Full Shuffle, breaking the ±1 house-size rule adds a very large penalty.

- **Full Shuffle:** Fixed House people are placed first. Everyone else is snake-drafted per gender, highest rating first, preferring a house that isn't their previous one. A local search then keeps any single move or same-gender swap that lowers the cost.
- **Assign New:** Existing assignments are locked. New people are placed greedily, highest rating first, into the cheapest house (the smaller house wins a tie). A local search then runs over the new people only.

The preview doesn't show this number, because it's hard to read for a non-technical audience. It shows a plain rating instead: **Very balanced** means every gap is 1 or less; **Balanced** means a few gaps of 2; **Uneven** means bigger gaps, or house sizes that break the ±1 rule. After each edit it says in words what changed. The raw number is still in the rating's tooltip and the export's Run Info sheet.

A single search can get stuck at a layout that no single move or swap improves. To avoid that, each draft runs 16 independent attempts from the seed and keeps the fairest one. It stays reproducible and takes about half a second. On the trial data, 100 of 100 seeds came out "Balanced"; with a single attempt, 23 of 100 came out "Uneven".

The employee data workbook needs these sheets, found by name (case and surrounding spaces don't matter): **SL Employees**, **Houses**, **Events**, **Rating Levels** and **Settings**. The employee sheet name is set by `EMPLOYEES_SHEET` in `js/engine.js`.

Houses, events, rating levels and weights all come from the workbook's config sheets, and columns are matched by header name.

## Decisions on the spec's open items

- **Stack:** static HTML/JS with [SheetJS](https://sheetjs.com) vendored in `vendor/` (Apache-2.0), so it works offline and from `file://`.
- **Leavers in Assign New:** reported only. They stay in their house in the export, are flagged *Possible leaver* in the preview and are left out of the balance figures.
- The local search also tries single **moves**, not only swaps. This lets it fix house sizes that Fixed House pins knocked out of line.
- The output's **Run Info** sheet contains `App = Sorting Hat House Draft`. Assign New uses this to recognise a valid output file.

## Look and feel

The app uses the "Observatory" theme. Dark mode is starry navy and light mode is cool paper, both with a gold accent. The header button switches between them. Your choice is remembered in this browser; until you pick one, the app follows your system setting. Fonts (Sora, Manrope) load from Google Fonts when you're online, and system fonts are used otherwise. House colours follow the order of the Houses sheet: blue, purple, pink, green, then spares for any extra houses.

## Tests

```bash
node --test sorting-hat/tests
```
