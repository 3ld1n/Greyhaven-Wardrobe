# Greyhaven Wardrobe v1.0.0

A separate SillyTavern extension for authoritative clothing/accessory state.

## Catalog

- 27 clothing/accessory categories
- 870 manually defined selectable items
- 40 optional color choices, including an empty/unmentioned color

The catalog includes underwear, bras, tops, bottoms, dresses/one-pieces, outerwear,
sleepwear, swimwear, socks/stockings/tights, shoes, headwear, eyewear, necklaces,
earrings, bracelets, rings, watches, belts, bags, gloves, scarves, ties, hair
accessories, piercings and other accessories.

## State logic

Every character/persona starts as:
**Unknown outfit**

Unknown means the RP has not established clothing. Nothing is injected into the AI.

Once you explicitly save an outfit:
- selected slots become authoritative
- unselected clothing slots are explicitly absent
- saving an outfit with NO garments means **naked**
- selecting only an oversized T-shirt means exactly that: oversized T-shirt,
  with no underwear unless underwear was selected
- single-choice categories replace the previous item in that category
- multi-accessory categories can contain multiple items
- colors are optional and separate from item names

## AI knowledge

The current persona knows what they are wearing.
Characters in the current RP receive compact outfit facts for continuity.
The prompt never dumps the full clothing catalog.

## Detect from current chat

The optional Detect action:
- reviews a bounded recent RP excerpt
- asks the current model to map visible clothing to catalog IDs
- does not silently apply anything
- shows suggestions for review before saving

No background scanning is performed.

## Install

This is a NEW extension, not a Greyhaven Phone branch.

Recommended repository:
`Greyhaven-Wardrobe`

Upload:
- manifest.json
- index.js
- style.css
- catalog.js
- README.md

Then install that repository through SillyTavern Manage Extensions.
