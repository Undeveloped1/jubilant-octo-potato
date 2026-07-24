import { CONFIG, getDefaultLimbHp } from './config.js';
import {
  isModItem,
  modFitsSlot,
  getWeaponSlotNames,
  isMagazineItem,
  getMagazineWeapon,
  getMagazineCapacity,
  getMagazineAmmoId,
  isAmmoItemId,
  getMagazineRoundsLabel,
  unloadMagazineToStack,
  getEquippedMag,
  setEquippedMag,
  findFirstEmptySlotForMag,
  placeMagInRigPocketBackpackOrGround,
  createDefaultEquippedModsForWeapon,
  getModsForWeaponInSlot,
  getModsForWeaponItem,
  getDefaultPockets,
  ensurePockets,
  sanitizePockets,
  getDefaultBackpack,
  ensureGridItems,
  getInventoryItemConfig,
  isMedicalItem,
  getDefaultDurability,
  canPlace,
  findSpace,
  findSpaceTryRotated,
  placeItem,
  removeItem,
  moveItemInGrid,
  getOrCreateAmmoBoxInventory,
  getOrCreateRigInventory,
  tryAddItemAmmoBoxOnly,
  tryAddItem,
  isPocketSlotEmpty,
  ensureEquippedModsShape,
} from './inventory.js';
import {
  savePersistent,
  ensureWeaponSlotModsShape,
} from './persistence.js';
import { sfx } from './audio.js';
import {
  limbEffectsToStatusString,
  applyMedicalItemToLimb,
} from './medical.js';
import { ensureInvCtx } from './invUiContext.js';

/**
 * Shared inventory panel for raid GameScene and Hideout CHARACTER tab.
 * @param {Phaser.Scene} scene
 * @param {object} [ctx] InvUI context from createRaidInvCtx / createHideoutInvCtx
 */
