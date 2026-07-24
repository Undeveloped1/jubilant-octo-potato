import { CONFIG } from './config.js';
import { savePersistent } from './persistence.js';

/**
 * InvUI context shared by raid GameScene and Hideout CHARACTER tab.
 * Replaces the old `_invIsHideout` boolean piggyback flag.
 */

function createRaidInvCtx(scene) {
  const ctx = {
    mode: 'raid',
    get content() {
      return scene.invContent;
    },
    get stats() {
      return scene.playerStats;
    },
    get bodyView() {
      return scene.invBodyView || 'gear';
    },
    isHideout() {
      return false;
    },
    onRerender() {
      if (typeof scene.renderInventoryPanel === 'function') scene.renderInventoryPanel();
    },
    onRerenderOrDefer() {
      this.onRerender();
    },
    saveRunStats() {
      /* raid panel does not persist via SAVE_KEY on delete in this path */
    },
    savePersistentMeta() {
      /* no meta save from raid invent mag menu */
    },
    getStashBounds() {
      return null;
    },
    setContainerBounds(bounds) {
      /* raid has no stash bridge */
    },
    canUseStash() {
      return false;
    },
  };
  scene._invCtx = ctx;
  return ctx;
}

function createHideoutInvCtx(scene) {
  const ctx = {
    mode: 'hideout',
    get content() {
      return scene._invContent;
    },
    get stats() {
      return scene._invStats != null ? scene._invStats : scene.stats;
    },
    get bodyView() {
      return scene._invBodyView || 'gear';
    },
    isHideout() {
      return true;
    },
    onRerender() {
      if (scene.currentTab === 'character' && typeof scene._rerenderCharacterTab === 'function') {
        scene._rerenderCharacterTab();
      } else if (typeof scene.renderInventoryPanel === 'function') {
        scene.renderInventoryPanel();
      }
    },
    onRerenderOrDefer() {
      if (scene.currentTab === 'character' && typeof scene._rerenderCharacterTab === 'function') {
        scene.time.delayedCall(0, () => this.onRerender());
      } else {
        this.onRerender();
      }
    },
    saveRunStats() {
      if (scene.stats) {
        localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(scene.stats));
      }
    },
    savePersistentMeta() {
      if (scene.persistent) savePersistent(scene.persistent);
    },
    getStashBounds() {
      return scene._hideoutStashBounds || null;
    },
    setContainerBounds(bounds) {
      scene._hideoutContainerBounds = bounds;
    },
    canUseStash() {
      return true;
    },
  };
  scene._invCtx = ctx;
  return ctx;
}

/** Ensure scene has an InvUI context; default to raid. */
function ensureInvCtx(scene) {
  if (scene._invCtx) return scene._invCtx;
  return createRaidInvCtx(scene);
}

export {
  createRaidInvCtx,
  createHideoutInvCtx,
  ensureInvCtx,
};
