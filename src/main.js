import Phaser from 'phaser';

// Legacy game.js expects a global Phaser (was CDN script tag).
window.Phaser = Phaser;

import('./game.js').catch((err) => {
  console.error('Failed to load game.js', err);
});
