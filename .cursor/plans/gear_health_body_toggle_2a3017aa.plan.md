---
name: Gear Health Body Toggle
overview: Add a two-button toggle ("Gear" and "Health") at the top of the inventory body section. Gear shows the current equipment body; Health shows a skeleton-style body outline. Implement the skeleton view first as the foundation for the future medical system.
todos: []
isProject: false
---

# Gear / Health Body View Toggle

## Goal

At the top of the body section in the in-run inventory panel, add two buttons: **Gear** (current view) and **Health** (skeleton view). Default is Gear. Clicking **Health** switches the body area to a skeleton outline; clicking **Gear** shows the current gear slots and labels. This sets up the medical screen without yet implementing damage or med application.

## Current layout (reference)

- In [game.js](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.js), `renderInventoryPanel()` (~8608) builds the inventory UI.
- Body section: `bodyAreaTop` = 50 + bodyOffsetY (~~70), `bodyAreaBottom`, `bodyCenterX`, `leftEdge`, `bodyWidth` = 260. A single **"BODY"** label sits at `bodyCenterX, nvgY - accBoxH/2 - 10 - 7` (~~line 8752).
- The body then draws: outline rect, EARS box, head oval, helmet semicircle, NVG box, chest hex, abdomen, arms, crotch, legs, feet, and finally **HP: current/max** at `bodyAreaBottom + 84`.

## Implementation steps

### 1. Body view state

- Add scene state for the active body view, e.g. `this.invBodyView = 'gear'` (default). When the inventory is closed this can be left as-is so next open defaults to Gear.
- Ensure `renderInventoryPanel()` reads this when deciding what to draw in the body area.

### 2. Replace "BODY" with Gear / Health buttons

- Remove the single `'BODY'` text at the top of the body section.
- Add two clickable controls at the same general height (top of body area):
  - **Gear** – left or first; when selected, body shows current gear view.
  - **Health** – right or second; when selected, body shows skeleton view.
- Use the same panel styling as the rest of the inventory (e.g. small rectangles or text with a simple selected state: different fill/border or font color for the active tab). Make them `setInteractive()` and on click set `this.invBodyView = 'gear'` or `'health'` and call `rerender()` so the whole panel redraws.
- Position: e.g. two buttons side-by-side centered above the body outline (using `bodyCenterX`, `bodyAreaTop`, and a small vertical offset so they sit where "BODY" was or just above it).

### 3. Conditional body content

- **When `invBodyView === 'gear'`**: draw exactly what exists today (outline rect, EARS, head, helmet slot, NVG, chest, abdomen, arms, crotch, legs, feet, armor slot labels, HP text). No change to current behavior.
- **When `invBodyView === 'health'`**: do **not** draw the gear slots and their labels. Instead draw a **skeleton-style body outline** that reuses the same layout (same `bodyCenterX`, same vertical landmarks) so it aligns with the panel:
  - A simple skeleton silhouette: head (oval/skull), spine/ribcage, pelvis, two arms, two legs (and optionally feet). Lines or thin shapes in a distinct color (e.g. light gray/white outline on dark fill, or line-only) so it reads as "health" body, not equipment.
  - You can derive positions from the existing variables (helmetY, chestY, abdomenY, crotchTopY, legY, leftLegX, rightLegX, etc.) so the skeleton matches the gear layout proportions.
  - HP display can stay as-is below the body in both views (or only in Gear if you prefer; spec is to keep it for now).

### 4. No new data model yet

- Do not add limb/body part damage, bleeding, or trauma in this step. The Health view is purely visual (skeleton outline). No med application or drag-to-body logic yet.

## Files and locations

- All changes in [game.js](c:\Users\TheGreyBeard\OneDrive\Desktop\LovelyLadyLumps\game.js):
  - `renderInventoryPanel()`: add `invBodyView` read; replace "BODY" with Gear/Health buttons; wrap existing body drawing in `if (this.invBodyView === 'gear') { ... }`; add `else if (this.invBodyView === 'health') { draw skeleton }`.
  - Optional: initialize `this.invBodyView = 'gear'` in `create()` or when opening inventory so it’s always defined.

## Result

- User opens inventory and sees **Gear** and **Health** at the top of the body section. **Gear** shows the current equipment body; **Health** shows a skeleton outline in the same space. Toggling re-renders the panel. This is the first step toward a Tarkov-style health/medical screen; damage and med interaction can be added later on top of this view.

