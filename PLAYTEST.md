# Playtest handoff — Jul 2026 revival

**Link:** https://undeveloped1.github.io/jubilant-octo-potato/

**Local:** `npm install` then `npm run dev` → http://localhost:5173/

Send to 3+ people. Watch at least one play **without coaching**.

**Pages note (after Phase 3):** Repo Settings → Pages → Source must be **GitHub Actions** (workflow `.github/workflows/pages.yml`), not “Deploy from branch”.

## What to ask (or watch for)

1. Do they understand **extraction** (key / exit / beacon)?
2. Do they find the **inventory** (gear / stash / meds)?
3. Does the **limb system** register (HUD silhouette, limp, bleeds)?
4. If bitten: do they notice **infection** and try antidote / extract?
5. On death: is the **recap** useful?

## Optional notes for you

- Top-center HUD: `LV#  time  |  FIND KEY / EXIT OPEN / BEACON`
- Hideout → Facilities: **Med Bay**, **Insurance**
- Trader sells **Antidote** (hotkeys 1–3)

Log feedback in `TESTING_FEEDBACK.md` or a new chat — re-rank Phase 3/4 from what they stumble on.

---

## Smoke checklist — after Phase 8 InvUI + mag stow (Jul 24)

Run locally after `npm run dev`. Check each box; stop and note the failure if something breaks.

### A. Mag stow (the fix)

- [ ] Open **http://localhost:5173/?smoke=magPickup** (use `5174` if Vite took that port)
- [ ] Boots into raid (no menu), pistol shows ammo in HUD, brown mag on floor
- [ ] Press **F** on the mag → it stows in a **pocket** (or backpack if pockets full)
- [ ] Mag does **not** drop back on the floor
- [ ] Open invent (**I**) → mag visible in pocket/backpack; gun still has its equipped mag

### B. Boot + Hideout InvUI

- [ ] Open plain **http://localhost:5173/** → main menu loads
- [ ] **CONTINUE** or **NEW GAME** → Hideout CHARACTER / Loadout draws (body + grids + stash)
- [ ] Tab **FACILITIES** / **TRADER** / **EXTRAS** and back to **CHARACTER** — no blank/crash
- [ ] Drag a med onto a limb (or Infect via play then antidote) — heal/cure applies, panel refreshes

### C. Hideout stash round-trip

- [ ] Stash → backpack (or pocket)
- [ ] Backpack → stash
- [ ] Body slot (e.g. helmet/rig) → stash and back, if you have the item

### D. In-raid invent (non-smoke)

- [ ] Start a normal level from Mission Map
- [ ] **I** open/close invent twice — no stuck ghost drag
- [ ] Pick up a world/crate **mag_pistol** (if you see one) — same stow rule as A

### E. Friend playtest (when Pages is on GitHub Actions)

- [ ] Push branch / deploy; open https://undeveloped1.github.io/jubilant-octo-potato/
- [ ] Send link to 3+ people; watch one without coaching
- [ ] Log answers to the five questions above

### Pass / fail note

| Area | Pass? | Note |
|------|-------|------|
| A Mag stow | | |
| B Hideout InvUI | | |
| C Stash | | |
| D Raid invent | | |
| E Friends | | |
