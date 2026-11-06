# Greyhaven Wardrobe v1.3.0 — Massive Catalog & Outfit Styles

An **incremental update pack** for the existing `3ld1n/Greyhaven-Wardrobe` installation. **Do not delete the original files.** This ZIP contains only new/replaced files; original `index.js`, `catalog.js`, `style.css`, and older README files remain unchanged.

## What's new

- Adds **2,179 curated candidates** to the existing 870-item catalog, with case-insensitive duplicate labels skipped at runtime; roughly **3,000 total selectable items across 28 categories**.
- Expands all 27 previous categories, not just tops and bottoms. New items include satin trousers and lounge pants, oversized hoodies, silks, outerwear, footwear, accessories, body-wrap towels, and hair-wrap towels.
- Adds **Costumes & cosplay** as the 28th category, with **397 costumes**, including historical, fantasy, superhero-inspired, holiday, work-uniform, stage, sci-fi and Halloween options.
- Adds **How it's worn** to every selected clothing item, with category- and item-aware choices. Examples: jeans low on hips; hoodie sleeves rolled up, off shoulder, or hem knotted; underwear adjusted or lowered; bra unclasped; towel wrapped at waist; costume mask lifted.
- **Worn normally** is the default and generates no redundant additional prompt text.
- Adds **Save preset / Wear preset / Delete preset** controls. Reusable named outfits are saved in SillyTavern extension settings for the same character identity across chats. The active outfit and its wearing styles remain in the individual chat metadata.
- Preserves the existing original outfit editor, chat detection, manual saves, clothing awareness, color picker, and original item IDs.

## Install — GitHub upload method

1. Back up your current chat JSONL, extension settings, and original `Greyhaven-Wardrobe` files before installing.
2. Extract this archive. It contains exactly five files to upload: `manifest.json`, `enhanced-entry.js`, `wardrobe-catalog-expansion.js`, `wardrobe-features.js`, `wardrobe-features.css`, plus this readme.
3. In your **existing** `3ld1n/Greyhaven-Wardrobe` GitHub repository, upload those five files and the readme **into the repository root**. Allow `manifest.json` to be replaced. **Do not delete/replace** the existing `index.js`, `catalog.js`, or `style.css`.
4. On your SillyTavern server/VPS, update the installed Wardrobe extension from GitHub (or copy the files into the existing extension folder). Restart SillyTavern if necessary, then fully reload the iPhone browser/PWA.
5. Open an existing group chat and select Greyhaven Wardrobe from Extensions. Choose a character, select an item, adjust its color and style, and click the usual **Save outfit** button.
6. Test saved presets by creating one, selecting a different outfit, and applying the preset. Inspect Prompt Itemization to confirm `[Greyhaven Wardrobe — precise garment wearing styles...]` appears when at least one nondefault style or costume is selected.

## Compatibility and limitations

- The old stored outfit schema (`greyhavenWardrobe`) is preserved. New wearing-style data is stored separately in `chatMetadata.greyhavenWardrobeExpanded`; removing this upgrade will not erase your original saved garments.
- Saved reusable presets live in `extensionSettings.greyhavenWardrobeExpansion` and rely on the same persona/character keys used by Wardrobe. Export SillyTavern settings to back them up.
- If a previously saved outfit contains an item that isn't currently loaded, the original Wardrobe behavior still applies: unrecognized entries are ignored by its normalizer. Do not uninstall the expansion if you're actively using its new items.
- Full-body costumes are handled as costume layers and their coverage is clarified in an additional prompt. The legacy original clothing prompt can still list absent individual top/bottom categories; the additional costume clarification explicitly takes precedence for actual areas covered. It does not make a prop or mask cover the body.
- Existing Dress/one-piece behavior still automatically replaces selected tops and bottoms when appropriate; costumes are a separate, optionally layered category.
- **Offline tests** cover JS parsing, 28 category registrations, item ID uniqueness, style-prompt behavior, costume coverage notes, and historical state preservation. An interactive test on the user's live SillyTavern installation/iPhone is still required.
- Detect-from-chat uses your selected model and therefore may incur an API charge; normal item selection and saving does not call an AI.

## Rollback

Restore the old `manifest.json` (`"js":"index.js"`, `"css":"style.css"`, version `1.2.0`) or the archived extension backup. Keep the new files harmlessly unused or delete them. Your old `greyhavenWardrobe` state remains untouched.
