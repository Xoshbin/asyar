# Guide Images

Screenshots and figures for the user guide live here. Pages reference them by a
descriptive filename, e.g. `calculator-result.png`.

Pages ship with **image placeholders**: a real `![...](...)` reference plus an
`<!-- image-todo: ... -->` marker. To fill one, drop a PNG at the referenced path
using the exact filename in the marker — the page then renders it automatically.

Find every unfilled placeholder across the guide:

    grep -rn "image-todo" docs/guide

Note: `troubleshooting.md` and `faq.md` are intentionally text-only — they have
no hero image, so the absence of an `image-todo` marker on those two pages is by
design, not an unfilled slot.
