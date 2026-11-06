# Greyhaven Wardrobe v1.4.0 — iPhone UI fixes + Character Chooses Outfit

**Incremental update over Greyhaven Wardrobe v1.3.0.** This release preserves the expanded catalog (~3,049 options / 28 categories, including 397 costumes), current garment state, worn-style adjustments and saved reusable outfits.

## Fixes

1. **Compact action buttons.** Removed the gigantic always-visible saved-outfits panel. On a phone the actions now occupy two short rows, leaving the majority of the screen for browsing clothes. The saved-outfit library opens in its own popup.
2. **No sideways-scrolling editor.** Selected garments now arrange into a two-row mobile grid: garment name + remove button, then color + wearing-style dropdown. Both controls stay inside the available width. Only category tabs intentionally scroll sideways.
3. **Preserve scroll position.** Selecting/removing a garment, changing colors, switching clothing categories and saving the outfit preserve the clothing browser's previous scroll position. (The existing wardrobe core redraws the editor after changes; this extension captures/restores that position.) The wardrobe content remains independently scrollable.
4. **Unify persona with matching character.** When a persona's name matches **exactly one** existing character name, the redundant persona picker option disappears, and outfit state/styles/presets are merged onto the matching character's stable identity. Group members appear first in the dropdown. Older persona outfits are archived in the chat metadata as `greyhavenWardrobe.legacyPersonaOutfits` before being migrated; when both have a known outfit, the more recently updated outfit wins. The main outfit prompt describes that person once rather than as two separate identities. If names are ambiguous, the extension does not silently merge them.

## New AI feature: Let character choose

A new **Let character choose** button sits beside Detect from current chat. It is **different** from detecting existing garments:

- Reads the selected character's description/personality, the recent chat, relevant Greyhaven Life scene/person details, and the **fictional time and date** when available. If the fictional clock is unavailable, uses the local real date/time as a fallback.
- Asks the currently connected roleplay model to independently choose sensible clothing for what the character is doing or planning, even if the chat never describes what they wear. It does not default to sexualized clothing.
- Uses a compact set of representative choices from the existing catalog and maps/validates generated items against the **actual** catalog. Each item can include a color and an optional wearing style.
- **Shows a review screen** with the chosen outfit and short rationale. Nothing is applied until you tap **Wear this outfit**. Cancel leaves existing clothes untouched.
- Does not auto-change the character's clothing when a normal RP message is generated. This button initiates one **paid model call** via SillyTavern, similar to Detect from chat.

## Install via GitHub (same approach as v1.3.0)

1. **Back up** your existing Wardrobe extension and the active SillyTavern group chat JSONL. Export SillyTavern settings as well if saved outfit presets matter to you.
2. Extract the update ZIP. Upload its **five implementation files** into the root of `3ld1n/Greyhaven-Wardrobe`, replacing files with matching names: `manifest.json`, `enhanced-entry.js`, `wardrobe-catalog-expansion.js`, `wardrobe-features.js`, `wardrobe-features.css`.
3. You may also upload this README. **Do not delete or overwrite** the original `index.js`, `catalog.js`, or `style.css` files. The manifest must show version `1.4.0` and point to `enhanced-entry.js` and `wardrobe-features.css`.
4. Update the installed extension from GitHub on your VPS as you did before; **fully close and reopen the iPhone PWA/browser** to clear old JavaScript and CSS.
5. Open Wardrobe: check the slim toolbar, try a color or style change while scrolled down, open Saved outfits, compare matching persona/character entries, and test Let character choose on a copied chat.

## Data storage and compatibility

- Existing outfit data remains under `chatMetadata.greyhavenWardrobe`. New styles remain under `chatMetadata.greyhavenWardrobeExpanded`.
- Named outfit presets remain under SillyTavern `extensionSettings.greyhavenWardrobeExpansion`, so they are reusable across chats. **Do not restore stale settings backups** after installing the update.
- Character/persona migration runs on the current chat when loaded. Backups keep a copy of the old persona outfit; no destructive deletion of the character's current chat or phone data occurs.
- No changes to Greyhaven Phone or Greyhaven Life are required. If Greyhaven Life provides its fictional time API, the character-outfit generator can read it.
- If an older costume/outfit state requires a catalog item added in v1.3, keep the catalog-expansion file installed.

## Tests and limits

Node.js syntax checks and offline behavior tests verify identity migration, single-person prompt injection, wearing-style output, outfit proposal validation, and Greyhaven Life fictional-time context. This update has **not** been exercised on your actual iPhone/SillyTavern installation, so please validate the responsive layout and scrolling on a copied chat before relying on it.

**Rollback:** Upload your saved v1.3.0 `manifest.json`, `wardrobe-features.js`, and `wardrobe-features.css` files again. Original wardrobe state remains compatible; upgraded character/persona alias migration won't reverse automatically, but the archived persona outfits remain available in chat metadata.
