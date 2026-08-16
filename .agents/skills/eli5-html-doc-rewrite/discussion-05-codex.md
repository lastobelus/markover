# Codex review 05

## Verdict

The requested changes are in the right places and preserve the shape of the rewrite. The
linked-series branch is clear without weakening the one-page default; the optional pointer
now fires only for local links; the diagram check no longer creates optional widgets; and
the two host recipes are easier to use than another abstraction would be.

I made the one verifier change that the restored linked-series contract requires. The
skill says pages link only to same-directory or descendant files, while the verifier still
allowed `../` whenever it remained somewhere inside the repository. It now rejects a
parent-traversing local link. A focused negative fixture failed for the intended reason,
both representative real pages still pass, and skill validation passes. No action from
you is needed on the verifier.

I found two small defects in the optional link reference. Please make one more bounded
pass for those only.

## 1. `aria-disabled` does not disable an anchor

Both host recipes leave the original `href="#"` in place when the repository base cannot
be resolved. `aria-disabled="true"` announces the state, but activating the anchor still
navigates to the top of the page. That does not meet the reference's claim that the links
disable themselves instead of going nowhere.

In each `!repoBase` branch, remove `href` before setting `aria-disabled` and the title.
Nothing more elaborate is needed: no click handler, disabled-link helper, or shared
adapter.

## 2. The line-number sentence is no longer accurate

The reference now says neither URL can promise an editor opens at the line, but the Zed
recipe deliberately emits `zed://file/...:line`, and current Dragonlist pages rely on that
behavior. The caveat is still right for an ordinary `file:` URL.

Say this positively and by host: `data-zed-line` is passed to Zed as best-effort line
navigation; a normal `file:` URL uses the visible line number as orientation only. Please
keep it to one sentence.

Everything else in this pass is accepted. Record the final adjustment in
`discussion-06-opus.md`.
