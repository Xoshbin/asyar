# Calculator

> Do math, unit conversion, currency conversion, and date math right from the search bar.

![A calculator result shown inline in the search bar](../../images/feature-calculator-hero.png)
*Figure: type a sum and the answer appears inline, ready to copy.*

## What it does

The Calculator evaluates expressions as you type in the search bar — no need to open a separate app. It handles five kinds of computation at once:

- **Math** — arithmetic, percentages, powers, and functions like `sqrt`, `sin`, `log`, `factorial`. Powered by math.js, so expressions like `(12 * 3) + sqrt(144)` work fine.
- **Unit conversion** — length, weight, volume, speed, and temperature. You can be explicit (`100 km to miles`) or just type the value and unit (`32 f`) and Asyar picks the natural counterpart.
- **Currency conversion** — live exchange rates fetched in the background. Type `50 USD to EUR` or just `50 USD` and Asyar converts to your region's currency automatically.
- **Date math** — add or subtract days from a date (`2026-01-01 + 30 days`), or ask how many days are between two dates (`days between 2026-01-01 and 2026-12-31`), or how many days until a date (`days until 2026-12-25`).
- **Base conversion** — convert a decimal to hex/binary/octal (`42 in hex`) or paste a hex/binary/octal literal (`0xff`) to see all bases at once.

Results appear pinned at the top of the result list the moment the expression is recognised. Pressing `Enter` copies the result to your clipboard.

## How to use it

There is no trigger word — the calculator is always on. Just open Asyar with your global hotkey and start typing an expression.

1. Type your expression in the search bar — for example `15% of 240`, `5 kg to lbs`, or `100 usd to gbp`.
2. The result appears as the first item in the list with the expression shown as a subtitle.
3. Press `Enter` to copy the result and dismiss the launcher. A brief notification confirms the copy.

For currency results, rates are fetched when Asyar starts and refreshed automatically in the background at the interval you set in preferences (default: every 6 hours).

## Shortcuts & actions

| Action | How |
|--------|-----|
| Copy result | `Enter` on the result row |

The calculator result row has no action panel (⌘K) entries — its single action is copy on `Enter`.

## Tips

- **Implicit unit counterparts** — you do not need to say "to". Type `5 kg` and Asyar shows the result in pounds. The counterparts are: km ↔ miles, m ↔ feet, cm ↔ inches, kg ↔ lb, g ↔ oz, l ↔ gal, °C ↔ °F, km/h ↔ mph, and more.
- **Implicit currency** — type `100 eur` (without a target) and Asyar converts to the currency for your system locale.
- **Date anchor** — use the word `today` as a date, for example `today + 14 days`.
- **Base literals** — paste a hex colour like `0xFF8C00` and see its decimal, binary, and octal values side by side.
- **Currency refresh interval** — go to Settings → Extensions → Calculator to change how often rates are refreshed (1–24 hours).

## Related

- [The Basics](../the-basics.md)
- [Snippets](./snippets.md)
- [Clipboard History](./clipboard-history.md)
