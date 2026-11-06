# Greyhaven Wardrobe v1.4.1 — Emergency freeze repair

This fixes the page-wide MutationObserver from v1.4.0 that could repeatedly rebuild/decorate the Wardrobe UI and freeze SillyTavern on mobile.

## Installation

1. If SillyTavern will not load, close it on your iPhone; do not keep opening the frozen Wardrobe dialog.
2. Using GitHub or Termius, back up the installed Wardrobe extension folder and your active chat `.jsonl`.
3. Extract this ZIP and replace ONLY these five files in your **existing** Greyhaven Wardrobe extension root: `manifest.json`, `enhanced-entry.js`, `wardrobe-catalog-expansion.js`, `wardrobe-features.js`, `wardrobe-features.css`. **Do not delete or replace `index.js`, `catalog.js`, or `style.css`.** Do not create a nested folder or another extension installation.
4. If you maintain the extension through GitHub, commit replacements to the existing repository and run the extension update on your VPS; if editing the server folder directly, upload there. Restart SillyTavern and force-refresh the iPhone PWA / Safari (clear only its cached site resources if necessary; do NOT clear site data/storage).
5. Verify Wardrobe opens, categories and search respond, selecting/swiping doesn't jump to the top, outfit presets work, and AI outfit review appears. First test on a copied group chat.

## Changes versus v1.4.0

- Replaced global `document.body` subtree watching with a narrowly scoped observer on the Wardrobe dialog's **direct shell replacement**. It ignores changes caused by Wardrobe's own subcontrols or unrelated SillyTavern UI.
- Debounced UI enhancement to at most one pass per animation frame rather than chaining microtasks.
- Avoided writing every garment's `hidden` property when its state already matches.
- Explicitly rescan the item grid when the user types in the clothing search field (search replaces only an inner grid).
- All v1.4.0 UI changes, 3,000+ clothing options, Costumes, wearing styles, preset storage, persona mapping, and on-demand AI selection remain intact.

## Emergency rollback if 1.4.1 is still unstable

Re-upload the **five** update files from your known-working `Greyhaven-Wardrobe-v1.3.0-Expansion-Update.zip`. The old extension code will ignore newer extra data, and the original current outfit data should remain intact. You don't need to delete chats or extension metadata. Avoid clearing your iPhone's site data.

## Testing

The ZIP, JS syntax and offline browser harness can be checked locally, but this update has not been verified against the live SillyTavern/iOS PWA. If the interface still freezes after replacing files, confirm `wardrobe-features.js` on the server says `1.4.1` at the top and there is only one active Wardrobe extension.
