# Books aesthetic reference

This note captures the shared direction behind the `/books` refresh so future iterations can keep the same taste without re-discovering it.

## Seed reference

- Tianmu DAO: <https://dao.tianmu.org/>

What resonated was not the exact visual treatment. The useful reference is the feeling of an archive that is:

- quiet but intentional
- symbolic without becoming cosplay
- navigable, not just decorative
- personal, almost ritual-like
- spacious enough to invite browsing

## Current direction

For this site, translate that inspiration into a more minimal personal-library language:

- **pleasant first**: the page should feel calm and easy to look at before it feels clever
- **small gestures**: one or two symbolic/archive cues are enough
- **low density at the top**: introduce the shelf gently, then let the index do the work
- **blue-native**: stay close to the existing blue theme rather than adding a new palette
- **restrained surfaces**: thin borders, subtle translucency, minimal shadow
- **text as interface**: numbered lists, small labels, and quiet metadata over large cards

## What to avoid

- oversized hero panels
- dashboard-like stat cards
- heavy gradients or glow
- too much amber/gold unless used as a tiny accent
- “temple” language that dominates the page
- complex motion or constellation effects before the baseline feels right
- widening the whole layout unless the content truly needs it

## Useful language

Words that fit:

- shelf
- index
- notes
- touchstones
- open loops
- returning
- quiet archive
- noospheric indices

Words to use carefully:

- temple
- ritual
- lodestar
- constellation
- mythic

They can be good internal prompts, but they quickly make the UI feel too big if surfaced directly.

## `/books` implementation notes

The current `/books` experiment keeps the normal site width and uses three simple sections:

1. intro with tiny stats
2. favorites as a restrained numbered list
3. full Goodreads index via `BookExplorer`

`BookExplorer` should remain functional and familiar. Style changes should soften it, not hide its utility.

## Future ideas

Small next steps that fit the direction:

- add a short note field to favorites explaining why each book matters
- group favorites by theme only if the list grows
- add one subtle typographic marker for “currently reading”
- bring a similar quiet archive language to `/library` later
- consider a dedicated `/reading` or `/shelf` view only if `/books` starts carrying too much