export function renderInventoryPanel(scene, ctx) {

    if (scene.invGhostRect) { scene.invGhostRect.destroy(); scene.invGhostRect = null; }
    if (scene.invGhostText) { scene.invGhostText.destroy(); scene.invGhostText = null; }
    if (scene.invListeners) {
        scene.input.off('pointermove', scene.invListeners.move);
        scene.input.off('pointerdown', scene.invListeners.down);
        scene.input.off('pointerup', scene.invListeners.up);
        if (scene.invListeners.delKey) scene.invListeners.delKey.off('down', scene.invListeners.delKeyCallback);
        if (scene.invListeners.rKey) scene.invListeners.rKey.off('down', scene.invListeners.rKeyCallback);
        if (scene.invListeners.uKey) scene.invListeners.uKey.off('down', scene.invListeners.uKeyCallback);
        scene.invListeners = null;
    }
    ctx = ctx || ensureInvCtx(scene);
    const contentArray = scene._invContent !== undefined ? scene._invContent : scene.invContent;
    const stats = scene._invStats !== undefined ? scene._invStats : scene.playerStats;
    if (contentArray && contentArray.length) {
        contentArray.forEach(e => e.destroy());
        contentArray.length = 0;
    }
    if (ctx.isHideout()) {
        const backdrop = scene.add.rectangle(400, 300, 800, 600, 0x0d0d0d, 1).setDepth(290);
        contentArray.push(backdrop);
    }
    if (!stats.backpack) stats.backpack = getDefaultBackpack();
    const backpack = stats.backpack;
    ensureGridItems(backpack);
    backpack.gridW = 6;
    backpack.gridH = 9;
    // One-time test loadout: SMG, rifle, crossbow + all attachment mods (for 4.2 drag/drop testing) — skip in hideout
    if (!ctx.isHideout() && !stats._attachmentTestLoadoutAdded && backpack) {
        tryAddItem(backpack, 'smg', 1);
        tryAddItem(backpack, 'rifle', 1);
        tryAddItem(backpack, 'crossbow', 1);
        const modIds = Object.values(CONFIG.MODS || {}).map(m => m.id);
        modIds.forEach(id => tryAddItem(backpack, id, 1));
        stats._attachmentTestLoadoutAdded = true;
    }
    const INV_DEPTH = 300;
    const cellSize = 20;
    const gap = 1;
    const step = cellSize + gap;
    let invGridX, invGridY;
    const itemZones = [];
    function addItemZone(x0, y0, p) {
        const sw = p.sizeW || 1, sh = p.sizeH || 1;
        const hw = sw * step, hh = sh * step;
        const cx = x0 + p.col * step + hw / 2, cy = y0 + p.row * step + hh / 2;
        const zone = {
            left: cx - hw / 2, right: cx + hw / 2, top: cy - hh / 2, bottom: cy + hh / 2,
            placementId: p.placementId, itemId: p.itemId, count: p.count || 1, sizeW: sw, sizeH: sh
        };
        if (p.durability != null) zone.durability = p.durability;
        if (p.maxDurability != null) zone.maxDurability = p.maxDurability;
        itemZones.push(zone);
    }
    const occupied = new Set();
    (backpack.items || []).forEach(p => {
        for (let r = 0; r < (p.sizeH || 1); r++)
            for (let c = 0; c < (p.sizeW || 1); c++) occupied.add(`${p.row + r},${p.col + c}`);
    });
    const invPanelW = 479;     // player window width (widen 20px from 459)
    const invPanelH = 450;
    const invPanelLeft = 22;   // player window left edge (25 then -3px more)
    const invPanelTop = 65;     // player window top (60 then -5px more)
    const invPanelCenterX = invPanelLeft + invPanelW / 2;
    const invPanelCenterY = invPanelTop + invPanelH / 2;
    const bg = scene.add.rectangle(invPanelCenterX, invPanelCenterY, invPanelW, invPanelH, 0x1a1a1a, 0.97).setStrokeStyle(4, 0x666666).setDepth(INV_DEPTH);
    contentArray.push(bg);
    const weapon = stats.currentWeapon;
    // Layout: left = body section, right = inventory section. Body section must not extend left of panel (invPanelLeft).
    // --- BODY SECTION: left area of the panel (leftEdge to rightStart). Includes: leftEdge, bodyWidth, bodyCenterX, bodyAreaTop, bodyAreaH,
    //     bodyOffsetY, bodyScale, body figure (helmet, ears, chest, arms, abdomen, crotch, legs, feet), limb HP bars and effect labels. "Body section" = all of the above.
    const leftEdge = invPanelLeft;   // align body section to panel left so nothing sticks out
    const bodyWidth = 280;
    const rightStart = leftEdge + bodyWidth + 5;
    invGridX = rightStart + 8 + 20;
    invGridY = invPanelTop + 175;   // was 235; lowered with panel (invPanelTop 60 + 175)
    const bodyScale = 1.35;   // body section scale (was 1.2; larger figure)
    const BODY_GROW_H = 1.25;   // body 25% wider
    const BODY_GROW_V = 1.25;   // body 25% taller
    const bodySlotW = Math.round(44 * bodyScale * BODY_GROW_H);
    const bodySlotH = Math.round(36 * bodyScale * BODY_GROW_V);
    const bodyOffsetX = 50;   // shift body section horizontally (30 + 20)
    const bodyCenterX = leftEdge + 90 + bodyOffsetX;
    const panelH = invPanelH;
    const bodyOffsetY = -10;   // shift body section up 30px (was 20; extends section upward)
    const bodyAreaTop = invPanelTop + bodyOffsetY;
    const bodyAreaH = Math.floor(panelH * 0.6) + 30;   // +30px height for body section only
    const bodyAreaBottom = bodyAreaTop + bodyAreaH;
    const bodyLabelY = bodyAreaTop + 18 * BODY_GROW_V;
    const accSize = Math.round(28 * bodyScale * BODY_GROW_H);
    const accBoxW = accSize * 1.20;   // elongate 20%
    const accBoxH = accSize * 0.5;     // height half
    const nopsX = leftEdge + 32 + bodyOffsetX;
    const nopsY = bodyAreaTop + 28 * BODY_GROW_V;
    const earsY = nopsY + accBoxH / 2 + 10 * BODY_GROW_V + accBoxH / 2 + 15;
    const earsX = leftEdge + 32 + bodyOffsetX - 5;
    const helmetY = bodyAreaTop + 42 * BODY_GROW_V + bodySlotH / 2;
    const bodySegmentPad = 6 * BODY_GROW_V;  // padding between body segments (chest–abdomen, etc.)
    const chestSlotH = 55 * BODY_GROW_V;
    // Chest position: fixed from head, not contingent on neck
    const chestTopY = helmetY + bodySlotH / 2 + 6 * BODY_GROW_V;
    const chestY = helmetY + bodySlotH / 2 + 19 * BODY_GROW_V + chestSlotH / 2;
    const armW = Math.round(12 * bodyScale * BODY_GROW_H);
    const armH = 54 * BODY_GROW_V;
    const chestArmGap = Math.round(10 * bodyScale * BODY_GROW_H);
    const armOffset = bodySlotW / 2 + armW / 2 + chestArmGap;
    const leftArmX = bodyCenterX - armOffset;
    const rightArmX = bodyCenterX + armOffset;
    const chestTopWidth = (rightArmX - armW / 2) - (leftArmX + armW / 2);
    const abdomenH = 15 * BODY_GROW_V;  // reduced 25% (was 20)
    const abdomenY = chestY + chestSlotH / 2 + bodySegmentPad + abdomenH / 2;
    const crotchH = 28 * BODY_GROW_V;
    const crotchTopY = abdomenY + abdomenH / 2 + bodySegmentPad;
    const crotchCenterY = crotchTopY + crotchH / 2;
    const legW = Math.round(armW * 0.9);  // slightly narrower for proportion with crotch
    const legH = 42 * BODY_GROW_V;  // reduced for proportion with crotch (was 56)
    const legOffset = bodySlotW / 2 + legW / 2 + 5 * BODY_GROW_H;
    const leftLegX = bodyCenterX - legOffset;
    const rightLegX = bodyCenterX + legOffset;
    const legY = crotchTopY + bodySegmentPad + legH / 2;
    const footSize = 30;
    const leftFootX = bodyCenterX - legOffset;
    const rightFootX = bodyCenterX + legOffset;
    const itemHead = stats.armor && stats.armor['head'];
    const itemEars = stats.armor && stats.armor.ears;
    contentArray.push(scene.add.rectangle(leftEdge + bodyWidth / 2, bodyAreaTop + bodyAreaH / 2, bodyWidth, bodyAreaH, 0x000000, 0).setStrokeStyle(2, 0x666666).setDepth(INV_DEPTH - 1));
    let limbZones = [];
    const headEdgeW = chestTopWidth * 0.5;
    const headRadius = headEdgeW / 2;
    const helmetSlotRadius = 1.5 * headRadius * 0.8;
    const helmetSlotY = helmetY - 20 * BODY_GROW_V;
    contentArray.push(scene.add.rectangle(earsX, earsY, accBoxW, accBoxH, 0x353535).setStrokeStyle(1, 0x777777).setDepth(INV_DEPTH));
    contentArray.push(scene.add.text(earsX, earsY + 6, itemEars ? `${itemEars.name} ${itemEars.durability}/${itemEars.maxDurability}` : "EMPTY", { fontSize: '7px', fill: itemEars ? '#00ff00' : '#999' }).setOrigin(0.5).setDepth(INV_DEPTH + 1));
    const itemBody = stats.armor && stats.armor['body'];
    // Helmet box to the right of head; vest box in the middle of the chest
    const equipBoxW = 38;
    const equipBoxH = 26;
    const equipBoxGap = 12;
    const helmetBoxX = bodyCenterX + helmetSlotRadius + equipBoxGap + equipBoxW / 2;
    const helmetBoxY = helmetY;
    const vestBoxX = bodyCenterX;
    const vestBoxY = chestY;
    contentArray.push(scene.add.text(helmetBoxX, helmetBoxY - equipBoxH / 2 - 8, 'HELMET', { fontSize: '8px', fill: '#bbb' }).setOrigin(0.5).setDepth(INV_DEPTH));
    contentArray.push(scene.add.rectangle(helmetBoxX, helmetBoxY, equipBoxW, equipBoxH, itemHead ? 0x454535 : 0x353535).setStrokeStyle(1, 0x777777).setDepth(INV_DEPTH));
    contentArray.push(scene.add.text(helmetBoxX, helmetBoxY, itemHead ? `${itemHead.name}\n${itemHead.durability}/${itemHead.maxDurability}` : '—', { fontSize: '8px', fill: itemHead ? '#00ff00' : '#999' }).setOrigin(0.5).setDepth(INV_DEPTH + 1));
    contentArray.push(scene.add.text(vestBoxX, vestBoxY - equipBoxH / 2 - 8, 'VEST', { fontSize: '8px', fill: '#bbb' }).setOrigin(0.5).setDepth(INV_DEPTH));
    contentArray.push(scene.add.rectangle(vestBoxX, vestBoxY, equipBoxW, equipBoxH, itemBody ? 0x454535 : 0x353535).setStrokeStyle(1, 0x777777).setDepth(INV_DEPTH));
    contentArray.push(scene.add.text(vestBoxX, vestBoxY, itemBody ? `${itemBody.name}\n${itemBody.durability}/${itemBody.maxDurability}` : '—', { fontSize: '8px', fill: itemBody ? '#00ff00' : '#999' }).setOrigin(0.5).setDepth(INV_DEPTH + 1));
    // Head oval: width matches neck top (chestTopWidth * 0.5), height = bodySlotH
    const headTopY = helmetY - bodySlotH / 2;
    const headG = scene.add.graphics();
    headG.fillStyle(0x404040, 1);
    headG.lineStyle(1, 0x888888);
    headG.beginPath();
    const headRx = headEdgeW / 2, headRy = bodySlotH / 2;
    for (let i = 0; i <= 32; i++) {
        const t = (i / 32) * Math.PI * 2;
        const x = bodyCenterX + headRx * Math.cos(t);
        const y = helmetY + headRy * Math.sin(t);
        if (i === 0) headG.moveTo(x, y);
        else headG.lineTo(x, y);
    }
    headG.closePath();
    headG.fillPath();
    headG.strokePath();
    headG.setDepth(INV_DEPTH);
    contentArray.push(headG);
    // Helmet container: half circle (bottom half), radius = 1.5 * head radius, shrunk 20%; helmet slot uses this, not the head
    const helmetHalfG = scene.add.graphics();
    helmetHalfG.fillStyle(0x404040, 1);
    helmetHalfG.lineStyle(1, 0x888888);
    helmetHalfG.beginPath();
    helmetHalfG.moveTo(bodyCenterX - helmetSlotRadius, helmetY);
    helmetHalfG.arc(bodyCenterX, helmetY, helmetSlotRadius, Math.PI, 0, false);
    helmetHalfG.closePath();
    helmetHalfG.fillPath();
    helmetHalfG.strokePath();
    helmetHalfG.setDepth(INV_DEPTH);
    contentArray.push(helmetHalfG);
    const nvgY = helmetY - 33 * BODY_GROW_V - 2;   // raised 2px
    const itemNvg = stats.armor && stats.armor.nvg;
    contentArray.push(scene.add.rectangle(bodyCenterX, nvgY, accBoxW, accBoxH, itemNvg ? 0x354535 : 0x353535).setStrokeStyle(1, 0x777777).setDepth(INV_DEPTH));
    contentArray.push(scene.add.text(bodyCenterX, nvgY, itemNvg ? 'NVG' : 'EMPTY', { fontSize: '9px', fill: itemNvg ? '#00cc66' : '#aaa' }).setOrigin(0.5).setDepth(INV_DEPTH + 1));
    // Chest hexagon: tapered from shoulders (wider) down to bottom (narrower); no arms for now. All values from chest/bodySlotW/chestTopWidth only.
    const chestHexTopEdgeW = chestTopWidth * 0.5;  // chest top edge width
    const chestShoulderOutset = 4 * BODY_GROW_H;   // shoulder width (wider at top)
    const chestBottomOutset = 2 * BODY_GROW_H;     // bottom width (narrower, tapered)
    const chestTopLeftX = bodyCenterX - bodySlotW / 2 - chestShoulderOutset;
    const chestTopRightX = bodyCenterX + bodySlotW / 2 + chestShoulderOutset;
    const chestBottomY = chestY + chestSlotH / 2;
    const chestShoulderY = chestY - chestSlotH / 2 + 5 * BODY_GROW_V;
    const chestG = scene.add.graphics();
    chestG.fillStyle(0x404040, 1);
    chestG.lineStyle(1, 0x888888);
    chestG.beginPath();
    chestG.moveTo(bodyCenterX - bodySlotW / 2 - chestBottomOutset, chestBottomY);
    chestG.lineTo(bodyCenterX + bodySlotW / 2 + chestBottomOutset, chestBottomY);
    chestG.lineTo(chestTopRightX, chestShoulderY);
    chestG.lineTo(bodyCenterX + chestHexTopEdgeW / 2, chestTopY);
    chestG.lineTo(bodyCenterX - chestHexTopEdgeW / 2, chestTopY);
    chestG.lineTo(chestTopLeftX, chestShoulderY);
    chestG.closePath();
    chestG.fillPath();
    chestG.strokePath();
    chestG.setDepth(INV_DEPTH);
    contentArray.push(chestG);
    // Abdomen trapezoid: top longer (wider), bottom shorter = chest/crotch width (bodySlotW)
    const abdomenTopOutset = 1.5 * BODY_GROW_H;  // extra half-width at top (each side)
    const abdomenG = scene.add.graphics();
    abdomenG.fillStyle(0x353535, 1);
    abdomenG.lineStyle(1, 0x777777);
    abdomenG.beginPath();
    abdomenG.moveTo(bodyCenterX - bodySlotW / 2 - abdomenTopOutset, abdomenY - abdomenH / 2);
    abdomenG.lineTo(bodyCenterX + bodySlotW / 2 + abdomenTopOutset, abdomenY - abdomenH / 2);
    abdomenG.lineTo(bodyCenterX + bodySlotW / 2, abdomenY + abdomenH / 2);
    abdomenG.lineTo(bodyCenterX - bodySlotW / 2, abdomenY + abdomenH / 2);
    abdomenG.closePath();
    abdomenG.fillPath();
    abdomenG.strokePath();
    abdomenG.setDepth(INV_DEPTH);
    contentArray.push(abdomenG);
    // Wonky hexagonal arms: start at top of chest, wrap along side to abdomen bottom; 5px padding from chest/abdomen; taper for arrow look
    const armChestPad = 5 * BODY_GROW_H;
    const armWAtShoulder = 14 * BODY_GROW_H;
    const armWAtChestBottom = 10 * BODY_GROW_H;
    const armWAtAbdomenBottom = 4 * BODY_GROW_H;
    const leftArmHex = scene.add.graphics();
    leftArmHex.fillStyle(0x404040, 1);
    leftArmHex.lineStyle(1, 0x888888);
    leftArmHex.beginPath();
    leftArmHex.moveTo(bodyCenterX - chestHexTopEdgeW / 2 - armChestPad, chestTopY);
    leftArmHex.lineTo(chestTopLeftX - armChestPad, chestShoulderY);
    leftArmHex.lineTo(bodyCenterX - bodySlotW / 2 - chestBottomOutset - armChestPad, chestBottomY);
    leftArmHex.lineTo(bodyCenterX - bodySlotW / 2 - chestBottomOutset - armChestPad - armWAtChestBottom, chestBottomY);
    leftArmHex.lineTo(chestTopLeftX - armChestPad - armWAtShoulder, chestShoulderY);
    leftArmHex.lineTo(bodyCenterX - chestHexTopEdgeW / 2 - armChestPad - armWAtShoulder, chestTopY);
    leftArmHex.closePath();
    leftArmHex.fillPath();
    leftArmHex.strokePath();
    leftArmHex.setDepth(INV_DEPTH);
    contentArray.push(leftArmHex);
    const rightArmHex = scene.add.graphics();
    rightArmHex.fillStyle(0x404040, 1);
    rightArmHex.lineStyle(1, 0x888888);
    rightArmHex.beginPath();
    rightArmHex.moveTo(bodyCenterX + chestHexTopEdgeW / 2 + armChestPad, chestTopY);
    rightArmHex.lineTo(chestTopRightX + armChestPad, chestShoulderY);
    rightArmHex.lineTo(bodyCenterX + bodySlotW / 2 + chestBottomOutset + armChestPad, chestBottomY);
    rightArmHex.lineTo(bodyCenterX + bodySlotW / 2 + chestBottomOutset + armChestPad + armWAtChestBottom, chestBottomY);
    rightArmHex.lineTo(chestTopRightX + armChestPad + armWAtShoulder, chestShoulderY);
    rightArmHex.lineTo(bodyCenterX + chestHexTopEdgeW / 2 + armChestPad + armWAtShoulder, chestTopY);
    rightArmHex.closePath();
    rightArmHex.fillPath();
    rightArmHex.strokePath();
    rightArmHex.setDepth(INV_DEPTH);
    contentArray.push(rightArmHex);
    const crotchW = bodySlotW;
    const crotchG = scene.add.graphics();
    crotchG.fillStyle(0x353535, 1);
    crotchG.lineStyle(1, 0x777777);
    crotchG.beginPath();
    crotchG.moveTo(bodyCenterX - crotchW / 2, crotchTopY);
    crotchG.lineTo(bodyCenterX + crotchW / 2, crotchTopY);
    crotchG.lineTo(bodyCenterX, crotchTopY + crotchH);
    crotchG.closePath();
    crotchG.fillPath();
    crotchG.strokePath();
    crotchG.setDepth(INV_DEPTH);
    contentArray.push(crotchG);

    // --- CROTCH TRIANGLE (reference shape) ---
    const triTopLeftX = bodyCenterX - crotchW / 2;
    const triTopRightX = bodyCenterX + crotchW / 2;
    const triTopY = crotchTopY;
    const triBottomTipX = bodyCenterX;
    const triBottomTipY = crotchTopY + crotchH;

    // --- LEG–TRIANGLE PADDING (gap between triangle and leg) ---
    const legTrianglePad = 7 * BODY_GROW_H;

    // --- LEG TOP EDGE (slope from outer top to inner top; runs alongside triangle side) ---
    const legOuterTopInset = 2 * BODY_GROW_H;
    const legOuterTopDrop = 4 * BODY_GROW_V;
    const legShiftTowardTip = 2 * BODY_GROW_H;
    let leftLegOuterTopX = triTopLeftX - legTrianglePad + legOuterTopInset;
    let leftLegOuterTopY = triTopY + legOuterTopDrop;
    let rightLegOuterTopX = triTopRightX + legTrianglePad - legOuterTopInset;
    let rightLegOuterTopY = triTopY + legOuterTopDrop;
    const legTopEdgeScale = 0.9;
    const legInnerTopPad = 2 * BODY_GROW_H;
    let leftLegInnerTopX = leftLegOuterTopX + legTopEdgeScale * (triBottomTipX - legTrianglePad - legInnerTopPad - leftLegOuterTopX);
    let leftLegInnerTopY = leftLegOuterTopY + legTopEdgeScale * (triBottomTipY - leftLegOuterTopY);
    let rightLegInnerTopX = rightLegOuterTopX + legTopEdgeScale * (triBottomTipX + legTrianglePad + legInnerTopPad - rightLegOuterTopX);
    let rightLegInnerTopY = rightLegOuterTopY + legTopEdgeScale * (triBottomTipY - rightLegOuterTopY);
    const shiftToward = (px, py) => {
        const dx = triBottomTipX - px, dy = triBottomTipY - py;
        const d = Math.hypot(dx, dy);
        return d > 0 ? [px + legShiftTowardTip * dx / d, py + legShiftTowardTip * dy / d] : [px, py];
    };
    [leftLegOuterTopX, leftLegOuterTopY] = shiftToward(leftLegOuterTopX, leftLegOuterTopY);
    [leftLegInnerTopX, leftLegInnerTopY] = shiftToward(leftLegInnerTopX, leftLegInnerTopY);
    [rightLegOuterTopX, rightLegOuterTopY] = shiftToward(rightLegOuterTopX, rightLegOuterTopY);
    [rightLegInnerTopX, rightLegInnerTopY] = shiftToward(rightLegInnerTopX, rightLegInnerTopY);

    // --- LEG BOTTOM (outer and inner corners; flat bottom; outer edge slightly off vertical) ---
    const legDrop = 44 * BODY_GROW_V;
    const legOuterEdgeSlope = 4 * BODY_GROW_H;
    const leftLegOuterBottomX = leftLegOuterTopX - legOuterEdgeSlope;
    const leftLegOuterBottomY = legY + legH / 2 + legDrop;
    const rightLegOuterBottomX = rightLegOuterTopX + legOuterEdgeSlope;
    const rightLegOuterBottomY = legY + legH / 2 + legDrop;
    const legInnerBottomInset = 22 * BODY_GROW_H;
    const leftLegInnerBottomX = leftLegX - legW / 2 + legInnerBottomInset;
    const rightLegInnerBottomX = rightLegX + legW / 2 - legInnerBottomInset;
    const leftLegInnerBottomY = leftLegOuterBottomY;
    const rightLegInnerBottomY = rightLegOuterBottomY;

    const footPad = 4 * BODY_GROW_V;
    const leftFootW = leftLegInnerBottomX - leftLegOuterBottomX;
    const rightFootW = rightLegOuterBottomX - rightLegInnerBottomX;
    const leftFootTopY = leftLegOuterBottomY + footPad;
    const rightFootTopY = rightLegOuterBottomY + footPad;
    const footSoleOutset = 2 * BODY_GROW_H;
    const leftFootBottomY = leftFootTopY + leftFootW;
    const rightFootBottomY = rightFootTopY + rightFootW;
    const leftFootCenterX = (leftLegOuterBottomX + leftLegInnerBottomX) / 2;
    const leftFootCenterY = leftFootTopY + leftFootW / 2;
    const rightFootCenterX = (rightLegInnerBottomX + rightLegOuterBottomX) / 2;
    const rightFootCenterY = rightFootTopY + rightFootW / 2;

    // Leg trapezoid edges: topEdge (outerTop→innerTop), innerEdge (innerTop→innerBottom), bottom (innerBottom→outerBottom), outerEdge (outerBottom→outerTop)
    const leftLegG = scene.add.graphics();
    leftLegG.fillStyle(0x404040, 1);
    leftLegG.lineStyle(1, 0x888888);
    leftLegG.beginPath();
    leftLegG.moveTo(leftLegOuterTopX, leftLegOuterTopY);
    leftLegG.lineTo(leftLegInnerTopX, leftLegInnerTopY);
    leftLegG.lineTo(leftLegInnerBottomX, leftLegInnerBottomY);
    leftLegG.lineTo(leftLegOuterBottomX, leftLegOuterBottomY);
    leftLegG.closePath();
    leftLegG.fillPath();
    leftLegG.strokePath();
    leftLegG.setDepth(INV_DEPTH);
    contentArray.push(leftLegG);
    const rightLegG = scene.add.graphics();
    rightLegG.fillStyle(0x404040, 1);
    rightLegG.lineStyle(1, 0x888888);
    rightLegG.beginPath();
    rightLegG.moveTo(rightLegOuterTopX, rightLegOuterTopY);
    rightLegG.lineTo(rightLegInnerTopX, rightLegInnerTopY);
    rightLegG.lineTo(rightLegInnerBottomX, rightLegInnerBottomY);
    rightLegG.lineTo(rightLegOuterBottomX, rightLegOuterBottomY);
    rightLegG.closePath();
    rightLegG.fillPath();
    rightLegG.strokePath();
    rightLegG.setDepth(INV_DEPTH);
    contentArray.push(rightLegG);
    const itemFeet = stats.armor && stats.armor['feet'];
    const leftFootG = scene.add.graphics();
    leftFootG.fillStyle(0x404040, 1);
    leftFootG.lineStyle(1, 0x888888);
    leftFootG.beginPath();
    leftFootG.moveTo(leftLegOuterBottomX, leftFootTopY);
    leftFootG.lineTo(leftLegInnerBottomX, leftFootTopY);
    leftFootG.lineTo(leftLegInnerBottomX + footSoleOutset, leftFootBottomY);
    leftFootG.lineTo(leftLegOuterBottomX - footSoleOutset, leftFootBottomY);
    leftFootG.closePath();
    leftFootG.fillPath();
    leftFootG.strokePath();
    leftFootG.setDepth(INV_DEPTH);
    contentArray.push(leftFootG);
    const rightFootG = scene.add.graphics();
    rightFootG.fillStyle(0x404040, 1);
    rightFootG.lineStyle(1, 0x888888);
    rightFootG.beginPath();
    rightFootG.moveTo(rightLegInnerBottomX, rightFootTopY);
    rightFootG.lineTo(rightLegOuterBottomX, rightFootTopY);
    rightFootG.lineTo(rightLegOuterBottomX + footSoleOutset, rightFootBottomY);
    rightFootG.lineTo(rightLegInnerBottomX - footSoleOutset, rightFootBottomY);
    rightFootG.closePath();
    rightFootG.fillPath();
    rightFootG.strokePath();
    rightFootG.setDepth(INV_DEPTH);
    contentArray.push(rightFootG);
    contentArray.push(scene.add.text(leftFootCenterX, leftFootCenterY, itemFeet ? 'EQ' : "—", { fontSize: '8px', fill: itemFeet ? '#00ff00' : '#999' }).setOrigin(0.5).setDepth(INV_DEPTH));
    contentArray.push(scene.add.text(rightFootCenterX, rightFootCenterY, itemFeet ? 'EQ' : "—", { fontSize: '8px', fill: itemFeet ? '#00ff00' : '#999' }).setOrigin(0.5).setDepth(INV_DEPTH));
    const skullRy = (headEdgeW / 2) * 0.85;
    const thoraxMidY = (chestTopY + chestBottomY) / 2;
    const elbowY = chestY + (abdomenY - chestY) * 0.7;
    const leftElbowX = leftArmX - armW - 2;
    const rightElbowX = rightArmX + armW + 2;
    const kneeY = (triBottomTipY + leftLegOuterBottomY) / 2;
    const leftKneeX = leftLegX - legW / 2 - 2;
    const rightKneeX = rightLegX + legW / 2 + 2;
    const limbLabels = { head: 'HEAD', leftArm: 'L ARM', rightArm: 'R ARM', chest: 'CHEST', abdomen: 'ABDOMEN', crotch: 'CROTCH', leftLeg: 'L LEG', rightLeg: 'R LEG' };
    // Bar a little taller than 11px text; width ~10px padding each side of "30/30"
    const limbBarW = 52;
    const limbBarH = 14;
    const limbHp = stats.limbHp || getDefaultLimbHp();
    const limbPositions = [
        { id: 'head', x: bodyCenterX, y: helmetY - skullRy - 6 },
        { id: 'chest', x: bodyCenterX, y: thoraxMidY },
        { id: 'abdomen', x: bodyCenterX, y: abdomenY },
        { id: 'crotch', x: bodyCenterX, y: crotchCenterY },
        { id: 'leftArm', x: leftElbowX - 8, y: elbowY },
        { id: 'rightArm', x: rightElbowX + 8, y: elbowY },
        { id: 'leftLeg', x: leftKneeX, y: kneeY },
        { id: 'rightLeg', x: rightKneeX, y: kneeY }
    ];
    limbPositions.forEach((pos) => {
        const limbId = pos.id;
        const data = limbHp[limbId] || { hp: LIMB_MAX_HP[limbId], maxHp: LIMB_MAX_HP[limbId], status: '', effects: [] };
        const x = pos.x;
        const y = limbId === 'head' ? pos.y + 15
            : (limbId === 'leftArm' || limbId === 'rightArm') ? pos.y - 50
            : limbId === 'chest' ? pos.y - 35
            : limbId === 'abdomen' ? pos.y - 15
            : limbId === 'crotch' ? pos.y - 8
            : pos.y;
        const maxH = data.maxHp || 1;
        const cur = Math.min(data.hp || 0, maxH);
        const pct = maxH > 0 ? cur / maxH : 0;
        const barColor = pct >= 0.5 ? 0x00aa00 : pct >= 0.35 ? 0xcc6600 : 0xaa0000;
        const barBg = scene.add.rectangle(x, y, limbBarW, limbBarH, 0x333333).setStrokeStyle(1, 0x666666).setDepth(INV_DEPTH + 1);
        contentArray.push(barBg);
        if (pct > 0) {
            const fillW = Math.max(1, limbBarW * pct);
            const barFill = scene.add.rectangle(x - limbBarW / 2 + fillW / 2, y, fillW, Math.max(1, limbBarH - 2), barColor).setDepth(INV_DEPTH + 2);
            contentArray.push(barFill);
        }
        // HP numbers inside the bar to save space (same size as limb label)
        const numbersTxt = scene.add.text(x, y, `${cur}/${maxH}`, { fontSize: '11px', fill: '#fff' }).setOrigin(0.5).setDepth(INV_DEPTH + 3);
        numbersTxt.setStroke('#000', 2);
        contentArray.push(numbersTxt);
        const labelY = y - limbBarH / 2 - 4;
        contentArray.push(scene.add.text(x, labelY, limbLabels[limbId] || limbId, { fontSize: '11px', fill: '#ccc' }).setOrigin(0.5, 1).setDepth(INV_DEPTH + 1));
        const statusY = y + limbBarH / 2 + 4;
        const statusStr = limbEffectsToStatusString(data.effects) || (data.status && String(data.status).trim() ? String(data.status) : '') || '—';
        contentArray.push(scene.add.text(x, statusY, statusStr, { fontSize: '9px', fill: '#999' }).setOrigin(0.5, 0).setDepth(INV_DEPTH + 1));
        const zonePad = 10;
        limbZones.push({
            id: limbId,
            left: x - limbBarW / 2 - 15,
            right: x + limbBarW / 2 + 15,
            top: labelY - 12,
            bottom: statusY + 10
        });
        });
    const hpPct = stats.maxHp > 0 ? stats.hp / stats.maxHp : 0;
    const hpColor = hpPct >= 0.5 ? '#00ff00' : hpPct >= 0.35 ? '#ff8800' : '#ff0000';  // green 50%+, orange 35-49%, red 0-34%
    contentArray.push(scene.add.text(bodyCenterX, bodyAreaBottom + 114, `HP: ${stats.hp}/${stats.maxHp}`, { fontSize: '24px', fontStyle: 'bold', fill: hpColor }).setOrigin(0.5).setDepth(INV_DEPTH));
    const rigSlotSize = 25;
    const rigX = invGridX - rigSlotSize / 2 - 5;
    // Block (rig, pockets, backpack, secure) 8px below primary weapon slot; same relative spacing within block.
    const primarySlotH = 42, secondarySlotH = 42, slotRowGap = 5;
    const secondarySlotYRef = 443;
    const primarySlotY = invPanelTop + 35; // primary weapon slot Y (was 95; lowered with panel)
    invGridY = invPanelTop + 155; // block (rig, pockets, backpack, secure) - was 215; lowered with panel
    const rigY = invGridY - 73.5;
    const armorSlotZones = [
        { id: 'head', left: helmetBoxX - equipBoxW / 2, right: helmetBoxX + equipBoxW / 2, top: helmetBoxY - equipBoxH / 2 - 10, bottom: helmetBoxY + equipBoxH / 2 },
        { id: 'body', left: vestBoxX - equipBoxW / 2, right: vestBoxX + equipBoxW / 2, top: vestBoxY - equipBoxH / 2 - 10, bottom: vestBoxY + equipBoxH / 2 },
        { id: 'ears', left: earsX - accBoxW / 2, right: earsX + accBoxW / 2, top: earsY - accBoxH / 2, bottom: earsY + accBoxH / 2 },
        { id: 'nvg', left: bodyCenterX - accBoxW / 2, right: bodyCenterX + accBoxW / 2, top: nvgY - accBoxH / 2, bottom: nvgY + accBoxH / 2 },
        { id: 'rig', left: rigX - rigSlotSize / 2, right: rigX + rigSlotSize / 2, top: rigY - rigSlotSize / 2, bottom: rigY + rigSlotSize / 2 }
    ];
    const ARMOR_SLOT_ITEM = { head: 'helmet', body: 'vest', ears: 'headset', rig: 'rig', nvg: 'nvg' };
    const rigEquipped = stats.armor && stats.armor.rig;
    contentArray.push(scene.add.text(rigX, rigY - rigSlotSize / 2 - 6, 'RIG', { fontSize: '8px', fill: '#bbb' }).setOrigin(0.5).setDepth(INV_DEPTH));
    contentArray.push(scene.add.rectangle(rigX, rigY, rigSlotSize, rigSlotSize, rigEquipped ? 0x555555 : 0x404040).setStrokeStyle(1, 0x888888).setDepth(INV_DEPTH));
    contentArray.push(scene.add.text(rigX, rigY, rigEquipped ? 'EQ' : '—', { fontSize: '8px', fill: rigEquipped ? '#00ff00' : '#999' }).setOrigin(0.5).setDepth(INV_DEPTH + 1));
    let rigGrid = null;
    const rigItemZones = [];
    const rigEmptyZones = [];
    const rigCellSize = 20;
    const rigColGap = 5;
    const rigStepX = rigCellSize + rigColGap;
    const rigStepY = rigCellSize + 1;
    const rigGridCols = 4;
    const rigGridRows = 2;
    const rigGridBottomY = rigY - rigSlotSize / 2 + (rigGridRows - 1) * rigStepY + rigCellSize;
    if (rigEquipped) {
        rigGrid = stats.rigGrid || { gridW: 4, gridH: 2, items: [], _nextId: 1 };
        rigGrid.gridW = rigGridCols;
        rigGrid.gridH = rigGridRows;
        ensureGridItems(rigGrid);
        const rigGridX = invGridX;
        const rigGridY = rigY - rigSlotSize / 2;
        const rigOccupied = new Set();
        (rigGrid.items || []).forEach(p => {
            for (let r = 0; r < (p.sizeH || 1); r++)
                for (let c = 0; c < (p.sizeW || 1); c++) rigOccupied.add(`${p.row + r},${p.col + c}`);
        });
        for (let row = 0; row < rigGridRows; row++) {
            for (let col = 0; col < rigGridCols; col++) {
                const x = rigGridX + col * rigStepX, y = rigGridY + row * rigStepY;
                const isOcc = rigOccupied.has(`${row},${col}`);
                const r = scene.add.rectangle(x + rigCellSize / 2, y + rigCellSize / 2, rigCellSize, rigCellSize, isOcc ? 0x3a4a3a : 0x2a2a2a).setStrokeStyle(1, 0x666666).setDepth(INV_DEPTH);
                contentArray.push(r);
                if (!isOcc) rigEmptyZones.push({ left: x, right: x + rigCellSize, top: y, bottom: y + rigCellSize, row, col });
            }
        }
        (rigGrid.items || []).forEach(p => {
            const cfg = getInventoryItemConfig(p.itemId);
            const lbl = (cfg && cfg.icon) ? cfg.icon : (p.itemId || '?').slice(0, 2).toUpperCase();
            const sw = p.sizeW || 1, sh = p.sizeH || 1;
            const hw = sw * rigCellSize, hh = sh * rigCellSize;
            const tx = rigGridX + p.col * rigStepX + hw / 2;
            const ty = rigGridY + p.row * rigStepY + hh / 2;
            if (cfg && cfg.color) {
                const cellColor = parseInt(cfg.color.slice(1), 16);
                contentArray.push(scene.add.rectangle(tx, ty, hw, hh, cellColor).setStrokeStyle(1, 0x666666).setDepth(INV_DEPTH));
            }
            const fillColor = (cfg && cfg.color) ? cfg.color : '#e0e0e0';
            contentArray.push(scene.add.text(tx, ty, (p.count > 1 ? lbl + p.count : lbl) + getMagazineRoundsLabel(p), { fontSize: '7px', fill: fillColor }).setOrigin(0.5).setDepth(INV_DEPTH + 1));
            rigItemZones.push({
                left: tx - hw / 2, right: tx + hw / 2, top: ty - hh / 2, bottom: ty + hh / 2,
                placementId: p.placementId, itemId: p.itemId, count: p.count || 1, sizeW: sw, sizeH: sh, fromRig: true
            });
        });
    }
    // Med bag: 2×2 grid, slot to the right of rig; medical-only (same pattern as secure container).
    const medBagGridCols = 2;
    const medBagGridRows = 2;
    const medBagCellSize = rigCellSize;
    const medBagColGap = 0;
    const medBagRowGap = 0;
    const medBagStepX = medBagCellSize + medBagColGap;
    const medBagStepY = medBagCellSize + medBagRowGap;
    // Position med bag 60px to the left of the pistol/sidearm slot (same left-edge formula as sidearm)
    const pistolBagLeftX = bodyCenterX - bodySlotW / 2 - 15 - rigSlotSize + 120;
    const medBagGapLeftOfPistol = 60;
    const medBagOffsetX = -35; // extra offset: negative = left (-50 + 15)
    const medBagOffsetY = 160; // extra offset: down (200 - 40)
    const medBagGridLeft = pistolBagLeftX - medBagGapLeftOfPistol - (medBagGridCols * medBagCellSize) + medBagOffsetX;
    const medBagSlotSize = rigSlotSize;
    const medBagSlotX = medBagGridLeft + (medBagGridCols * medBagCellSize) / 2;
    const medBagSlotY = rigY + medBagOffsetY;
    const medBagSlotZone = { id: 'medBag', left: medBagSlotX - medBagSlotSize / 2, right: medBagSlotX + medBagSlotSize / 2, top: medBagSlotY - medBagSlotSize / 2, bottom: medBagSlotY + medBagSlotSize / 2 };
    const hasMedBagGrid = stats.medBagGrid && Array.isArray(stats.medBagGrid.items);
    contentArray.push(scene.add.text(medBagSlotX, medBagSlotY - medBagSlotSize / 2 - 6, 'MED', { fontSize: '8px', fill: '#bbb' }).setOrigin(0.5).setDepth(INV_DEPTH));
    contentArray.push(scene.add.rectangle(medBagSlotX, medBagSlotY, medBagSlotSize, medBagSlotSize, hasMedBagGrid ? 0x555555 : 0x404040).setStrokeStyle(1, 0x888888).setDepth(INV_DEPTH));
    contentArray.push(scene.add.text(medBagSlotX, medBagSlotY, hasMedBagGrid ? 'EQ' : '—', { fontSize: '8px', fill: hasMedBagGrid ? '#00ff00' : '#999' }).setOrigin(0.5).setDepth(INV_DEPTH + 1));
    let medBagGrid = null;
    const medBagItemZones = [];
    const medBagEmptyZones = [];
    if (hasMedBagGrid) {
        medBagGrid = stats.medBagGrid;
        medBagGrid.gridW = medBagGridCols;
        medBagGrid.gridH = medBagGridRows;
        ensureGridItems(medBagGrid);
        const medBagGridGapBelowSlot = 5;
        const medBagGridY = medBagSlotY + medBagSlotSize / 2 + medBagGridGapBelowSlot;
        const medBagOccupied = new Set();
        (medBagGrid.items || []).forEach(p => {
            for (let r = 0; r < (p.sizeH || 1); r++)
                for (let c = 0; c < (p.sizeW || 1); c++) medBagOccupied.add(`${p.row + r},${p.col + c}`);
        });
        for (let row = 0; row < medBagGridRows; row++) {
            for (let col = 0; col < medBagGridCols; col++) {
                const x = medBagGridLeft + col * medBagStepX, y = medBagGridY + row * medBagStepY;
                const isOcc = medBagOccupied.has(`${row},${col}`);
                const r = scene.add.rectangle(x + medBagCellSize / 2, y + medBagCellSize / 2, medBagCellSize, medBagCellSize, isOcc ? 0x3a4a3a : 0x2a2a2a).setStrokeStyle(1, 0x666666).setDepth(INV_DEPTH);
                contentArray.push(r);
                if (!isOcc) medBagEmptyZones.push({ left: x, right: x + medBagCellSize, top: y, bottom: y + medBagCellSize, row, col });
            }
        }
        (medBagGrid.items || []).forEach(p => {
            const cfg = getInventoryItemConfig(p.itemId);
            const lbl = (cfg && cfg.icon) ? cfg.icon : (p.itemId || '?').slice(0, 2).toUpperCase();
            const sw = p.sizeW || 1, sh = p.sizeH || 1;
            const hw = sw * medBagCellSize, hh = sh * medBagCellSize;
            const tx = medBagGridLeft + p.col * medBagStepX + hw / 2;
            const ty = medBagGridY + p.row * medBagStepY + hh / 2;
            if (cfg && cfg.color) {
                const cellColor = parseInt(cfg.color.slice(1), 16);
                contentArray.push(scene.add.rectangle(tx, ty, hw, hh, cellColor).setStrokeStyle(1, 0x666666).setDepth(INV_DEPTH));
            }
            const fillColor = (cfg && cfg.color) ? cfg.color : '#e0e0e0';
            contentArray.push(scene.add.text(tx, ty, (p.count > 1 ? lbl + p.count : lbl), { fontSize: '7px', fill: fillColor }).setOrigin(0.5).setDepth(INV_DEPTH + 1));
            medBagItemZones.push({
                left: tx - hw / 2, right: tx + hw / 2, top: ty - hh / 2, bottom: ty + hh / 2,
                placementId: p.placementId, itemId: p.itemId, count: p.count || 1, sizeW: sw, sizeH: sh, fromMedBag: true
            });
        });
    }
    // Pockets: 3&4 = 1×1 above; 1&2 = 2×1 below. Pocket 1 left edge and pocket 2 right edge align with backpack.
    const pocketSlotSize = 20;
    const pocketGap = 9;
    const pocketBackpackGap = 10;
    const pocketToBackpackGap = 15;
    const pocketYBottom = rigGridBottomY + pocketBackpackGap + pocketSlotSize / 2;
    const pocketYTop = pocketYBottom - pocketSlotSize - 4;
    const backpackLeft = invGridX;
    const backpackRight = invGridX + 6 * step;
    // Pocket section: fully detached — single anchor, no backpack/rig/invGrid references.
    const pocketBlockLeftX = 250; // left edge of pocket 3; change this to move the whole pocket block
    const pocketGapInner = 10; // gap between adjacent pockets (3–1, 1–2, 2–4)
    const pocket3OffsetRight = 78; // pocket 3 shifted right
    const pocket3CenterX = pocketBlockLeftX + pocketSlotSize / 2 + pocket3OffsetRight;
    const pocket1OffsetRight = 85; // pocket 1 shifted right from default gap
    const pocket1CenterX = pocket3CenterX + pocketSlotSize + pocketGapInner + pocket1OffsetRight - pocket3OffsetRight;
    const pocket2OffsetRight = 107; // pocket 2 shifted right from default gap
    const pocket2CenterX = pocket1CenterX + pocketSlotSize + pocketGapInner + pocket2OffsetRight - pocket1OffsetRight;
    // Match gap (2 right edge → 4 left edge) to gap (3 right edge → 1 left edge)
    const pocket4OffsetRight = pocket2OffsetRight + pocket1OffsetRight - pocket3OffsetRight;
    const pocket4CenterX = pocket2CenterX + pocketSlotSize + pocketGapInner + pocket4OffsetRight - pocket2OffsetRight;
    // Pocket 3 (left of pocket 1); pocket 4 (right of pocket 2) — same row as pocket 1 & 2
    contentArray.push(scene.add.rectangle(pocket3CenterX, pocketYBottom, pocketSlotSize, pocketSlotSize, 0x353535).setStrokeStyle(1, 0x777777).setDepth(INV_DEPTH));
    contentArray.push(scene.add.rectangle(pocket4CenterX, pocketYBottom, pocketSlotSize, pocketSlotSize, 0x353535).setStrokeStyle(1, 0x777777).setDepth(INV_DEPTH));
    // Bottom row: pocket 1 (2×1 = two squares), pocket 2 (2×1 = two squares)
    contentArray.push(scene.add.rectangle(pocket1CenterX - pocketSlotSize / 2, pocketYBottom, pocketSlotSize, pocketSlotSize, 0x353535).setStrokeStyle(1, 0x777777).setDepth(INV_DEPTH));
    contentArray.push(scene.add.rectangle(pocket1CenterX + pocketSlotSize / 2, pocketYBottom, pocketSlotSize, pocketSlotSize, 0x353535).setStrokeStyle(1, 0x777777).setDepth(INV_DEPTH));
    contentArray.push(scene.add.rectangle(pocket2CenterX - pocketSlotSize / 2, pocketYBottom, pocketSlotSize, pocketSlotSize, 0x353535).setStrokeStyle(1, 0x777777).setDepth(INV_DEPTH));
    contentArray.push(scene.add.rectangle(pocket2CenterX + pocketSlotSize / 2, pocketYBottom, pocketSlotSize, pocketSlotSize, 0x353535).setStrokeStyle(1, 0x777777).setDepth(INV_DEPTH));
    // Draw pocket contents (playerStats.pockets: [p1[2], p2[2], p3[1], p4[1]]). Each pocket is separate; no item spans two pockets.
    ensurePockets(stats);
    sanitizePockets(stats);
    const pockets = stats.pockets || getDefaultPockets();
    const pocketSlotCenters = [
        [pocket1CenterX - pocketSlotSize / 2, pocketYBottom], [pocket1CenterX + pocketSlotSize / 2, pocketYBottom],
        [pocket2CenterX - pocketSlotSize / 2, pocketYBottom], [pocket2CenterX + pocketSlotSize / 2, pocketYBottom],
        [pocket3CenterX, pocketYBottom],
        [pocket4CenterX, pocketYBottom]
    ];
    const half = pocketSlotSize / 2;
    const pocketZones = pocketSlotCenters.map(([cx, cy], i) => ({
        left: cx - half, right: cx + half, top: cy - half, bottom: cy + half,
        pocketIndex: POCKET_SLOT_INDEX_TO_POCKET[i],
        slotIndex: [0, 1, 0, 1, 0, 0][i]
    }));
    let slotIdx = 0;
    pockets.forEach((pocketSlots, pi) => {
        (pocketSlots || []).forEach((slot, si) => {
            if (slotIdx >= pocketSlotCenters.length) return;
            if (slot && slot._spansFrom !== undefined) return;
            if (!slot || !slot.itemId) {
                slotIdx += 1;
                return;
            }
            const cfg = getInventoryItemConfig(slot.itemId);
            const stackable = cfg && (cfg.category === 'stackable' || (cfg.stackMax && cfg.stackMax > 1));
            const count = slot.count == null ? 1 : slot.count;
            if (stackable && count <= 0) {
                slotIdx += 1;
                return;
            }
            const sw = slot.sizeW || 1, sh = slot.sizeH || 1;
            const samePocketSpan = slotIdx + 1 < pocketSlotCenters.length && POCKET_SLOT_INDEX_TO_POCKET[slotIdx] === POCKET_SLOT_INDEX_TO_POCKET[slotIdx + 1];
            const drawAs2x1 = sw === 2 && sh === 1 && POCKET_LAYOUT[pi] && POCKET_LAYOUT[pi].w >= 2 && samePocketSpan;
            let cx, cy, drawW, drawH;
            if (drawAs2x1) {
                const [cx0, cy0] = pocketSlotCenters[slotIdx], [cx1, cy1] = pocketSlotCenters[slotIdx + 1];
                cx = (cx0 + cx1) / 2; cy = (cy0 + cy1) / 2;
                drawW = pocketSlotSize * 2 - 2; drawH = pocketSlotSize - 2;
            } else {
                [cx, cy] = pocketSlotCenters[slotIdx];
                drawW = pocketSlotSize - 2; drawH = pocketSlotSize - 2;
            }
            const lbl = (cfg && cfg.icon) ? cfg.icon : (slot.itemId || '?').slice(0, 2).toUpperCase();
            const fillColor = (cfg && cfg.color) ? cfg.color : '#e0e0e0';
            if (drawW > pocketSlotSize && cfg && cfg.color) {
                const cellColor = parseInt(cfg.color.slice(1), 16);
                contentArray.push(scene.add.rectangle(cx, cy, drawW, drawH, cellColor).setStrokeStyle(1, 0x666666).setDepth(INV_DEPTH));
            }
            contentArray.push(scene.add.text(cx, cy, (count > 1 ? lbl + count : lbl) + getMagazineRoundsLabel(slot), { fontSize: '8px', fill: fillColor }).setOrigin(0.5).setDepth(INV_DEPTH + 1));
            slotIdx += drawAs2x1 ? 2 : 1;
        });
    });
    const backpackSlotSize = rigSlotSize;
    const backpackSlotX = invGridX - backpackSlotSize / 2 - 8;
    const backpackSlotY = invGridY + backpackSlotSize / 2;
    const backpackSlotZone = { id: 'backpack', left: backpackSlotX - backpackSlotSize / 2, right: backpackSlotX + backpackSlotSize / 2, top: backpackSlotY - backpackSlotSize / 2, bottom: backpackSlotY + backpackSlotSize / 2 };
    const backpackEquipped = stats.equippedBackpack && stats.equippedBackpack.placementId === 'equipped';
    contentArray.push(scene.add.text(backpackSlotX, backpackSlotY - backpackSlotSize / 2 - 6, 'BAG', { fontSize: '8px', fill: '#bbb' }).setOrigin(0.5).setDepth(INV_DEPTH));
    contentArray.push(scene.add.rectangle(backpackSlotX, backpackSlotY, backpackSlotSize, backpackSlotSize, backpackEquipped ? 0x555555 : 0x404040).setStrokeStyle(1, 0x888888).setDepth(INV_DEPTH));
    contentArray.push(scene.add.text(backpackSlotX, backpackSlotY, backpackEquipped ? 'EQ' : '—', { fontSize: '8px', fill: backpackEquipped ? '#00ff00' : '#999' }).setOrigin(0.5).setDepth(INV_DEPTH + 1));
    // Secure container: equip slot centered over 2×3 grid; grid 8px left of previous position
    const secureGridCols = 2;
    const secureGridRows = 3;
    const secureCellSize = rigCellSize;
    const secureColGap = 0;
    const secureRowGap = 0;
    const secureStepX = secureCellSize + secureColGap;
    const secureStepY = secureCellSize + secureRowGap;
    const secureGridWidth = secureGridCols * secureCellSize + Math.max(0, secureGridCols - 1) * secureColGap;
    const secureGridLeft = invGridX - (backpackSlotSize / 2 + 8) - secureGridWidth / 2 - 8;
    const secureContainerSlotSize = backpackSlotSize;
    const secureContainerSlotX = secureGridLeft + secureGridWidth / 2;
    const secureContainerSlotY = invGridY + 4.5 * step;
    const secureContainerSlotZone = { id: 'secureContainer', left: secureContainerSlotX - secureContainerSlotSize / 2, right: secureContainerSlotX + secureContainerSlotSize / 2, top: secureContainerSlotY - secureContainerSlotSize / 2, bottom: secureContainerSlotY + secureContainerSlotSize / 2 };
    const hasSecureContainerGrid = stats.secureContainerGrid && Array.isArray(stats.secureContainerGrid.items);
    contentArray.push(scene.add.text(secureContainerSlotX, secureContainerSlotY - secureContainerSlotSize / 2 - 6, 'SEC', { fontSize: '8px', fill: '#bbb' }).setOrigin(0.5).setDepth(INV_DEPTH));
    contentArray.push(scene.add.rectangle(secureContainerSlotX, secureContainerSlotY, secureContainerSlotSize, secureContainerSlotSize, hasSecureContainerGrid ? 0x555555 : 0x404040).setStrokeStyle(1, 0x888888).setDepth(INV_DEPTH));
    contentArray.push(scene.add.text(secureContainerSlotX, secureContainerSlotY, hasSecureContainerGrid ? 'EQ' : '—', { fontSize: '8px', fill: hasSecureContainerGrid ? '#00ff00' : '#999' }).setOrigin(0.5).setDepth(INV_DEPTH + 1));
    let secureContainerGrid = null;
    const secureContainerItemZones = [];
    const secureContainerEmptyZones = [];
    if (hasSecureContainerGrid) {
        secureContainerGrid = stats.secureContainerGrid;
        secureContainerGrid.gridW = secureGridCols;
        secureContainerGrid.gridH = secureGridRows;
        ensureGridItems(secureContainerGrid);
        const secureGridGapBelowSlot = 5;
        const secureGridY = secureContainerSlotY + secureContainerSlotSize / 2 + secureGridGapBelowSlot;
        const secureOccupied = new Set();
        (secureContainerGrid.items || []).forEach(p => {
            for (let r = 0; r < (p.sizeH || 1); r++)
                for (let c = 0; c < (p.sizeW || 1); c++) secureOccupied.add(`${p.row + r},${p.col + c}`);
        });
        for (let row = 0; row < secureGridRows; row++) {
            for (let col = 0; col < secureGridCols; col++) {
                const x = secureGridLeft + col * secureStepX, y = secureGridY + row * secureStepY;
                const isOcc = secureOccupied.has(`${row},${col}`);
                const r = scene.add.rectangle(x + secureCellSize / 2, y + secureCellSize / 2, secureCellSize, secureCellSize, isOcc ? 0x3a4a3a : 0x2a2a2a).setStrokeStyle(1, 0x666666).setDepth(INV_DEPTH);
                contentArray.push(r);
                if (!isOcc) secureContainerEmptyZones.push({ left: x, right: x + secureCellSize, top: y, bottom: y + secureCellSize, row, col });
            }
        }
        (secureContainerGrid.items || []).forEach(p => {
            const cfg = getInventoryItemConfig(p.itemId);
            const lbl = (cfg && cfg.icon) ? cfg.icon : (p.itemId || '?').slice(0, 2).toUpperCase();
            const sw = p.sizeW || 1, sh = p.sizeH || 1;
            const hw = sw * secureCellSize, hh = sh * secureCellSize;
            const tx = secureGridLeft + p.col * secureStepX + hw / 2;
            const ty = secureGridY + p.row * secureStepY + hh / 2;
            if (cfg && cfg.color) {
                const cellColor = parseInt(cfg.color.slice(1), 16);
                contentArray.push(scene.add.rectangle(tx, ty, hw, hh, cellColor).setStrokeStyle(1, 0x666666).setDepth(INV_DEPTH));
            }
            const fillColor = (cfg && cfg.color) ? cfg.color : '#e0e0e0';
            contentArray.push(scene.add.text(tx, ty, (p.count > 1 ? lbl + p.count : lbl), { fontSize: '7px', fill: fillColor }).setOrigin(0.5).setDepth(INV_DEPTH + 1));
            secureContainerItemZones.push({
                left: tx - hw / 2, right: tx + hw / 2, top: ty - hh / 2, bottom: ty + hh / 2,
                placementId: p.placementId, itemId: p.itemId, count: p.count || 1, sizeW: sw, sizeH: sh, fromSecureContainer: true
            });
        });
    }
    const emptyCellZones = [];
    if (backpackEquipped) {
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 6; col++) {
                const x = invGridX + col * step, y = invGridY + row * step;
                const isOcc = occupied.has(`${row},${col}`);
                const r = scene.add.rectangle(x + cellSize/2, y + cellSize/2, cellSize, cellSize, isOcc ? 0x3a4a3a : 0x2a2a2a).setStrokeStyle(1, 0x666666).setDepth(INV_DEPTH);
                contentArray.push(r);
            }
        }
        (backpack.items || []).forEach(p => {
            const cfg = getInventoryItemConfig(p.itemId);
            const lbl = (cfg && cfg.icon) ? cfg.icon : (p.itemId || '?').slice(0, 2).toUpperCase();
            const tx = invGridX + p.col * step + (p.sizeW || 1) * step / 2;
            const ty = invGridY + p.row * step + (p.sizeH || 1) * step / 2;
            if (cfg && cfg.color) {
                const cellColor = parseInt(cfg.color.slice(1), 16);
                const rw = (p.sizeW || 1) * step, rh = (p.sizeH || 1) * step;
                const bgRect = scene.add.rectangle(tx, ty, rw, rh, cellColor).setStrokeStyle(1, 0x666666).setDepth(INV_DEPTH);
                contentArray.push(bgRect);
            }
            const fillColor = (cfg && cfg.color) ? cfg.color : '#e0e0e0';
            const txt = scene.add.text(tx, ty, (p.count > 1 ? lbl + p.count : lbl) + getMagazineRoundsLabel(p), { fontSize: '8px', fill: fillColor }).setOrigin(0.5).setDepth(INV_DEPTH + 1);
            contentArray.push(txt);
            addItemZone(invGridX, invGridY, p);
        });
        for (let row = 0; row < 9; row++)
            for (let col = 0; col < 6; col++)
                if (!occupied.has(`${row},${col}`))
                    emptyCellZones.push({
                        left: invGridX + col * step, right: invGridX + (col + 1) * step,
                        top: invGridY + row * step, bottom: invGridY + (row + 1) * step,
                        row, col
                    });
    }
    const weaponSlotIds = ['primary', 'secondary', 'sidearm', 'melee'];
    const ws = stats.weaponSlots || { primary: null, secondary: null, sidearm: 'pistol', melee: null };
    const weaponSlotLabels = ['PRIMARY', 'SECONDARY', 'SIDEARM', 'MELEE'];
    const weaponSlotDisplay = weaponSlotIds.map(id => (ws[id] || '').toUpperCase() || 'EMPTY');
    const weaponSlotCurrent = weaponSlotIds.map(id => ws[id] === weapon);
    // Primary slot: same horizontal span as before (left = rig, right = backpack+15), centered; vertical positions set above
    const primarySlotLeft = rigX - rigSlotSize / 2;
    const primarySlotRight = backpackRight + 15;
    const primarySlotW = primarySlotRight - primarySlotLeft;
    const primarySlotCenterX = primarySlotLeft + primarySlotW / 2;
    const secondarySlotY = secondarySlotYRef - 5;
    // Sidearm: same size as rig/BAG square, left of body (abdomen/crotch) — hip holster position
    const sidearmBoxSize = rigSlotSize;
    const sidearmGapLeftOfBody = 15;
    const bodyLeftX = bodyCenterX - bodySlotW / 2;
    const sidearmCenterX = bodyLeftX - sidearmGapLeftOfBody - sidearmBoxSize / 2 + 120;
    const sidearmY = pocketYBottom + 115;
    // Melee: 1x4 equippable strip along right side of backpack, top-aligned (no cells)
    const meleeSlotW = step;
    const meleeSlotH = 4 * step;
    const meleeGapRightOfBackpack = 8;
    const meleeCenterX = backpackRight + meleeGapRightOfBackpack + meleeSlotW / 2;
    const meleeCenterY = invGridY + 2 * step;
    const weaponSlotPos = [
        { x: primarySlotCenterX, y: primarySlotY, w: primarySlotW, h: primarySlotH },
        { x: primarySlotCenterX, y: secondarySlotY, w: primarySlotW, h: secondarySlotH },
        { x: sidearmCenterX, y: sidearmY, w: sidearmBoxSize, h: sidearmBoxSize },
        { x: meleeCenterX, y: meleeCenterY, w: meleeSlotW, h: meleeSlotH }
    ];
    const attachmentBoxSize = 14;
    const attachmentBoxGap = 2;
    const attachmentRowOffsetY = 2;
    ensureEquippedModsShape(stats);
    ensureWeaponSlotModsShape(stats);
    const attachmentBoxZones = [];
    weaponSlotIds.forEach((id, i) => {
        const pos = weaponSlotPos[i];
        const slotBg = scene.add.rectangle(pos.x, pos.y, pos.w, pos.h, 0x404040).setStrokeStyle(1, 0x888888).setDepth(INV_DEPTH);
        const lbl = scene.add.text(pos.x, pos.y - pos.h / 2 - 4, weaponSlotLabels[i], { fontSize: '8px', fill: '#bbb' }).setOrigin(0.5).setDepth(INV_DEPTH);
        const isEquipped = weaponSlotCurrent[i];
        const slotWeaponId = ws[id];
        const slotCfg = slotWeaponId ? getInventoryItemConfig(slotWeaponId) : null;
        const shortLabel = (slotCfg && slotCfg.icon) ? slotCfg.icon : weaponSlotDisplay[i];
        const slotFontSize = (i === 2) ? '8px' : '9px';
        const itemTxt = scene.add.text(pos.x, pos.y, shortLabel + (isEquipped ? ' (EQ)' : ''), { fontSize: slotFontSize, fill: weaponSlotDisplay[i] !== 'EMPTY' ? (isEquipped ? '#00ff00' : '#ddd') : '#999' }).setOrigin(0.5).setDepth(INV_DEPTH);
        contentArray.push(slotBg, lbl, itemTxt);
        // Mag round count on weapon slot (lower-right) for primary/secondary only; sidearm shows rounds in attachment box below
        if (i <= 1 && (slotWeaponId === 'pistol' || slotWeaponId === 'smg' || slotWeaponId === 'rifle')) {
            const em = getEquippedMag(stats, slotWeaponId);
            const roundsStr = em ? `${em.rounds ?? 0}/${em.maxRounds ?? getMagazineCapacity(em.itemId)}` : '—';
            const roundTxt = scene.add.text(pos.x + pos.w / 2 - 6, pos.y + pos.h / 2 - 5, roundsStr, { fontSize: '10px', fill: em ? '#8f8' : '#666' }).setOrigin(1, 1).setDepth(INV_DEPTH + 1);
            contentArray.push(roundTxt);
        }
        // Phase 4.2: attachment boxes with hit zones for drag/drop
        if (i <= 2) {
            const weaponId = ws[id];
            if (weaponId && CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[weaponId]) {
                let slotNames = getWeaponSlotNames(weaponId);
                // Sidearm (pistol) only: suppressor, light, magazine — 3 boxes centered under the slot
                if (i === 2 && weaponId === 'pistol') slotNames = slotNames.slice(0, 3);
                const modsObj = getModsForWeaponInSlot(stats, id);
                const totalW = slotNames.length * attachmentBoxSize + (slotNames.length - 1) * attachmentBoxGap;
                const rowY = pos.y + pos.h / 2 + attachmentRowOffsetY + attachmentBoxSize / 2 + (i <= 1 ? -18 : 0);
                let boxX = pos.x - totalW / 2 + attachmentBoxSize / 2;
                slotNames.forEach((slotName) => {
                    const isMagSlot = (slotName === 'magazine' || slotName === 'magazine_mod') && (weaponId === 'pistol' || weaponId === 'smg' || weaponId === 'rifle');
                    const equippedMag = isMagSlot ? getEquippedMag(stats, weaponId) : null;
                    const modId = isMagSlot ? null : (modsObj[slotName] || null);
                    const mod = modId ? Object.values(CONFIG.MODS).find(m => m.id === modId) : null;
                    attachmentBoxZones.push({
                        left: boxX - attachmentBoxSize / 2, right: boxX + attachmentBoxSize / 2,
                        top: rowY - attachmentBoxSize / 2, bottom: rowY + attachmentBoxSize / 2,
                        type: 'slot', slotId: id, slotName, weaponId, modId: equippedMag ? null : (modId || null),
                        magId: equippedMag ? equippedMag.itemId : null, magRounds: equippedMag ? equippedMag.rounds : null, magMaxRounds: equippedMag ? equippedMag.maxRounds : null
                    });
                    const hasContent = equippedMag || mod;
                    const boxBg = scene.add.rectangle(boxX, rowY, attachmentBoxSize, attachmentBoxSize, hasContent ? 0x334433 : 0x2a2a2a).setStrokeStyle(1, 0x666666).setDepth(INV_DEPTH);
                    contentArray.push(boxBg);
                    const label = equippedMag ? `${equippedMag.rounds ?? 0}/${equippedMag.maxRounds ?? getMagazineCapacity(equippedMag.itemId)}` : (mod ? mod.icon : (slotName === 'magazine' || slotName === 'magazine_mod' ? '—' : slotName.replace(/_/g, '').slice(0, 2)));
                    const boxTxt = scene.add.text(boxX, rowY, label, { fontSize: equippedMag ? '6px' : '7px', fill: hasContent ? '#8f8' : '#666' }).setOrigin(0.5).setDepth(INV_DEPTH + 1);
                    contentArray.push(boxTxt);
                    boxX += attachmentBoxSize + attachmentBoxGap;
                });
            }
        }
    });
    const weaponSlotZones = weaponSlotIds.map((id, i) => {
        const pos = weaponSlotPos[i];
        return { id, left: pos.x - pos.w / 2, right: pos.x + pos.w / 2, top: pos.y - pos.h / 2, bottom: pos.y + pos.h / 2 };
    });
    // Phase 2: weapon detail view (double-click weapon in bag to focus)
    const focusWeapon = scene.invFocusedWeapon;
    if (focusWeapon && CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[focusWeapon]) {
        // Safety: if source item no longer exists, clear focus to avoid errors
        let sourceValid = true;
        if (scene.invFocusedWeaponSource && scene.invFocusedWeaponSource.type === 'backpack' && backpack && backpack.items) {
            sourceValid = !!backpack.items.find(p => p.placementId === scene.invFocusedWeaponSource.placementId);
        } else if (scene.invFocusedWeaponSource && scene.invFocusedWeaponSource.type === 'rig' && rigGrid && rigGrid.items) {
            sourceValid = !!rigGrid.items.find(p => p.placementId === scene.invFocusedWeaponSource.placementId);
        } else if (scene.invFocusedWeaponSource && scene.invFocusedWeaponSource.type === 'stash' && scene.persistent && scene.persistent.stash && scene.persistent.stash.items) {
            sourceValid = !!scene.persistent.stash.items.find(p => p.placementId === scene.invFocusedWeaponSource.placementId);
        } else if (scene.invFocusedWeaponSource && scene.invFocusedWeaponSource.type === 'pocket' && stats.pockets) {
            const slot = stats.pockets[scene.invFocusedWeaponSource.pocketIndex] && stats.pockets[scene.invFocusedWeaponSource.pocketIndex][scene.invFocusedWeaponSource.slotIndex];
            sourceValid = !!(slot && slot.itemId === focusWeapon);
        } else if (scene.invFocusedWeaponSource && scene.invFocusedWeaponSource.type === 'slot' && stats.weaponSlots) {
            sourceValid = (stats.weaponSlots[scene.invFocusedWeaponSource.slotId] === focusWeapon);
        }
        if (!sourceValid) {
            scene.invFocusedWeapon = null;
            scene.invFocusedWeaponSource = null;
        }
    }
    if (focusWeapon && scene.invFocusedWeapon === focusWeapon && CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[focusWeapon]) {
        const detailX = 535;
        const detailY = 180;
        const detailW = 220;
        const detailH = 72;
        contentArray.push(scene.add.rectangle(detailX, detailY, detailW, detailH, 0x1e2a1e, 0.95).setStrokeStyle(2, 0x558855).setDepth(INV_DEPTH + 2));
        contentArray.push(scene.add.text(detailX, detailY - detailH / 2 + 10, 'OUTFIT: ' + (focusWeapon || '').toUpperCase(), { fontSize: '11px', fill: '#8f8' }).setOrigin(0.5).setDepth(INV_DEPTH + 3));
        const fSlotNames = getWeaponSlotNames(focusWeapon);
        let fModsObj;
        if (scene.invFocusedWeaponSource && scene.invFocusedWeaponSource.type === 'backpack' && backpack && backpack.items) {
            const item = backpack.items.find(p => p.placementId === scene.invFocusedWeaponSource.placementId);
            fModsObj = getModsForWeaponItem(item);
        } else if (scene.invFocusedWeaponSource && scene.invFocusedWeaponSource.type === 'rig' && rigGrid && rigGrid.items) {
            const item = rigGrid.items.find(p => p.placementId === scene.invFocusedWeaponSource.placementId);
            fModsObj = getModsForWeaponItem(item);
        } else if (scene.invFocusedWeaponSource && scene.invFocusedWeaponSource.type === 'pocket') {
            ensurePockets(stats);
            const slot = stats.pockets[scene.invFocusedWeaponSource.pocketIndex] && stats.pockets[scene.invFocusedWeaponSource.pocketIndex][scene.invFocusedWeaponSource.slotIndex];
            fModsObj = getModsForWeaponItem(slot);
        } else if (scene.invFocusedWeaponSource && scene.invFocusedWeaponSource.type === 'stash' && scene.persistent && scene.persistent.stash && scene.persistent.stash.items) {
            const item = scene.persistent.stash.items.find(p => p.placementId === scene.invFocusedWeaponSource.placementId);
            fModsObj = getModsForWeaponItem(item);
        } else if (scene.invFocusedWeaponSource && scene.invFocusedWeaponSource.type === 'slot') {
            fModsObj = getModsForWeaponInSlot(stats, scene.invFocusedWeaponSource.slotId);
        } else {
            fModsObj = createDefaultEquippedModsForWeapon(focusWeapon);
        }
        if (!fModsObj) fModsObj = createDefaultEquippedModsForWeapon(focusWeapon);
        const fBoxSize = 16;
        const fBoxGap = 2;
        const fTotalW = fSlotNames.length * fBoxSize + (fSlotNames.length - 1) * fBoxGap;
        let fBoxX = detailX - fTotalW / 2 + fBoxSize / 2;
        const fRowY = detailY + 8;
        fSlotNames.forEach((slotName) => {
            const modId = fModsObj[slotName];
            const mod = modId ? Object.values(CONFIG.MODS).find(m => m.id === modId) : null;
            attachmentBoxZones.push({
                left: fBoxX - fBoxSize / 2, right: fBoxX + fBoxSize / 2,
                top: fRowY - fBoxSize / 2, bottom: fRowY + fBoxSize / 2,
                type: 'outfit', source: scene.invFocusedWeaponSource, slotName, weaponId: focusWeapon, modId: modId || null
            });
            contentArray.push(scene.add.rectangle(fBoxX, fRowY, fBoxSize, fBoxSize, mod ? 0x334433 : 0x2a2a2a).setStrokeStyle(1, 0x666666).setDepth(INV_DEPTH + 3));
            contentArray.push(scene.add.text(fBoxX, fRowY, mod ? mod.icon : slotName.replace(/_/g, '').slice(0, 2), { fontSize: '7px', fill: mod ? '#8f8' : '#666' }).setOrigin(0.5).setDepth(INV_DEPTH + 4));
            fBoxX += fBoxSize + fBoxGap;
        });
        const clearBtn = scene.add.text(detailX + detailW / 2 - 18, detailY - detailH / 2 + 10, '[X]', { fontSize: '9px', fill: '#a66' }).setOrigin(0.5).setDepth(INV_DEPTH + 4).setInteractive({ useHandCursor: true });
        contentArray.push(clearBtn);
        clearBtn.on('pointerdown', () => { scene.invFocusedWeapon = null; scene.invFocusedWeaponSource = null; rerender(); });
    }
    const hoverTooltipX = 400;
    const hoverTooltipY = 160;
    const hoverTooltipBg = scene.add.rectangle(hoverTooltipX, hoverTooltipY, 160, 36, 0x252525, 0.98).setStrokeStyle(2, 0x999999).setVisible(false).setDepth(INV_DEPTH + 12);
    const hoverTooltipText = scene.add.text(hoverTooltipX, hoverTooltipY, '', { fontSize: '14px', fill: '#f0f0f0' }).setOrigin(0.5).setVisible(false).setDepth(INV_DEPTH + 13);
    contentArray.push(hoverTooltipBg, hoverTooltipText);
    if (ctx.isHideout()) {
        const secureGridYVal = hasSecureContainerGrid ? (invGridY + 4.5 * step + secureContainerSlotSize / 2 + 5) : null;
        const medBagGridYVal = hasMedBagGrid ? (medBagSlotY + medBagSlotSize / 2 + 5) : null;
        const rigSlotZone = armorSlotZones && armorSlotZones.find(z => z.id === 'rig');
        const headSlotZone = armorSlotZones && armorSlotZones.find(z => z.id === 'head');
        const bodySlotZone = armorSlotZones && armorSlotZones.find(z => z.id === 'body');
        const earsSlotZone = armorSlotZones && armorSlotZones.find(z => z.id === 'ears');
        const nvgSlotZone = armorSlotZones && armorSlotZones.find(z => z.id === 'nvg');
        ctx.setContainerBounds({
            backpack: { left: invGridX, right: invGridX + 6 * step, top: invGridY, bottom: invGridY + 9 * step },
            rig: rigEquipped ? { left: invGridX, right: invGridX + 4 * rigStepX, top: rigY - rigSlotSize / 2, bottom: rigY - rigSlotSize / 2 + 2 * rigStepY } : null,
            secure: hasSecureContainerGrid ? { left: secureGridLeft, right: secureGridLeft + 2 * secureStepX, top: secureGridYVal, bottom: secureGridYVal + 3 * secureStepY } : null,
            medBag: hasMedBagGrid ? { left: medBagGridLeft, right: medBagGridLeft + 2 * medBagStepX, top: medBagGridYVal, bottom: medBagGridYVal + 2 * medBagStepY } : null,
            pockets: pocketZones && pocketZones.length ? { left: Math.min(...pocketZones.map(z => z.left)), right: Math.max(...pocketZones.map(z => z.right)), top: Math.min(...pocketZones.map(z => z.top)), bottom: Math.max(...pocketZones.map(z => z.bottom)) } : null,
            pocketZones: pocketZones && pocketZones.length ? pocketZones : null,
            backpackEmptyZones: emptyCellZones && emptyCellZones.length ? emptyCellZones : null,
            rigEmptyZones: rigEmptyZones && rigEmptyZones.length ? rigEmptyZones : null,
            secureContainerEmptyZones: secureContainerEmptyZones && secureContainerEmptyZones.length ? secureContainerEmptyZones : null,
            medBagEmptyZones: medBagEmptyZones && medBagEmptyZones.length ? medBagEmptyZones : null,
            backpackSlot: backpackSlotZone ? { left: backpackSlotZone.left, right: backpackSlotZone.right, top: backpackSlotZone.top, bottom: backpackSlotZone.bottom } : null,
            rigSlot: rigSlotZone ? { left: rigSlotZone.left, right: rigSlotZone.right, top: rigSlotZone.top, bottom: rigSlotZone.bottom } : null,
            headSlot: headSlotZone ? { left: headSlotZone.left, right: headSlotZone.right, top: headSlotZone.top, bottom: headSlotZone.bottom } : null,
            bodySlot: bodySlotZone ? { left: bodySlotZone.left, right: bodySlotZone.right, top: bodySlotZone.top, bottom: bodySlotZone.bottom } : null,
            earsSlot: earsSlotZone ? { left: earsSlotZone.left, right: earsSlotZone.right, top: earsSlotZone.top, bottom: earsSlotZone.bottom } : null,
            nvgSlot: nvgSlotZone ? { left: nvgSlotZone.left, right: nvgSlotZone.right, top: nvgSlotZone.top, bottom: nvgSlotZone.bottom } : null,
            secureSlot: secureContainerSlotZone ? { left: secureContainerSlotZone.left, right: secureContainerSlotZone.right, top: secureContainerSlotZone.top, bottom: secureContainerSlotZone.bottom } : null,
            medBagSlot: medBagSlotZone ? { left: medBagSlotZone.left, right: medBagSlotZone.right, top: medBagSlotZone.top, bottom: medBagSlotZone.bottom } : null,
            backpackItemZones: (itemZones && itemZones.length) ? itemZones.filter(z => z.itemId === 'backpack_default').map(z => ({ left: z.left, right: z.right, top: z.top, bottom: z.bottom, placementId: z.placementId })) : null,
            backpackItemZonesAll: (itemZones && itemZones.length) ? itemZones.map(z => ({ left: z.left, right: z.right, top: z.top, bottom: z.bottom, placementId: z.placementId, itemId: z.itemId })) : null,
            rigItemZones: (rigItemZones && rigItemZones.length) ? rigItemZones.map(z => ({ left: z.left, right: z.right, top: z.top, bottom: z.bottom, placementId: z.placementId, itemId: z.itemId })) : null,
            weaponSlots: weaponSlotZones && weaponSlotZones.length ? weaponSlotZones.map(z => ({ id: z.id, left: z.left, right: z.right, top: z.top, bottom: z.bottom })) : null,
            attachmentMagSlotZones: (attachmentBoxZones && attachmentBoxZones.length) ? attachmentBoxZones.filter(z => (z.slotName === 'magazine' || z.slotName === 'magazine_mod') && (z.weaponId === 'pistol' || z.weaponId === 'smg' || z.weaponId === 'rifle')).map(z => ({ left: z.left, right: z.right, top: z.top, bottom: z.bottom, weaponId: z.weaponId })) : null,
            attachmentModSlotZones: (attachmentBoxZones && attachmentBoxZones.length) ? attachmentBoxZones.filter(z => z.slotName !== 'magazine' && z.slotName !== 'magazine_mod').map(z => ({ left: z.left, right: z.right, top: z.top, bottom: z.bottom, slotId: z.slotId, slotName: z.slotName, weaponId: z.weaponId, type: z.type, source: z.source })) : null
        });
    }
    const getWorld = (ptr) => {
        if (ptr.worldX != null) return { x: ptr.worldX, y: ptr.worldY };
        const p = scene.cameras.main.getWorldPoint(ptr.x, ptr.y);
        return { x: p.x, y: p.y };
    };
    const inZone = (px, py, z) => px >= z.left && px <= z.right && py >= z.top && py <= z.bottom;
    /** Unified container drag: return the grid (backpack, rig, secure container, or med bag) the drag came from, or null if from slot/weapon. */
    const getDragSourceGrid = (d) => {
        if (d.fromSlot || d.fromWeaponSlot) return null;
        if (d.fromRig || d.container === 'rig') return rigGrid;
        if (d.fromSecureContainer || d.container === 'secureContainer') return secureContainerGrid;
        if (d.fromMedBag || d.container === 'medBag') return medBagGrid;
        return backpack;
    };
    /** Remove the dragged item from its source container (backpack or rig). Returns the item or null. */
    const removeFromDragSource = (d) => {
        const grid = getDragSourceGrid(d);
        if (!grid || !d.placementId) return null;
        return removeItem(grid, d.placementId);
    };
    /** True if this drag is from a container (backpack, rig, secure container, med bag, or pocket) — not equipment/slots. */
    const isContainerDrag = (d) => d.fromPocket || (d.fromRig && rigGrid) || (d.fromSecureContainer && secureContainerGrid) || (d.fromMedBag && medBagGrid) || (d.container === 'backpack' && d.placementId) || (d.container === 'secureContainer' && d.placementId) || (d.container === 'medBag' && d.placementId);
    /** Remove item from container source (pocket, rig, or backpack). Returns item payload or null. Item has itemId, count, sizeW, sizeH, durability?, maxDurability?. */
    const removeFromContainerSource = (d) => {
        if (d.fromPocket) {
            ensurePockets(stats);
            const pockets = stats.pockets;
            const slot = pockets[d.pocketIndex] && pockets[d.pocketIndex][d.slotIndex];
            if (!slot || !slot.itemId) return null;
            const sw = slot.sizeW || 1, sh = slot.sizeH || 1;
            const item = { itemId: slot.itemId, count: slot.count || 1, durability: slot.durability, maxDurability: slot.maxDurability, sizeW: sw, sizeH: sh };
            if (slot.mods && typeof slot.mods === 'object') item.mods = slot.mods;
            if (slot.rounds != null || slot.maxRounds != null) { item.rounds = slot.rounds ?? 0; item.maxRounds = slot.maxRounds ?? getMagazineCapacity(slot.itemId); }
            pockets[d.pocketIndex][d.slotIndex] = null;
            if (sw > 1 || sh > 1) {
                const nextSi = d.slotIndex + 1;
                if (pockets[d.pocketIndex] && pockets[d.pocketIndex][nextSi] && pockets[d.pocketIndex][nextSi]._spansFrom === d.slotIndex)
                    pockets[d.pocketIndex][nextSi] = null;
            }
            return item;
        }
        if (d.fromRig && rigGrid && d.placementId) return removeItem(rigGrid, d.placementId);
        if (d.fromSecureContainer && secureContainerGrid && d.placementId) return removeItem(secureContainerGrid, d.placementId);
        if (d.fromMedBag && medBagGrid && d.placementId) return removeItem(medBagGrid, d.placementId);
        if (d.container === 'backpack' && d.placementId) {
            const liveBackpack = stats.backpack;
            return liveBackpack ? removeItem(liveBackpack, d.placementId) : null;
        }
        if (d.container === 'secureContainer' && d.placementId) return removeItem(secureContainerGrid, d.placementId);
        if (d.container === 'medBag' && d.placementId) return removeItem(medBagGrid, d.placementId);
        return null;
    };
    /** Put an item back into its container source after a failed drop. */
    const putBackInContainerSource = (d, item) => {
        if (d.fromPocket) {
            ensurePockets(stats);
            const pockets = stats.pockets;
            const sw = item.sizeW || 1, sh = item.sizeH || 1;
            const slotData = { itemId: item.itemId, count: item.count || 1, durability: item.durability, maxDurability: item.maxDurability, sizeW: sw, sizeH: sh };
            if (item.mods && typeof item.mods === 'object') slotData.mods = item.mods;
            if (item.rounds != null || item.maxRounds != null) { slotData.rounds = item.rounds ?? 0; slotData.maxRounds = item.maxRounds ?? getMagazineCapacity(item.itemId); }
            pockets[d.pocketIndex][d.slotIndex] = slotData;
            if (sw > 1 || sh > 1) {
                const nextSi = d.slotIndex + 1;
                if (pockets[d.pocketIndex] && nextSi < pockets[d.pocketIndex].length)
                    pockets[d.pocketIndex][nextSi] = { _spansFrom: d.slotIndex };
            }
            return;
        }
        if (d.fromRig && rigGrid) rigGrid.items.push(item);
        else if (d.fromSecureContainer && secureContainerGrid) secureContainerGrid.items.push(item);
        else if (d.fromMedBag && medBagGrid) medBagGrid.items.push(item);
        else if (d.container === 'backpack') {
            const liveBackpack = stats.backpack;
            if (liveBackpack) { ensureGridItems(liveBackpack); liveBackpack.items.push(item); }
        } else if (backpack) backpack.items.push(item);
    };
    /** Build extra (durability, mods, rounds for mags) for placeItem/tryAddItem from a removed item. */
    const buildExtraFromRemoved = (removed) => {
        const o = {};
        if (removed.durability != null || removed.maxDurability != null) { o.durability = removed.durability; o.maxDurability = removed.maxDurability; }
        if (removed.mods && typeof removed.mods === 'object') o.mods = removed.mods;
        if (removed.rounds != null || removed.maxRounds != null) { o.rounds = removed.rounds ?? 0; o.maxRounds = removed.maxRounds ?? (isMagazineItem(removed.itemId) ? getMagazineCapacity(removed.itemId) : undefined); }
        return Object.keys(o).length ? o : undefined;
    };
    /** Effective size when dragging (accounts for R rotation). */
    const getEffectiveDragSize = (d) => {
        if (d.fromPocket) return { w: d.sizeW || 1, h: d.sizeH || 1 };
        const w = d.sizeW || 1, h = d.sizeH || 1;
        return d.rotated ? { w: h, h: w } : { w, h };
    };
    const destroyGhost = () => {
        if (scene.invGhostRect) { scene.invGhostRect.destroy(); scene.invGhostRect = null; }
        if (scene.invGhostText) { scene.invGhostText.destroy(); scene.invGhostText = null; }
    };
    const rerender = () => { ctx.onRerender(); };
    /** Defer full character-tab rerender to next frame to avoid lag when only panel needs refresh (e.g. limb heal). */
    const rerenderOrDefer = () => { ctx.onRerenderOrDefer(); };
    let invHoverBg = null, invHoverText = null;
    invHoverBg = scene.add.rectangle(0, 0, 200, 26, 0x1a1a1a, 0.96).setStrokeStyle(1, 0x666666).setDepth(INV_DEPTH + 20).setVisible(false);
    invHoverText = scene.add.text(0, 0, '', { fontSize: '12px', fill: '#eee' }).setOrigin(0, 0.5).setDepth(INV_DEPTH + 21).setVisible(false);
    contentArray.push(invHoverBg, invHoverText);
    let lastRigClickChar = null;
    let lastAmmoBoxClickChar = null;
    let lastBackpackClickChar = null;
    let pendingRigDrag = null;
    let pendingAmmoBoxDrag = null;
    let pendingBackpackDrag = null;
    let pendingRigSlotDrag = null;
    let lastBackpackSlotClick = null;
    let pendingBackpackSlotDrag = null;
    let pendingSecureContainerSlotDrag = null;
    let pendingMedBagSlotDrag = null;
    let pendingWeaponDrag = null;
    const MAG_MENU_DEPTH = INV_DEPTH + 50;
    const showMagContextMenu = (cursorX, cursorY, context) => {
        const menuX = Math.max(100, Math.min(700, cursorX));
        const menuY0 = Math.max(50, Math.min(550, cursorY));
        const menuW = 130;
        const rowH = 22;
        const showLoad = context.type === 'inventory_mag';
        const menuH = showLoad ? 2 * rowH : rowH;
        const overlay = scene.add.rectangle(400, 300, 800, 600, 0x000000, 0.01).setInteractive().setDepth(MAG_MENU_DEPTH);
        const bg = scene.add.rectangle(menuX, menuY0 + menuH / 2 - rowH / 2, menuW, menuH, 0x252525, 0.98).setStrokeStyle(2, 0x666666).setDepth(MAG_MENU_DEPTH + 1);
        contentArray.push(overlay, bg);
        const doClose = () => { rerender(); };
        const runUnload = () => {
            const liveStats = scene._invStats != null ? scene._invStats : (scene.stats || scene.playerStats);
            const magRef = context.type === 'weapon_slot'
                ? { fromAttachmentBox: true, weaponId: context.weaponId, itemId: context.itemId }
                : context.dragRef;
            if (unloadMagazineToStack(liveStats, scene.persistent, magRef, magRef.fromStash === true)) {
                sfx.click();
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(liveStats));
                ctx.savePersistentMeta();
            }
            doClose();
        };
        const runLoad = () => {
            const liveStats = scene._invStats != null ? scene._invStats : (scene.stats || scene.playerStats);
            if (context.type !== 'inventory_mag' || !context.dragRef || !context.weaponId) { doClose(); return; }
            const dragRef = context.dragRef;
            let removed;
            if (dragRef.fromStash && scene.persistent && scene.persistent.stash) {
                removed = removeItem(scene.persistent.stash, dragRef.placementId);
            } else {
                removed = removeFromContainerSource(dragRef);
            }
            if (!removed || removed.itemId !== dragRef.itemId || getMagazineWeapon(removed.itemId) !== context.weaponId) {
                if (removed && !dragRef.fromStash) putBackInContainerSource(dragRef, removed);
                else if (removed && dragRef.fromStash && scene.persistent && scene.persistent.stash) {
                    ensureGridItems(scene.persistent.stash);
                    scene.persistent.stash.items.push(removed);
                }
                doClose();
                return;
            }
            const currentMag = getEquippedMag(liveStats, context.weaponId);
            setEquippedMag(liveStats, context.weaponId, { itemId: removed.itemId, rounds: removed.rounds ?? 0, maxRounds: removed.maxRounds ?? getMagazineCapacity(removed.itemId) });
            if (currentMag) placeMagInRigPocketBackpackOrGround(scene, liveStats, currentMag, scene.persistent || undefined);
            sfx.click();
            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(liveStats));
            ctx.savePersistentMeta();
            doClose();
        };
        const unloadBtn = scene.add.rectangle(menuX, menuY0, menuW - 8, rowH - 4, 0x333333, 0.01).setInteractive({ useHandCursor: true }).setDepth(MAG_MENU_DEPTH + 2);
        const unloadTxt = scene.add.text(menuX, menuY0, 'Unload mag', { fontSize: '12px', fill: '#eee' }).setOrigin(0.5).setDepth(MAG_MENU_DEPTH + 3);
        unloadBtn.on('pointerdown', runUnload);
        contentArray.push(unloadBtn, unloadTxt);
        if (showLoad) {
            const loadBtn = scene.add.rectangle(menuX, menuY0 + rowH, menuW - 8, rowH - 4, 0x333333, 0.01).setInteractive({ useHandCursor: true }).setDepth(MAG_MENU_DEPTH + 2);
            const loadTxt = scene.add.text(menuX, menuY0 + rowH, 'Load mag', { fontSize: '12px', fill: '#eee' }).setOrigin(0.5).setDepth(MAG_MENU_DEPTH + 3);
            loadBtn.on('pointerdown', runLoad);
            contentArray.push(loadBtn, loadTxt);
        }
        overlay.on('pointerdown', () => { doClose(); });
    };
    scene._showMagMenu = showMagContextMenu;
    const onPointerMove = (ptr) => {
        const w = getWorld(ptr);
        const px = w.x, py = w.y;
        if (scene.invDragging && scene.invGhostRect) {
            scene.invGhostRect.setPosition(px, py);
            scene.invGhostText.setPosition(px, py);
            return;
        }
        if (pendingRigDrag) {
            const dx = px - pendingRigDrag.startX, dy = py - pendingRigDrag.startY;
            if (dx * dx + dy * dy > 25) {
                sfx.click();
                scene.invDragging = { container: 'backpack', placementId: pendingRigDrag.placementId, itemId: pendingRigDrag.itemId, count: pendingRigDrag.count, sizeW: pendingRigDrag.sizeW, sizeH: pendingRigDrag.sizeH, rotated: false };
                const cfg = getInventoryItemConfig(pendingRigDrag.itemId);
                const lbl = (cfg && cfg.icon) ? cfg.icon : (pendingRigDrag.itemId || '?').slice(0, 2).toUpperCase();
                const ghostFill = (cfg && cfg.color) ? cfg.color : '#e8e8e8';
                const gw = (pendingRigDrag.sizeW || 1) * step - 2, gh = (pendingRigDrag.sizeH || 1) * step - 2;
                scene.invGhostRect = scene.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xccffcc).setDepth(INV_DEPTH + 5);
                scene.invGhostText = scene.add.text(px, py, (pendingRigDrag.count > 1 ? lbl + pendingRigDrag.count : lbl), { fontSize: '8px', fill: ghostFill }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
                pendingRigDrag = null;
            }
            return;
        }
        if (pendingAmmoBoxDrag) {
            const dx = px - pendingAmmoBoxDrag.startX, dy = py - pendingAmmoBoxDrag.startY;
            if (dx * dx + dy * dy > 25) {
                sfx.click();
                scene.invDragging = { container: 'backpack', placementId: pendingAmmoBoxDrag.placementId, itemId: pendingAmmoBoxDrag.itemId, count: pendingAmmoBoxDrag.count, sizeW: pendingAmmoBoxDrag.sizeW, sizeH: pendingAmmoBoxDrag.sizeH, rotated: false };
                const cfg = getInventoryItemConfig(pendingAmmoBoxDrag.itemId);
                const lbl = (cfg && cfg.icon) ? cfg.icon : (pendingAmmoBoxDrag.itemId || '?').slice(0, 2).toUpperCase();
                const ghostFill = (cfg && cfg.color) ? cfg.color : '#e8e8e8';
                const gw = (pendingAmmoBoxDrag.sizeW || 1) * step - 2, gh = (pendingAmmoBoxDrag.sizeH || 1) * step - 2;
                scene.invGhostRect = scene.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xccffcc).setDepth(INV_DEPTH + 5);
                scene.invGhostText = scene.add.text(px, py, (pendingAmmoBoxDrag.count > 1 ? lbl + pendingAmmoBoxDrag.count : lbl), { fontSize: '8px', fill: ghostFill }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
                pendingAmmoBoxDrag = null;
            }
            return;
        }
        if (pendingBackpackDrag) {
            const dx = px - pendingBackpackDrag.startX, dy = py - pendingBackpackDrag.startY;
            if (dx * dx + dy * dy > 25) {
                sfx.click();
                scene.invDragging = { container: 'backpack', placementId: pendingBackpackDrag.placementId, itemId: pendingBackpackDrag.itemId, count: pendingBackpackDrag.count, sizeW: pendingBackpackDrag.sizeW, sizeH: pendingBackpackDrag.sizeH, rotated: false };
                const cfg = getInventoryItemConfig(pendingBackpackDrag.itemId);
                const lbl = (cfg && cfg.icon) ? cfg.icon : (pendingBackpackDrag.itemId || '?').slice(0, 2).toUpperCase();
                const ghostFill = (cfg && cfg.color) ? cfg.color : '#e8e8e8';
                const gw = (pendingBackpackDrag.sizeW || 1) * step - 2, gh = (pendingBackpackDrag.sizeH || 1) * step - 2;
                scene.invGhostRect = scene.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xccffcc).setDepth(INV_DEPTH + 5);
                scene.invGhostText = scene.add.text(px, py, (pendingBackpackDrag.count > 1 ? lbl + pendingBackpackDrag.count : lbl), { fontSize: '8px', fill: ghostFill }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
                pendingBackpackDrag = null;
            }
            return;
        }
        if (pendingRigSlotDrag) {
            const dx = px - pendingRigSlotDrag.startX, dy = py - pendingRigSlotDrag.startY;
            if (dx * dx + dy * dy > 25) {
                sfx.click();
                scene.invDragging = { fromSlot: 'rig', itemId: 'rig' };
                scene.invGhostRect = scene.add.rectangle(px, py, step - 2, step - 2, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(INV_DEPTH + 5);
                scene.invGhostText = scene.add.text(px, py, 'Rg', { fontSize: '8px', fill: '#ccc' }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
                pendingRigSlotDrag = null;
            }
            return;
        }
        if (pendingBackpackSlotDrag) {
            const dx = px - pendingBackpackSlotDrag.startX, dy = py - pendingBackpackSlotDrag.startY;
            if (dx * dx + dy * dy > 25) {
                sfx.click();
                const itemId = (stats.equippedBackpack && stats.equippedBackpack.itemId) || 'backpack_default';
                scene.invDragging = { fromBackpackSlot: true, itemId };
                scene.invGhostRect = scene.add.rectangle(px, py, step - 2, step - 2, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(INV_DEPTH + 5);
                scene.invGhostText = scene.add.text(px, py, 'Bp', { fontSize: '8px', fill: '#ccc' }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
                pendingBackpackSlotDrag = null;
            }
            return;
        }
        if (pendingSecureContainerSlotDrag) {
            const dx = px - pendingSecureContainerSlotDrag.startX, dy = py - pendingSecureContainerSlotDrag.startY;
            if (dx * dx + dy * dy > 25) {
                sfx.click();
                scene.invDragging = { fromSecureContainerSlot: true, itemId: 'secure_container_default' };
                scene.invGhostRect = scene.add.rectangle(px, py, secureCellSize - 2, secureCellSize - 2, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(INV_DEPTH + 5);
                scene.invGhostText = scene.add.text(px, py, 'Sc', { fontSize: '7px', fill: '#ccc' }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
                pendingSecureContainerSlotDrag = null;
            }
            return;
        }
        if (pendingWeaponDrag) {
            const dx = px - pendingWeaponDrag.startX, dy = py - pendingWeaponDrag.startY;
            if (dx * dx + dy * dy > 25) {
                scene.lastInvWeaponClick = null;
                sfx.click();
                if (pendingWeaponDrag.type === 'backpack') {
                    scene.invDragging = { container: 'backpack', placementId: pendingWeaponDrag.placementId, itemId: pendingWeaponDrag.itemId, count: pendingWeaponDrag.count, sizeW: pendingWeaponDrag.sizeW, sizeH: pendingWeaponDrag.sizeH, rotated: false };
                    const cfg = getInventoryItemConfig(pendingWeaponDrag.itemId);
                    const lbl = (cfg && cfg.icon) ? cfg.icon : (pendingWeaponDrag.itemId || '?').slice(0, 2).toUpperCase();
                    const ghostFill = (cfg && cfg.color) ? cfg.color : '#e8e8e8';
                    const gw = (pendingWeaponDrag.sizeW || 1) * step - 2, gh = (pendingWeaponDrag.sizeH || 1) * step - 2;
                    scene.invGhostRect = scene.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xccffcc).setDepth(INV_DEPTH + 5);
                    scene.invGhostText = scene.add.text(px, py, (pendingWeaponDrag.count > 1 ? lbl + pendingWeaponDrag.count : lbl), { fontSize: '8px', fill: ghostFill }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
                } else if (pendingWeaponDrag.type === 'rig') {
                    scene.invDragging = { container: 'rig', fromRig: true, placementId: pendingWeaponDrag.placementId, itemId: pendingWeaponDrag.itemId, count: pendingWeaponDrag.count || 1, sizeW: pendingWeaponDrag.sizeW || 1, sizeH: pendingWeaponDrag.sizeH || 1, rotated: false };
                    const cfg = getInventoryItemConfig(pendingWeaponDrag.itemId);
                    const lbl = (cfg && cfg.icon) ? cfg.icon : (pendingWeaponDrag.itemId || '?').slice(0, 2).toUpperCase();
                    const gw = (pendingWeaponDrag.sizeW || 1) * rigCellSize - 2, gh = (pendingWeaponDrag.sizeH || 1) * rigCellSize - 2;
                    scene.invGhostRect = scene.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(INV_DEPTH + 5);
                    scene.invGhostText = scene.add.text(px, py, (pendingWeaponDrag.count > 1 ? lbl + pendingWeaponDrag.count : lbl), { fontSize: '7px', fill: '#ccc' }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
                } else if (pendingWeaponDrag.type === 'pocket') {
                    scene.invDragging = { fromPocket: true, pocketIndex: pendingWeaponDrag.pocketIndex, slotIndex: pendingWeaponDrag.slotIndex, itemId: pendingWeaponDrag.itemId, count: pendingWeaponDrag.count || 1, durability: pendingWeaponDrag.durability, maxDurability: pendingWeaponDrag.maxDurability, sizeW: pendingWeaponDrag.sizeW || 1, sizeH: pendingWeaponDrag.sizeH || 1 };
                    const cfg = getInventoryItemConfig(pendingWeaponDrag.itemId);
                    const lbl = (cfg && cfg.icon) ? cfg.icon : (pendingWeaponDrag.itemId || '?').slice(0, 2).toUpperCase();
                    const gw = (pendingWeaponDrag.sizeW || 1) * pocketSlotSize - 2, gh = (pendingWeaponDrag.sizeH || 1) * pocketSlotSize - 2;
                    scene.invGhostRect = scene.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(INV_DEPTH + 5);
                    scene.invGhostText = scene.add.text(px, py, (pendingWeaponDrag.count > 1 ? lbl + pendingWeaponDrag.count : lbl), { fontSize: '8px', fill: '#ccc' }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
                }
                pendingWeaponDrag = null;
            }
            return;
        }
        if (pendingMedBagSlotDrag) {
            const dx = px - pendingMedBagSlotDrag.startX, dy = py - pendingMedBagSlotDrag.startY;
            if (dx * dx + dy * dy > 25) {
                sfx.click();
                scene.invDragging = { fromMedBagSlot: true, itemId: 'med_bag_default' };
                scene.invGhostRect = scene.add.rectangle(px, py, medBagCellSize - 2, medBagCellSize - 2, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(INV_DEPTH + 5);
                scene.invGhostText = scene.add.text(px, py, 'MB', { fontSize: '7px', fill: '#ccc' }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
                pendingMedBagSlotDrag = null;
            }
            return;
        }
        // Small near-cursor tooltip only for attachment box mags; rig/backpack/pockets use the larger fixed tooltip below
        if (invHoverBg && invHoverText) {
            let tip = '';
            const overAb = attachmentBoxZones.find(z => inZone(px, py, z));
            if (overAb && (overAb.magId || overAb.magRounds != null)) {
                const cfg = getInventoryItemConfig(overAb.magId || 'mag_pistol');
                tip = (cfg && cfg.label) || overAb.magId || 'Mag';
                tip += ` — ${overAb.magRounds ?? 0}/${overAb.magMaxRounds ?? 0} rounds`;
            }
            if (tip) {
                invHoverText.setText(tip);
                const w = Math.min(invHoverText.width + 14, 220);
                let tx = px + 14;
                tx = Math.max(tx, w / 2 + 12);
                tx = Math.min(tx, 488 - w / 2);
                const ty = Math.max(py - 28, 22);
                invHoverBg.setPosition(tx, ty).setSize(w, 24).setVisible(true);
                invHoverText.setPosition(tx - w / 2 + 7, ty).setVisible(true);
            } else {
                invHoverBg.setVisible(false);
                invHoverText.setVisible(false);
            }
        }
        let over = itemZones.find(z => inZone(px, py, z));
        if (!over) over = rigItemZones.find(z => inZone(px, py, z));
        if (!over && secureContainerItemZones && secureContainerItemZones.length) over = secureContainerItemZones.find(z => inZone(px, py, z));
        if (!over && medBagItemZones && medBagItemZones.length) over = medBagItemZones.find(z => inZone(px, py, z));
        if (!over) {
            const pocketZone = pocketZones.find(z => inZone(px, py, z));
            if (pocketZone) {
                const slotItem = (stats.pockets || [])[pocketZone.pocketIndex] && (stats.pockets[pocketZone.pocketIndex] || [])[pocketZone.slotIndex];
                if (slotItem && slotItem.itemId) {
                    over = { itemId: slotItem.itemId, count: slotItem.count || 1, durability: slotItem.durability, maxDurability: slotItem.maxDurability, rounds: slotItem.rounds, maxRounds: slotItem.maxRounds };
                }
            }
        }
        if (over) {
            const cfg = getInventoryItemConfig(over.itemId);
            const name = (cfg && cfg.label) ? cfg.label : over.itemId;
            let txt = over.count > 1 ? name + ' (×' + over.count + ')' : name;
            const overDefDur = getDefaultDurability(over.itemId);
            if (overDefDur && (over.durability != null || over.maxDurability != null)) {
                const d = over.durability != null ? over.durability : overDefDur.durability;
                const m = over.maxDurability != null ? over.maxDurability : overDefDur.maxDurability;
                txt += '  ' + d + '/' + m;
            }
            if (isMagazineItem(over.itemId)) {
                let r = over.rounds ?? 0, max = over.maxRounds ?? getMagazineCapacity(over.itemId);
                if (over.placementId) {
                    const grid = over.fromRig ? rigGrid : (over.fromSecureContainer ? secureContainerGrid : (over.fromMedBag ? medBagGrid : backpack));
                    const pl = grid && grid.items && grid.items.find(i => i.placementId === over.placementId);
                    if (pl) { r = pl.rounds ?? 0; max = pl.maxRounds ?? getMagazineCapacity(over.itemId); }
                }
                txt += '  ' + r + '/' + max + ' rounds';
            }
            hoverTooltipText.setText(txt);
            hoverTooltipBg.setVisible(true);
            hoverTooltipText.setVisible(true);
        } else {
            hoverTooltipBg.setVisible(false);
            hoverTooltipText.setVisible(false);
        }
    };
    const onPointerDown = (ptr) => {
        const w = getWorld(ptr);
        const px = w.x, py = w.y;
        const isRightClick = ptr.event && ptr.event.button === 2;
        if (isRightClick) {
            const overAb = attachmentBoxZones.find(z => inZone(px, py, z));
            const isMagSlot = overAb && (overAb.slotName === 'magazine' || overAb.slotName === 'magazine_mod') && (overAb.weaponId === 'pistol' || overAb.weaponId === 'smg' || overAb.weaponId === 'rifle');
            if (isMagSlot && overAb.magId) {
                showMagContextMenu(px, py, { type: 'weapon_slot', weaponId: overAb.weaponId, itemId: overAb.magId });
                return;
            }
            let overMagInInv = null;
            const overItemMag = itemZones.find(z => inZone(px, py, z));
            if (overItemMag && isMagazineItem(overItemMag.itemId)) overMagInInv = { container: 'backpack', placementId: overItemMag.placementId, itemId: overItemMag.itemId };
            if (!overMagInInv && rigEquipped) {
                const overRig = rigItemZones.find(z => inZone(px, py, z));
                if (overRig && isMagazineItem(overRig.itemId)) overMagInInv = { fromRig: true, container: 'rig', placementId: overRig.placementId, itemId: overRig.itemId };
            }
            if (!overMagInInv) {
                const overPocket = pocketZones.find(z => inZone(px, py, z));
                if (overPocket) {
                    const pocketsArr = stats.pockets || [];
                    let slotItem = pocketsArr[overPocket.pocketIndex] && (pocketsArr[overPocket.pocketIndex] || [])[overPocket.slotIndex];
                    let mainSlotIndex = overPocket.slotIndex;
                    if (slotItem && slotItem._spansFrom !== undefined) {
                        mainSlotIndex = slotItem._spansFrom;
                        slotItem = pocketsArr[overPocket.pocketIndex] && pocketsArr[overPocket.pocketIndex][mainSlotIndex];
                    }
                    if (slotItem && slotItem.itemId && isMagazineItem(slotItem.itemId)) overMagInInv = { fromPocket: true, pocketIndex: overPocket.pocketIndex, slotIndex: mainSlotIndex, itemId: slotItem.itemId };
                }
            }
            if (overMagInInv) {
                const weaponId = getMagazineWeapon(overMagInInv.itemId);
                if (weaponId) showMagContextMenu(px, py, { type: 'inventory_mag', dragRef: overMagInInv, weaponId });
                return;
            }
        }
        if (!isRightClick) {
            scene.invSelectedMag = null;
            scene.stashSelectedMag = null;
        }
        const overItem = itemZones.find(z => inZone(px, py, z));
        if (overItem) {
            if (overItem.itemId === 'ammo_box') {
                const now = Date.now();
                if (lastAmmoBoxClickChar && lastAmmoBoxClickChar.placementId === overItem.placementId && (now - lastAmmoBoxClickChar.time) < 450) {
                    lastAmmoBoxClickChar = null;
                    sfx.menuOpen();
                    scene.showAmmoBoxWindow(overItem.placementId, false, rerender);
                    return;
                }
                lastAmmoBoxClickChar = { time: now, placementId: overItem.placementId };
                pendingAmmoBoxDrag = { placementId: overItem.placementId, itemId: overItem.itemId, count: overItem.count, sizeW: overItem.sizeW, sizeH: overItem.sizeH, startX: px, startY: py };
                return;
            }
            if (overItem.itemId === 'rig') {
                const now = Date.now();
                if (lastRigClickChar && lastRigClickChar.type === 'backpack' && lastRigClickChar.placementId === overItem.placementId && (now - lastRigClickChar.time) < 450) {
                    lastRigClickChar = null;
                    sfx.menuOpen();
                    scene.showRigWindowInGame({ placementId: overItem.placementId });
                    return;
                }
                lastRigClickChar = { time: now, type: 'backpack', placementId: overItem.placementId };
                pendingRigDrag = { placementId: overItem.placementId, itemId: overItem.itemId, count: overItem.count, sizeW: overItem.sizeW, sizeH: overItem.sizeH, startX: px, startY: py };
                return;
            } else { lastRigClickChar = null; lastAmmoBoxClickChar = null; lastBackpackClickChar = null; }
            if (overItem.itemId === 'backpack_default') {
                const now = Date.now();
                if (lastBackpackClickChar && lastBackpackClickChar.placementId === overItem.placementId && (now - lastBackpackClickChar.time) < 450) {
                    lastBackpackClickChar = null;
                    return;
                }
                lastBackpackClickChar = { time: now, placementId: overItem.placementId };
                pendingBackpackDrag = { placementId: overItem.placementId, itemId: overItem.itemId, count: overItem.count, sizeW: overItem.sizeW, sizeH: overItem.sizeH, startX: px, startY: py };
                return;
            }
            const now = Date.now();
            if (CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[overItem.itemId] && scene.lastInvWeaponClick && scene.lastInvWeaponClick.type === 'backpack' && scene.lastInvWeaponClick.placementId === overItem.placementId && scene.lastInvWeaponClick.itemId === overItem.itemId && (now - scene.lastInvWeaponClick.time) < 450) {
                scene.invFocusedWeapon = overItem.itemId;
                scene.invFocusedWeaponSource = { type: 'backpack', placementId: overItem.placementId };
                scene.lastInvWeaponClick = null;
                sfx.menuOpen();
                rerender();
                return;
            }
            if (CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[overItem.itemId]) {
                scene.lastInvWeaponClick = { type: 'backpack', placementId: overItem.placementId, itemId: overItem.itemId, time: now };
                pendingWeaponDrag = { type: 'backpack', placementId: overItem.placementId, itemId: overItem.itemId, count: overItem.count, sizeW: overItem.sizeW, sizeH: overItem.sizeH, startX: px, startY: py };
                sfx.click();
                return;
            }
            scene.lastInvWeaponClick = null;
            sfx.click();
            scene.invDragging = { container: 'backpack', placementId: overItem.placementId, itemId: overItem.itemId, count: overItem.count, sizeW: overItem.sizeW, sizeH: overItem.sizeH, rotated: false };
            const cfg = getInventoryItemConfig(overItem.itemId);
            const lbl = (cfg && cfg.icon) ? cfg.icon : (overItem.itemId || '?').slice(0, 2).toUpperCase();
            const ghostFill = (cfg && cfg.color) ? cfg.color : '#e8e8e8';
            const gw = (overItem.sizeW || 1) * step - 2, gh = (overItem.sizeH || 1) * step - 2;
            scene.invGhostRect = scene.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xccffcc).setDepth(INV_DEPTH + 5);
            scene.invGhostText = scene.add.text(px, py, (overItem.count > 1 ? lbl + overItem.count : lbl), { fontSize: '8px', fill: ghostFill }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
            return;
        }
        const overSlot = armorSlotZones.find(z => inZone(px, py, z));
        if (overSlot && overSlot.id === 'rig') {
            if (stats.armor && stats.armor.rig) {
                const now = Date.now();
                if (lastRigClickChar && lastRigClickChar.type === 'slot' && (now - lastRigClickChar.time) < 450) {
                    lastRigClickChar = null;
                    sfx.menuOpen();
                    scene.showRigWindowInGame('equipped');
                    return;
                }
                lastRigClickChar = { time: now, type: 'slot' };
                pendingRigSlotDrag = { startX: px, startY: py };
            }
            return;
        }
        if (inZone(px, py, backpackSlotZone) && backpackEquipped) {
            const now = Date.now();
            if (lastBackpackSlotClick && (now - lastBackpackSlotClick) < 450) {
                lastBackpackSlotClick = null;
                sfx.menuOpen();
                return;
            }
            lastBackpackSlotClick = now;
            pendingBackpackSlotDrag = { startX: px, startY: py };
            return;
        }
        if (inZone(px, py, secureContainerSlotZone) && hasSecureContainerGrid) {
            pendingSecureContainerSlotDrag = { startX: px, startY: py };
            return;
        }
        if (inZone(px, py, medBagSlotZone) && hasMedBagGrid) {
            pendingMedBagSlotDrag = { startX: px, startY: py };
            return;
        }
        const overRigItem = rigEquipped && rigItemZones.find(z => inZone(px, py, z));
        if (overRigItem) {
            lastRigClickChar = null;
            const nowRig = Date.now();
            if (CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[overRigItem.itemId] && scene.lastInvWeaponClick && scene.lastInvWeaponClick.type === 'rig' && scene.lastInvWeaponClick.placementId === overRigItem.placementId && scene.lastInvWeaponClick.itemId === overRigItem.itemId && (nowRig - scene.lastInvWeaponClick.time) < 450) {
                scene.invFocusedWeapon = overRigItem.itemId;
                scene.invFocusedWeaponSource = { type: 'rig', placementId: overRigItem.placementId };
                scene.lastInvWeaponClick = null;
                sfx.menuOpen();
                rerender();
                return;
            }
            if (CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[overRigItem.itemId]) {
                scene.lastInvWeaponClick = { type: 'rig', placementId: overRigItem.placementId, itemId: overRigItem.itemId, time: nowRig };
                pendingWeaponDrag = { type: 'rig', placementId: overRigItem.placementId, itemId: overRigItem.itemId, count: overRigItem.count || 1, sizeW: overRigItem.sizeW || 1, sizeH: overRigItem.sizeH || 1, startX: px, startY: py };
                sfx.click();
                return;
            }
            scene.lastInvWeaponClick = null;
            sfx.click();
            scene.invDragging = { container: 'rig', fromRig: true, placementId: overRigItem.placementId, itemId: overRigItem.itemId, count: overRigItem.count || 1, sizeW: overRigItem.sizeW || 1, sizeH: overRigItem.sizeH || 1, rotated: false };
            const cfg = getInventoryItemConfig(overRigItem.itemId);
            const lbl = (cfg && cfg.icon) ? cfg.icon : (overRigItem.itemId || '?').slice(0, 2).toUpperCase();
            const gw = (overRigItem.sizeW || 1) * rigCellSize - 2, gh = (overRigItem.sizeH || 1) * rigCellSize - 2;
            scene.invGhostRect = scene.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(INV_DEPTH + 5);
            scene.invGhostText = scene.add.text(px, py, (overRigItem.count > 1 ? lbl + overRigItem.count : lbl), { fontSize: '7px', fill: '#ccc' }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
            return;
        }
        const overSecureContainerItem = secureContainerGrid && secureContainerItemZones.find(z => inZone(px, py, z));
        if (overSecureContainerItem) {
            lastRigClickChar = null;
            sfx.click();
            scene.invDragging = { container: 'secureContainer', fromSecureContainer: true, placementId: overSecureContainerItem.placementId, itemId: overSecureContainerItem.itemId, count: overSecureContainerItem.count || 1, sizeW: overSecureContainerItem.sizeW || 1, sizeH: overSecureContainerItem.sizeH || 1, rotated: false };
            const cfg = getInventoryItemConfig(overSecureContainerItem.itemId);
            const lbl = (cfg && cfg.icon) ? cfg.icon : (overSecureContainerItem.itemId || '?').slice(0, 2).toUpperCase();
            const gw = (overSecureContainerItem.sizeW || 1) * secureCellSize - 2, gh = (overSecureContainerItem.sizeH || 1) * secureCellSize - 2;
            scene.invGhostRect = scene.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(INV_DEPTH + 5);
            scene.invGhostText = scene.add.text(px, py, (overSecureContainerItem.count > 1 ? lbl + overSecureContainerItem.count : lbl), { fontSize: '7px', fill: '#ccc' }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
            return;
        }
        const overMedBagItem = medBagGrid && medBagItemZones.find(z => inZone(px, py, z));
        if (overMedBagItem) {
            lastRigClickChar = null;
            sfx.click();
            scene.invDragging = { container: 'medBag', fromMedBag: true, placementId: overMedBagItem.placementId, itemId: overMedBagItem.itemId, count: overMedBagItem.count || 1, sizeW: overMedBagItem.sizeW || 1, sizeH: overMedBagItem.sizeH || 1, rotated: false };
            const cfg = getInventoryItemConfig(overMedBagItem.itemId);
            const lbl = (cfg && cfg.icon) ? cfg.icon : (overMedBagItem.itemId || '?').slice(0, 2).toUpperCase();
            const gw = (overMedBagItem.sizeW || 1) * medBagCellSize - 2, gh = (overMedBagItem.sizeH || 1) * medBagCellSize - 2;
            scene.invGhostRect = scene.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(INV_DEPTH + 5);
            scene.invGhostText = scene.add.text(px, py, (overMedBagItem.count > 1 ? lbl + overMedBagItem.count : lbl), { fontSize: '7px', fill: '#ccc' }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
            return;
        }
        const overAttachmentBox = attachmentBoxZones.find(z => inZone(px, py, z));
        if (overAttachmentBox && (overAttachmentBox.modId || overAttachmentBox.magId)) {
            sfx.click();
            const itemId = overAttachmentBox.magId || overAttachmentBox.modId;
            const cfg = getInventoryItemConfig(itemId);
            const sizeW = (cfg && cfg.sizeW) || 1, sizeH = (cfg && cfg.sizeH) || 1;
            scene.invDragging = {
                fromAttachmentBox: true,
                itemId,
                type: overAttachmentBox.type,
                slotId: overAttachmentBox.slotId,
                slotName: overAttachmentBox.slotName,
                weaponId: overAttachmentBox.weaponId,
                source: overAttachmentBox.source,
                magRounds: overAttachmentBox.magRounds,
                magMaxRounds: overAttachmentBox.magMaxRounds,
                sizeW, sizeH, rotated: false
            };
            const mod = !overAttachmentBox.magId && Object.values(CONFIG.MODS).find(m => m.id === itemId);
            const lbl = mod ? mod.icon : (cfg && cfg.icon) ? cfg.icon : (itemId || '?').slice(0, 2);
            const gw = (sizeW * step) - 2, gh = (sizeH * step) - 2;
            scene.invGhostRect = scene.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(INV_DEPTH + 5);
            scene.invGhostText = scene.add.text(px, py, lbl, { fontSize: '8px', fill: '#ccc' }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
            return;
        }
        const overWeaponSlot = weaponSlotZones.find(z => inZone(px, py, z));
        if (overWeaponSlot && ws[overWeaponSlot.id]) {
            const itemId = ws[overWeaponSlot.id];
            const nowSlot = Date.now();
            if (CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[itemId] && scene.lastInvWeaponClick && scene.lastInvWeaponClick.type === 'slot' && scene.lastInvWeaponClick.slotId === overWeaponSlot.id && scene.lastInvWeaponClick.itemId === itemId && (nowSlot - scene.lastInvWeaponClick.time) < 450) {
                scene.invFocusedWeapon = itemId;
                scene.invFocusedWeaponSource = { type: 'slot', slotId: overWeaponSlot.id };
                scene.lastInvWeaponClick = null;
                sfx.menuOpen();
                rerender();
                return;
            }
            if (CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[itemId]) scene.lastInvWeaponClick = { type: 'slot', slotId: overWeaponSlot.id, itemId, time: nowSlot };
            else scene.lastInvWeaponClick = null;
            sfx.click();
            scene.invDragging = { fromWeaponSlot: overWeaponSlot.id, itemId };
            const cfg = getInventoryItemConfig(itemId);
            const lbl = (cfg && cfg.icon) ? cfg.icon : (itemId || '?').slice(0, 2).toUpperCase();
            scene.invGhostRect = scene.add.rectangle(px, py, step - 2, step - 2, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(INV_DEPTH + 5);
            scene.invGhostText = scene.add.text(px, py, lbl, { fontSize: '8px', fill: '#ccc' }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
            return;
        }
        if (overSlot && stats.armor && stats.armor[overSlot.id]) {
            lastRigClickChar = null;
            sfx.click();
            const itemId = (overSlot.id === 'head' && stats.armor.head && stats.armor.head.itemId) ? stats.armor.head.itemId : (overSlot.id === 'ears' && stats.armor.ears && stats.armor.ears.itemId) ? stats.armor.ears.itemId : (overSlot.id === 'nvg' && stats.armor.nvg) ? 'nvg' : (ARMOR_SLOT_ITEM[overSlot.id] || 'helmet');
            scene.invDragging = { fromSlot: overSlot.id, itemId };
            const cfg = getInventoryItemConfig(itemId);
            const lbl = (cfg && cfg.icon) ? cfg.icon : (itemId || '?').slice(0, 2).toUpperCase();
            scene.invGhostRect = scene.add.rectangle(px, py, step - 2, step - 2, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(INV_DEPTH + 5);
            scene.invGhostText = scene.add.text(px, py, lbl, { fontSize: '8px', fill: '#ccc' }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
            return;
        }
        const overPocketZone = pocketZones.find(z => inZone(px, py, z));
        if (overPocketZone) {
            const pocketsArr = stats.pockets || [];
            let slotItem = pocketsArr[overPocketZone.pocketIndex] && (pocketsArr[overPocketZone.pocketIndex] || [])[overPocketZone.slotIndex];
            let pi = overPocketZone.pocketIndex, si = overPocketZone.slotIndex;
            if (slotItem && slotItem._spansFrom !== undefined) {
                const main = pocketsArr[pi] && pocketsArr[pi][slotItem._spansFrom];
                if (main && main.itemId) { slotItem = main; si = slotItem._spansFrom; }
            }
            if (slotItem && slotItem.itemId) {
                lastRigClickChar = null;
                const nowPock = Date.now();
                if (CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[slotItem.itemId] && scene.lastInvWeaponClick && scene.lastInvWeaponClick.type === 'pocket' && scene.lastInvWeaponClick.pocketIndex === pi && scene.lastInvWeaponClick.slotIndex === si && scene.lastInvWeaponClick.itemId === slotItem.itemId && (nowPock - scene.lastInvWeaponClick.time) < 450) {
                    scene.invFocusedWeapon = slotItem.itemId;
                    scene.invFocusedWeaponSource = { type: 'pocket', pocketIndex: pi, slotIndex: si };
                    scene.lastInvWeaponClick = null;
                    sfx.menuOpen();
                    rerender();
                    return;
                }
                if (CONFIG.WEAPON_SLOTS && CONFIG.WEAPON_SLOTS[slotItem.itemId]) {
                    scene.lastInvWeaponClick = { type: 'pocket', pocketIndex: pi, slotIndex: si, itemId: slotItem.itemId, time: nowPock };
                    const sw = slotItem.sizeW || 1, sh = slotItem.sizeH || 1;
                    pendingWeaponDrag = { type: 'pocket', pocketIndex: pi, slotIndex: si, itemId: slotItem.itemId, count: slotItem.count || 1, durability: slotItem.durability, maxDurability: slotItem.maxDurability, sizeW: sw, sizeH: sh, startX: px, startY: py };
                    sfx.click();
                    return;
                }
                scene.lastInvWeaponClick = null;
                sfx.click();
                const sw = slotItem.sizeW || 1, sh = slotItem.sizeH || 1;
                scene.invDragging = {
                    fromPocket: true,
                    pocketIndex: pi,
                    slotIndex: si,
                    itemId: slotItem.itemId,
                    count: slotItem.count || 1,
                    durability: slotItem.durability,
                    maxDurability: slotItem.maxDurability,
                    sizeW: sw,
                    sizeH: sh
                };
                const cfg = getInventoryItemConfig(slotItem.itemId);
                const lbl = (cfg && cfg.icon) ? cfg.icon : (slotItem.itemId || '?').slice(0, 2).toUpperCase();
                const gw = sw * pocketSlotSize - 2, gh = sh * pocketSlotSize - 2;
                scene.invGhostRect = scene.add.rectangle(px, py, gw, gh, 0x446644, 0.9).setStrokeStyle(2, 0xaaffaa).setDepth(INV_DEPTH + 5);
                scene.invGhostText = scene.add.text(px, py, (slotItem.count > 1 ? lbl + slotItem.count : lbl), { fontSize: '8px', fill: '#ccc' }).setOrigin(0.5).setDepth(INV_DEPTH + 6);
            }
        }
    };
    const longGunIds = ['shotgun', 'smg', 'crossbow', 'rifle'];
    const weaponSlots = stats.weaponSlots || { primary: null, secondary: null, sidearm: 'pistol', melee: null };
    const onPointerUp = (ptr) => {
        if (ptr.event && ptr.event.button === 2) {
            scene.invSelectedMag = null;
            scene.stashSelectedMag = null;
            return;
        }
        if (pendingRigDrag || pendingAmmoBoxDrag || pendingBackpackDrag || pendingRigSlotDrag || pendingBackpackSlotDrag || pendingSecureContainerSlotDrag || pendingMedBagSlotDrag || pendingWeaponDrag) {
            pendingRigDrag = null;
            pendingAmmoBoxDrag = null;
            pendingBackpackDrag = null;
            pendingRigSlotDrag = null;
            pendingBackpackSlotDrag = null;
            pendingSecureContainerSlotDrag = null;
            pendingMedBagSlotDrag = null;
            pendingWeaponDrag = null;
            return;
        }
        if (!scene.invDragging) return;
        const w = getWorld(ptr);
        const px = w.x, py = w.y;
        const drag = scene.invDragging;
        destroyGhost();
        const stashBounds = ctx.getStashBounds();
        const inStashBounds = ctx.isHideout() && stashBounds && px >= stashBounds.left && px <= stashBounds.right && py >= stashBounds.top && py <= stashBounds.bottom;
        if (inStashBounds && (drag.fromSlot === 'rig' && scene.addEquippedRigToStash)) {
            scene.addEquippedRigToStash();
            destroyGhost();
            scene.invDragging = null;
            return;
        }
        if (inStashBounds && (drag.fromSlot === 'head' || drag.fromSlot === 'body' || drag.fromSlot === 'ears' || drag.fromSlot === 'nvg') && scene.addEquippedArmorToStash) {
            scene.addEquippedArmorToStash(drag.fromSlot);
            destroyGhost();
            scene.invDragging = null;
            return;
        }
        if (inStashBounds && drag.fromBackpackSlot && scene.addEquippedBackpackToStash) {
            scene.addEquippedBackpackToStash();
            destroyGhost();
            scene.invDragging = null;
            return;
        }
        if (inStashBounds && drag.fromSecureContainerSlot && scene.addEquippedSecureContainerToStash) {
            scene.addEquippedSecureContainerToStash();
            destroyGhost();
            scene.invDragging = null;
            return;
        }
        if (inStashBounds && drag.fromMedBagSlot && scene.addEquippedMedBagToStash) {
            scene.addEquippedMedBagToStash();
            destroyGhost();
            scene.invDragging = null;
            return;
        }
        if (inStashBounds && drag.fromWeaponSlot && scene.addItemToStash) {
            const weaponId = weaponSlots[drag.fromWeaponSlot];
            if (weaponId && drag.itemId === weaponId) {
                const slotMods = stats.weaponSlotMods && stats.weaponSlotMods[drag.fromWeaponSlot];
                const item = { itemId: drag.itemId, count: 1 };
                if (slotMods && typeof slotMods === 'object') item.mods = slotMods;
                weaponSlots[drag.fromWeaponSlot] = null;
                if (stats.weaponSlotMods && stats.weaponSlotMods[drag.fromWeaponSlot]) stats.weaponSlotMods[drag.fromWeaponSlot] = null;
                const added = scene.addItemToStash(item, { container: 'weaponSlot', slotId: drag.fromWeaponSlot });
                if (!added) {
                    weaponSlots[drag.fromWeaponSlot] = weaponId;
                    if (stats.weaponSlotMods) stats.weaponSlotMods[drag.fromWeaponSlot] = slotMods || null;
                    localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(scene.stats));
                } else sfx.click();
                destroyGhost();
                scene.invDragging = null;
                return;
            }
        }
        if (inStashBounds && drag.fromAttachmentBox && scene.addItemToStash) {
            if (isMagazineItem(drag.itemId)) {
                const magItem = { itemId: drag.itemId, count: 1, rounds: drag.magRounds ?? 0, maxRounds: drag.magMaxRounds ?? getMagazineCapacity(drag.itemId) };
                setEquippedMag(stats, drag.weaponId, null);
                const added = scene.addItemToStash(magItem, { container: 'weaponMag', weaponId: drag.weaponId });
                if (added) { sfx.click(); } else { setEquippedMag(stats, drag.weaponId, { itemId: drag.itemId, rounds: magItem.rounds, maxRounds: magItem.maxRounds }); }
            } else if (isModItem(drag.itemId)) {
                const modItem = { itemId: drag.itemId, count: 1 };
                let removed = false;
                if (drag.type === 'slot' && drag.slotId && drag.slotName) {
                    ensureWeaponSlotModsShape(stats);
                    if (stats.weaponSlotMods && stats.weaponSlotMods[drag.slotId] && stats.weaponSlotMods[drag.slotId][drag.slotName]) {
                        stats.weaponSlotMods[drag.slotId][drag.slotName] = null;
                        removed = true;
                    }
                } else if (drag.type === 'outfit' && drag.source) {
                    const src = drag.source;
                    let weaponItem = null;
                    if (src.type === 'backpack' && stats.backpack && stats.backpack.items) {
                        weaponItem = stats.backpack.items.find(p => p.placementId === src.placementId);
                    } else if (src.type === 'rig' && stats.rigGrid && stats.rigGrid.items) {
                        weaponItem = stats.rigGrid.items.find(p => p.placementId === src.placementId);
                    } else if (src.type === 'pocket' && stats.pockets) {
                        const s = stats.pockets[src.pocketIndex] && stats.pockets[src.pocketIndex][src.slotIndex];
                        weaponItem = s && s.itemId ? s : null;
                    } else if (src.type === 'stash' && scene.persistent && scene.persistent.stash && scene.persistent.stash.items) {
                        weaponItem = scene.persistent.stash.items.find(p => p.placementId === src.placementId);
                    }
                    if (weaponItem && weaponItem.mods && weaponItem.mods[drag.slotName]) {
                        weaponItem.mods[drag.slotName] = null;
                        removed = true;
                    }
                }
                if (removed) {
                    const added = scene.addItemToStash(modItem, { container: 'weaponMod', weaponId: drag.weaponId, slotName: drag.slotName });
                    if (added) sfx.click();
                    else {
                        if (drag.type === 'slot' && stats.weaponSlotMods) stats.weaponSlotMods[drag.slotId][drag.slotName] = drag.itemId;
                        else if (drag.type === 'outfit' && weaponItem && weaponItem.mods) weaponItem.mods[drag.slotName] = drag.itemId;
                    }
                }
            }
            destroyGhost();
            scene.invDragging = null;
            return;
        }
        if (ctx.isHideout() && scene._hideoutContainerBounds && isContainerDrag(drag) && isAmmoItemId(drag.itemId)) {
            const b = scene._hideoutContainerBounds;
            const overAmmoBox = b.backpackItemZonesAll && b.backpackItemZonesAll.find(z => px >= z.left && px <= z.right && py >= z.top && py <= z.bottom && z.itemId === 'ammo_box' && z.placementId !== drag.placementId);
            if (overAmmoBox) {
                const item = removeFromContainerSource(drag);
                if (item) {
                    const invMap = scene.stats.ammoBoxInventories;
                    if (!invMap) scene.stats.ammoBoxInventories = {};
                    const innerGrid = getOrCreateAmmoBoxInventory(scene.stats.ammoBoxInventories, 'backpack_' + overAmmoBox.placementId);
                    ensureGridItems(innerGrid);
                    if (tryAddItemAmmoBoxOnly(innerGrid, item.itemId, item.count || 1)) {
                        sfx.click();
                        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(scene.stats));
                        if (scene._rerenderCharacterTab) scene._rerenderCharacterTab();
                        destroyGhost();
                        scene.invDragging = null;
                        return;
                    }
                    putBackInContainerSource(drag, item);
                }
            }
        }
        if (ctx.isHideout() && stashBounds && scene.addItemToStash && isContainerDrag(drag) && inStashBounds) {
            const item = removeFromContainerSource(drag);
            if (item) {
                const sourceInfo = { container: drag.fromPocket ? 'pocket' : (drag.fromRig ? 'rig' : (drag.fromSecureContainer ? 'secureContainer' : (drag.fromMedBag ? 'medBag' : 'backpack'))), placementId: drag.placementId };
                scene.addItemToStash(item, sourceInfo);
            }
            destroyGhost();
            scene.invDragging = null;
            return;
        }
        // Limb med drop: handle when dragging from backpack/rig/pockets/etc. (so it works in unified body view)
        if (limbZones.length > 0 && isMedicalItem(drag.itemId) && (isContainerDrag(drag) || drag.placementId)) {
            const overLimb = limbZones.find(z => inZone(px, py, z));
            if (overLimb) {
                const removed = isContainerDrag(drag) ? removeFromContainerSource(drag) : removeFromDragSource(drag);
                const srcGrid = getDragSourceGrid(drag);
                const putBack = (item) => { if (isContainerDrag(drag)) putBackInContainerSource(drag, item); else if (srcGrid) tryAddItem(srcGrid, item.itemId, item.count || 1, { durability: item.durability, maxDurability: item.maxDurability }); };
                if (removed) {
                    applyMedicalItemToLimb({
                        stats,
                        limbId: overLimb.id,
                        item: removed,
                        hooks: {
                            putBack,
                            onHealSfx: () => { if (typeof sfx.lootHealth === 'function') sfx.lootHealth(); else if (typeof sfx.heal === 'function') sfx.heal(); },
                            onInfectionCleared: () => {
                                scene._infectionWarned = false;
                                if (typeof scene.showFloatingText === 'function') {
                                    scene.showFloatingText(400, 260, "INFECTION CLEARED", 0x88ff88);
                                }
                            },
                            onArmPenaltyCheck: () => {
                                if (scene.hasBothArmsBlacked()) scene.applyBodyPenaltyDamage();
                                else if (scene.hasNoGoodArms()) scene.applyBothArmsActionDamage();
                            },
                            clearBrokenArmRoll: (limbId) => {
                                if (scene.brokenArmRollCount) scene.brokenArmRollCount[limbId] = 0;
                            },
                            onRerender: () => rerender(),
                        },
                    });
                }
                destroyGhost();
                scene.invDragging = null;
                return;
            }
        }
        destroyGhost();
        scene.invDragging = null;
        if (drag.fromAttachmentBox) {
            const overAbZone = attachmentBoxZones.find(z => inZone(px, py, z));
            const emptyZone = emptyCellZones.find(z => inZone(px, py, z));
            const overRigEmpty = rigEmptyZones && rigEmptyZones.length && rigEmptyZones.find(z => inZone(px, py, z));
            const overPocketZone = pocketZones && pocketZones.find(z => inZone(px, py, z));
            const isMag = isMagazineItem(drag.itemId);
            const magExtra = isMag ? { rounds: drag.magRounds ?? 0, maxRounds: drag.magMaxRounds ?? getMagazineCapacity(drag.itemId) } : undefined;
            const eff = getEffectiveDragSize(drag);
            const sizeW = eff.w, sizeH = eff.h;
            let stripped = false;
            const liveBackpackPutBack = stats.backpack;
            const liveRigPutBack = stats.armor && stats.armor.rig && stats.rigGrid;
            const isDroppingOnContainer = !overAbZone && ((emptyZone && liveBackpackPutBack) || (overRigEmpty && liveRigPutBack) || overPocketZone ||
                (liveBackpackPutBack && px >= invGridX && px <= invGridX + 6 * step && py >= invGridY && py <= invGridY + 9 * step) ||
                (liveRigPutBack && rigEquipped && px >= invGridX && px <= invGridX + 4 * rigStepX && py >= rigY - rigSlotSize / 2 && py <= rigY - rigSlotSize / 2 + 2 * rigStepY) ||
                (pocketZones && pocketZones.length && px >= Math.min(...pocketZones.map(z => z.left)) && px <= Math.max(...pocketZones.map(z => z.right)) && py >= Math.min(...pocketZones.map(z => z.top)) && py <= Math.max(...pocketZones.map(z => z.bottom))));
            const removeModFromWeapon = () => {
                if (isMag) { setEquippedMag(stats, drag.weaponId, null); return true; }
                if (drag.type === 'slot' && drag.slotId) {
                    ensureWeaponSlotModsShape(stats);
                    if (stats.weaponSlotMods && stats.weaponSlotMods[drag.slotId] && stats.weaponSlotMods[drag.slotId][drag.slotName]) {
                        stats.weaponSlotMods[drag.slotId][drag.slotName] = null;
                        return true;
                    }
                } else if (drag.type === 'outfit' && drag.source) {
                    const src = drag.source;
                    let weaponItem = null;
                    if (src.type === 'backpack' && backpack && backpack.items) weaponItem = backpack.items.find(p => p.placementId === src.placementId);
                    else if (src.type === 'rig' && rigGrid && rigGrid.items) weaponItem = rigGrid.items.find(p => p.placementId === src.placementId);
                    else if (src.type === 'pocket' && stats.pockets) { const s = stats.pockets[src.pocketIndex] && stats.pockets[src.pocketIndex][src.slotIndex]; weaponItem = s && s.itemId ? s : null; }
                    else if (src.type === 'stash' && scene.persistent && scene.persistent.stash && scene.persistent.stash.items) weaponItem = scene.persistent.stash.items.find(p => p.placementId === src.placementId);
                    if (weaponItem && weaponItem.mods && weaponItem.mods[drag.slotName]) { weaponItem.mods[drag.slotName] = null; return true; }
                }
                return false;
            };
            const putModBackOnWeapon = () => {
                if (isMag) setEquippedMag(stats, drag.weaponId, { itemId: drag.itemId, rounds: magExtra?.rounds ?? 0, maxRounds: magExtra?.maxRounds ?? getMagazineCapacity(drag.itemId) });
                else if (drag.type === 'slot' && stats.weaponSlotMods) stats.weaponSlotMods[drag.slotId][drag.slotName] = drag.itemId;
                else if (drag.type === 'outfit' && drag.source) {
                    const src = drag.source;
                    let weaponItem = null;
                    if (src.type === 'backpack' && backpack && backpack.items) weaponItem = backpack.items.find(p => p.placementId === src.placementId);
                    else if (src.type === 'rig' && rigGrid && rigGrid.items) weaponItem = rigGrid.items.find(p => p.placementId === src.placementId);
                    else if (src.type === 'pocket' && stats.pockets) { const s = stats.pockets[src.pocketIndex] && stats.pockets[src.pocketIndex][src.slotIndex]; weaponItem = s && s.itemId ? s : null; }
                    else if (src.type === 'stash' && scene.persistent && scene.persistent.stash && scene.persistent.stash.items) weaponItem = scene.persistent.stash.items.find(p => p.placementId === src.placementId);
                    if (weaponItem && weaponItem.mods) weaponItem.mods[drag.slotName] = drag.itemId;
                }
            };
            const didRemove = isDroppingOnContainer ? removeModFromWeapon() : false;
            if (emptyZone && liveBackpackPutBack) {
                if (canPlace(liveBackpackPutBack, emptyZone.row, emptyZone.col, sizeW, sizeH, null) && placeItem(liveBackpackPutBack, drag.itemId, 1, emptyZone.row, emptyZone.col, magExtra, sizeW !== 1 || sizeH !== 1 ? { sizeW, sizeH } : undefined)) stripped = true;
                if (!stripped && sizeW !== sizeH && canPlace(liveBackpackPutBack, emptyZone.row, emptyZone.col, sizeH, sizeW, null) && placeItem(liveBackpackPutBack, drag.itemId, 1, emptyZone.row, emptyZone.col, magExtra, { sizeW: sizeH, sizeH: sizeW })) stripped = true;
            }
            if (!stripped && liveBackpackPutBack && tryAddItem(liveBackpackPutBack, drag.itemId, 1, magExtra)) stripped = true;
            if (!stripped && overRigEmpty && liveRigPutBack) {
                if (canPlace(liveRigPutBack, overRigEmpty.row, overRigEmpty.col, sizeW, sizeH, null) && placeItem(liveRigPutBack, drag.itemId, 1, overRigEmpty.row, overRigEmpty.col, magExtra, sizeW !== 1 || sizeH !== 1 ? { sizeW, sizeH } : undefined)) stripped = true;
                if (!stripped && sizeW !== sizeH && canPlace(liveRigPutBack, overRigEmpty.row, overRigEmpty.col, sizeH, sizeW, null) && placeItem(liveRigPutBack, drag.itemId, 1, overRigEmpty.row, overRigEmpty.col, magExtra, { sizeW: sizeH, sizeH: sizeW })) stripped = true;
            }
            if (!stripped && overPocketZone) {
                ensurePockets(stats);
                const pi = overPocketZone.pocketIndex, si = overPocketZone.slotIndex;
                const pockets = stats.pockets;
                const slotEmpty = (pI, sI) => { const s = pockets[pI] && pockets[pI][sI]; return !s || !s.itemId || s._spansFrom !== undefined; };
                if (sizeW === 1 && sizeH === 1) {
                    const slot = pockets[pi] && pockets[pi][si];
                    if (slot && !slot.itemId) {
                        pockets[pi][si] = { itemId: drag.itemId, count: 1, rounds: drag.magRounds ?? 0, maxRounds: drag.magMaxRounds ?? getMagazineCapacity(drag.itemId) };
                        stripped = true;
                    }
                } else if (sizeW === 2 && sizeH === 1 && pi <= 1 && slotEmpty(pi, 0) && slotEmpty(pi, 1)) {
                    pockets[pi][0] = { itemId: drag.itemId, count: 1, rounds: drag.magRounds ?? 0, maxRounds: drag.magMaxRounds ?? getMagazineCapacity(drag.itemId), sizeW: 2, sizeH: 1 };
                    pockets[pi][1] = { _spansFrom: 0 };
                    stripped = true;
                } else if (sizeW === 1 && sizeH === 2 && pi <= 1 && slotEmpty(pi, 0) && slotEmpty(pi, 1)) {
                    pockets[pi][0] = { itemId: drag.itemId, count: 1, rounds: drag.magRounds ?? 0, maxRounds: drag.magMaxRounds ?? getMagazineCapacity(drag.itemId), sizeW: 2, sizeH: 1 };
                    pockets[pi][1] = { _spansFrom: 0 };
                    stripped = true;
                }
            }
            // Drop anywhere in container: place in first fit if pointer is inside container bounds
            if (!stripped && liveBackpackPutBack) {
                const inBackpackBounds = px >= invGridX && px <= invGridX + 6 * step && py >= invGridY && py <= invGridY + 9 * step;
                if (inBackpackBounds) {
                    if (tryAddItem(liveBackpackPutBack, drag.itemId, 1, magExtra)) stripped = true;
                    if (!stripped) {
                        const pos = findSpaceTryRotated(liveBackpackPutBack, sizeW, sizeH);
                        if (pos) {
                            const pw = pos.rotated ? sizeH : sizeW, ph = pos.rotated ? sizeW : sizeH;
                            if (placeItem(liveBackpackPutBack, drag.itemId, 1, pos.row, pos.col, magExtra, pw !== 1 || ph !== 1 ? { sizeW: pw, sizeH: ph } : undefined)) stripped = true;
                        }
                    }
                }
            }
            if (!stripped && liveRigPutBack && rigEquipped) {
                const rigGridLeft = invGridX, rigGridTop = rigY - rigSlotSize / 2;
                const inRigBounds = px >= rigGridLeft && px <= rigGridLeft + 4 * rigStepX && py >= rigGridTop && py <= rigGridTop + 2 * rigStepY;
                if (inRigBounds) {
                    const pos = findSpaceTryRotated(liveRigPutBack, sizeW, sizeH);
                    if (pos) {
                        const pw = pos.rotated ? sizeH : sizeW, ph = pos.rotated ? sizeW : sizeH;
                        if (placeItem(liveRigPutBack, drag.itemId, 1, pos.row, pos.col, magExtra, pw !== 1 || ph !== 1 ? { sizeW: pw, sizeH: ph } : undefined)) stripped = true;
                    }
                }
            }
            if (!stripped && pocketZones && pocketZones.length) {
                const pocketLeft = Math.min(...pocketZones.map(z => z.left)), pocketRight = Math.max(...pocketZones.map(z => z.right));
                const pocketTop = Math.min(...pocketZones.map(z => z.top)), pocketBottom = Math.max(...pocketZones.map(z => z.bottom));
                const inPocketBounds = px >= pocketLeft && px <= pocketRight && py >= pocketTop && py <= pocketBottom;
                if (inPocketBounds) {
                    ensurePockets(stats);
                    const pockets = stats.pockets;
                    const slotEmpty = (pI, sI) => { const s = pockets[pI] && pockets[pI][sI]; return !s || !s.itemId || s._spansFrom !== undefined; };
                    if (sizeW === 1 && sizeH === 1) {
                        for (let pI = 0; pI < (pockets.length || 0); pI++) {
                            for (let sI = 0; sI < (pockets[pI] && pockets[pI].length) || 0; sI++) {
                                if (slotEmpty(pI, sI)) {
                                    pockets[pI][sI] = { itemId: drag.itemId, count: 1, rounds: drag.magRounds ?? 0, maxRounds: drag.magMaxRounds ?? getMagazineCapacity(drag.itemId) };
                                    stripped = true;
                                    break;
                                }
                            }
                            if (stripped) break;
                        }
                    } else if (sizeW === 2 && sizeH === 1) {
                        for (let pI = 0; pI <= 1 && !stripped; pI++) {
                            if (slotEmpty(pI, 0) && slotEmpty(pI, 1)) {
                                pockets[pI][0] = { itemId: drag.itemId, count: 1, rounds: drag.magRounds ?? 0, maxRounds: drag.magMaxRounds ?? getMagazineCapacity(drag.itemId), sizeW: 2, sizeH: 1 };
                                pockets[pI][1] = { _spansFrom: 0 };
                                stripped = true;
                            }
                        }
                    } else if (sizeW === 1 && sizeH === 2) {
                        for (let pI = 0; pI <= 1 && !stripped; pI++) {
                            if (slotEmpty(pI, 0) && slotEmpty(pI, 1)) {
                                pockets[pI][0] = { itemId: drag.itemId, count: 1, rounds: drag.magRounds ?? 0, maxRounds: drag.magMaxRounds ?? getMagazineCapacity(drag.itemId), sizeW: 2, sizeH: 1 };
                                pockets[pI][1] = { _spansFrom: 0 };
                                stripped = true;
                            }
                        }
                    }
                }
            }
            if (didRemove && !stripped) putModBackOnWeapon();
            if (stripped) {
                if (!didRemove) {
                    if (isMag && drag.type === 'slot' && drag.slotId && drag.weaponId) setEquippedMag(stats, drag.weaponId, null);
                    else if (drag.type === 'slot' && drag.slotId) {
                        ensureWeaponSlotModsShape(stats);
                        if (stats.weaponSlotMods[drag.slotId]) stats.weaponSlotMods[drag.slotId][drag.slotName] = null;
                    } else if (drag.type === 'outfit' && drag.source) {
                        if (drag.source.type === 'backpack' && backpack && backpack.items) {
                            const item = backpack.items.find(p => p.placementId === drag.source.placementId);
                            if (item && item.mods) item.mods[drag.slotName] = null;
                        } else if (drag.source.type === 'rig' && rigGrid && rigGrid.items) {
                            const item = rigGrid.items.find(p => p.placementId === drag.source.placementId);
                            if (item && item.mods) item.mods[drag.slotName] = null;
                        } else if (drag.source.type === 'pocket') {
                            const slot = stats.pockets[drag.source.pocketIndex] && stats.pockets[drag.source.pocketIndex][drag.source.slotIndex];
                            if (slot && slot.mods) slot.mods[drag.slotName] = null;
                        } else if (drag.source.type === 'stash' && scene.persistent && scene.persistent.stash && scene.persistent.stash.items) {
                            const item = scene.persistent.stash.items.find(p => p.placementId === drag.source.placementId);
                            if (item && item.mods) item.mods[drag.slotName] = null;
                        }
                    }
                }
                sfx.click();
                rerender();
            }
            return;
        }
        if (isContainerDrag(drag)) {
            const rigSlotZone = armorSlotZones && armorSlotZones.find(z => z.id === 'rig');
            const placeInContainerFromSquare = (grid, isMed) => {
                const removed = removeFromContainerSource(drag);
                if (!removed) return;
                if (isMed && !isMedicalItem(removed.itemId)) { putBackInContainerSource(drag, removed); return; }
                const extra = buildExtraFromRemoved(removed);
                const placeW = drag.rotated ? (removed.sizeH || 1) : (removed.sizeW || 1), placeH = drag.rotated ? (removed.sizeW || 1) : (removed.sizeH || 1);
                if (tryAddItem(grid, removed.itemId, removed.count || 1, extra)) { destroyGhost(); scene.invDragging = null; sfx.click(); rerender(); return; }
                const pos = findSpaceTryRotated(grid, placeW, placeH);
                if (pos) {
                    const pw = pos.rotated ? placeH : placeW, ph = pos.rotated ? placeW : placeH;
                    placeItem(grid, removed.itemId, removed.count || 1, pos.row, pos.col, extra, (pw !== 1 || ph !== 1) ? { sizeW: pw, sizeH: ph } : undefined);
                    destroyGhost(); scene.invDragging = null; sfx.click(); rerender(); return;
                }
                putBackInContainerSource(drag, removed);
            };
            if (inZone(px, py, backpackSlotZone) && backpackEquipped && backpack && drag.itemId !== 'backpack_default') {
                placeInContainerFromSquare(backpack, false);
                return;
            }
            if (rigSlotZone && inZone(px, py, rigSlotZone) && rigEquipped && rigGrid && drag.itemId !== 'rig') {
                placeInContainerFromSquare(rigGrid, false);
                return;
            }
            if (inZone(px, py, secureContainerSlotZone) && hasSecureContainerGrid && secureContainerGrid) {
                placeInContainerFromSquare(secureContainerGrid, false);
                return;
            }
            if (inZone(px, py, medBagSlotZone) && hasMedBagGrid && medBagGrid) {
                placeInContainerFromSquare(medBagGrid, true);
                return;
            }
            const isAmmoDrag = drag.itemId === 'ammo_9mm' || drag.itemId === 'ammo_45' || drag.itemId === 'ammo_556';
            if (isAmmoDrag) {
                const overMagBackpack = itemZones.find(z => inZone(px, py, z) && isMagazineItem(z.itemId));
                const overMagRig = rigItemZones.length ? rigItemZones.find(z => inZone(px, py, z) && isMagazineItem(z.itemId)) : null;
                let overMagPocket = null;
                const overPocketZoneForMag = pocketZones && pocketZones.find(z => inZone(px, py, z));
                if (overPocketZoneForMag) {
                    const slot = stats.pockets && stats.pockets[overPocketZoneForMag.pocketIndex] && stats.pockets[overPocketZoneForMag.pocketIndex][overPocketZoneForMag.slotIndex];
                    if (slot && slot.itemId && isMagazineItem(slot.itemId)) overMagPocket = { zone: overPocketZoneForMag, slot };
                }
                const magTarget = overMagBackpack ? { container: 'backpack', placementId: overMagBackpack.placementId, itemId: overMagBackpack.itemId }
                    : overMagRig ? { container: 'rig', placementId: overMagRig.placementId, itemId: overMagRig.itemId }
                    : overMagPocket ? { container: 'pocket', pocketIndex: overMagPocket.zone.pocketIndex, slotIndex: overMagPocket.zone.slotIndex, itemId: overMagPocket.slot.itemId }
                    : null;
                if (magTarget && getMagazineAmmoId(magTarget.itemId) === drag.itemId) {
                    let magRounds = 0, magMaxRounds = getMagazineCapacity(magTarget.itemId);
                    if (magTarget.container === 'backpack' && backpack && backpack.items) {
                        const p = backpack.items.find(i => i.placementId === magTarget.placementId);
                        if (p) { magRounds = p.rounds ?? 0; magMaxRounds = p.maxRounds ?? magMaxRounds; }
                    } else if (magTarget.container === 'rig' && rigGrid && rigGrid.items) {
                        const p = rigGrid.items.find(i => i.placementId === magTarget.placementId);
                        if (p) { magRounds = p.rounds ?? 0; magMaxRounds = p.maxRounds ?? magMaxRounds; }
                    } else if (magTarget.container === 'pocket') {
                        const s = stats.pockets[magTarget.pocketIndex] && stats.pockets[magTarget.pocketIndex][magTarget.slotIndex];
                        if (s) { magRounds = s.rounds ?? 0; magMaxRounds = s.maxRounds ?? magMaxRounds; }
                    }
                    const room = magMaxRounds - magRounds;
                    const ammoCount = drag.count || 1;
                    const toAdd = Math.min(ammoCount, room);
                    if (toAdd > 0) {
                        if (magTarget.container === 'backpack' && backpack && backpack.items) {
                            const p = backpack.items.find(i => i.placementId === magTarget.placementId);
                            if (p) { p.rounds = (p.rounds ?? 0) + toAdd; p.maxRounds = p.maxRounds ?? magMaxRounds; }
                        } else if (magTarget.container === 'rig' && rigGrid && rigGrid.items) {
                            const p = rigGrid.items.find(i => i.placementId === magTarget.placementId);
                            if (p) { p.rounds = (p.rounds ?? 0) + toAdd; p.maxRounds = p.maxRounds ?? magMaxRounds; }
                        } else if (magTarget.container === 'pocket') {
                            ensurePockets(stats);
                            const s = stats.pockets[magTarget.pocketIndex] && stats.pockets[magTarget.pocketIndex][magTarget.slotIndex];
                            if (s) { s.rounds = (s.rounds ?? 0) + toAdd; s.maxRounds = s.maxRounds ?? magMaxRounds; }
                        }
                        const removeAmmo = (c, pid, cnt) => {
                            if (c === 'backpack' && backpack && backpack.items) {
                                const p = backpack.items.find(i => i.placementId === pid);
                                if (p && (p.count || 0) >= cnt) { p.count = (p.count || 1) - cnt; if ((p.count || 0) <= 0) removeItem(backpack, pid); return true; }
                            } else if ((c === 'rig' || drag.fromRig) && rigGrid && rigGrid.items) {
                                const p = rigGrid.items.find(i => i.placementId === pid);
                                if (p && (p.count || 0) >= cnt) { p.count = (p.count || 1) - cnt; if ((p.count || 0) <= 0) removeItem(rigGrid, pid); return true; }
                            } else if (drag.fromPocket) {
                                ensurePockets(stats);
                                const slot = stats.pockets[drag.pocketIndex] && stats.pockets[drag.pocketIndex][drag.slotIndex];
                                if (slot && (slot.count || 0) >= cnt) { slot.count = (slot.count || 1) - cnt; if ((slot.count || 0) <= 0) stats.pockets[drag.pocketIndex][drag.slotIndex] = null; return true; }
                            }
                            return false;
                        };
                        const srcContainer = drag.fromPocket ? 'pocket' : (drag.fromRig || drag.container === 'rig') ? 'rig' : 'backpack';
                        const srcPid = drag.placementId;
                        if (removeAmmo(srcContainer, srcPid, toAdd)) {
                            destroyGhost();
                            scene.invDragging = null;
                            sfx.click();
                            localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(scene.stats));
                            rerender();
                            return;
                        }
                    }
                }
            }
            const overPocketZone = pocketZones.find(z => inZone(px, py, z));
            const overBackpackEmpty = emptyCellZones.find(z => inZone(px, py, z));
            const overBackpackItem = itemZones.find(z => inZone(px, py, z));
            const overRigItemForMerge = rigEquipped && rigItemZones.find(z => inZone(px, py, z));
            const overSecureContainerEmpty = secureContainerEmptyZones && secureContainerEmptyZones.find(z => inZone(px, py, z));
            const overMedBagEmpty = medBagEmptyZones && medBagEmptyZones.find(z => inZone(px, py, z));
            const overRigEmpty = rigEmptyZones && rigEmptyZones.find(z => inZone(px, py, z));
            const overWFromContainer = weaponSlotZones.find(z => inZone(px, py, z));
            // Stack combine: drag same stackable item onto another stack (backpack or rig) = merge counts up to stackMax
            const stackCfg = getInventoryItemConfig(drag.itemId);
            const canStack = stackCfg && (stackCfg.stackMax || 1) > 1;
            if (overBackpackItem && canStack && drag.itemId === overBackpackItem.itemId && (drag.container !== 'backpack' || drag.placementId !== overBackpackItem.placementId)) {
                const removed = removeFromContainerSource(drag);
                if (removed) {
                    const liveBackpack = stats.backpack;
                    const dest = liveBackpack && liveBackpack.items && liveBackpack.items.find(p => p.placementId === overBackpackItem.placementId);
                    if (dest) {
                        const stackMax = stackCfg.stackMax || 1;
                        const cur = dest.count || 0;
                        const room = stackMax - cur;
                        const toAdd = Math.min(removed.count || 1, room);
                        dest.count = cur + toAdd;
                        const remainder = (removed.count || 1) - toAdd;
                        if (remainder > 0) {
                            const extra = buildExtraFromRemoved(removed);
                            if (removed.row != null && removed.col != null && canPlace(liveBackpack, removed.row, removed.col, 1, 1, null)) {
                                placeItem(liveBackpack, removed.itemId, remainder, removed.row, removed.col, extra);
                            } else if (!tryAddItem(liveBackpack, removed.itemId, remainder, extra)) {
                                putBackInContainerSource(drag, { ...removed, count: remainder });
                            }
                        }
                        destroyGhost();
                        scene.invDragging = null;
                        sfx.click();
                        rerender();
                        return;
                    }
                    putBackInContainerSource(drag, removed);
                }
            }
            if (overRigItemForMerge && canStack && drag.itemId === overRigItemForMerge.itemId && (!drag.fromRig || drag.placementId !== overRigItemForMerge.placementId)) {
                const removed = removeFromContainerSource(drag);
                if (removed) {
                    const liveRig = stats.armor && stats.armor.rig && stats.rigGrid;
                    const dest = liveRig && liveRig.items && liveRig.items.find(p => p.placementId === overRigItemForMerge.placementId);
                    if (dest) {
                        const stackMax = stackCfg.stackMax || 1;
                        const cur = dest.count || 0;
                        const room = stackMax - cur;
                        const toAdd = Math.min(removed.count || 1, room);
                        dest.count = cur + toAdd;
                        const remainder = (removed.count || 1) - toAdd;
                        if (remainder > 0) {
                            const extra = buildExtraFromRemoved(removed);
                            if (removed.row != null && removed.col != null && canPlace(liveRig, removed.row, removed.col, 1, 1, null)) {
                                placeItem(liveRig, removed.itemId, remainder, removed.row, removed.col, extra);
                            } else if (!tryAddItem(liveRig, removed.itemId, remainder, extra)) {
                                putBackInContainerSource(drag, { ...removed, count: remainder });
                            }
                        }
                        destroyGhost();
                        scene.invDragging = null;
                        sfx.click();
                        rerender();
                        return;
                    }
                    putBackInContainerSource(drag, removed);
                }
            }
            // §6 fix: when dragging a magazine, prioritize drop onto weapon mag slot (so it's not stolen by weapon slot or empty cell)
            const dragIsMag = isMagazineItem(drag.itemId);
            const overMagSlotZone = dragIsMag && attachmentBoxZones.find(z => inZone(px, py, z) && (z.slotName === 'magazine' || z.slotName === 'magazine_mod') && (z.weaponId === 'pistol' || z.weaponId === 'smg' || z.weaponId === 'rifle') && getMagazineWeapon(drag.itemId) === z.weaponId);
            if (overMagSlotZone) {
                const weaponId = overMagSlotZone.weaponId;
                const removed = removeFromContainerSource(drag);
                if (!removed || removed.itemId !== drag.itemId) {
                    if (removed) putBackInContainerSource(drag, removed);
                } else {
                    const currentMag = getEquippedMag(stats, weaponId);
                    if (currentMag) {
                        const curMagCfg = getInventoryItemConfig(currentMag.itemId);
                        const curSizeW = curMagCfg ? (curMagCfg.sizeW || 1) : 1, curSizeH = curMagCfg ? (curMagCfg.sizeH || 1) : 1;
                        // Source slot is vacated after removeFromContainerSource — no exclude needed
                        const dest = findFirstEmptySlotForMag(stats, curSizeW, curSizeH, null);
                        const magExtra = { rounds: currentMag.rounds ?? 0, maxRounds: currentMag.maxRounds ?? getMagazineCapacity(currentMag.itemId) };
                        if (dest) {
                            const placeW = dest.rotated ? curSizeH : curSizeW, placeH = dest.rotated ? curSizeW : curSizeH;
                            const liveRig = stats.armor && stats.armor.rig && stats.rigGrid;
                            const liveBackpack = stats.backpack;
                            if (dest.container === 'rig' && liveRig) placeItem(liveRig, currentMag.itemId, 1, dest.row, dest.col, magExtra, (placeW !== 1 || placeH !== 1) ? { sizeW: placeW, sizeH: placeH } : undefined);
                            else if (dest.container === 'backpack' && liveBackpack) placeItem(liveBackpack, currentMag.itemId, 1, dest.row, dest.col, magExtra, (placeW !== 1 || placeH !== 1) ? { sizeW: placeW, sizeH: placeH } : undefined);
                            else if (dest.container === 'pocket') {
                                ensurePockets(stats);
                                if (placeW === 1 && placeH === 1) {
                                    const slot = stats.pockets[dest.pocketIndex] && stats.pockets[dest.pocketIndex][dest.slotIndex];
                                    if (slot && !slot.itemId) stats.pockets[dest.pocketIndex][dest.slotIndex] = { itemId: currentMag.itemId, count: 1, rounds: magExtra.rounds, maxRounds: magExtra.maxRounds };
                                } else if (placeW === 2 && placeH === 1 && dest.slotIndex === 0) {
                                    stats.pockets[dest.pocketIndex][0] = { itemId: currentMag.itemId, count: 1, rounds: magExtra.rounds, maxRounds: magExtra.maxRounds, sizeW: 2, sizeH: 1 };
                                    stats.pockets[dest.pocketIndex][1] = { _spansFrom: 0 };
                                }
                            }
                        } else {
                            if (!scene.textures.exists('pickup_dropped')) {
                                const g = scene.make.graphics({ x: 0, y: 0, add: false });
                                g.fillStyle(0x8B4513, 1);
                                g.fillCircle(8, 8, 8);
                                g.generateTexture('pickup_dropped', 16, 16);
                            }
                            const ppx = scene.player ? scene.player.x : 400;
                            const ppy = scene.player ? scene.player.y : 300;
                            const dropType = { itemId: currentMag.itemId, count: 1, rounds: currentMag.rounds ?? 0, maxRounds: currentMag.maxRounds ?? getMagazineCapacity(currentMag.itemId) };
                            const spr = scene.add.image(ppx, ppy - 10, 'pickup_dropped').setDepth(5);
                            scene.droppedInventoryItems.add(spr);
                            spr.setData('type', dropType);
                        }
                    }
                    setEquippedMag(stats, weaponId, { itemId: removed.itemId, rounds: removed.rounds ?? 0, maxRounds: removed.maxRounds ?? getMagazineCapacity(removed.itemId) });
                    sfx.click();
                    rerender();
                }
                return;
            }
            if (overWFromContainer) {
                const slotId = overWFromContainer.id;
                const weaponInSlot = weaponSlots[slotId];
                const isWeaponSlot = (slotId === 'primary' || slotId === 'secondary' || slotId === 'sidearm');
                // Drag mag or attachment onto weapon slot: same as dropping on mag/attachment box (add or swap)
                if (weaponInSlot && isWeaponSlot) {
                    const weaponId = weaponInSlot;
                    if (isMagazineItem(drag.itemId) && getMagazineWeapon(drag.itemId) === weaponId) {
                        const oldMagOnWeapon = getEquippedMag(stats, weaponId);
                        const removed = removeFromContainerSource(drag);
                        if (!removed || removed.itemId !== drag.itemId) {
                            if (removed) putBackInContainerSource(drag, removed);
                            return;
                        }
                        setEquippedMag(stats, weaponId, { itemId: removed.itemId, rounds: removed.rounds ?? 0, maxRounds: removed.maxRounds ?? getMagazineCapacity(removed.itemId) });
                        if (oldMagOnWeapon) {
                            const curMagCfg = getInventoryItemConfig(oldMagOnWeapon.itemId);
                            const curSizeW = curMagCfg ? (curMagCfg.sizeW || 1) : 1, curSizeH = curMagCfg ? (curMagCfg.sizeH || 1) : 1;
                            const dest = findFirstEmptySlotForMag(stats, curSizeW, curSizeH, null);
                            const magExtra = { rounds: oldMagOnWeapon.rounds ?? 0, maxRounds: oldMagOnWeapon.maxRounds ?? getMagazineCapacity(oldMagOnWeapon.itemId) };
                            if (dest) {
                                const placeW = dest.rotated ? curSizeH : curSizeW, placeH = dest.rotated ? curSizeW : curSizeH;
                                const liveRig = stats.armor && stats.armor.rig && stats.rigGrid;
                                const liveBackpack = stats.backpack;
                                if (dest.container === 'rig' && liveRig) placeItem(liveRig, oldMagOnWeapon.itemId, 1, dest.row, dest.col, magExtra, (placeW !== 1 || placeH !== 1) ? { sizeW: placeW, sizeH: placeH } : undefined);
                                else if (dest.container === 'backpack' && liveBackpack) placeItem(liveBackpack, oldMagOnWeapon.itemId, 1, dest.row, dest.col, magExtra, (placeW !== 1 || placeH !== 1) ? { sizeW: placeW, sizeH: placeH } : undefined);
                                else if (dest.container === 'pocket') {
                                    ensurePockets(stats);
                                    if (placeW === 1 && placeH === 1) {
                                        const slot = stats.pockets[dest.pocketIndex] && stats.pockets[dest.pocketIndex][dest.slotIndex];
                                        if (slot && !slot.itemId) stats.pockets[dest.pocketIndex][dest.slotIndex] = { itemId: oldMagOnWeapon.itemId, count: 1, rounds: magExtra.rounds, maxRounds: magExtra.maxRounds };
                                    } else if (placeW === 2 && placeH === 1 && dest.slotIndex === 0) {
                                        stats.pockets[dest.pocketIndex][0] = { itemId: oldMagOnWeapon.itemId, count: 1, rounds: magExtra.rounds, maxRounds: magExtra.maxRounds, sizeW: 2, sizeH: 1 };
                                        stats.pockets[dest.pocketIndex][1] = { _spansFrom: 0 };
                                    }
                                }
                            } else {
                                if (!scene.textures.exists('pickup_dropped')) {
                                    const g = scene.make.graphics({ x: 0, y: 0, add: false });
                                    g.fillStyle(0x8B4513, 1);
                                    g.fillCircle(8, 8, 8);
                                    g.generateTexture('pickup_dropped', 16, 16);
                                }
                                const ppx = scene.player ? scene.player.x : 400;
                                const ppy = scene.player ? scene.player.y : 300;
                                const dropType = { itemId: oldMagOnWeapon.itemId, count: 1, rounds: oldMagOnWeapon.rounds ?? 0, maxRounds: oldMagOnWeapon.maxRounds ?? getMagazineCapacity(oldMagOnWeapon.itemId) };
                                const spr = scene.add.image(ppx, ppy - 10, 'pickup_dropped').setDepth(5);
                                scene.droppedInventoryItems.add(spr);
                                spr.setData('type', dropType);
                            }
                        }
                        sfx.click();
                        rerender();
                        return;
                    }
                    if (isModItem(drag.itemId)) {
                        const slotNames = getWeaponSlotNames(weaponInSlot);
                        const targetSlotName = slotNames.find(sn => modFitsSlot(drag.itemId, sn, weaponInSlot));
                        if (targetSlotName) {
                            const removed = removeFromContainerSource(drag);
                            if (removed && removed.itemId === drag.itemId) {
                                ensureWeaponSlotModsShape(stats);
                                const wsm = stats.weaponSlotMods;
                                if (!wsm[slotId]) wsm[slotId] = createDefaultEquippedModsForWeapon(weaponInSlot);
                                const oldModId = wsm[slotId][targetSlotName];
                                if (oldModId) tryAddItem(backpack, oldModId, 1);
                                wsm[slotId][targetSlotName] = removed.itemId;
                                sfx.click();
                                rerender();
                            } else if (removed) putBackInContainerSource(drag, removed);
                            return;
                        }
                    }
                }
                const canPrimary = longGunIds.includes(drag.itemId);
                const canSidearm = drag.itemId === 'pistol';
                const canMelee = longGunIds.includes(drag.itemId) || drag.itemId === 'pistol';
                const okSlot = ((overWFromContainer.id === 'primary' || overWFromContainer.id === 'secondary') && canPrimary) || (overWFromContainer.id === 'sidearm' && canSidearm) || (overWFromContainer.id === 'melee' && canMelee);
                if (okSlot) {
                    const removed = removeFromContainerSource(drag);
                    if (removed) {
                        ensureWeaponSlotModsShape(stats);
                        const wsm = stats.weaponSlotMods;
                        const oldWeapon = weaponSlots[overWFromContainer.id];
                        const oldMods = oldWeapon ? (wsm[overWFromContainer.id] || createDefaultEquippedModsForWeapon(oldWeapon)) : null;
                        if (oldWeapon) tryAddItem(backpack, oldWeapon, 1, oldMods ? { mods: oldMods } : undefined);
                        weaponSlots[overWFromContainer.id] = removed.itemId;
                        wsm[overWFromContainer.id] = (removed.mods && typeof removed.mods === 'object' && Object.keys(removed.mods).length)
                            ? JSON.parse(JSON.stringify(removed.mods))
                            : createDefaultEquippedModsForWeapon(removed.itemId);
                        sfx.click();
                        rerender();
                        return;
                    }
                }
            }
            const overAbZone = attachmentBoxZones.find(z => inZone(px, py, z));
            const isMagSlot = overAbZone && (overAbZone.slotName === 'magazine' || overAbZone.slotName === 'magazine_mod') && (overAbZone.weaponId === 'pistol' || overAbZone.weaponId === 'smg' || overAbZone.weaponId === 'rifle');
            if (isMagSlot && isMagazineItem(drag.itemId) && getMagazineWeapon(drag.itemId) === overAbZone.weaponId) {
                const weaponId = overAbZone.weaponId;
                const removed = removeFromContainerSource(drag);
                if (!removed || removed.itemId !== drag.itemId) {
                    if (removed) putBackInContainerSource(drag, removed);
                    return;
                }
                const currentMag = getEquippedMag(stats, weaponId);
                if (currentMag) {
                    const curMagCfg = getInventoryItemConfig(currentMag.itemId);
                    const curSizeW = curMagCfg ? (curMagCfg.sizeW || 1) : 1, curSizeH = curMagCfg ? (curMagCfg.sizeH || 1) : 1;
                    const dest = findFirstEmptySlotForMag(stats, curSizeW, curSizeH, null);
                    const magExtra = { rounds: currentMag.rounds ?? 0, maxRounds: currentMag.maxRounds ?? getMagazineCapacity(currentMag.itemId) };
                    if (dest) {
                        const placeW = dest.rotated ? curSizeH : curSizeW, placeH = dest.rotated ? curSizeW : curSizeH;
                        const liveRig = stats.armor && stats.armor.rig && stats.rigGrid;
                        const liveBackpack = stats.backpack;
                        if (dest.container === 'rig' && liveRig) placeItem(liveRig, currentMag.itemId, 1, dest.row, dest.col, magExtra, (placeW !== 1 || placeH !== 1) ? { sizeW: placeW, sizeH: placeH } : undefined);
                        else if (dest.container === 'backpack' && liveBackpack) placeItem(liveBackpack, currentMag.itemId, 1, dest.row, dest.col, magExtra, (placeW !== 1 || placeH !== 1) ? { sizeW: placeW, sizeH: placeH } : undefined);
                        else if (dest.container === 'pocket') {
                            ensurePockets(stats);
                            if (placeW === 1 && placeH === 1) {
                                const slot = stats.pockets[dest.pocketIndex] && stats.pockets[dest.pocketIndex][dest.slotIndex];
                                if (slot && !slot.itemId) stats.pockets[dest.pocketIndex][dest.slotIndex] = { itemId: currentMag.itemId, count: 1, rounds: magExtra.rounds, maxRounds: magExtra.maxRounds };
                            } else if (placeW === 2 && placeH === 1 && dest.slotIndex === 0) {
                                stats.pockets[dest.pocketIndex][0] = { itemId: currentMag.itemId, count: 1, rounds: magExtra.rounds, maxRounds: magExtra.maxRounds, sizeW: 2, sizeH: 1 };
                                stats.pockets[dest.pocketIndex][1] = { _spansFrom: 0 };
                            }
                        }
                    } else {
                        if (!scene.textures.exists('pickup_dropped')) {
                            const g = scene.make.graphics({ x: 0, y: 0, add: false });
                            g.fillStyle(0x8B4513, 1);
                            g.fillCircle(8, 8, 8);
                            g.generateTexture('pickup_dropped', 16, 16);
                        }
                        const ppx = scene.player ? scene.player.x : 400;
                        const ppy = scene.player ? scene.player.y : 300;
                        const dropType = { itemId: currentMag.itemId, count: 1, rounds: currentMag.rounds ?? 0, maxRounds: currentMag.maxRounds ?? getMagazineCapacity(currentMag.itemId) };
                        const spr = scene.add.image(ppx, ppy - 10, 'pickup_dropped').setDepth(5);
                        scene.droppedInventoryItems.add(spr);
                        spr.setData('type', dropType);
                    }
                }
                setEquippedMag(stats, weaponId, { itemId: removed.itemId, rounds: removed.rounds ?? 0, maxRounds: removed.maxRounds ?? getMagazineCapacity(removed.itemId) });
                sfx.click();
                rerender();
                return;
            }
            if (overAbZone && isModItem(drag.itemId) && modFitsSlot(drag.itemId, overAbZone.slotName, overAbZone.weaponId)) {
                const removed = removeFromContainerSource(drag);
                if (removed && removed.itemId === drag.itemId) {
                    if (overAbZone.type === 'slot' && overAbZone.slotId) {
                        ensureWeaponSlotModsShape(stats);
                        if (!stats.weaponSlotMods[overAbZone.slotId]) stats.weaponSlotMods[overAbZone.slotId] = createDefaultEquippedModsForWeapon(overAbZone.weaponId);
                        stats.weaponSlotMods[overAbZone.slotId][overAbZone.slotName] = removed.itemId;
                    } else if (overAbZone.type === 'outfit' && overAbZone.source) {
                        if (overAbZone.source.type === 'backpack' && backpack && backpack.items) {
                            const item = backpack.items.find(p => p.placementId === overAbZone.source.placementId);
                            if (item) {
                                if (!item.mods) item.mods = createDefaultEquippedModsForWeapon(overAbZone.weaponId);
                                item.mods[overAbZone.slotName] = removed.itemId;
                            }
                        } else if (overAbZone.source.type === 'rig' && rigGrid && rigGrid.items) {
                            const item = rigGrid.items.find(p => p.placementId === overAbZone.source.placementId);
                            if (item) {
                                if (!item.mods) item.mods = createDefaultEquippedModsForWeapon(overAbZone.weaponId);
                                item.mods[overAbZone.slotName] = removed.itemId;
                            }
                        } else if (overAbZone.source.type === 'pocket') {
                            const slot = stats.pockets[overAbZone.source.pocketIndex] && stats.pockets[overAbZone.source.pocketIndex][overAbZone.source.slotIndex];
                            if (slot) {
                                if (!slot.mods) slot.mods = createDefaultEquippedModsForWeapon(overAbZone.weaponId);
                                slot.mods[overAbZone.slotName] = removed.itemId;
                            }
                        } else if (overAbZone.source.type === 'slot') {
                            ensureWeaponSlotModsShape(stats);
                            if (!stats.weaponSlotMods[overAbZone.source.slotId]) stats.weaponSlotMods[overAbZone.source.slotId] = createDefaultEquippedModsForWeapon(overAbZone.weaponId);
                            stats.weaponSlotMods[overAbZone.source.slotId][overAbZone.slotName] = removed.itemId;
                        }
                    }
                    sfx.click();
                    rerender();
                    return;
                }
                if (removed) putBackInContainerSource(drag, removed);
            }
            const overSlot = armorSlotZones.find(z => inZone(px, py, z));
            if (overSlot && overSlot.id === 'rig' && drag.itemId === 'rig' && drag.container === 'backpack' && drag.placementId) {
                const removed = removeItem(backpack, drag.placementId);
                if (removed) {
                    const oldRig = stats.armor.rig;
                    if (oldRig && stats.rigGrid) {
                        const pos = findSpace(backpack, 3, 2);
                        if (pos) {
                            const oldPlacementId = placeItem(backpack, 'rig', 1, pos.row, pos.col, undefined, { sizeW: 3, sizeH: 2 });
                            if (oldPlacementId != null) {
                                if (!stats.rigInventories) stats.rigInventories = {};
                                stats.rigInventories['backpack_' + oldPlacementId] = JSON.parse(JSON.stringify(stats.rigGrid));
                            }
                        }
                    }
                    stats.armor.rig = { name: 'Rig', itemId: 'rig' };
                    if (!stats.rigGrid) stats.rigGrid = { gridW: 4, gridH: 2, items: [], _nextId: 1 };
                    if (stats.rigInventories && stats.rigInventories['backpack_' + drag.placementId]) {
                        stats.rigGrid = JSON.parse(JSON.stringify(stats.rigInventories['backpack_' + drag.placementId]));
                        delete stats.rigInventories['backpack_' + drag.placementId];
                    } else {
                        stats.rigGrid.items = stats.rigGrid.items || [];
                        stats.rigGrid.gridW = 4;
                        stats.rigGrid.gridH = 2;
                    }
                    sfx.click();
                }
                rerender();
                return;
            }
            if (inZone(px, py, backpackSlotZone) && drag.container === 'backpack' && drag.itemId === 'backpack_default' && drag.placementId) {
                const removed = removeItem(backpack, drag.placementId);
                if (removed) {
                    const oldEquipped = stats.equippedBackpack;
                    if (oldEquipped && oldEquipped.placementId === 'equipped' && stats.backpackInventories && stats.backpackInventories['equipped']) {
                        const pos = findSpace(backpack, 5, 8);
                        if (pos) {
                            const oldPlacementId = placeItem(backpack, 'backpack_default', 1, pos.row, pos.col, undefined, { sizeW: 5, sizeH: 8 });
                            if (oldPlacementId != null) {
                                if (!stats.backpackInventories) stats.backpackInventories = {};
                                stats.backpackInventories['backpack_' + oldPlacementId] = JSON.parse(JSON.stringify(stats.backpackInventories['equipped']));
                            }
                        }
                    }
                    stats.equippedBackpack = { itemId: 'backpack_default', placementId: 'equipped' };
                    if (!stats.backpackInventories) stats.backpackInventories = {};
                    if (stats.backpackInventories['backpack_' + drag.placementId]) {
                        stats.backpackInventories['equipped'] = JSON.parse(JSON.stringify(stats.backpackInventories['backpack_' + drag.placementId]));
                        delete stats.backpackInventories['backpack_' + drag.placementId];
                    } else {
                        stats.backpackInventories['equipped'] = getDefaultBackpack();
                        ensureGridItems(stats.backpackInventories['equipped']);
                    }
                    stats.backpack = stats.backpackInventories['equipped'];
                    stats.backpack.gridW = 6;
                    stats.backpack.gridH = 9;
                    sfx.click();
                }
                rerender();
                return;
            }
            const eff = getEffectiveDragSize(drag);
            const sizeW = eff.w, sizeH = eff.h;
            ensurePockets(stats);
            const pockets = stats.pockets;

            const isPocketSlotEmpty = (pi, si) => {
                const s = pockets[pi] && pockets[pi][si];
                return !s || !s.itemId || s._spansFrom !== undefined;
            };
            const pocketFitsSize = (pocketIndex, w, h) => {
                const layout = POCKET_LAYOUT[pocketIndex];
                return layout && layout.w >= w && layout.h >= h;
            };
            const canPlaceInPocket = (pi, si, w, h) => {
                if (w === 1 && h === 1) return true;
                if (w === 2 && h === 1 && pocketFitsSize(pi, 2, 1))
                    return isPocketSlotEmpty(pi, 0) && isPocketSlotEmpty(pi, 1);
                return false;
            };
            if (overPocketZone) {
                const pi = overPocketZone.pocketIndex, si = overPocketZone.slotIndex;
                let placeInPocketW = sizeW, placeInPocketH = sizeH;
                if (!canPlaceInPocket(pi, si, sizeW, sizeH) && sizeW !== sizeH && canPlaceInPocket(pi, si, sizeH, sizeW)) {
                    placeInPocketW = sizeH;
                    placeInPocketH = sizeW;
                }
                if (canPlaceInPocket(pi, si, placeInPocketW, placeInPocketH)) {
                    const removed = removeFromContainerSource(drag);
                    if (removed) {
                        ensurePockets(stats);
                        const pockets = stats.pockets;
                        if (drag.fromPocket && drag.pocketIndex === pi && drag.slotIndex === si) {
                            putBackInContainerSource(drag, removed);
                            rerender();
                            return;
                        }
                        const destSlot = pockets[pi] && pockets[pi][si];
                        const destIsEmpty = isPocketSlotEmpty(pi, si);
                        if (placeInPocketW === 1 && placeInPocketH === 1 && destIsEmpty) {
                            const slotData = { itemId: removed.itemId, count: removed.count || 1, durability: removed.durability, maxDurability: removed.maxDurability };
                            if (removed.mods && typeof removed.mods === 'object') slotData.mods = removed.mods;
                            if (removed.rounds != null || removed.maxRounds != null) { slotData.rounds = removed.rounds ?? 0; slotData.maxRounds = removed.maxRounds ?? getMagazineCapacity(removed.itemId); }
                            pockets[pi][si] = slotData;
                            sfx.click();
                            rerender();
                            return;
                        }
                        if (placeInPocketW === 2 && placeInPocketH === 1 && pocketFitsSize(pi, 2, 1) && isPocketSlotEmpty(pi, 0) && isPocketSlotEmpty(pi, 1)) {
                            const slotData = { itemId: removed.itemId, count: removed.count || 1, durability: removed.durability, maxDurability: removed.maxDurability, sizeW: 2, sizeH: 1 };
                            if (removed.mods && typeof removed.mods === 'object') slotData.mods = removed.mods;
                            if (removed.rounds != null || removed.maxRounds != null) { slotData.rounds = removed.rounds ?? 0; slotData.maxRounds = removed.maxRounds ?? getMagazineCapacity(removed.itemId); }
                            pockets[pi][0] = slotData;
                            pockets[pi][1] = { _spansFrom: 0 };
                            sfx.click();
                            rerender();
                            return;
                        }
                        if (!destIsEmpty && destSlot && destSlot.itemId && sizeW === 1 && sizeH === 1) {
                            if (destSlot.itemId === removed.itemId) {
                                const pCfg = getInventoryItemConfig(removed.itemId);
                                const pStackMax = (pCfg && pCfg.stackMax) || 1;
                                if (pStackMax > 1) {
                                    const cur = destSlot.count || 1;
                                    const room = pStackMax - cur;
                                    const toAdd = Math.min(removed.count || 1, room);
                                    destSlot.count = cur + toAdd;
                                    const remainder = (removed.count || 1) - toAdd;
                                    if (remainder > 0) {
                                        putBackInContainerSource(drag, { ...removed, count: remainder });
                                    }
                                    sfx.click();
                                    rerender();
                                    return;
                                }
                            }
                            const destExtra = (destSlot.durability != null || destSlot.maxDurability != null) ? { durability: destSlot.durability, maxDurability: destSlot.maxDurability } : undefined;
                            if (tryAddItem(backpack, destSlot.itemId, destSlot.count || 1, destExtra)) {
                                const slotData = { itemId: removed.itemId, count: removed.count || 1, durability: removed.durability, maxDurability: removed.maxDurability };
                                if (removed.mods && typeof removed.mods === 'object') slotData.mods = removed.mods;
                                pockets[pi][si] = slotData;
                                sfx.click();
                                rerender();
                                return;
                            }
                        }
                        putBackInContainerSource(drag, removed);
                    }
                }
                rerender();
                return;
            }
            if (overBackpackEmpty) {
                if (drag.container === 'backpack' && drag.placementId) {
                    if (!drag.rotated && canPlace(backpack, overBackpackEmpty.row, overBackpackEmpty.col, sizeW, sizeH, drag.placementId)) {
                        if (moveItemInGrid(backpack, drag.placementId, overBackpackEmpty.row, overBackpackEmpty.col)) {
                            sfx.click();
                            rerender();
                            return;
                        }
                    }
                    if (drag.rotated && canPlace(backpack, overBackpackEmpty.row, overBackpackEmpty.col, sizeW, sizeH, null)) {
                        const removed = removeFromContainerSource(drag);
                        if (removed) {
                            const extra = buildExtraFromRemoved(removed);
                            if (placeItem(backpack, removed.itemId, removed.count || 1, overBackpackEmpty.row, overBackpackEmpty.col, extra, { sizeW, sizeH })) {
                                sfx.click();
                                rerender();
                                return;
                            }
                            putBackInContainerSource(drag, removed);
                        }
                        rerender();
                        return;
                    }
                }
                const removed = removeFromContainerSource(drag);
                if (removed) {
                    const extra = buildExtraFromRemoved(removed);
                    const placeW = drag.rotated ? (removed.sizeH || 1) : (removed.sizeW || 1), placeH = drag.rotated ? (removed.sizeW || 1) : (removed.sizeH || 1);
                    if (overBackpackEmpty && canPlace(backpack, overBackpackEmpty.row, overBackpackEmpty.col, placeW, placeH, null)) {
                        placeItem(backpack, removed.itemId, removed.count || 1, overBackpackEmpty.row, overBackpackEmpty.col, extra, (placeW !== 1 || placeH !== 1) ? { sizeW: placeW, sizeH: placeH } : undefined);
                        sfx.click();
                        rerender();
                        return;
                    }
                    if (overBackpackEmpty && placeW !== placeH && canPlace(backpack, overBackpackEmpty.row, overBackpackEmpty.col, placeH, placeW, null)) {
                        placeItem(backpack, removed.itemId, removed.count || 1, overBackpackEmpty.row, overBackpackEmpty.col, extra, { sizeW: placeH, sizeH: placeW });
                        sfx.click();
                        rerender();
                        return;
                    }
                    if (!drag.rotated && tryAddItem(backpack, removed.itemId, removed.count || 1, extra)) {
                        sfx.click();
                        rerender();
                        return;
                    }
                    const pos = findSpaceTryRotated(backpack, placeW, placeH);
                    if (pos) {
                        const pw = pos.rotated ? placeH : placeW, ph = pos.rotated ? placeW : placeH;
                        placeItem(backpack, removed.itemId, removed.count || 1, pos.row, pos.col, extra, (pw !== 1 || ph !== 1) ? { sizeW: pw, sizeH: ph } : undefined);
                        sfx.click();
                        rerender();
                        return;
                    }
                    putBackInContainerSource(drag, removed);
                }
                rerender();
                return;
            }
            if (overSecureContainerEmpty && secureContainerGrid) {
                if (drag.fromSecureContainer && drag.placementId && !drag.rotated && canPlace(secureContainerGrid, overSecureContainerEmpty.row, overSecureContainerEmpty.col, sizeW, sizeH, drag.placementId)) {
                    if (moveItemInGrid(secureContainerGrid, drag.placementId, overSecureContainerEmpty.row, overSecureContainerEmpty.col)) {
                        sfx.click();
                        rerender();
                        return;
                    }
                }
                if (drag.fromSecureContainer && drag.placementId && drag.rotated && canPlace(secureContainerGrid, overSecureContainerEmpty.row, overSecureContainerEmpty.col, sizeW, sizeH, null)) {
                    const removed = removeFromContainerSource(drag);
                    if (removed) {
                        const extra = buildExtraFromRemoved(removed);
                        if (placeItem(secureContainerGrid, removed.itemId, removed.count || 1, overSecureContainerEmpty.row, overSecureContainerEmpty.col, extra, { sizeW, sizeH })) {
                            sfx.click();
                            rerender();
                            return;
                        }
                        putBackInContainerSource(drag, removed);
                    }
                    rerender();
                    return;
                }
                const removed = removeFromContainerSource(drag);
                if (removed) {
                    const sw = drag.rotated ? (removed.sizeH || 1) : (removed.sizeW || 1), sh = drag.rotated ? (removed.sizeW || 1) : (removed.sizeH || 1);
                    if (canPlace(secureContainerGrid, overSecureContainerEmpty.row, overSecureContainerEmpty.col, sw, sh)) {
                        const extra = buildExtraFromRemoved(removed);
                        placeItem(secureContainerGrid, removed.itemId, removed.count || 1, overSecureContainerEmpty.row, overSecureContainerEmpty.col, extra, { sizeW: sw, sizeH: sh });
                        sfx.click();
                        rerender();
                        return;
                    }
                    putBackInContainerSource(drag, removed);
                }
                rerender();
                return;
            }
            if (overMedBagEmpty && medBagGrid) {
                if (!drag.fromMedBag && !isMedicalItem(drag.itemId)) {
                    rerender();
                    return;
                }
                if (drag.fromMedBag && drag.placementId && !drag.rotated && canPlace(medBagGrid, overMedBagEmpty.row, overMedBagEmpty.col, sizeW, sizeH, drag.placementId)) {
                    if (moveItemInGrid(medBagGrid, drag.placementId, overMedBagEmpty.row, overMedBagEmpty.col)) {
                        sfx.click();
                        rerender();
                        return;
                    }
                }
                if (drag.fromMedBag && drag.placementId && drag.rotated && canPlace(medBagGrid, overMedBagEmpty.row, overMedBagEmpty.col, sizeW, sizeH, null)) {
                    const removed = removeFromContainerSource(drag);
                    if (removed) {
                        const extra = buildExtraFromRemoved(removed);
                        if (placeItem(medBagGrid, removed.itemId, removed.count || 1, overMedBagEmpty.row, overMedBagEmpty.col, extra, { sizeW, sizeH })) {
                            sfx.click();
                            rerender();
                            return;
                        }
                        putBackInContainerSource(drag, removed);
                    }
                    rerender();
                    return;
                }
                const removed = removeFromContainerSource(drag);
                if (removed) {
                    if (!isMedicalItem(removed.itemId)) {
                        putBackInContainerSource(drag, removed);
                        rerender();
                        return;
                    }
                    const sw = drag.rotated ? (removed.sizeH || 1) : (removed.sizeW || 1), sh = drag.rotated ? (removed.sizeW || 1) : (removed.sizeH || 1);
                    if (canPlace(medBagGrid, overMedBagEmpty.row, overMedBagEmpty.col, sw, sh)) {
                        const extra = buildExtraFromRemoved(removed);
                        placeItem(medBagGrid, removed.itemId, removed.count || 1, overMedBagEmpty.row, overMedBagEmpty.col, extra, { sizeW: sw, sizeH: sh });
                        sfx.click();
                        rerender();
                        return;
                    }
                    putBackInContainerSource(drag, removed);
                }
                rerender();
                return;
            }
            if (overRigEmpty && rigGrid) {
                if (drag.fromRig && drag.placementId && !drag.rotated && canPlace(rigGrid, overRigEmpty.row, overRigEmpty.col, sizeW, sizeH, drag.placementId)) {
                    if (moveItemInGrid(rigGrid, drag.placementId, overRigEmpty.row, overRigEmpty.col)) {
                        sfx.click();
                        rerender();
                        return;
                    }
                }
                if (drag.fromRig && drag.placementId && drag.rotated && canPlace(rigGrid, overRigEmpty.row, overRigEmpty.col, sizeW, sizeH, null)) {
                    const removed = removeFromContainerSource(drag);
                    if (removed) {
                        const extra = buildExtraFromRemoved(removed);
                        if (placeItem(rigGrid, removed.itemId, removed.count || 1, overRigEmpty.row, overRigEmpty.col, extra, { sizeW, sizeH })) {
                            sfx.click();
                            rerender();
                            return;
                        }
                        putBackInContainerSource(drag, removed);
                    }
                    rerender();
                    return;
                }
                const removed = removeFromContainerSource(drag);
                if (removed) {
                    const sw = drag.rotated ? (removed.sizeH || 1) : (removed.sizeW || 1), sh = drag.rotated ? (removed.sizeW || 1) : (removed.sizeH || 1);
                    let placeW = sw, placeH = sh;
                    if (canPlace(rigGrid, overRigEmpty.row, overRigEmpty.col, sw, sh, null)) {
                        placeW = sw;
                        placeH = sh;
                    } else if (sw !== sh && canPlace(rigGrid, overRigEmpty.row, overRigEmpty.col, sh, sw, null)) {
                        placeW = sh;
                        placeH = sw;
                    } else {
                        putBackInContainerSource(drag, removed);
                        rerender();
                        return;
                    }
                    const extra = buildExtraFromRemoved(removed);
                    placeItem(rigGrid, removed.itemId, removed.count || 1, overRigEmpty.row, overRigEmpty.col, extra, (placeW !== 1 || placeH !== 1) ? { sizeW: placeW, sizeH: placeH } : undefined);
                    sfx.click();
                    rerender();
                    return;
                }
                rerender();
                return;
            }
            // Drop onto another backpack (nested): if pointer is over a backpack item in the main backpack grid, place into that backpack's inner grid
            const overNestedBackpack = backpack && itemZones.find(z => inZone(px, py, z) && z.itemId === 'backpack_default');
            if (overNestedBackpack) {
                if (!stats.backpackInventories) stats.backpackInventories = {};
                let innerGrid = stats.backpackInventories['backpack_' + overNestedBackpack.placementId];
                if (!innerGrid || !Array.isArray(innerGrid.items)) {
                    innerGrid = getDefaultBackpack();
                    ensureGridItems(innerGrid);
                    stats.backpackInventories['backpack_' + overNestedBackpack.placementId] = innerGrid;
                }
                innerGrid.gridW = 6;
                innerGrid.gridH = 9;
                const removed = removeFromContainerSource(drag);
                if (removed) {
                    const extra = buildExtraFromRemoved(removed);
                    const placeW = drag.rotated ? (removed.sizeH || 1) : (removed.sizeW || 1), placeH = drag.rotated ? (removed.sizeW || 1) : (removed.sizeH || 1);
                    if (tryAddItem(innerGrid, removed.itemId, removed.count || 1, extra)) { destroyGhost(); scene.invDragging = null; sfx.click(); rerender(); return; }
                    const pos = findSpaceTryRotated(innerGrid, placeW, placeH);
                    if (pos) {
                        const pw = pos.rotated ? placeH : placeW, ph = pos.rotated ? placeW : placeH;
                        placeItem(innerGrid, removed.itemId, removed.count || 1, pos.row, pos.col, extra, (pw !== 1 || ph !== 1) ? { sizeW: pw, sizeH: ph } : undefined);
                        destroyGhost(); scene.invDragging = null; sfx.click(); rerender(); return;
                    }
                    putBackInContainerSource(drag, removed);
                }
            }
            // Drop anywhere in container (or on equip square): place in first fit when pointer is inside container grid or on BAG/RIG/SEC/MED slot
            const inBackpackBounds = backpackEquipped && ( (px >= invGridX && px <= invGridX + 6 * step && py >= invGridY && py <= invGridY + 9 * step) || (backpackSlotZone && px >= backpackSlotZone.left && px <= backpackSlotZone.right && py >= backpackSlotZone.top && py <= backpackSlotZone.bottom) );
            const inRigBounds = rigEquipped && ( (px >= invGridX && px <= invGridX + 4 * rigStepX && py >= rigY - rigSlotSize / 2 && py <= rigY - rigSlotSize / 2 + 2 * rigStepY) || (rigSlotZone && px >= rigSlotZone.left && px <= rigSlotZone.right && py >= rigSlotZone.top && py <= rigSlotZone.bottom) );
            const secureGridYVal = hasSecureContainerGrid ? (secureContainerSlotY + secureContainerSlotSize / 2 + 5) : 0;
            const inSecureBounds = hasSecureContainerGrid && secureContainerGrid && ( (px >= secureGridLeft && px <= secureGridLeft + 2 * secureStepX && py >= secureGridYVal && py <= secureGridYVal + 3 * secureStepY) || (secureContainerSlotZone && px >= secureContainerSlotZone.left && px <= secureContainerSlotZone.right && py >= secureContainerSlotZone.top && py <= secureContainerSlotZone.bottom) );
            const medBagGridYVal = hasMedBagGrid ? (medBagSlotY + medBagSlotSize / 2 + 5) : 0;
            const inMedBagBounds = hasMedBagGrid && medBagGrid && ( (px >= medBagGridLeft && px <= medBagGridLeft + 2 * medBagStepX && py >= medBagGridYVal && py <= medBagGridYVal + 2 * medBagStepY) || (medBagSlotZone && px >= medBagSlotZone.left && px <= medBagSlotZone.right && py >= medBagSlotZone.top && py <= medBagSlotZone.bottom) );
            const inPocketBounds = pocketZones && pocketZones.length && (() => { const pl = Math.min(...pocketZones.map(z => z.left)), pr = Math.max(...pocketZones.map(z => z.right)), pt = Math.min(...pocketZones.map(z => z.top)), pb = Math.max(...pocketZones.map(z => z.bottom)); return px >= pl && px <= pr && py >= pt && py <= pb; })();
            if (inBackpackBounds && backpack) {
                const removed = removeFromContainerSource(drag);
                if (removed) {
                    const extra = buildExtraFromRemoved(removed);
                    const placeW = drag.rotated ? (removed.sizeH || 1) : (removed.sizeW || 1), placeH = drag.rotated ? (removed.sizeW || 1) : (removed.sizeH || 1);
                    if (tryAddItem(backpack, removed.itemId, removed.count || 1, extra)) { destroyGhost(); scene.invDragging = null; sfx.click(); rerender(); return; }
                    const pos = findSpaceTryRotated(backpack, placeW, placeH);
                    if (pos) {
                        const pw = pos.rotated ? placeH : placeW, ph = pos.rotated ? placeW : placeH;
                        placeItem(backpack, removed.itemId, removed.count || 1, pos.row, pos.col, extra, (pw !== 1 || ph !== 1) ? { sizeW: pw, sizeH: ph } : undefined);
                        destroyGhost(); scene.invDragging = null; sfx.click(); rerender(); return;
                    }
                    putBackInContainerSource(drag, removed);
                }
            }
            if (inRigBounds && rigGrid) {
                const removed = removeFromContainerSource(drag);
                if (removed) {
                    const extra = buildExtraFromRemoved(removed);
                    const placeW = drag.rotated ? (removed.sizeH || 1) : (removed.sizeW || 1), placeH = drag.rotated ? (removed.sizeW || 1) : (removed.sizeH || 1);
                    const pos = findSpaceTryRotated(rigGrid, placeW, placeH);
                    if (pos) {
                        const pw = pos.rotated ? placeH : placeW, ph = pos.rotated ? placeW : placeH;
                        placeItem(rigGrid, removed.itemId, removed.count || 1, pos.row, pos.col, extra, (pw !== 1 || ph !== 1) ? { sizeW: pw, sizeH: ph } : undefined);
                        destroyGhost(); scene.invDragging = null; sfx.click(); rerender(); return;
                    }
                    putBackInContainerSource(drag, removed);
                }
            }
            if (inSecureBounds && secureContainerGrid) {
                const removed = removeFromContainerSource(drag);
                if (removed) {
                    const extra = buildExtraFromRemoved(removed);
                    const placeW = drag.rotated ? (removed.sizeH || 1) : (removed.sizeW || 1), placeH = drag.rotated ? (removed.sizeW || 1) : (removed.sizeH || 1);
                    const pos = findSpaceTryRotated(secureContainerGrid, placeW, placeH);
                    if (pos) {
                        const pw = pos.rotated ? placeH : placeW, ph = pos.rotated ? placeW : placeH;
                        placeItem(secureContainerGrid, removed.itemId, removed.count || 1, pos.row, pos.col, extra, (pw !== 1 || ph !== 1) ? { sizeW: pw, sizeH: ph } : undefined);
                        destroyGhost(); scene.invDragging = null; sfx.click(); rerender(); return;
                    }
                    putBackInContainerSource(drag, removed);
                }
            }
            if (inMedBagBounds && medBagGrid) {
                const removed = removeFromContainerSource(drag);
                if (removed && isMedicalItem(removed.itemId)) {
                    const extra = buildExtraFromRemoved(removed);
                    const placeW = drag.rotated ? (removed.sizeH || 1) : (removed.sizeW || 1), placeH = drag.rotated ? (removed.sizeW || 1) : (removed.sizeH || 1);
                    const pos = findSpaceTryRotated(medBagGrid, placeW, placeH);
                    if (pos) {
                        const pw = pos.rotated ? placeH : placeW, ph = pos.rotated ? placeW : placeH;
                        placeItem(medBagGrid, removed.itemId, removed.count || 1, pos.row, pos.col, extra, (pw !== 1 || ph !== 1) ? { sizeW: pw, sizeH: ph } : undefined);
                        destroyGhost(); scene.invDragging = null; sfx.click(); rerender(); return;
                    }
                    putBackInContainerSource(drag, removed);
                } else if (removed) putBackInContainerSource(drag, removed);
            }
            if (inPocketBounds && pocketZones && pocketZones.length) {
                ensurePockets(stats);
                const pockets = stats.pockets;
                const removed = removeFromContainerSource(drag);
                if (removed) {
                    const placeW = drag.rotated ? (removed.sizeH || 1) : (removed.sizeW || 1), placeH = drag.rotated ? (removed.sizeW || 1) : (removed.sizeH || 1);
                    const slotEmpty = (pI, sI) => { const s = pockets[pI] && pockets[pI][sI]; return !s || !s.itemId || s._spansFrom !== undefined; };
                    const makeSlotData = (r, w, h) => {
                        const slotData = { itemId: r.itemId, count: r.count || 1, durability: r.durability, maxDurability: r.maxDurability };
                        if (w === 2 && h === 1) { slotData.sizeW = 2; slotData.sizeH = 1; }
                        if (r.mods && typeof r.mods === 'object') slotData.mods = r.mods;
                        if (r.rounds != null || r.maxRounds != null) { slotData.rounds = r.rounds ?? 0; slotData.maxRounds = r.maxRounds ?? getMagazineCapacity(r.itemId); }
                        return slotData;
                    };
                    let placed = false;
                    if (placeW === 1 && placeH === 1) {
                        for (let pI = 0; pI < (pockets.length || 0) && !placed; pI++) {
                            for (let sI = 0; sI < (pockets[pI] && pockets[pI].length) || 0; sI++) {
                                if (slotEmpty(pI, sI)) {
                                    pockets[pI][sI] = makeSlotData(removed, 1, 1);
                                    placed = true;
                                    break;
                                }
                            }
                        }
                    } else if (placeW === 2 && placeH === 1) {
                        for (let pI = 0; pI <= 1 && !placed; pI++) {
                            if (slotEmpty(pI, 0) && slotEmpty(pI, 1)) {
                                pockets[pI][0] = makeSlotData(removed, 2, 1);
                                pockets[pI][1] = { _spansFrom: 0 };
                                placed = true;
                            }
                        }
                    } else if (placeW === 1 && placeH === 2) {
                        for (let pI = 0; pI <= 1 && !placed; pI++) {
                            if (slotEmpty(pI, 0) && slotEmpty(pI, 1)) {
                                pockets[pI][0] = makeSlotData(removed, 2, 1);
                                pockets[pI][1] = { _spansFrom: 0 };
                                placed = true;
                            }
                        }
                    }
                    if (placed) { destroyGhost(); scene.invDragging = null; sfx.click(); rerender(); return; }
                    putBackInContainerSource(drag, removed);
                }
            }
            if (overSlot && overSlot.id !== 'rig' && ((drag.itemId === 'helmet' || drag.itemId === 'headset') && overSlot.id === 'head' || drag.itemId === 'vest' && overSlot.id === 'body' || drag.itemId === 'headset' && overSlot.id === 'ears' || drag.itemId === 'nvg' && overSlot.id === 'nvg')) {
                const removed = removeFromContainerSource(drag);
                if (removed) {
                    const oldArmor = stats.armor[overSlot.id];
                    if (overSlot.id === 'nvg') {
                        stats.armor.nvg = { itemId: 'nvg', name: 'NVG' };
                        if (oldArmor) tryAddItem(backpack, 'nvg', 1);
                    } else {
                        const armorDefDur = getDefaultDurability(removed.itemId);
                        const d = removed.durability != null ? removed.durability : (armorDefDur ? armorDefDur.durability : 3);
                        const m = removed.maxDurability != null ? removed.maxDurability : (armorDefDur ? armorDefDur.maxDurability : 3);
                        if (overSlot.id === 'head') stats.armor.head = { name: removed.itemId === 'headset' ? 'HEADSET' : 'HELMET', durability: d, maxDurability: m, itemId: removed.itemId };
                        else if (overSlot.id === 'body') stats.armor.body = { name: 'VEST', durability: d, maxDurability: m };
                        else if (overSlot.id === 'ears') stats.armor.ears = { name: 'HEADSET', durability: d, maxDurability: m, itemId: 'headset' };
                        if (oldArmor) tryAddItem(backpack, oldArmor.itemId || ARMOR_SLOT_ITEM[overSlot.id], 1, { durability: oldArmor.durability, maxDurability: oldArmor.maxDurability });
                    }
                    sfx.click();
                    rerender();
                    return;
                }
            }
            rerender();
            return;
        }
        if (drag.fromWeaponSlot) {
            const overW = weaponSlotZones.find(z => inZone(px, py, z));
            if (overW && overW.id === drag.fromWeaponSlot) {
                stats.currentWeapon = drag.itemId;
                sfx.click();
                rerender();
                return;
            }
            // Drop on a different weapon slot: swap or move
            if (overW && overW.id !== drag.fromWeaponSlot) {
                const canPrimary = longGunIds.includes(drag.itemId);
                const canSidearm = drag.itemId === 'pistol';
                const canMelee = longGunIds.includes(drag.itemId) || drag.itemId === 'pistol';
                const okTarget = ((overW.id === 'primary' || overW.id === 'secondary') && canPrimary) || (overW.id === 'sidearm' && canSidearm) || (overW.id === 'melee' && canMelee);
                if (okTarget) {
                    ensureWeaponSlotModsShape(stats);
                    const wsm = stats.weaponSlotMods;
                    const srcMods = wsm[drag.fromWeaponSlot];
                    const targetWeapon = weaponSlots[overW.id];
                    const targetMods = targetWeapon ? wsm[overW.id] : null;
                    weaponSlots[overW.id] = drag.itemId;
                    wsm[overW.id] = (srcMods && typeof srcMods === 'object') ? JSON.parse(JSON.stringify(srcMods)) : createDefaultEquippedModsForWeapon(drag.itemId);
                    weaponSlots[drag.fromWeaponSlot] = targetWeapon;
                    wsm[drag.fromWeaponSlot] = (targetMods && typeof targetMods === 'object') ? targetMods : null;
                    sfx.click();
                    rerender();
                    return;
                }
            }
            // Drop on rig empty cell, pocket, or backpack: unequip to that container
            ensureWeaponSlotModsShape(stats);
            const slotMods = stats.weaponSlotMods[drag.fromWeaponSlot];
            const extra = (slotMods && typeof slotMods === 'object') ? { mods: slotMods } : undefined;
            const cfg = getInventoryItemConfig(drag.itemId);
            const sizeW = (cfg && cfg.sizeW) || 1, sizeH = (cfg && cfg.sizeH) || 1;
            let placed = false;
            const overRigEmpty = rigEmptyZones && rigEmptyZones.length && rigEmptyZones.find(z => inZone(px, py, z));
            const overPocketZone = pocketZones && pocketZones.find(z => inZone(px, py, z));
            const emptyZone = emptyCellZones.find(z => inZone(px, py, z));
            if (overRigEmpty && rigGrid && canPlace(rigGrid, overRigEmpty.row, overRigEmpty.col, sizeW, sizeH, null)) {
                const placementId = placeItem(rigGrid, drag.itemId, 1, overRigEmpty.row, overRigEmpty.col, extra, sizeW !== 1 || sizeH !== 1 ? { sizeW, sizeH } : undefined);
                if (placementId != null) {
                    placed = true;
                    weaponSlots[drag.fromWeaponSlot] = null;
                    stats.weaponSlotMods[drag.fromWeaponSlot] = null;
                    sfx.click();
                    rerender();
                }
            }
            if (!placed && overPocketZone) {
                ensurePockets(stats);
                const pockets = stats.pockets;
                const pi = overPocketZone.pocketIndex, si = overPocketZone.slotIndex;
                const isPocketSlotEmpty = (pI, sI) => { const s = pockets[pI] && pockets[pI][sI]; return !s || !s.itemId || s._spansFrom !== undefined; };
                if (sizeW === 1 && sizeH === 1 && isPocketSlotEmpty(pi, si)) {
                    const slotData = { itemId: drag.itemId, count: 1 };
                    if (extra && extra.mods) slotData.mods = extra.mods;
                    pockets[pi][si] = slotData;
                    placed = true;
                    weaponSlots[drag.fromWeaponSlot] = null;
                    stats.weaponSlotMods[drag.fromWeaponSlot] = null;
                    sfx.click();
                    rerender();
                }
            }
            if (!placed && backpack) {
                if (emptyZone && canPlace(backpack, emptyZone.row, emptyZone.col, sizeW, sizeH, null)) {
                    const placementId = placeItem(backpack, drag.itemId, 1, emptyZone.row, emptyZone.col, extra, sizeW !== 1 || sizeH !== 1 ? { sizeW, sizeH } : undefined);
                    placed = placementId != null;
                }
                if (!placed && tryAddItem(backpack, drag.itemId, 1, extra))
                    placed = true;
                if (placed) {
                    weaponSlots[drag.fromWeaponSlot] = null;
                    stats.weaponSlotMods[drag.fromWeaponSlot] = null;
                    sfx.click();
                    rerender();
                }
            }
            return;
        }
        if (drag.fromBackpackSlot) {
            return;
        }
        if (drag.fromSlot) {
            const emptyZone = emptyCellZones.find(z => inZone(px, py, z));
            if (drag.fromSlot === 'rig') {
                if (emptyZone) {
const pos = findSpace(backpack, 3, 2);
                        if (pos) {
                            const newPlacementId = placeItem(backpack, 'rig', 1, pos.row, pos.col, undefined, { sizeW: 3, sizeH: 2 });
                        if (newPlacementId != null) {
                            if (!stats.rigInventories) stats.rigInventories = {};
                            stats.rigInventories['backpack_' + newPlacementId] = stats.rigGrid ? JSON.parse(JSON.stringify(stats.rigGrid)) : getOrCreateRigInventory(stats.rigInventories, 'backpack_' + newPlacementId);
                            stats.armor.rig = null;
                            stats.rigGrid = null;
                            sfx.click();
                            rerender();
                        }
                    }
                }
            } else {
                const armorExtra = stats.armor[drag.fromSlot] ? { durability: stats.armor[drag.fromSlot].durability, maxDurability: stats.armor[drag.fromSlot].maxDurability } : undefined;
                const unequipItemId = (drag.fromSlot === 'head' && stats.armor.head && stats.armor.head.itemId) ? stats.armor.head.itemId : (drag.fromSlot === 'ears' && stats.armor.ears && stats.armor.ears.itemId) ? stats.armor.ears.itemId : drag.itemId;
                if (emptyZone && tryAddItem(backpack, unequipItemId, 1, armorExtra)) {
                    stats.armor[drag.fromSlot] = null;
                    sfx.click();
                    rerender();
                }
            }
            return;
        }
        const overW = weaponSlotZones.find(z => inZone(px, py, z));
        const fromContainerOrBackpack = isContainerDrag(drag) || (drag.placementId && (drag.container === 'backpack' || drag.fromRig || drag.fromSecureContainer || drag.fromMedBag));
        if (overW && fromContainerOrBackpack) {
            const canPrimary = longGunIds.includes(drag.itemId);
            const canSidearm = drag.itemId === 'pistol';
            const canMelee = longGunIds.includes(drag.itemId) || drag.itemId === 'pistol'; // melee slot accepts any weapon for testing / future melee weapons
            const ok = ((overW.id === 'primary' || overW.id === 'secondary') && canPrimary) || (overW.id === 'sidearm' && canSidearm) || (overW.id === 'melee' && canMelee);
            if (ok) {
                const removed = isContainerDrag(drag) ? removeFromContainerSource(drag) : removeFromDragSource(drag);
                if (removed) {
                    ensureWeaponSlotModsShape(stats);
                    const wsm = stats.weaponSlotMods;
                    const oldWeapon = weaponSlots[overW.id];
                    const oldMods = oldWeapon ? (wsm[overW.id] || createDefaultEquippedModsForWeapon(oldWeapon)) : null;
                    if (oldWeapon) tryAddItem(backpack, oldWeapon, 1, oldMods ? { mods: oldMods } : undefined);
                    weaponSlots[overW.id] = removed.itemId;
                    wsm[overW.id] = (removed.mods && typeof removed.mods === 'object' && Object.keys(removed.mods).length)
                        ? JSON.parse(JSON.stringify(removed.mods))
                        : createDefaultEquippedModsForWeapon(removed.itemId);
                    sfx.click();
                    rerender();
                }
                return;
            }
        }
        const overSlot = armorSlotZones.find(z => inZone(px, py, z));
        if (overSlot && overSlot.id === 'rig' && drag.placementId && drag.itemId === 'rig') {
            const removed = removeItem(backpack, drag.placementId);
            if (removed) {
                const oldRig = stats.armor.rig;
                if (oldRig && stats.rigGrid) {
                    const pos = findSpace(backpack, 3, 2);
                    if (pos) {
                        const oldPlacementId = placeItem(backpack, 'rig', 1, pos.row, pos.col, undefined, { sizeW: 3, sizeH: 2 });
                        if (oldPlacementId != null) {
                            if (!stats.rigInventories) stats.rigInventories = {};
                            stats.rigInventories['backpack_' + oldPlacementId] = JSON.parse(JSON.stringify(stats.rigGrid));
                        }
                    }
                }
                stats.armor.rig = { name: 'Rig', itemId: 'rig' };
                if (!stats.rigGrid) stats.rigGrid = { gridW: 4, gridH: 2, items: [], _nextId: 1 };
                if (stats.rigInventories && stats.rigInventories['backpack_' + drag.placementId]) {
                    stats.rigGrid = JSON.parse(JSON.stringify(stats.rigInventories['backpack_' + drag.placementId]));
                    delete stats.rigInventories['backpack_' + drag.placementId];
                } else {
                    stats.rigGrid.items = stats.rigGrid.items || [];
                    stats.rigGrid.gridW = 4;
                    stats.rigGrid.gridH = 2;
                }
                sfx.click();
                rerender();
            }
            return;
        }
        if (overSlot && ((drag.itemId === 'helmet' || drag.itemId === 'headset') && overSlot.id === 'head' || drag.itemId === 'vest' && overSlot.id === 'body' || drag.itemId === 'headset' && overSlot.id === 'ears' || drag.itemId === 'nvg' && overSlot.id === 'nvg')) {
            const removed = removeFromDragSource(drag);
            if (removed) {
                const oldArmor = stats.armor[overSlot.id];
                if (overSlot.id === 'nvg') {
                    stats.armor.nvg = { itemId: 'nvg', name: 'NVG' };
                    if (oldArmor) tryAddItem(backpack, 'nvg', 1);
                } else {
                    const armorDefDur = getDefaultDurability(removed.itemId);
                    const d = removed.durability != null ? removed.durability : (armorDefDur ? armorDefDur.durability : 3);
                    const m = removed.maxDurability != null ? removed.maxDurability : (armorDefDur ? armorDefDur.maxDurability : 3);
                    if (overSlot.id === 'head') stats.armor.head = { name: removed.itemId === 'headset' ? 'HEADSET' : 'HELMET', durability: d, maxDurability: m, itemId: removed.itemId };
                    else if (overSlot.id === 'body') stats.armor.body = { name: 'VEST', durability: d, maxDurability: m };
                    else if (overSlot.id === 'ears') stats.armor.ears = { name: 'HEADSET', durability: d, maxDurability: m, itemId: 'headset' };
                    if (oldArmor) tryAddItem(backpack, oldArmor.itemId || ARMOR_SLOT_ITEM[overSlot.id], 1, { durability: oldArmor.durability, maxDurability: oldArmor.maxDurability });
                }
                sfx.click();
                rerender();
            }
            return;
        }
    };
    /** Permanently remove the dragged item (no drop pickup). Used when user confirms delete from delete zone. */
    const doDeleteFromInventory = (drag) => {
        if (!drag) return;
        if (drag.fromWeaponSlot) {
            if (drag.itemId) {
                ensureWeaponSlotModsShape(stats);
                const ws = stats.weaponSlots || {};
                const wsm = stats.weaponSlotMods || {};
                ws[drag.fromWeaponSlot] = null;
                if (wsm[drag.fromWeaponSlot]) wsm[drag.fromWeaponSlot] = null;
            }
            ctx.saveRunStats();
            return;
        }
        if (drag.fromSlot) {
            if (stats.armor && stats.armor[drag.fromSlot] && stats.armor[drag.fromSlot].itemId) {
                stats.armor[drag.fromSlot] = null;
            }
            ctx.saveRunStats();
            return;
        }
        if (drag.fromAttachmentBox) {
            if (isMagazineItem(drag.itemId)) setEquippedMag(stats, drag.weaponId, null);
            else if (isModItem(drag.itemId)) {
                if (drag.type === 'slot' && drag.slotId) {
                    ensureWeaponSlotModsShape(stats);
                    if (stats.weaponSlotMods[drag.slotId]) stats.weaponSlotMods[drag.slotId][drag.slotName] = null;
                } else if (drag.type === 'outfit' && drag.source) {
                    const src = drag.source;
                    let weaponItem = null;
                    if (src.type === 'backpack' && stats.backpack && stats.backpack.items) weaponItem = stats.backpack.items.find(p => p.placementId === src.placementId);
                    else if (src.type === 'rig' && stats.rigGrid && stats.rigGrid.items) weaponItem = stats.rigGrid.items.find(p => p.placementId === src.placementId);
                    else if (src.type === 'pocket' && stats.pockets) { const s = stats.pockets[src.pocketIndex] && stats.pockets[src.pocketIndex][src.slotIndex]; weaponItem = s && s.itemId ? s : null; }
                    else if (src.type === 'stash' && scene.persistent && scene.persistent.stash && scene.persistent.stash.items) weaponItem = scene.persistent.stash.items.find(p => p.placementId === src.placementId);
                    if (weaponItem && weaponItem.mods) weaponItem.mods[drag.slotName] = null;
                }
            }
            ctx.saveRunStats();
            return;
        }
        if (drag.fromSecureContainerSlot) {
            if (stats.secureContainerGrid) {
                stats.secureContainerGrid = { gridW: 2, gridH: 3, items: [], _nextId: 1 };
                ensureGridItems(stats.secureContainerGrid);
            }
            ctx.saveRunStats();
            return;
        }
        if (drag.fromMedBagSlot) {
            if (stats.medBagGrid) {
                stats.medBagGrid = { gridW: 2, gridH: 2, items: [], _nextId: 1 };
                ensureGridItems(stats.medBagGrid);
            }
            ctx.saveRunStats();
            return;
        }
        if (drag.fromBackpackSlot) {
            if (!stats.backpackInventories) stats.backpackInventories = {};
            stats.equippedBackpack = null;
            stats.backpack = getDefaultBackpack();
            ensureGridItems(stats.backpack);
            stats.backpack.gridW = 6;
            stats.backpack.gridH = 9;
            ctx.saveRunStats();
            return;
        }
        if (drag.fromPocket) {
            ensurePockets(stats);
            const pockets = stats.pockets;
            if (pockets[drag.pocketIndex] && pockets[drag.pocketIndex][drag.slotIndex]) {
                const slot = pockets[drag.pocketIndex][drag.slotIndex];
                pockets[drag.pocketIndex][drag.slotIndex] = null;
                if (slot.sizeW === 2 && slot.sizeH === 1 && pockets[drag.pocketIndex][1] && pockets[drag.pocketIndex][1]._spansFrom === 0)
                    pockets[drag.pocketIndex][1] = null;
            }
            ctx.saveRunStats();
            return;
        }
        const removed = isContainerDrag(drag) ? removeFromContainerSource(drag) : removeFromDragSource(drag);
        if (!removed) return;
        const prefix = (drag.container === 'backpack' ? 'backpack_' : drag.container === 'rig' ? 'rig_' : drag.container === 'secureContainer' ? 'secureContainer_' : drag.container === 'medBag' ? 'medBag_' : 'backpack_');
        const invKey = prefix + drag.placementId;
        if (removed.itemId === 'ammo_box' && stats.ammoBoxInventories && stats.ammoBoxInventories[invKey]) delete stats.ammoBoxInventories[invKey];
        else if (removed.itemId === 'rig' && stats.rigInventories && stats.rigInventories[invKey]) delete stats.rigInventories[invKey];
        ctx.saveRunStats();
    };
    const doDropFromInventory = () => {
        if (!scene.invDragging) return;
        const drag = scene.invDragging;
        destroyGhost();
        scene.invDragging = null;
        const ensurePickupTexture = () => {
            if (!scene.textures.exists('pickup_dropped')) {
                const g = scene.make.graphics({ x: 0, y: 0, add: false });
                g.fillStyle(0x8B4513, 1);
                g.fillCircle(8, 8, 8);
                g.generateTexture('pickup_dropped', 16, 16);
            }
        };
        const spawnDroppedPickup = (type) => {
            ensurePickupTexture();
            const ppx = scene.player ? scene.player.x : 400;
            const ppy = scene.player ? scene.player.y : 300;
            const spr = scene.add.image(ppx, ppy - 10, 'pickup_dropped').setDepth(5);
            scene.droppedInventoryItems.add(spr);
            spr.setData('type', type);
            sfx.loot();
            rerender();
        };
        if (drag.fromWeaponSlot) {
            const weaponId = drag.itemId;
            if (weaponId) {
                ensureWeaponSlotModsShape(stats);
                const ws = stats.weaponSlots || {};
                const wsm = stats.weaponSlotMods || {};
                ws[drag.fromWeaponSlot] = null;
                if (wsm[drag.fromWeaponSlot]) wsm[drag.fromWeaponSlot] = null;
                spawnDroppedPickup({ itemId: weaponId, count: 1 });
            }
            return;
        }
        if (drag.fromSlot) {
            const armor = stats.armor && stats.armor[drag.fromSlot];
            if (armor && armor.itemId) {
                const type = { itemId: armor.itemId, count: 1 };
                const dropDefDur = getDefaultDurability(armor.itemId);
                if (dropDefDur && (armor.durability != null || armor.maxDurability != null)) {
                    type.durability = armor.durability != null ? armor.durability : dropDefDur.durability;
                    type.maxDurability = armor.maxDurability != null ? armor.maxDurability : dropDefDur.maxDurability;
                }
                stats.armor[drag.fromSlot] = null;
                spawnDroppedPickup(type);
            }
            return;
        }
        if (drag.fromAttachmentBox) {
            if (isMagazineItem(drag.itemId)) {
                setEquippedMag(stats, drag.weaponId, null);
                spawnDroppedPickup({ itemId: drag.itemId, count: 1, rounds: drag.magRounds ?? 0, maxRounds: drag.magMaxRounds ?? getMagazineCapacity(drag.itemId) });
            } else {
                ensureWeaponSlotModsShape(stats);
                if (stats.weaponSlotMods[drag.slotId]) stats.weaponSlotMods[drag.slotId][drag.slotName] = null;
                spawnDroppedPickup({ itemId: drag.itemId, count: 1 });
            }
            return;
        }
        if (drag.fromSecureContainerSlot && ctx.isHideout() && scene.addEquippedSecureContainerToStash) {
            scene.addEquippedSecureContainerToStash();
            return;
        }
        if (drag.fromMedBagSlot && ctx.isHideout() && scene.addEquippedMedBagToStash) {
            scene.addEquippedMedBagToStash();
            return;
        }
        if (drag.fromBackpackSlot) {
            const itemId = (stats.equippedBackpack && stats.equippedBackpack.itemId) || 'backpack_default';
            const type = { itemId, count: 1 };
            if (stats.backpack) {
                type.innerGrid = JSON.parse(JSON.stringify(stats.backpack));
            }
            if (!stats.backpackInventories) stats.backpackInventories = {};
            stats.equippedBackpack = null;
            stats.backpack = getDefaultBackpack();
            ensureGridItems(stats.backpack);
            stats.backpack.gridW = 6;
            stats.backpack.gridH = 9;
            spawnDroppedPickup(type);
            return;
        }
        if (drag.fromPocket) {
            ensurePockets(stats);
            const pockets = stats.pockets;
            const slot = pockets[drag.pocketIndex] && pockets[drag.pocketIndex][drag.slotIndex];
            if (!slot || !slot.itemId) { rerender(); return; }
            const type = { itemId: slot.itemId, count: slot.count || 1 };
            const dropDefDur = getDefaultDurability(slot.itemId);
            if (dropDefDur && (slot.durability != null || slot.maxDurability != null)) {
                type.durability = slot.durability != null ? slot.durability : dropDefDur.durability;
                type.maxDurability = slot.maxDurability != null ? slot.maxDurability : dropDefDur.maxDurability;
            }
            if (slot.rounds != null || slot.maxRounds != null) { type.rounds = slot.rounds ?? 0; type.maxRounds = slot.maxRounds ?? getMagazineCapacity(slot.itemId); }
            pockets[drag.pocketIndex][drag.slotIndex] = null;
            if (slot.sizeW === 2 && slot.sizeH === 1 && pockets[drag.pocketIndex][1] && pockets[drag.pocketIndex][1]._spansFrom === 0)
                pockets[drag.pocketIndex][1] = null;
            spawnDroppedPickup(type);
            return;
        }
        const removed = removeFromDragSource(drag);
        if (!removed) return;
        const itemId = removed.itemId, count = removed.count || 1;
        const type = { itemId, count };
        const dropDefDur = getDefaultDurability(itemId);
        if (dropDefDur && (removed.durability != null || removed.maxDurability != null)) {
            type.durability = removed.durability != null ? removed.durability : dropDefDur.durability;
            type.maxDurability = removed.maxDurability != null ? removed.maxDurability : dropDefDur.maxDurability;
        }
        if (removed.rounds != null || removed.maxRounds != null) { type.rounds = removed.rounds ?? 0; type.maxRounds = removed.maxRounds ?? getMagazineCapacity(itemId); }
        if (itemId === 'ammo_box' && drag.container === 'backpack') {
            const invMap = stats.ammoBoxInventories || scene.stats.ammoBoxInventories;
            if (invMap) {
                const key = 'backpack_' + drag.placementId;
                if (invMap[key]) {
                    type.innerGrid = JSON.parse(JSON.stringify(invMap[key]));
                    delete invMap[key];
                }
            }
        } else if (itemId === 'rig' && drag.container === 'backpack') {
            const rigInvMap = stats.rigInventories || scene.stats.rigInventories;
            if (rigInvMap) {
                const key = 'backpack_' + drag.placementId;
                if (rigInvMap[key]) {
                    type.innerGrid = JSON.parse(JSON.stringify(rigInvMap[key]));
                    delete rigInvMap[key];
                }
            }
        }
        spawnDroppedPickup(type);
    };
    scene.input.on('pointermove', onPointerMove);
    scene.input.on('pointerdown', onPointerDown);
    scene.input.on('pointerup', onPointerUp);
    const delKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DELETE);
    const onDeleteKey = () => {
        if (scene.invDragging) {
            const dragCopy = JSON.parse(JSON.stringify(scene.invDragging));
            destroyGhost();
            scene.invDragging = null;
            doDeleteFromInventory(dragCopy);
            rerender();
            return;
        }
        if (scene.stashDragging && scene.stashDragging.fromStash) {
            const placementId = scene.stashDragging.placementId;
            if (scene._clearStashDrag) scene._clearStashDrag();
            const st = scene.persistent.stash;
            const item = removeItem(st, placementId);
            if (item) {
                if (item.itemId === 'ammo_box' && scene.persistent.ammoBoxInventories) delete scene.persistent.ammoBoxInventories['stash_' + placementId];
                if (item.itemId === 'rig' && scene.persistent.rigInventories) delete scene.persistent.rigInventories['stash_' + placementId];
                if (item.itemId === 'backpack_default' && scene.persistent.backpackInventories) { const k = 'stash_' + placementId; if (scene.persistent.backpackInventories[k]) delete scene.persistent.backpackInventories[k]; }
                if (item.itemId === 'secure_container_default' && scene.persistent.secureContainerInventories) { const k = 'stash_' + placementId; if (scene.persistent.secureContainerInventories[k]) delete scene.persistent.secureContainerInventories[k]; }
                if (item.itemId === 'med_bag_default' && scene.persistent.medBagInventories) { const k = 'stash_' + placementId; if (scene.persistent.medBagInventories[k]) delete scene.persistent.medBagInventories[k]; }
                savePersistent(scene.persistent);
            }
            if (scene._rerenderCharacterTab) scene._rerenderCharacterTab();
            return;
        }
        doDropFromInventory();
    };
    delKey.on('down', onDeleteKey);
    const rotateDrag = () => {
        const d = scene.invDragging;
        if (!d || !scene.invGhostRect) return;
        if (d.fromPocket || d.fromSlot || d.fromWeaponSlot || d.fromBackpackSlot) return;
        if (d.fromAttachmentBox && !isMagazineItem(d.itemId)) return;
        const w = d.sizeW || 1, h = d.sizeH || 1;
        if (w === h) return;
        d.rotated = !d.rotated;
        const stepUsed = d.fromAttachmentBox ? step : (d.fromRig ? rigCellSize : (d.fromSecureContainer ? secureCellSize : (d.fromMedBag ? medBagCellSize : step)));
        const gw = (d.rotated ? h : w) * stepUsed - 2, gh = (d.rotated ? w : h) * stepUsed - 2;
        scene.invGhostRect.setSize(gw, gh);
        sfx.click();
    };
    const rKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    rKey.on('down', rotateDrag);
    const onUKey = () => {
        const st = scene._invStats != null ? scene._invStats : scene.stats;
        const persistent = scene.persistent;
        const isStashContext = ctx.isHideout();
        if (scene.stashDragging && isMagazineItem(scene.stashDragging.itemId)) {
            const magRef = { fromStash: true, placementId: scene.stashDragging.placementId, itemId: scene.stashDragging.itemId };
            if (unloadMagazineToStack(st, persistent, magRef, true)) {
                sfx.click();
                if (scene._clearStashDrag) scene._clearStashDrag();
                scene.stashDragging = null;
                savePersistent(scene.persistent);
                rerender();
            }
            return;
        }
        if (scene.invDragging && isMagazineItem(scene.invDragging.itemId)) {
            const d = scene.invDragging;
            const magRef = { itemId: d.itemId };
            if (d.fromAttachmentBox && d.weaponId) {
                magRef.fromAttachmentBox = true;
                magRef.weaponId = d.weaponId;
            } else if (d.fromPocket) {
                magRef.fromPocket = true;
                magRef.pocketIndex = d.pocketIndex;
                magRef.slotIndex = d.slotIndex;
            } else if (d.fromRig && d.placementId) {
                magRef.fromRig = true;
                magRef.placementId = d.placementId;
            } else if (d.container === 'backpack' && d.placementId) {
                magRef.container = 'backpack';
                magRef.placementId = d.placementId;
            }
            if (unloadMagazineToStack(st, persistent, magRef, isStashContext)) {
                sfx.click();
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(st));
                if (isStashContext && persistent) savePersistent(persistent);
                rerender();
            }
            return;
        }
        if (scene.invSelectedMag) {
            if (unloadMagazineToStack(st, persistent, scene.invSelectedMag, isStashContext)) {
                sfx.click();
                scene.invSelectedMag = null;
                localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(st));
                if (isStashContext && persistent) savePersistent(persistent);
                rerender();
            }
            return;
        }
        if (scene.stashSelectedMag) {
            if (unloadMagazineToStack(st, persistent, scene.stashSelectedMag, true)) {
                sfx.click();
                scene.stashSelectedMag = null;
                savePersistent(scene.persistent);
                rerender();
            }
        }
    };
    const uKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.U);
    uKey.on('down', onUKey);
    scene.invListeners = { move: onPointerMove, down: onPointerDown, up: onPointerUp, delKey, delKeyCallback: onDeleteKey, rKey, rKeyCallback: rotateDrag, uKey, uKeyCallback: onUKey };
}

export default renderInventoryPanel;
