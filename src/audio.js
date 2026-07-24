import { loadSettings, saveSettings } from './persistence.js';

class SoundManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.settings = loadSettings();
        
        // Create gain nodes for volume control
        this.masterGain = this.ctx.createGain();
        this.sfxGain = this.ctx.createGain();
        this.musicGain = this.ctx.createGain();
        
        // Connect gain chain
        this.sfxGain.connect(this.masterGain);
        this.musicGain.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);
        
        this.updateVolumes();
        
        // Footstep timing
        this.lastFootstep = 0;
        this.footstepInterval = 250; // ms between footsteps
    }
    
    updateVolumes() {
        this.masterGain.gain.value = this.settings.masterVolume;
        this.sfxGain.gain.value = this.settings.sfxVolume;
        this.musicGain.gain.value = this.settings.musicVolume;
    }
    
    setMasterVolume(vol) {
        this.settings.masterVolume = vol;
        this.updateVolumes();
        saveSettings(this.settings);
    }
    
    setSfxVolume(vol) {
        this.settings.sfxVolume = vol;
        this.updateVolumes();
        saveSettings(this.settings);
    }
    
    setMusicVolume(vol) {
        this.settings.musicVolume = vol;
        this.updateVolumes();
        saveSettings(this.settings);
    }
    
    reloadSettings() {
        this.settings = loadSettings();
        this.updateVolumes();
    }

    resume() { if (this.ctx.state === 'suspended') this.ctx.resume(); }

    playTone(freq, type, duration, vol = 1) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.sfxGain);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }
    
    // Pitch variation helper
    playToneVaried(freq, type, duration, vol = 1, variance = 0.1) {
        const variedFreq = freq * (1 + (Math.random() - 0.5) * variance * 2);
        this.playTone(variedFreq, type, duration, vol);
    }

    playNoise(duration, vol = 1) {
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        noise.connect(gain);
        gain.connect(this.sfxGain);
        noise.start();
    }
    
    // Filtered noise for variety
    playFilteredNoise(duration, vol = 1, filterFreq = 1000, filterType = 'lowpass') {
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = this.ctx.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.value = filterFreq;
        
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);
        noise.start();
    }

    // ==================== WEAPON SOUNDS (with variation) ====================
    shootPistol() { 
        this.playToneVaried(600, 'sawtooth', 0.1, 0.5, 0.1); 
        this.playNoise(0.1, 0.3); 
    }
    
    shootShotgun() { 
        this.playToneVaried(200, 'square', 0.3, 0.6, 0.05); 
        this.playNoise(0.3, 0.6); 
        this.playTone(100, 'sawtooth', 0.15, 0.3); // Extra bass
    }
    
    shootSMG() { 
        this.playToneVaried(800, 'sawtooth', 0.05, 0.4, 0.15); 
        this.playNoise(0.05, 0.2); 
    }
    
    // Crossbow - quiet twang
    shootCrossbow() {
        this.playToneVaried(300, 'triangle', 0.15, 0.2, 0.1);
        this.playToneVaried(150, 'sine', 0.1, 0.15, 0.1);
    }
    
    // Assault Rifle - medium crack
    shootRifle() {
        this.playToneVaried(400, 'sawtooth', 0.15, 0.5, 0.08);
        this.playNoise(0.15, 0.4);
        this.playTone(150, 'square', 0.1, 0.25);
    }
    
    // ==================== EXPLODER SOUNDS ====================
    exploderWarning() {
        // Ticking/bubbling sound as it charges
        this.playTone(200, 'sine', 0.1, 0.2);
        this.playTone(250, 'sine', 0.08, 0.15);
    }
    
    exploderExplode() {
        // Meaty explosion
        this.playTone(80, 'sawtooth', 0.4, 0.7);
        this.playNoise(0.35, 0.6);
        this.playTone(40, 'square', 0.3, 0.4);
    }
    
    // ==================== STEALTH SOUNDS ====================
    detectionPing() {
        // Soft ping when detection rises
        this.playTone(600, 'sine', 0.1, 0.2);
    }
    
    detectionMax() {
        // Alarm sound when fully detected
        this.playTone(800, 'square', 0.3, 0.5);
        this.playTone(600, 'square', 0.2, 0.4);
        this.playTone(800, 'square', 0.3, 0.5);
    }
    
    stealthKill() {
        // Satisfying quiet kill
        this.playTone(100, 'triangle', 0.15, 0.3);
        this.playFilteredNoise(0.1, 0.2, 800, 'lowpass');
    }
    
    // ==================== NECROMANCER SOUNDS ====================
    necroSummon() {
        // Ethereal chanting
        this.playTone(150, 'sine', 0.5, 0.3);
        this.playTone(200, 'sine', 0.4, 0.25);
        this.playTone(175, 'triangle', 0.3, 0.2);
    }
    
    necroVulnerable() {
        // Shield break sound
        this.playTone(400, 'sawtooth', 0.2, 0.4);
        this.playNoise(0.15, 0.3);
        this.playTone(200, 'square', 0.3, 0.3);
    }
    
    necroTeleport() {
        // Whoosh
        this.playFilteredNoise(0.2, 0.3, 2000, 'highpass');
        this.playTone(500, 'sine', 0.15, 0.2);
    }
    
    necroProjectile() {
        // Ghostly whistle
        this.playTone(600, 'sine', 0.2, 0.25);
        this.playTone(650, 'sine', 0.15, 0.2);
    }
    
    necroDeath() {
        // Dramatic echo fade
        this.playTone(200, 'sawtooth', 0.5, 0.5);
        this.playTone(150, 'sawtooth', 0.6, 0.4);
        this.playTone(100, 'sawtooth', 0.7, 0.3);
        this.playFilteredNoise(0.4, 0.4, 500, 'lowpass');
    }
    
    // ==================== HIT/DAMAGE SOUNDS ====================
    enemyHit() { 
        const pitch = 80 + Math.random() * 40;
        this.playTone(pitch, 'sawtooth', 0.1, 0.5); 
    }
    
    enemyDeath() {
        this.playTone(60, 'sawtooth', 0.2, 0.4);
        this.playFilteredNoise(0.3, 0.3, 500, 'lowpass');
    }
    
    playerHurt() { 
        this.playTone(50, 'sawtooth', 0.3, 0.8);
        this.playTone(70, 'square', 0.2, 0.4);
    }
    
    playerDeath() {
        this.playTone(40, 'sawtooth', 0.5, 0.6);
        this.playTone(30, 'square', 0.6, 0.4);
        this.playFilteredNoise(0.4, 0.5, 300, 'lowpass');
    }
    
    // ==================== UI SOUNDS ====================
    click() { 
        this.playTone(800, 'sine', 0.05, 0.3); 
    }
    
    menuOpen() {
        this.playTone(600, 'sine', 0.08, 0.2);
        this.playTone(800, 'sine', 0.08, 0.15);
    }
    
    menuClose() {
        this.playTone(800, 'sine', 0.08, 0.2);
        this.playTone(600, 'sine', 0.08, 0.15);
    }
    
    error() {
        this.playTone(200, 'square', 0.1, 0.4);
        this.playTone(150, 'square', 0.15, 0.3);
    }
    
    success() {
        this.playTone(800, 'sine', 0.1, 0.3);
        this.playTone(1000, 'sine', 0.1, 0.25);
        this.playTone(1200, 'sine', 0.15, 0.2);
    }
    
    // ==================== PICKUP SOUNDS ====================
    loot() { 
        this.playTone(1200, 'square', 0.1, 0.2); 
        this.playTone(1600, 'square', 0.1, 0.2); 
    }
    
    lootHealth() {
        this.playTone(600, 'sine', 0.1, 0.3);
        this.playTone(800, 'sine', 0.15, 0.25);
        this.playTone(1000, 'sine', 0.1, 0.2);
    }
    
    lootAmmo() {
        this.playTone(400, 'triangle', 0.08, 0.3);
        this.playFilteredNoise(0.1, 0.2, 2000, 'highpass');
    }
    
    lootWeapon() {
        this.playTone(500, 'square', 0.1, 0.3);
        this.playTone(700, 'square', 0.1, 0.25);
        this.playTone(900, 'square', 0.15, 0.3);
        this.playNoise(0.1, 0.2);
    }
    
    lootKey() {
        this.playTone(1000, 'sine', 0.15, 0.3);
        this.playTone(1500, 'sine', 0.2, 0.25);
        this.playTone(2000, 'sine', 0.1, 0.2);
    }
    
    // ==================== EQUIPMENT SOUNDS ====================
    toggleNVG() { 
        this.playTone(2000, 'sine', 0.2, 0.1); 
        this.playFilteredNoise(0.1, 0.1, 4000, 'highpass');
    }
    
    reload() {
        // Mag-out click
        this.playTone(280, 'triangle', 0.08, 0.35);
        this.playFilteredNoise(0.06, 0.18, 1200, 'lowpass');
    }

    reloadFinish() {
        // Mag-in + rack
        this.playTone(520, 'triangle', 0.07, 0.4);
        this.playFilteredNoise(0.05, 0.12, 1800, 'highpass');
        setTimeout(() => {
            this.playTone(700, 'square', 0.04, 0.25);
            this.playFilteredNoise(0.04, 0.15, 2500, 'highpass');
        }, 70);
    }

    weaponSwap() {
        this.playTone(350, 'triangle', 0.06, 0.3);
        this.playTone(220, 'sine', 0.05, 0.2);
        this.playFilteredNoise(0.04, 0.12, 900, 'lowpass');
    }

    heartbeat() {
        this.playTone(70, 'sine', 0.09, 0.28);
        setTimeout(() => this.playTone(55, 'sine', 0.08, 0.22), 130);
    }

    limpFootstep() {
        const pitch = 70 + Math.random() * 30;
        this.playFilteredNoise(0.07, 0.18, pitch * 8, 'lowpass');
        this.playTone(pitch, 'sine', 0.04, 0.12);
    }

    infectionWarn() {
        this.playTone(180, 'sawtooth', 0.12, 0.2);
        this.playTone(140, 'sine', 0.15, 0.25);
    }
    
    // ==================== MOVEMENT SOUNDS ====================
    dodge() { 
        this.playNoise(0.15, 0.3); 
        this.playTone(300, 'sine', 0.1, 0.2); 
    }
    
    footstep(time, isRunning = false) {
        if (time - this.lastFootstep < this.footstepInterval / (isRunning ? 1.5 : 1)) return;
        this.lastFootstep = time;
        
        const vol = isRunning ? 0.15 : 0.1;
        const pitch = 100 + Math.random() * 50;
        this.playFilteredNoise(0.05, vol, pitch * 10, 'lowpass');
    }
    
    // ==================== COMBAT SOUNDS ====================
    empty() { 
        this.playTone(200, 'square', 0.05, 0.3); 
    }
    
    melee() {
        this.playNoise(0.1, 0.4);
        this.playTone(250, 'sawtooth', 0.08, 0.3);
    }
    
    spit() { 
        this.playTone(150, 'sawtooth', 0.2, 0.4); 
        this.playNoise(0.15, 0.2); 
    }
    
    grenadeThrow() { 
        this.playTone(400, 'sine', 0.1, 0.3); 
        this.playNoise(0.08, 0.15);
    }
    
    explosion() { 
        this.playNoise(0.4, 0.8); 
        this.playTone(60, 'square', 0.3, 0.6); 
        this.playTone(40, 'sawtooth', 0.4, 0.5); 
        this.playFilteredNoise(0.5, 0.4, 200, 'lowpass');
    }
    
    // ==================== ENEMY SOUNDS ====================
    zombieGrowl() {
        const pitch = 80 + Math.random() * 40;
        this.playTone(pitch, 'sawtooth', 0.3, 0.2);
        this.playFilteredNoise(0.2, 0.15, 300, 'lowpass');
    }
    
    leaperPrepare() {
        this.playTone(200, 'sawtooth', 0.2, 0.3);
        this.playTone(300, 'square', 0.15, 0.2);
    }
    
    leaperLeap() {
        this.playTone(400, 'sawtooth', 0.15, 0.4);
        this.playNoise(0.2, 0.3);
    }
    
    banditShout() {
        this.playTone(150, 'square', 0.2, 0.25);
        this.playFilteredNoise(0.15, 0.2, 800, 'bandpass');
    }
    
    bossRoar() {
        this.playTone(50, 'sawtooth', 0.5, 0.5);
        this.playTone(70, 'square', 0.4, 0.4);
        this.playFilteredNoise(0.5, 0.4, 200, 'lowpass');
    }
    
    // ==================== LEVEL SOUNDS ====================
    levelStart() {
        this.playTone(400, 'sine', 0.2, 0.25);
        this.playTone(600, 'sine', 0.2, 0.2);
        this.playTone(800, 'sine', 0.3, 0.15);
    }
    
    levelComplete() {
        this.playTone(600, 'sine', 0.15, 0.3);
        this.playTone(800, 'sine', 0.15, 0.25);
        this.playTone(1000, 'sine', 0.15, 0.2);
        this.playTone(1200, 'sine', 0.3, 0.25);
    }
    
    extractionStart() {
        this.playTone(800, 'square', 0.3, 0.3);
        this.playTone(1000, 'square', 0.3, 0.25);
    }
    
    extractionTick() {
        this.playTone(600, 'sine', 0.1, 0.2);
    }
    
    achievement() {
        this.playTone(800, 'sine', 0.1, 0.3);
        this.playTone(1000, 'sine', 0.1, 0.25);
        this.playTone(1200, 'sine', 0.1, 0.2);
        this.playTone(1600, 'sine', 0.2, 0.3);
    }
    
    // ==================== DOOR/INTERACT SOUNDS ====================
    doorOpen() {
        this.playFilteredNoise(0.3, 0.3, 500, 'lowpass');
        this.playTone(200, 'triangle', 0.2, 0.2);
    }
    
    crateShuffle() {
        this.playFilteredNoise(0.15, 0.2, 400, 'lowpass');
        this.playTone(150, 'sawtooth', 0.08, 0.15);
        this.playTone(200, 'sawtooth', 0.06, 0.12);
    }
    crateOpen() {
        this.playFilteredNoise(0.2, 0.25, 800, 'lowpass');
        this.playTone(300, 'triangle', 0.15, 0.2);
    }
    
    // ==================== TRADER SOUNDS ====================
    purchase() {
        this.playTone(800, 'sine', 0.1, 0.3);
        this.playTone(1000, 'sine', 0.15, 0.25);
        this.playTone(1200, 'sine', 0.1, 0.2);
    }
    
    sell() {
        this.playTone(600, 'sine', 0.1, 0.25);
        this.playTone(400, 'sine', 0.1, 0.2);
        this.playFilteredNoise(0.1, 0.15, 1000, 'highpass');
    }
    
    useConsumable() {
        this.playTone(1200, 'sine', 0.1, 0.3);
        this.playTone(1400, 'sine', 0.08, 0.25);
        this.playNoise(0.05, 0.15);
    }
}

const sfx = new SoundManager();

export { SoundManager, sfx };
