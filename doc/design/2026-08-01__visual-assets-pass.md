# Markover visual assets pass

The identity is ready to use as a three-part vector system: standalone mark, standalone logotype, and horizontal lockup. The visual usage board is at [`design/brand/mockups/index.html`](../../design/brand/mockups/index.html). It uses the exact paths copied from Affinity, not the earlier generated vector study.

## Canonical vector sources

Keep these as the authoritative delivery assets:

- [`markover-mark.svg`](../../design/brand/markover-mark.svg) — icons, favicons, compact documentation navigation and constrained app layouts.
- [`markover-logotype.svg`](../../design/brand/markover-logotype.svg) — paired with the mark when responsive spacing is useful.
- [`markover-lockup.svg`](../../design/brand/markover-lockup.svg) — README leaders, mastheads and other generous public-facing placements.

The SVG wrappers are web-ready and responsive. Every path and fill remains as pasted from Affinity.

## One color decision before producing variants

The Affinity artwork contains several one-channel fill differences. The warm paths range across `rgb(201,78,31)`, `rgb(201,78,32)` and `rgb(202,78,32)`; the dark paths have similar ±1 differences. They are visually negligible, but they prevent reliable two-token recoloring.

I recommend normalizing the entire family to the mark's two exact colors—`#c94e1f` and `#6d211f`—unless those differences are intentional. After that decision, ocean, olive, monochrome and reversed SVGs can be derived without touching any geometry.

## Production asset matrix

| Use | Create | Delivery format | Raster requirement |
| --- | --- | --- | --- |
| App icon | A square icon composition using the mark on a quiet background plate | SVG master; generated `.icns`, `.ico`, and Linux icon files | Produce a 1024×1024 PNG per palette as the high-resolution raster source |
| Favicon | Mark with a little optical padding | `favicon.svg` plus generated `favicon.ico` | PNG is unnecessary unless adding Apple touch or installable-web-app icons |
| GitHub README leader | Centered horizontal lockup with live Markdown below it | Existing lockup SVG | None |
| GitHub repository social preview | Lockup, short descriptor and solid background | 1280×640 PNG, under 1 MB | Required by GitHub's social-preview uploader; produce three palette versions |
| GitHub Pages hero | Mark/logotype in navigation; headline and product UI remain HTML/CSS | Existing SVG components | None for the rendered page |
| GitHub Pages share card | Simplified hero composition within a generous safe area | 1200×630 PNG | Required only if the Pages site should have a designed Open Graph card; produce three palette versions |
| Documentation pages | Mark in collapsed navigation; full mark, logotype and descriptor in the expanded table of contents | Existing SVG components | None |
| Desktop app header | Mark alone, or mark with a restrained logotype; no tagline while a document is open | Existing SVG components | None |

GitHub accepts repository social-preview images as PNG, JPG or GIF under 1 MB and recommends 1280×640 for best display. A solid background is the safest choice across destinations. [GitHub social-preview guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)

## App icon treatment

Use the mark rather than the full lockup. The current mockup places it on a warm off-white rounded plate, at roughly 68% of the icon width and 57% of its height. This gives the narrow inter-page gap and folded corner enough room to survive system scaling.

Maintain one square Affinity artboard per palette:

- `app-icon-warm`
- `app-icon-ocean`
- `app-icon-olive`

Export each as a 1024×1024 PNG. Packaging tooling should generate the macOS `.icns`, Windows `.ico`, and Linux sizes from those sources; do not maintain every raster size manually. Markover currently has no Electron packager configured, so the exact generated-file location should be chosen with the eventual packaging setup.

## Favicon treatment

Start with the existing mark and a padded square viewBox. The rendered check remains recognizable at both 32 px and 16 px: two panes remain distinct and the fold still reads. Do not create a special small-size redraw yet.

Ship:

- `favicon.svg` for modern browsers.
- `favicon.ico` containing 16, 32 and 48 px renderings for compatibility.
- `apple-touch-icon.png` at 180×180 only if the documentation site should support iOS home-screen bookmarks.
- 192×192 and 512×512 PNGs only if the Pages site later becomes an installable web app.

## GitHub repository treatment

Use the lockup SVG as a restrained README leader, not a baked full-width banner. Keep the descriptor and badges as live Markdown so the README remains accessible and easy to update. GitHub supports SVG images and relative repository paths. [GitHub image syntax](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#images)

```html
<p align="center">
  <img src="./design/brand/markover-lockup.svg" width="560" alt="Markover">
</p>
<p align="center">Structured Markdown review for agent threads.</p>
```

The separately uploaded 1280×640 social-preview PNG should use a solid palette background, the lockup and a short descriptor. It is the only required raster repository-brand asset.

## GitHub Pages and documentation treatment

Do not bake the Pages hero into an image. Use the mark and logotype SVGs in navigation, then build the headline, supporting copy, calls to action and product preview in HTML/CSS. This stays responsive, searchable and palette-switchable.

```html
<a class="site-brand" href="/">
  <img src="/assets/markover-mark.svg" alt="">
  <img src="/assets/markover-logotype.svg" alt="Markover">
</a>
```

On documentation pages, the mark alone is enough for a collapsed rail or narrow header. The expanded table of contents should restore the mark, logotype and descriptor because this navigation also orients readers within the documentation product. Use the horizontal lockup on the landing page or a spacious masthead.

## Desktop app header treatment

Do not show a tagline while someone is already using the app. It turns a working surface into a pitch and wastes high-value header space.

Two working-header treatments are valid:

- Mark plus a restrained logotype, with the capital `M` approximately 55% of the mark's rendered height.
- Mark only, for the quietest and most tool-like treatment.

The complete lockup and tagline belong in the empty workspace when no document is open. They should disappear as soon as the working document interface is present.

```html
<div class="brand">
  <img class="brand-mark" src="../design/brand/markover-mark.svg" alt="">
  <img class="brand-logotype" src="../design/brand/markover-logotype.svg" alt="Markover">
</div>
```

## Minimum asset set to make next

After resolving the two canonical colors, create only:

1. `app-icon-master.svg`, plus three 1024×1024 palette PNGs.
2. `favicon.svg` and generated `favicon.ico`.
3. Three 1280×640 GitHub social-preview PNGs.
4. Three 1200×630 Pages Open Graph PNGs, if social sharing matters for the documentation site.
5. Monochrome and reversed variants of the three canonical SVG components.

The README leader, Pages hero, documentation masthead and app header do not need separate raster artwork; they should compose the canonical SVGs directly.
