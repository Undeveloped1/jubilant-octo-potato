// Extracted from game.js — CONFIG and limb/damage tables
// =============================================================================
// CONFIGURATION - All magic numbers centralized here       
// =============================================================================
const CONFIG = {
    // Save system
    SAVE_KEY: 'zombie_save_v17',
    SETTINGS_KEY: 'zombie_settings_v17',
    WALKER_AI_TEST_MODE: false,  // true = only walker/leaper/bandit (for AI testing); false = use level pools (spitter, exploder, etc.)
    
    // Enemy composition per level (predefined count; 100/0 = walkers only for now)
    ENEMIES_PER_LEVEL: { 1: 5, 2: 4, 3: 5, 4: 5, 5: 12, 6: 6, 7: 10 },
    ZOMBIE_PCT: 100,
    BANDIT_PCT: 0,
    WALKERS_ONLY_SPAWN: false,
    SPAWN_MIN_DISTANCE: 100,
    // Enemies wander in from off-screen over time
    EDGE_SPAWN_ENABLED: true,
    EDGE_SPAWN_INTERVAL_MS: 20000,
    
    // Player settings
    PLAYER: {
        WALK_SPEED: 160,
        SPRINT_SPEED: 280,
        STAMINA_DRAIN: 0.5,
        STAMINA_REGEN: 0.2,
        INVULN_TIME: 1000,
        ENEMY_MELEE_HIT_COOLDOWN_MS: 700,
        MELEE_COOLDOWN: 500,
        MELEE_RANGE: 60,
        MELEE_DAMAGE: 2,
        LIGHT_RADIUS: 60,
        FLASHLIGHT_RANGE: 300,
        FLASHLIGHT_ANGLE: 0.5,
        // Dodge roll settings
        DODGE_SPEED: 400,
        DODGE_DURATION: 200,
        DODGE_COOLDOWN: 800,
        DODGE_STAMINA_COST: 20,
        // Crouch: slow movement, no footstep noise (leapers won't detect you)
        CROUCH_SPEED: 70,
        // Low HP threshold for vignette
        LOW_HP_THRESHOLD: 0.4
    },

    // Phase 5 — combat juice (feel)
    JUICE: {
        HITSTOP_MS: 45,
        CORPSE_LINGER_MS: 3500,
        CORPSE_FADE_MS: 450,
        FLINCH_SPEED: 90,
        HEARTBEAT_INTERVAL_MS: 750,
        SHAKE: {
            pistol:   { duration: 70,  intensity: 0.004 },
            smg:      { duration: 40,  intensity: 0.0025 },
            shotgun:  { duration: 120, intensity: 0.012 },
            rifle:    { duration: 85,  intensity: 0.007 },
            crossbow: { duration: 50,  intensity: 0.003 }
        }
    },

    // Phase 6 — make limb sim visible / felt
    LIMB_VIS: {
        LIMP_ORIGIN_AMP: 0.1,
        LIMP_BOB_HZ: 5,
        ARM_SWAY_AMP: 0.1,
        ARM_SWAY_HZ: 2.2,
        BLEED_DROP_INTERVAL_MS: 200,
        HUD_FLASH_MS: 380,
        BLOOD_MAX: 100,
        BLOOD_DRAIN_MINOR: 1,
        BLOOD_DRAIN_MAJOR: 2,
        BLOOD_REGEN_PER_SEC: 3,
        INFECTION_FILL_MS: 90000,
        INFECTION_SOURCES: ['walker', 'leaper', 'spitter', 'exploder', 'boss', 'necromancer']
    },

    BLEED: {
        MINOR_INTERVAL_MS: 3000,
        MINOR_DAMAGE: 1,
        MAJOR_INTERVAL_MS: 1500,
        MAJOR_DAMAGE: 1
    },
    
    // Weapon settings
    WEAPONS: {
        PISTOL: {
            FIRE_RATE: 300,
            AMMO_COST: 1,
            SPREAD: 0,
            MAG_SIZE: 12,
            RELOAD_TIME: 1000
        },
        SHOTGUN: {
            FIRE_RATE: 1000,
            AMMO_COST: 1,
            PELLETS: 3,
            SPREAD_STEP: 10,
            MAG_SIZE: 6,
            RELOAD_TIME: 1500
        },
        SMG: {
            FIRE_RATE: 100,
            AMMO_COST: 1,
            SPREAD: 8,
            MAG_SIZE: 30,
            RELOAD_TIME: 1800
        },
        CROSSBOW: {
            FIRE_RATE: 1500,      // Slow reload between shots
            AMMO_COST: 1,
            DAMAGE: 3,            // High damage (one-shots walkers)
            MAG_SIZE: 1,          // Single bolt
            RELOAD_TIME: 2000,
            PIERCING: true,       // Passes through first target
            SILENT: true          // Doesn't alert nearby enemies
        },
        RIFLE: {
            FIRE_RATE: 200,       // Medium rate
            AMMO_COST: 1,
            DAMAGE: 1.5,          // Slightly higher than pistol
            SPREAD: 3,            // Tight spread
            MAG_SIZE: 25,
            RELOAD_TIME: 1500,
            FIRST_SHOT_BONUS: true // Extra accuracy when stationary
        },
        BULLET_SPEED: 500,
        MAX_PIERCE_ENEMIES: 2   // Piercing bullets (e.g. crossbow) can hit this many enemies before stopping
    },

    // Per-weapon ammo types (Phase A — ammo types & magazines plan)
    AMMO_TYPES: {
        crossbow: { ammoId: 'ammo_bolts',  label: 'Bolts',  color: '#c0c0c0' },
        shotgun:  { ammoId: 'ammo_shells', label: 'Shells', color: '#00aa00' },
        pistol:   { ammoId: 'ammo_9mm',    label: '9mm',    color: '#b87333' },
        smg:      { ammoId: 'ammo_45',     label: '.45 cal', color: '#cd9b1d' },
        rifle:    { ammoId: 'ammo_556',    label: '5.56',   color: '#8800aa' }
    },

    // Physical magazines (weapon → mag item; capacity and ammo type for filling)
    MAGAZINES: {
        mag_pistol: { weapon: 'pistol', capacity: 17, ammoId: 'ammo_9mm' },
        mag_smg:    { weapon: 'smg',    capacity: 30, ammoId: 'ammo_45' },
        mag_rifle:  { weapon: 'rifle',  capacity: 30, ammoId: 'ammo_556' }
    },
    
    // Enemy configurations
    ENEMIES: {
        WALKER: {
            HP: 2,
            SPEED: 30,           // 50% of original 60 for roomba-style patrol
            DAMAGE: 2,
            AGGRO_RANGE: 300,
            PERCEPTION_RADIUS: 280,
            VISION_ANGLE: (Math.PI / 3) * 0.4,
            HUNT_SPEED_MULTIPLIER: 2.366,
            HEARING_RADIUS: 626,
            CLOSE_AGGRO_RADIUS: 80,
            CLOSE_AGGRO_CHANCE_FIRST: 0.8,
            CLOSE_AGGRO_CHANCE_FLOOR: 0.5,
            CLOSE_AGGRO_CHANCE_DECAY: 0.05,
            CLOSE_AGGRO_ROLL_INTERVAL_MS: 2000,
            SOUND_RADIUS: 180,
            GUNSHOT_ALERT_DURATION: 3000,
            SEARCH_RADIUS: 80,
            SEARCH_DURATION: 4000,
            PATROL_SPEED: 20,
            STUCK_TIME_MS: 400,
            TURN_INCREMENT: (15 * Math.PI) / 180,
            GO_AROUND_STUCK_TIME_MS: 350,
            GO_AROUND_DURATION_MS: 700,
            GO_AROUND_DISTANCE_MULTIPLIER: 1.15,
            TEXTURE: 'zombie'
        },
        LEAPER: {
            HP: 1,
            SPEED: 150,
            DAMAGE: 2,
            LEAP_RANGE: 180,
            LEAP_SPEED: 900,
            PREPARE_TIME: 50,
            LEAP_DURATION: 600,
            COOLDOWN_TIME: 1500,
            KNOCKBACK_SPEED: 250,
            PLAYER_BREAKFREE_KNOCKBACK_MULTIPLIER: 1.5,
            PLAYER_BREAKFREE_COOLDOWN_MS: 8000,
            PLAYER_BREAKFREE_STUN_MS: 3000,
            TEXTURE: 'leaper_idle_0',
            HEARING_RADIUS: 626,
            SOUND_RADIUS: 180,
            GUNSHOT_ALERT_DURATION: 3000,
            PIN_DAMAGE_INTERVAL_MS: 1000,
            PIN_DAMAGE_FIRST_PCT: 0.1,
            PIN_DAMAGE_FIRST_HITS: 3,
            PIN_DAMAGE_AFTER_PCT: 0.2,
            LEAP_TRIGGER_RADIUS: 180,
            LOSE_PLAYER_MS: 3000,
            PATROL_SPEED: 58,
            WANDER_CHANGE_MS: 2800,
            BANDIT_PIN_HIT_RADIUS: 55   // Distance at which leaper can pin a bandit on impact
        },
        BANDIT: {
            HP: 3,
            SPEED: 90,
            DAMAGE: 1,
            AMMO: 10,
            CAN_SHOOT: true,
            FIRE_RANGE: 350,
            FIRE_RATE: 2000,
            MELEE_SPEED: 120,
            SPREAD: 5,
            TEXTURE: 'bandit',
            PERCEPTION_RADIUS: 160,
            VISION_ANGLE: (Math.PI / 3) * 0.4,
            HEARING_RADIUS: 250,
            SOUND_RADIUS: 100,
            GUNSHOT_ALERT_DURATION: 3000,
            SEARCH_RADIUS: 100,
            SEARCH_DURATION: 4000,
            PATROL_SPEED: 35,
            HUNT_SPEED_MULTIPLIER: 1.2,
            CLOSE_AGGRO_RADIUS: 100,
            CLOSE_AGGRO_CHANCE_FIRST: 0.8,
            CLOSE_AGGRO_CHANCE_FLOOR: 0.5,
            CLOSE_AGGRO_CHANCE_DECAY: 0.05,
            CLOSE_AGGRO_ROLL_INTERVAL_MS: 2000,
            GO_AROUND_STUCK_TIME_MS: 350,
            GO_AROUND_DURATION_MS: 700,
            GO_AROUND_DISTANCE_MULTIPLIER: 1.15
        },
        BOSS: {
            HP: 5,
            SPEED: 85,
            DAMAGE: 10,
            SCALE: 2,
            INVULN_TIME: 500,
            TEXTURE: 'boss'
        },
        SPITTER: {
            HP: 2,
            SPEED: 50,
            DAMAGE: 1,
            SPIT_RANGE: 280,
            SPIT_COOLDOWN: 2500,
            SPIT_SPEED: 200,
            TEXTURE: 'spitter'
        },
        EXPLODER: {
            HP: 2,
            SPEED: 100,           // Fast
            DAMAGE: 3,            // Explosion damage to player
            EXPLOSION_RADIUS: 80,
            ENEMY_DAMAGE: 5,      // Damage to other enemies (chain reactions!)
            TEXTURE: 'zombie'     // Reuse zombie texture with orange tint
        },
        NECROMANCER: {
            HP: 8,
            SPEED: 60,
            DAMAGE: 2,
            SUMMON_COUNT: 4,        // Zombies per summon
            MINION_LEASH_RADIUS: 220, // Minions stay within this distance of the boss
            VULNERABLE_TIME: 10000, // 10 sec window
            PROJECTILE_SPEED: 150,
            PROJECTILE_DAMAGE: 2,
            TELEPORT_COOLDOWN: 5000,
            TEXTURE: 'necromancer'
        },
        KNOCKBACK_SPEED: 100
    },
    
    // Grenade settings
    GRENADE: {
        THROW_SPEED: 350,
        FUSE_TIME: 1500,
        EXPLOSION_RADIUS: 100,
        DAMAGE: 5,
        MAX_CARRY: 3
    },
    
    // Interaction distances
    DISTANCES: {
        INTERACT: 60,
        DEBRIS: 80,
        DOOR: 60
    },
    
    // Timings (in ms)
    TIMINGS: {
        CRATE_OPEN: 1000,
        BODY_SEARCH: 500,
        DEBRIS_BURN: 5000,
        EXTRACTION: 15000,
        DEATH_RESTART: 5000,
        LEVEL_TRANSITION: 1000,
        NVG_CRAFT: 90000,
        /** Raid countdown shown as big HUD clock (ms). Turns red at ≤ RAID_TIMER_WARN_MS. */
        RAID_LIMIT_MS: 8 * 60 * 1000,
        RAID_TIMER_WARN_MS: 60 * 1000
    },
    
    // UI settings
    UI: {
        HP_BAR_WIDTH: 200,
        HP_BAR_HEIGHT: 20,
        STAMINA_BAR_WIDTH: 150,
        STAMINA_BAR_HEIGHT: 10,
        ICON_RADIUS: 12,
        ICON_SPACING: 30,
        // Hit direction indicator settings
        HIT_INDICATOR_DURATION: 500,
        HIT_INDICATOR_SIZE: 60,
        HIT_INDICATOR_DISTANCE: 80,
        DAMAGE_LOG_MAX_ENTRIES: 12   // Combat log (backtick toggle) entry cap
    },
    
    // Loot tables (enemy kill drops use CONFIG.ENEMY_DROPS; level crates use LEVEL_POOLS below)
    LOOT: {
        // Single source of truth for level crate loot pools (used by procedural rooms and spawnLevelEntities)
        LEVEL_POOLS: {
            1: ['map', 'key', 'flashlight', 'shotgun', 'ammo_shells', 'ammo_shells', 'ammo_9mm', 'helmet', 'vest', 'scrap', 'cigarettes', 'mag_pistol'],
            2: ['map', 'molotov', 'shotgun', 'ammo_shells', 'ammo_9mm', 'ammo_9mm', 'scrap', 'helmet', 'headset', 'vest', 'medkit', 'bandage', 'plug', 'cigarettes', 'mag_pistol', 'mag_smg'],
            3: ['map', 'key', 'ammo_9mm', 'ammo_9mm', 'meds', 'meds', 'scrap', 'grenade', 'bandage', 'splint', 'plug', 'cigarettes', 'mag_pistol', 'mag_smg', 'antidote'],
            4: ['map', 'key', 'smg', 'ammo_45', 'ammo_45', 'ammo_45', 'grenade', 'grenade', 'meds', 'scrap', 'hemostat', 'plug', 'mag_pistol', 'mag_smg', 'antidote'],
            5: ['map', 'ammo_9mm', 'ammo_45', 'ammo_556', 'meds', 'meds', 'grenade', 'scrap', 'bandage', 'splint', 'plug', 'extended_mag', 'mag_pistol', 'mag_smg', 'mag_rifle', 'antidote'],
            6: ['map', 'key', 'rifle', 'ammo_556', 'ammo_556', 'ammo_556', 'meds', 'grenade', 'grenade', 'suppressor', 'rapid_fire', 'plug', 'trauma_kit', 'mag_rifle', 'mag_smg', 'antidote'],
            7: ['map', 'key', 'crossbow', 'ammo_bolts', 'ammo_bolts', 'meds', 'meds', 'laser_sight', 'damage_barrel', 'materials', 'trauma_kit', 'antidote']
        },
        LEVELS_NEEDING_KEY: [1, 3, 4, 6],
        MOD_RARITY_WEIGHTS: { common: 60, uncommon: 30, rare: 10 },
        // Data-driven applyLoot: weapon pickups (flag + float text)
        LOOT_WEAPON_ACTIONS: {
            // flashlight is now an attachment (grid item, equip on weapon); no longer instant-flag
            shotgun:    { flag: 'hasShotgun',    txt: 'SHOTGUN!', col: 0xff00ff },
            smg:        { flag: 'hasSMG',        txt: 'SMG!', col: 0x00ffff },
            crossbow:   { flag: 'hasCrossbow',   txt: 'CROSSBOW!', col: 0x8B4513 },
            rifle:      { flag: 'hasRifle',     txt: 'ASSAULT RIFLE!', col: 0x556B2F }
        },
        // Medical/grid items that only need sfx + "LABEL (dur/max)" + color (txt built from INVENTORY_ITEMS + getDefaultDurability)
        LOOT_MEDICAL_DISPLAY: {
            medkit: { col: 0x00ff00 }, bandage: { col: 0xcc2222 }, hemostat: { col: 0xcc2222 }, splint: { col: 0xcc2222 },
            trauma_kit: { col: 0xff8800 }, limb_breaker: { col: 0x1a1a1a }, trauma_inflict: { col: 0x1a1a1a },
            antidote: { col: 0x66ff88 }
        },
        // Canonical list of all loot IDs handled by applyLoot(); add new types here and in applyLoot switch
        VALID_IDS: ['meds', 'ammo', 'key', 'map', 'flashlight', 'molotov', 'pistol', 'shotgun', 'smg', 'crossbow', 'rifle', 'scrap', 'plug', 'helmet', 'headset', 'vest', 'medkit', 'bandage', 'hemostat', 'splint', 'trauma_kit', 'limb_breaker', 'trauma_inflict', 'antidote', 'grenade', 'materials', 'cigarettes', 'extended_mag', 'suppressor', 'laser_sight', 'damage_barrel', 'rapid_fire', 'ammo_box', 'rig', 'backpack_default', 'secure_container_default', 'med_bag_default', 'nvg', 'ammo_bolts', 'ammo_shells', 'ammo_9mm', 'ammo_45', 'ammo_556', 'mag_pistol', 'mag_smg', 'mag_rifle'],
        // Items that are not stored in backpack/stash: pickup only triggers instant effect (e.g. scrap = currency, meds = heal, molotov = key item). Flashlight is now a grid attachment.
        NON_GRID_ITEM_IDS: ['scrap', 'meds', 'molotov'],
        // Grid inventory: key, plug, flashlight (attachment) are grid items; map/scrap/meds/molotov stay instant
        INVENTORY_ITEMS: {
            key:           { id: 'key', sizeW: 1, sizeH: 1, stackMax: 1, category: 'key', label: 'Door Key', icon: 'K', color: '#ffd700' },
            plug:          { id: 'plug', sizeW: 1, sizeH: 1, stackMax: 1, category: 'consumable', label: 'Spark Plug', icon: 'Pg', color: '#00ffff' },
            meds:          { id: 'meds', sizeW: 1, sizeH: 1, stackMax: 10, category: 'consumable', label: 'Meds', icon: '+' },
            ammo:          { id: 'ammo', sizeW: 1, sizeH: 1, stackMax: 99, category: 'stackable', label: 'Ammo', icon: '#' },
            ammo_bolts:    { id: 'ammo_bolts', sizeW: 1, sizeH: 1, stackMax: 10, category: 'stackable', label: 'Bolts', icon: '#', color: '#c0c0c0' },
            ammo_shells:   { id: 'ammo_shells', sizeW: 1, sizeH: 1, stackMax: 25, category: 'stackable', label: 'Shells', icon: '#', color: '#00aa00' },
            ammo_9mm:      { id: 'ammo_9mm', sizeW: 1, sizeH: 1, stackMax: 50, category: 'stackable', label: '9mm', icon: '#', color: '#b87333' },
            ammo_45:       { id: 'ammo_45', sizeW: 1, sizeH: 1, stackMax: 50, category: 'stackable', label: '.45 cal', icon: '#', color: '#cd9b1d' },
            ammo_556:      { id: 'ammo_556', sizeW: 1, sizeH: 1, stackMax: 50, category: 'stackable', label: '5.56', icon: '#', color: '#8800aa' },
            grenade:       { id: 'grenade', sizeW: 1, sizeH: 1, stackMax: 1, category: 'stackable', label: 'Grenade', icon: 'G' },
            scrap:         { id: 'scrap', sizeW: 1, sizeH: 1, stackMax: 99, category: 'stackable', label: 'Scrap', icon: 'S' },
            materials:     { id: 'materials', sizeW: 1, sizeH: 1, stackMax: 99, category: 'stackable', label: 'Materials', icon: 'M' },
            cigarettes:    { id: 'cigarettes', sizeW: 1, sizeH: 1, stackMax: 99, category: 'stackable', label: 'Cigarettes', icon: 'C' },
            flashlight:    { id: 'flashlight', sizeW: 1, sizeH: 1, stackMax: 1, category: 'weapon', label: 'Flashlight', icon: 'F' },
            molotov:       { id: 'molotov', sizeW: 1, sizeH: 1, stackMax: 3, category: 'stackable', label: 'Molotov', icon: 'V' },
            shotgun:       { id: 'shotgun', sizeW: 2, sizeH: 1, stackMax: 1, category: 'weapon', label: 'Shotgun', icon: 'SG' },
            smg:           { id: 'smg', sizeW: 2, sizeH: 1, stackMax: 1, category: 'weapon', label: 'SMG', icon: 'SMG' },
            crossbow:      { id: 'crossbow', sizeW: 2, sizeH: 1, stackMax: 1, category: 'weapon', label: 'Crossbow', icon: 'X' },
            rifle:         { id: 'rifle', sizeW: 2, sizeH: 1, stackMax: 1, category: 'weapon', label: 'Rifle', icon: 'R' },
            pistol:        { id: 'pistol', sizeW: 1, sizeH: 1, stackMax: 1, category: 'weapon', label: 'Pistol', icon: 'P' },
            helmet:        { id: 'helmet', sizeW: 1, sizeH: 1, stackMax: 1, category: 'armor', label: 'Helmet', icon: 'H' },
            headset:       { id: 'headset', sizeW: 2, sizeH: 1, stackMax: 1, category: 'armor', label: 'Headset', icon: 'Hs' },
            vest:          { id: 'vest', sizeW: 1, sizeH: 1, stackMax: 1, category: 'armor', label: 'Vest', icon: 'V' },
            medkit:        { id: 'medkit', sizeW: 1, sizeH: 2, stackMax: 1, category: 'medical', label: 'Medkit', icon: 'MK', color: '#cc2222' },
            bandage:       { id: 'bandage', sizeW: 1, sizeH: 1, stackMax: 1, category: 'medical', label: 'Bandage', icon: 'Bd', color: '#cc2222' },
            hemostat:      { id: 'hemostat', sizeW: 1, sizeH: 1, stackMax: 1, category: 'medical', label: 'Hemostat', icon: 'Hs', color: '#cc2222' },
            splint:        { id: 'splint', sizeW: 1, sizeH: 1, stackMax: 1, category: 'medical', label: 'Splint', icon: 'Sp', color: '#cc2222' },
            trauma_kit:    { id: 'trauma_kit', sizeW: 2, sizeH: 2, stackMax: 1, category: 'medical', label: 'Trauma Kit', icon: 'TK', color: '#ff8800' },
            limb_breaker:  { id: 'limb_breaker', sizeW: 1, sizeH: 1, stackMax: 1, category: 'medical', label: 'Limb Breaker', icon: 'LB', color: '#1a1a1a' },
            trauma_inflict: { id: 'trauma_inflict', sizeW: 1, sizeH: 1, stackMax: 1, category: 'medical', label: 'Trauma Inflict', icon: 'TI', color: '#1a1a1a' },
            antidote:      { id: 'antidote', sizeW: 1, sizeH: 1, stackMax: 1, category: 'medical', label: 'Antidote', icon: 'Ad', color: '#66ff88' },
            extended_mag:  { id: 'extended_mag', sizeW: 1, sizeH: 1, stackMax: 5, category: 'stackable', label: 'Ext Mag', icon: 'M' },
            suppressor:    { id: 'suppressor', sizeW: 1, sizeH: 1, stackMax: 5, category: 'stackable', label: 'Suppressor', icon: 'S' },
            laser_sight:   { id: 'laser_sight', sizeW: 1, sizeH: 1, stackMax: 5, category: 'stackable', label: 'Flashlight/Laser', icon: 'L' },
            damage_barrel: { id: 'damage_barrel', sizeW: 1, sizeH: 1, stackMax: 5, category: 'stackable', label: 'Dmg Barrel', icon: 'D' },
            rapid_fire:    { id: 'rapid_fire', sizeW: 1, sizeH: 1, stackMax: 5, category: 'stackable', label: 'Rapid Fire', icon: 'R' },
            mag_pistol:    { id: 'mag_pistol', sizeW: 1, sizeH: 1, stackMax: 1, category: 'magazine', label: 'Pistol Mag', icon: 'M', color: '#b0b0b0' },
            mag_smg:       { id: 'mag_smg', sizeW: 1, sizeH: 2, stackMax: 1, category: 'magazine', label: 'SMG Mag', icon: 'M', color: '#505050' },
            mag_rifle:     { id: 'mag_rifle', sizeW: 1, sizeH: 2, stackMax: 1, category: 'magazine', label: 'Rifle Mag', icon: 'M', color: '#c4a574' },
            adrenaline:    { id: 'adrenaline', sizeW: 1, sizeH: 1, stackMax: 5, category: 'consumable', label: 'Adrenaline', icon: 'A' },
            armor_patch:   { id: 'armor_patch', sizeW: 1, sizeH: 1, stackMax: 5, category: 'consumable', label: 'Armor Patch', icon: 'P' },
            ammo_box:      { id: 'ammo_box', sizeW: 2, sizeH: 2, stackMax: 1, category: 'container', label: 'Ammo Box', icon: 'A' },
            rig:           { id: 'rig', sizeW: 3, sizeH: 2, stackMax: 1, category: 'armor', label: 'Rig', icon: 'Rg', color: '#888888' },
            backpack_default: { id: 'backpack_default', sizeW: 5, sizeH: 8, stackMax: 1, category: 'container', label: 'Backpack', icon: 'Bp', innerGridW: 6, innerGridH: 9 },
            secure_container_default: { id: 'secure_container_default', sizeW: 1, sizeH: 1, stackMax: 1, category: 'container', label: 'Secure', icon: 'Sc', innerGridW: 2, innerGridH: 3 },
            med_bag_default: { id: 'med_bag_default', sizeW: 1, sizeH: 1, stackMax: 1, category: 'container', label: 'Med Bag', icon: 'MB', innerGridW: 2, innerGridH: 2 },
            nvg:            { id: 'nvg', sizeW: 1, sizeH: 1, stackMax: 1, category: 'weapon', label: 'NVG', icon: 'NV', color: '#00cc66' }
        },
        AMMO_BOX_INNER: { gridW: 6, gridH: 6 },
        BACKPACK_DEFAULT_INNER: { gridW: 6, gridH: 9 },
        SECURE_CONTAINER_INNER: { gridW: 2, gridH: 3 }
    },
    
    // Achievements
    ACHIEVEMENTS: {
        FIRST_BLOOD: { id: 'first_blood', name: 'First Blood', desc: 'Kill your first enemy', icon: '💀' },
        EXTERMINATOR: { id: 'exterminator', name: 'Exterminator', desc: 'Kill 50 enemies total', icon: '☠️' },
        SHARPSHOOTER: { id: 'sharpshooter', name: 'Sharpshooter', desc: 'Achieve 50% accuracy in a run', icon: '🎯' },
        MELEE_MASTER: { id: 'melee_master', name: 'Melee Master', desc: 'Kill a boss with melee only', icon: '🗡️' },
        SURVIVOR: { id: 'survivor', name: 'Survivor', desc: 'Complete your first extraction', icon: '🏆' },
        VETERAN: { id: 'veteran', name: 'Veteran', desc: 'Complete 5 extractions', icon: '⭐' },
        GRENADIER: { id: 'grenadier', name: 'Grenadier', desc: 'Kill 3 enemies with one grenade', icon: '💣' },
        UNTOUCHABLE: { id: 'untouchable', name: 'Untouchable', desc: 'Complete a level without taking damage', icon: '🛡️' },
        SCAVENGER: { id: 'scavenger', name: 'Scavenger', desc: 'Collect 100 scrap total', icon: '🔧' },
        FULLY_LOADED: { id: 'fully_loaded', name: 'Fully Loaded', desc: 'Own all weapons at once', icon: '🔫' },
        // Class unlock achievements
        SCOUT_UNLOCK: { id: 'scout_unlock', name: 'Ghost Runner', desc: 'Complete any level without being hit', icon: '🏃' },
        MEDIC_UNLOCK: { id: 'medic_unlock', name: 'Field Medic', desc: 'Heal 50 total HP across all runs', icon: '💊' },
        SCAVENGER_UNLOCK: { id: 'scavenger_unlock', name: 'Pack Rat', desc: 'Collect 500 total scrap', icon: '🎒' }
    },
    
    // Hideout upgrade costs
    HIDEOUT: {
        WORKBENCH_COST: 15,
        WORKBENCH_DAMAGE_BONUS: 0.25, // +25% damage
        REPAIR_STATION_COST: 20,
        REPAIR_COST_PER_POINT: 1, // 1 scrap per durability point
        GUN_BENCH_LEVEL2_COST: 20,
        GUN_BENCH_CRAFT_9MM:  { scrap: 1, itemId: 'ammo_9mm', count: 4, timeMs: 90000 },
        GUN_BENCH_CRAFT_SHELLS: { scrap: 1, itemId: 'ammo_shells', count: 3, timeMs: 90000 },
        MED_BAY_COST: 8, // scrap: clear infection + full blood refill
        INSURANCE_COST: 12, // scrap: insure mid-raid loot for one death
        INSURANCE_RETURN_MS: 180000, // 3 min real-time until claimable
        INSURANCE_RETURN_CHANCE: 0.7 // chance each lost item isn't "scavenged"
    },
    
    // Currency system
    CURRENCIES: {
        SCRAP: { name: 'Scrap', icon: '🔧', color: 0xaaaaaa },
        CREDITS: { name: 'Credits', icon: '💰', color: 0xffd700 },
        MATERIALS: { name: 'Materials', icon: '⚙️', color: 0x00aaff }
    },
    
    // Trader quests: turn in items from stash for rewards (one-time per quest)
    TRADER_QUESTS: [
        { id: 'cigarettes_10', name: 'Filthy Habit', desc: 'Collect 10 Cigarettes from the field and turn them in.', require: { itemId: 'cigarettes', count: 10 }, reward: { scrap: 100 } }
    ],
    // Trader configuration
    TRADER: {
        HIDEOUT_STOCK: [
            { id: 'ammo_bundle', name: 'Ammo Bundle', type: 'ammo', amount: 50, cost: 15, currency: 'credits' },
            { id: 'med_kit', name: 'Med Kit', type: 'heal', amount: 5, cost: 20, currency: 'credits' },
            { id: 'grenade', name: 'Grenade', type: 'grenade', amount: 1, cost: 25, currency: 'credits' },
            { id: 'adrenaline', name: 'Adrenaline Shot', type: 'consumable', effect: 'speed', cost: 30, currency: 'credits' },
            { id: 'armor_patch', name: 'Armor Patch', type: 'consumable', effect: 'repair', cost: 25, currency: 'credits' },
            { id: 'antidote', name: 'Antidote', type: 'consumable', effect: 'cure_infection', cost: 35, currency: 'credits' },
            // Weapon Mods - purchased with materials
            { id: 'extended_mag', name: 'Extended Mag', type: 'mod', cost: 15, currency: 'materials' },
            { id: 'suppressor', name: 'Suppressor', type: 'mod', cost: 20, currency: 'materials' },
            { id: 'laser_sight', name: 'Laser Sight', type: 'mod', cost: 25, currency: 'materials' },
            { id: 'damage_barrel', name: 'Damage Barrel', type: 'mod', cost: 30, currency: 'materials' },
            { id: 'rapid_fire', name: 'Rapid Fire', type: 'mod', cost: 25, currency: 'materials' },
            { id: 'mag_pistol', name: 'Pistol Mag', type: 'magazine', cost: 8, currency: 'credits' },
            { id: 'mag_smg', name: 'SMG Mag', type: 'magazine', cost: 12, currency: 'credits' },
            { id: 'mag_rifle', name: 'Rifle Mag', type: 'magazine', cost: 15, currency: 'credits' }
        ],
        SELL_RATE: 0.5,
        // Sell value for items in stash/backpack grid (per unit). Any item that can go in stash can be sold; list all such items here.
        SELL_GRID: {
            shotgun: { credits: 25 }, smg: { credits: 35 }, crossbow: { credits: 40 }, rifle: { credits: 45 },
            helmet: { credits: 10 }, headset: { credits: 10 }, vest: { credits: 12 },
            ammo: { credits: 1 }, grenade: { credits: 12 }, materials: { materials: 5 }, cigarettes: { credits: 2 },
            medkit: { credits: 15 }, bandage: { credits: 5 }, hemostat: { credits: 5 }, splint: { credits: 5 },
            trauma_kit: { credits: 25 }, limb_breaker: { credits: 10 }, trauma_inflict: { credits: 10 },
            antidote: { credits: 18 },
            adrenaline: { credits: 15 }, armor_patch: { credits: 12 }, ammo_box: { credits: 20 }, rig: { credits: 25 },
            extended_mag: { materials: 7 }, suppressor: { materials: 10 }, laser_sight: { materials: 12 }, damage_barrel: { materials: 15 }, rapid_fire: { materials: 12 },
            mag_pistol: { credits: 4 }, mag_smg: { credits: 6 }, mag_rifle: { credits: 7 }
        }
    },
    
    // Consumables configuration
    CONSUMABLES: {
        adrenaline: { name: 'Adrenaline', effect: 'speed', multiplier: 1.5, duration: 10000, icon: '💉' },
        armor_patch: { name: 'Armor Patch', effect: 'repair', amount: 20, duration: 0, icon: '🩹' },
        antidote: { name: 'Antidote', effect: 'cure_infection', duration: 0, icon: '🧪' }
    },
    
    // Enemy drop configuration (currency auto-collects, items go to skull)
    ENEMY_DROPS: {
        WALKER: { currency: 'scrap', min: 1, max: 3, items: ['ammo_9mm', 'ammo_9mm', 'ammo_shells', 'meds', 'scrap', 'cigarettes'] },
        SPITTER: { currency: 'scrap', min: 2, max: 4, items: ['ammo_9mm', 'ammo_45', 'meds', 'grenade', 'scrap', 'cigarettes', 'antidote'] },
        BANDIT: { currency: 'credits', min: 5, max: 15, items: ['ammo_9mm', 'ammo_45', 'ammo_556', 'helmet', 'vest', 'grenade', 'meds', 'extended_mag', 'mag_pistol', 'mag_smg', 'mag_rifle', 'cigarettes'] },
        BOSS: { currency: 'materials', min: 8, max: 18, items: ['grenade', 'meds', 'ammo_556', 'ammo_45', 'extended_mag', 'suppressor', 'laser_sight', 'rapid_fire'] },
        LEAPER: { currency: 'scrap', min: 1, max: 2, items: ['ammo_9mm', 'ammo_shells', 'meds', 'cigarettes'] },
        EXPLODER: { currency: 'scrap', min: 2, max: 5, items: ['ammo_9mm', 'ammo_45', 'grenade', 'meds', 'cigarettes'] },
        NECROMANCER: { currency: 'materials', min: 12, max: 24, items: ['grenade', 'meds', 'crossbow', 'ammo_bolts', 'damage_barrel', 'rapid_fire', 'laser_sight', 'materials'] }
    },
    
    // Character classes
    CLASSES: {
        SURVIVOR: { id: 'survivor', name: 'Survivor', desc: 'No passive ability', passive: null, icon: '🧍' },
        SCOUT: { id: 'scout', name: 'Scout', desc: '+20% speed, silent footsteps', passive: 'speed', icon: '🏃' },
        MEDIC: { id: 'medic', name: 'Medic', desc: 'Regen 1 HP every 30s', passive: 'regen', icon: '💉' },
        SCAVENGER: { id: 'scavenger', name: 'Scavenger', desc: '+50% loot drops', passive: 'loot', icon: '🎒' }
    },
    
    // Permanent upgrades (unlock based on persistent stats)
    UPGRADES: {
        // Starting Gear
        START_SHOTGUN: { id: 'start_shotgun', name: 'Shotgun Start', desc: 'Begin runs with Shotgun', 
                         category: 'gear', icon: '🔫', requirement: { stat: 'runsCompleted', value: 10 } },
        START_GRENADE: { id: 'start_grenade', name: 'Grenade Start', desc: 'Begin runs with 1 Grenade',
                         category: 'gear', icon: '💣', requirement: { stat: 'totalGrenadeKills', value: 25 } },
        START_FLASHLIGHT: { id: 'start_flashlight', name: 'Flashlight Start', desc: 'Begin runs with Flashlight',
                            category: 'gear', icon: '🔦', requirement: { stat: 'highestLevelUnlocked', value: 5 } },
        START_AMMO: { id: 'start_ammo', name: 'Ammo Cache', desc: 'Begin runs with +20 Ammo',
                      category: 'gear', icon: '📦', requirement: { stat: 'totalKills', value: 100 } },
        
        // Stat Boosts
        HP_BOOST_1: { id: 'hp_boost_1', name: 'Tough I', desc: '+1 Max HP',
                      category: 'stats', icon: '❤️', requirement: { stat: 'runsCompleted', value: 5 } },
        HP_BOOST_2: { id: 'hp_boost_2', name: 'Tough II', desc: '+2 Max HP',
                      category: 'stats', icon: '💖', requirement: { stat: 'runsCompleted', value: 15 } },
        SPEED_BOOST: { id: 'speed_boost', name: 'Fleet Feet', desc: '+5% Movement Speed',
                       category: 'stats', icon: '👟', requirement: { stat: 'highestLevelUnlocked', value: 7 } },
        DAMAGE_BOOST: { id: 'damage_boost', name: 'Lethal', desc: '+10% Damage',
                        category: 'stats', icon: '💀', requirement: { stat: 'bossesKilled', value: 10 } },
        
        // Cosmetics - Player Skins (tints)
        SKIN_TACTICAL: { id: 'skin_tactical', name: 'Tactical', desc: 'Dark blue player skin',
                         category: 'skin', icon: '🔵', tint: 0x4466aa, requirement: { stat: 'runsStarted', value: 10 } },
        SKIN_SURVIVOR: { id: 'skin_survivor', name: 'Survivor', desc: 'Battle-worn red skin',
                         category: 'skin', icon: '🔴', tint: 0xaa4444, requirement: { stat: 'runsStarted', value: 25 } },
        SKIN_GHOST: { id: 'skin_ghost', name: 'Ghost', desc: 'Pale stealth skin',
                      category: 'skin', icon: '👻', tint: 0xaaaacc, requirement: { stat: 'meleeKills', value: 50 } },
        
        // Cosmetics - Muzzle Flash Colors
        MUZZLE_BLUE: { id: 'muzzle_blue', name: 'Blue Flash', desc: 'Blue muzzle flash',
                       category: 'muzzle', icon: '🔵', color: 0x00aaff, requirement: { stat: 'totalShotsFired', value: 1000 } },
        MUZZLE_RED: { id: 'muzzle_red', name: 'Red Flash', desc: 'Red muzzle flash',
                      category: 'muzzle', icon: '🔴', color: 0xff4444, requirement: { stat: 'bossesKilled', value: 5 } },
        MUZZLE_GREEN: { id: 'muzzle_green', name: 'Green Flash', desc: 'Green muzzle flash',
                        category: 'muzzle', icon: '🟢', color: 0x44ff44, requirement: { stat: 'totalScrapCollected', value: 300 } }
    },
    
    // Skill Tree - spend skill points to unlock abilities
    SKILLS: {
        // ===== SURVIVAL BRANCH =====
        THICK_SKIN: { 
            id: 'thick_skin', branch: 'survival', name: 'Thick Skin', 
            desc: '-10% damage taken', cost: 2, requires: null, row: 0,
            effect: { type: 'damage_reduction', value: 0.1 }
        },
        IRON_WILL: { 
            id: 'iron_will', branch: 'survival', name: 'Iron Will',
            desc: '-20% damage taken', cost: 4, requires: 'thick_skin', row: 1,
            effect: { type: 'damage_reduction', value: 0.2 }
        },
        SECOND_WIND: { 
            id: 'second_wind', branch: 'survival', name: 'Second Wind',
            desc: 'Survive one lethal hit per run (1 HP)', cost: 6, requires: 'iron_will', row: 2,
            effect: { type: 'cheat_death' }
        },
        REGENERATION: { 
            id: 'regeneration', branch: 'survival', name: 'Regeneration',
            desc: 'Heal 1 HP every 60 seconds', cost: 5, requires: null, row: 3,
            effect: { type: 'regen', interval: 60000 }
        },
        LAST_STAND: { 
            id: 'last_stand', branch: 'survival', name: 'Last Stand',
            desc: '+50% damage when below 25% HP', cost: 4, requires: null, row: 4,
            effect: { type: 'low_hp_damage', threshold: 0.25, bonus: 0.5 }
        },
        
        // ===== STEALTH BRANCH =====
        LIGHT_FEET: { 
            id: 'light_feet', branch: 'stealth', name: 'Light Feet',
            desc: 'Footstep sounds reduced', cost: 2, requires: null, row: 0,
            effect: { type: 'quiet_footsteps', value: 0.3 }
        },
        SHADOW_STEP: { 
            id: 'shadow_step', branch: 'stealth', name: 'Shadow Step',
            desc: '-25% enemy detection range', cost: 4, requires: 'light_feet', row: 1,
            effect: { type: 'detection_reduction', value: 0.25 }
        },
        SILENT_KILLER: { 
            id: 'silent_killer', branch: 'stealth', name: 'Silent Killer',
            desc: 'Melee kills do not alert nearby enemies', cost: 5, requires: 'shadow_step', row: 2,
            effect: { type: 'silent_melee' }
        },
        AMBUSH: { 
            id: 'ambush', branch: 'stealth', name: 'Ambush',
            desc: '+50% damage to unaware enemies', cost: 6, requires: 'silent_killer', row: 3,
            effect: { type: 'ambush_damage', bonus: 0.5 }
        },
        GHOST: { 
            id: 'ghost', branch: 'stealth', name: 'Ghost',
            desc: 'Enemies lose track of you faster', cost: 3, requires: null, row: 4,
            effect: { type: 'detection_decay', value: 2.0 }
        },
        
        // ===== UTILITY BRANCH =====
        QUICK_HANDS: { 
            id: 'quick_hands', branch: 'utility', name: 'Quick Hands',
            desc: '+25% interact speed', cost: 2, requires: null, row: 0,
            effect: { type: 'interact_speed', value: 0.25 }
        },
        HAGGLER: { 
            id: 'haggler', branch: 'utility', name: 'Haggler',
            desc: '15% discount at trader', cost: 4, requires: 'quick_hands', row: 1,
            effect: { type: 'trader_discount', value: 0.15 }
        },
        SCRAPPER: { 
            id: 'scrapper', branch: 'utility', name: 'Scrapper',
            desc: '+25% scrap from all sources', cost: 5, requires: 'haggler', row: 2,
            effect: { type: 'scrap_bonus', value: 0.25 }
        },
        SWIFT_RELOAD: { 
            id: 'swift_reload', branch: 'utility', name: 'Swift Reload',
            desc: '-15% reload time', cost: 4, requires: null, row: 3,
            effect: { type: 'reload_speed', value: 0.15 }
        },
        PACK_MULE: { 
            id: 'pack_mule', branch: 'utility', name: 'Pack Mule',
            desc: '+1 consumable slot', cost: 3, requires: null, row: 4,
            effect: { type: 'extra_consumable' }
        }
    },
    
    // Challenge System - daily/weekly/permanent challenges with skill point rewards
    CHALLENGES: {
        DAILY: [
            { id: 'daily_melee_10', name: 'Melee Mayhem', desc: 'Kill 10 enemies with melee', 
              target: 10, stat: 'runMeleeKills', reward: 2 },
            { id: 'daily_kills_20', name: 'Exterminator', desc: 'Kill 20 enemies in a single run', 
              target: 20, stat: 'runKills', reward: 1 },
            { id: 'daily_no_damage', name: 'Untouchable', desc: 'Complete a level without taking damage', 
              target: 1, stat: 'levelNoDamage', reward: 2 },
            { id: 'daily_headshots', name: 'Sharpshooter', desc: 'Achieve 60%+ accuracy in a run (min 20 shots)', 
              target: 1, stat: 'highAccuracy', reward: 2 },
            { id: 'daily_grenades_5', name: 'Bombardier', desc: 'Kill 5 enemies with grenades', 
              target: 5, stat: 'runGrenadeKills', reward: 2 },
            { id: 'daily_scrap_50', name: 'Scavenger Run', desc: 'Collect 50 scrap in a single run', 
              target: 50, stat: 'runScrapCollected', reward: 1 },
            { id: 'daily_speed_run', name: 'Speed Demon', desc: 'Complete any level in under 2 minutes', 
              target: 1, stat: 'speedRun', reward: 2 },
            { id: 'daily_pistol_only', name: 'Old Faithful', desc: 'Complete a level using only the pistol', 
              target: 1, stat: 'pistolOnly', reward: 2 }
        ],
        WEEKLY: [
            { id: 'weekly_kills_100', name: 'Genocide', desc: 'Kill 100 enemies this week', 
              target: 100, stat: 'weeklyKills', reward: 4 },
            { id: 'weekly_extract_5', name: 'Survivor', desc: 'Extract 5 times this week', 
              target: 5, stat: 'weeklyExtractions', reward: 3 },
            { id: 'weekly_bosses_3', name: 'Boss Hunter', desc: 'Kill 3 bosses this week', 
              target: 3, stat: 'weeklyBossKills', reward: 5 },
            { id: 'weekly_scrap_200', name: 'Hoarder', desc: 'Collect 200 scrap this week', 
              target: 200, stat: 'weeklyScrap', reward: 3 },
            { id: 'weekly_levels_all', name: 'Globetrotter', desc: 'Extract from 5 different levels this week', 
              target: 5, stat: 'weeklyUniqueLevels', reward: 4 }
        ],
        PERMANENT: [
            { id: 'perm_crossbow_100', name: 'Bolt Action', desc: 'Kill 100 enemies with the crossbow', 
              target: 100, stat: 'crossbowKills', reward: { type: 'skin', id: 'skin_hunter', tint: 0x665544 } },
            { id: 'perm_melee_200', name: 'Bladedancer', desc: 'Kill 200 enemies with melee', 
              target: 200, stat: 'meleeKills', reward: { type: 'skin', id: 'skin_assassin', tint: 0x332233 } },
            { id: 'perm_extractions_50', name: 'Veteran', desc: 'Complete 50 extractions', 
              target: 50, stat: 'runsCompleted', reward: { type: 'muzzle', id: 'muzzle_gold', color: 0xffd700 } },
            { id: 'perm_no_damage_5', name: 'Perfection', desc: 'Complete 5 levels without taking any damage', 
              target: 5, stat: 'perfectLevels', reward: { type: 'skin', id: 'skin_ethereal', tint: 0xaaddff } }
        ]
    },
    
    // Weapon attachment slot names per weapon type (plan: weapon_attachments_and_magazines)
    WEAPON_SLOTS: {
        rifle:    ['flashlight_laser', 'muzzle', 'grip', 'optic', 'magazine', 'extra_modifier'],
        smg:      ['flashlight_laser', 'muzzle', 'grip', 'optic', 'magazine', 'extra_modifier'],
        pistol:   ['flashlight_laser', 'muzzle', 'magazine', 'optic', 'extra_modifier'],
        shotgun:  ['flashlight_laser', 'muzzle', 'magazine_mod', 'optic', 'extra_modifier'],
        crossbow: ['flashlight_laser', 'optic', 'extra_modifier']
    },
    // Weapon Mods - attachments that modify weapon stats; slotType = which attachment slot they go in
    MODS: {
        EXTENDED_MAG: { 
            id: 'extended_mag', name: 'Extended Mag', 
            desc: '+50% magazine size', icon: 'M',
            slotType: 'magazine', // also valid for magazine_mod (shotgun)
            compatible: ['pistol', 'shotgun', 'smg', 'crossbow', 'rifle'],
            effect: { type: 'mag_size', value: 0.5 },
            cost: { currency: 'materials', amount: 15 },
            rarity: 'common'
        },
        SUPPRESSOR: { 
            id: 'suppressor', name: 'Suppressor', 
            desc: 'Silent shots, -10% damage', icon: 'S',
            slotType: 'muzzle',
            compatible: ['pistol', 'smg', 'rifle'],
            effect: { type: 'suppressor', damageReduction: 0.1 },
            cost: { currency: 'materials', amount: 20 },
            rarity: 'uncommon'
        },
        LASER_SIGHT: { 
            id: 'laser_sight', name: 'Flashlight/Laser', 
            desc: 'Light + laser aim', icon: 'L',
            slotType: 'flashlight_laser',
            compatible: ['pistol', 'shotgun', 'smg', 'crossbow', 'rifle'],
            effect: { type: 'laser_sight' },
            cost: { currency: 'materials', amount: 25 },
            rarity: 'uncommon'
        },
        DAMAGE_BARREL: { 
            id: 'damage_barrel', name: 'Damage Barrel', 
            desc: '+20% damage, -15% fire rate', icon: 'D',
            slotType: 'muzzle',
            compatible: ['shotgun', 'rifle'],
            effect: { type: 'damage_barrel', damage: 0.2, fireRate: -0.15 },
            cost: { currency: 'materials', amount: 30 },
            rarity: 'rare'
        },
        RAPID_FIRE: { 
            id: 'rapid_fire', name: 'Rapid Fire', 
            desc: '+25% fire rate, +20% spread', icon: 'R',
            slotType: 'extra_modifier',
            compatible: ['smg', 'pistol'],
            effect: { type: 'rapid_fire', fireRate: 0.25, spread: 0.2 },
            cost: { currency: 'materials', amount: 25 },
            rarity: 'rare'
        },
        FLASHLIGHT: {
            id: 'flashlight', name: 'Flashlight',
            desc: 'Basic light in darkness', icon: 'F',
            slotType: 'flashlight_laser',
            compatible: ['pistol', 'shotgun', 'smg', 'crossbow', 'rifle'],
            effect: { type: 'flashlight' },
            cost: { currency: 'materials', amount: 10 },
            rarity: 'common'
        }
    },
    
    // Roguelike Room System - Level grid dimensions
    LEVEL_GRIDS: {
        1: { cols: 2, rows: 2, theme: 'STREET' },      // Street - 4 rooms
        2: { cols: 2, rows: 2, theme: 'APARTMENT' },   // Apartment - 4 rooms
        3: { cols: 2, rows: 2, theme: 'ROOFTOP' },     // Rooftop - 4 rooms
        4: { cols: 3, rows: 2, theme: 'SEWERS' },      // Sewers - 6 rooms (maze-like)
        5: { cols: 2, rows: 1, theme: 'HOSPITAL' },    // Hospital - 2 rooms (boss level)
        6: { cols: 3, rows: 2, theme: 'MALL' },        // Mall - 6 rooms
        7: { cols: 2, rows: 1, theme: 'CEMETERY' }     // Cemetery - 2 rooms (boss level)
    },
    
    // Risk room configuration
    RISK_ROOM: {
        SPAWN_CHANCE: 0.25,        // 25% chance per eligible room
        ENEMY_MULTIPLIER: 1.5,     // 1.5x enemies (unused when ENEMIES_PER_LEVEL set)
        ENEMIES_PER_LEVEL: { 1: 4, 2: 4, 3: 5, 4: 5, 5: 10, 6: 5, 7: 10 },
        LOOT_MULTIPLIER: 2.0,      // 2x currency drops
        GUARANTEED_DROPS: ['extended_mag', 'suppressor', 'laser_sight', 'damage_barrel', 'rapid_fire'],
        BONUS_LOOT: ['materials', 'grenade', 'meds', 'ammo_9mm', 'ammo_45', 'ammo_556', 'ammo_shells', 'ammo_bolts'],  // One extra from this pool in risk rooms
        ENEMY_UPGRADES: {
            walker: 'leaper',      // Walkers become leapers
            leaper: 'bandit',      // Leapers become bandits
            spitter: 'exploder'    // Spitters become exploders
        }
    },
    
    // Room chunk templates for procedural generation
    // Each chunk has: walls (relative positions), spawnPoints, crateSlots, doorPositions
    // Coordinates are relative to 800x600 room (0,0 is top-left)
    ROOM_CHUNKS: {
        STREET: [
            {
                id: 'street_open',
                floor: 'floor_grass',
                walls: [
                    { x: 200, y: 200, scaleX: 1, scaleY: 3 },
                    { x: 600, y: 400, scaleX: 1, scaleY: 3 }
                ],
                spawnPoints: [
                    { x: 100, y: 150 }, { x: 700, y: 150 },
                    { x: 100, y: 450 }, { x: 700, y: 450 },
                    { x: 400, y: 300 }
                ],
                crateSlots: [
                    { x: 100, y: 100 }, { x: 700, y: 100 },
                    { x: 100, y: 500 }, { x: 700, y: 500 },
                    { x: 300, y: 300 }, { x: 500, y: 300 }
                ],
                doorPositions: { north: true, south: true, east: true, west: true }
            },
            {
                id: 'street_alley',
                floor: 'floor_grass',
                walls: [
                    { x: 300, y: 150, scaleX: 8, scaleY: 1 },
                    { x: 300, y: 450, scaleX: 8, scaleY: 1 },
                    { x: 150, y: 300, scaleX: 1, scaleY: 4 }
                ],
                spawnPoints: [
                    { x: 500, y: 300 }, { x: 650, y: 200 },
                    { x: 650, y: 400 }, { x: 250, y: 300 }
                ],
                crateSlots: [
                    { x: 400, y: 250 }, { x: 400, y: 350 },
                    { x: 600, y: 250 }, { x: 600, y: 350 },
                    { x: 700, y: 300 }
                ],
                doorPositions: { north: false, south: false, east: true, west: true }
            },
            {
                id: 'street_corner',
                floor: 'floor_grass',
                walls: [
                    { x: 200, y: 200, scaleX: 1, scaleY: 6 },
                    { x: 350, y: 100, scaleX: 6, scaleY: 1 },
                    { x: 600, y: 350, scaleX: 1, scaleY: 4 }
                ],
                spawnPoints: [
                    { x: 400, y: 300 }, { x: 500, y: 200 },
                    { x: 300, y: 400 }, { x: 700, y: 500 }
                ],
                crateSlots: [
                    { x: 350, y: 250 }, { x: 500, y: 350 },
                    { x: 650, y: 200 }, { x: 100, y: 500 },
                    { x: 750, y: 550 }
                ],
                doorPositions: { north: true, south: true, east: true, west: false }
            }
        ],
        APARTMENT: [
            {
                id: 'apt_hallway',
                floor: 'floor_apt',
                walls: [
                    { x: 200, y: 200, scaleX: 1, scaleY: 8 },
                    { x: 600, y: 200, scaleX: 1, scaleY: 8 }
                ],
                spawnPoints: [
                    { x: 400, y: 150 }, { x: 400, y: 300 },
                    { x: 400, y: 450 }, { x: 100, y: 300 },
                    { x: 700, y: 300 }
                ],
                crateSlots: [
                    { x: 300, y: 200 }, { x: 500, y: 200 },
                    { x: 300, y: 400 }, { x: 500, y: 400 },
                    { x: 100, y: 150 }, { x: 700, y: 150 }
                ],
                doorPositions: { north: true, south: true, east: true, west: true }
            },
            {
                id: 'apt_rooms',
                floor: 'floor_apt',
                walls: [
                    { x: 250, y: 300, scaleX: 1, scaleY: 10 },
                    { x: 550, y: 300, scaleX: 1, scaleY: 10 },
                    { x: 400, y: 250, scaleX: 4, scaleY: 1 }
                ],
                spawnPoints: [
                    { x: 100, y: 150 }, { x: 100, y: 450 },
                    { x: 700, y: 150 }, { x: 700, y: 450 },
                    { x: 400, y: 450 }
                ],
                crateSlots: [
                    { x: 100, y: 250 }, { x: 100, y: 350 },
                    { x: 700, y: 250 }, { x: 700, y: 350 },
                    { x: 400, y: 500 }
                ],
                doorPositions: { north: true, south: true, east: false, west: false }
            },
            {
                id: 'apt_lobby',
                floor: 'floor_apt',
                walls: [
                    { x: 200, y: 150, scaleX: 4, scaleY: 1 },
                    { x: 600, y: 150, scaleX: 4, scaleY: 1 },
                    { x: 150, y: 350, scaleX: 1, scaleY: 4 },
                    { x: 650, y: 350, scaleX: 1, scaleY: 4 }
                ],
                spawnPoints: [
                    { x: 400, y: 100 }, { x: 200, y: 450 },
                    { x: 600, y: 450 }, { x: 400, y: 350 }
                ],
                crateSlots: [
                    { x: 100, y: 100 }, { x: 700, y: 100 },
                    { x: 300, y: 300 }, { x: 500, y: 300 },
                    { x: 400, y: 550 }
                ],
                doorPositions: { north: true, south: true, east: true, west: true }
            }
        ],
        ROOFTOP: [
            {
                id: 'roof_open',
                floor: 'floor_roof',
                walls: [
                    { x: 100, y: 300, scaleX: 1, scaleY: 2 },
                    { x: 700, y: 300, scaleX: 1, scaleY: 2 }
                ],
                spawnPoints: [
                    { x: 200, y: 150 }, { x: 600, y: 150 },
                    { x: 200, y: 450 }, { x: 600, y: 450 },
                    { x: 400, y: 300 }
                ],
                crateSlots: [
                    { x: 150, y: 200 }, { x: 650, y: 200 },
                    { x: 150, y: 400 }, { x: 650, y: 400 },
                    { x: 400, y: 200 }, { x: 400, y: 400 }
                ],
                doorPositions: { north: true, south: true, east: true, west: true }
            },
            {
                id: 'roof_vents',
                floor: 'floor_roof',
                walls: [
                    { x: 200, y: 200, scaleX: 2, scaleY: 2 },
                    { x: 600, y: 200, scaleX: 2, scaleY: 2 },
                    { x: 400, y: 400, scaleX: 2, scaleY: 2 }
                ],
                spawnPoints: [
                    { x: 100, y: 100 }, { x: 700, y: 100 },
                    { x: 100, y: 500 }, { x: 700, y: 500 },
                    { x: 400, y: 250 }
                ],
                crateSlots: [
                    { x: 350, y: 150 }, { x: 450, y: 150 },
                    { x: 200, y: 450 }, { x: 600, y: 450 },
                    { x: 100, y: 300 }, { x: 700, y: 300 }
                ],
                doorPositions: { north: true, south: true, east: true, west: true }
            }
        ],
        SEWERS: [
            {
                id: 'sewer_junction',
                floor: 'floor_sewer',
                walls: [
                    { x: 200, y: 150, scaleX: 6, scaleY: 1 },
                    { x: 200, y: 450, scaleX: 6, scaleY: 1 },
                    { x: 600, y: 150, scaleX: 3, scaleY: 1 },
                    { x: 600, y: 450, scaleX: 3, scaleY: 1 }
                ],
                spawnPoints: [
                    { x: 400, y: 300 }, { x: 200, y: 300 },
                    { x: 600, y: 300 }, { x: 400, y: 200 },
                    { x: 400, y: 400 }
                ],
                crateSlots: [
                    { x: 100, y: 250 }, { x: 100, y: 350 },
                    { x: 700, y: 250 }, { x: 700, y: 350 },
                    { x: 350, y: 300 }, { x: 450, y: 300 }
                ],
                doorPositions: { north: true, south: true, east: true, west: true }
            },
            {
                id: 'sewer_pipe',
                floor: 'floor_sewer',
                walls: [
                    { x: 100, y: 200, scaleX: 1, scaleY: 3 },
                    { x: 100, y: 500, scaleX: 1, scaleY: 2 },
                    { x: 400, y: 300, scaleX: 1, scaleY: 6 },
                    { x: 700, y: 200, scaleX: 1, scaleY: 3 },
                    { x: 700, y: 500, scaleX: 1, scaleY: 2 }
                ],
                spawnPoints: [
                    { x: 250, y: 150 }, { x: 250, y: 450 },
                    { x: 550, y: 150 }, { x: 550, y: 450 }
                ],
                crateSlots: [
                    { x: 200, y: 200 }, { x: 200, y: 400 },
                    { x: 500, y: 200 }, { x: 500, y: 400 }
                ],
                doorPositions: { north: true, south: true, east: false, west: false }
            },
            {
                id: 'sewer_chamber',
                floor: 'floor_sewer',
                walls: [
                    { x: 200, y: 200, scaleX: 2, scaleY: 1 },
                    { x: 600, y: 200, scaleX: 2, scaleY: 1 },
                    { x: 200, y: 400, scaleX: 2, scaleY: 1 },
                    { x: 600, y: 400, scaleX: 2, scaleY: 1 }
                ],
                spawnPoints: [
                    { x: 400, y: 100 }, { x: 400, y: 500 },
                    { x: 100, y: 300 }, { x: 700, y: 300 },
                    { x: 400, y: 300 }
                ],
                crateSlots: [
                    { x: 300, y: 300 }, { x: 500, y: 300 },
                    { x: 100, y: 150 }, { x: 700, y: 150 },
                    { x: 100, y: 450 }, { x: 700, y: 450 }
                ],
                doorPositions: { north: true, south: true, east: true, west: true }
            }
        ],
        HOSPITAL: [
            {
                id: 'hospital_ward',
                floor: 'floor_hospital',
                walls: [
                    { x: 150, y: 200, scaleX: 1, scaleY: 6 },
                    { x: 650, y: 200, scaleX: 1, scaleY: 6 },
                    { x: 300, y: 100, scaleX: 3, scaleY: 1 },
                    { x: 500, y: 100, scaleX: 3, scaleY: 1 },
                    { x: 400, y: 350, scaleX: 6, scaleY: 1 }
                ],
                spawnPoints: [
                    { x: 400, y: 200 }, { x: 250, y: 450 },
                    { x: 550, y: 450 }, { x: 100, y: 300 },
                    { x: 700, y: 300 }
                ],
                crateSlots: [
                    { x: 250, y: 250 }, { x: 550, y: 250 },
                    { x: 100, y: 450 }, { x: 700, y: 450 },
                    { x: 400, y: 500 }
                ],
                doorPositions: { north: true, south: true, east: true, west: true }
            },
            {
                id: 'hospital_boss',
                floor: 'floor_hospital',
                walls: [
                    { x: 100, y: 200, scaleX: 1, scaleY: 4 },
                    { x: 700, y: 200, scaleX: 1, scaleY: 4 },
                    { x: 200, y: 450, scaleX: 3, scaleY: 1 },
                    { x: 600, y: 450, scaleX: 3, scaleY: 1 }
                ],
                spawnPoints: [
                    { x: 400, y: 150 }, { x: 200, y: 300 },
                    { x: 600, y: 300 }, { x: 300, y: 500 },
                    { x: 500, y: 500 }
                ],
                crateSlots: [
                    { x: 150, y: 450 }, { x: 650, y: 450 },
                    { x: 250, y: 200 }, { x: 550, y: 200 },
                    { x: 400, y: 350 }
                ],
                doorPositions: { north: false, south: true, east: true, west: true },
                isBossRoom: true
            }
        ],
        MALL: [
            {
                id: 'mall_atrium',
                floor: 'floor_apt',
                walls: [
                    { x: 100, y: 450, scaleX: 3, scaleY: 3 },
                    { x: 700, y: 450, scaleX: 3, scaleY: 3 },
                    { x: 300, y: 250, scaleX: 1, scaleY: 2 },
                    { x: 500, y: 250, scaleX: 1, scaleY: 2 }
                ],
                spawnPoints: [
                    { x: 400, y: 150 }, { x: 200, y: 250 },
                    { x: 600, y: 250 }, { x: 400, y: 400 },
                    { x: 200, y: 550 }, { x: 600, y: 550 }
                ],
                crateSlots: [
                    { x: 350, y: 350 }, { x: 450, y: 350 },
                    { x: 100, y: 200 }, { x: 700, y: 200 },
                    { x: 400, y: 500 }
                ],
                doorPositions: { north: true, south: true, east: true, west: true }
            },
            {
                id: 'mall_store',
                floor: 'floor_apt',
                walls: [
                    { x: 150, y: 150, scaleX: 1, scaleY: 4 },
                    { x: 650, y: 150, scaleX: 1, scaleY: 4 },
                    { x: 150, y: 450, scaleX: 1, scaleY: 4 },
                    { x: 650, y: 450, scaleX: 1, scaleY: 4 },
                    { x: 400, y: 300, scaleX: 4, scaleY: 1 }
                ],
                spawnPoints: [
                    { x: 300, y: 150 }, { x: 500, y: 150 },
                    { x: 300, y: 450 }, { x: 500, y: 450 },
                    { x: 100, y: 300 }, { x: 700, y: 300 }
                ],
                crateSlots: [
                    { x: 250, y: 200 }, { x: 550, y: 200 },
                    { x: 250, y: 400 }, { x: 550, y: 400 },
                    { x: 400, y: 150 }, { x: 400, y: 450 }
                ],
                doorPositions: { north: true, south: true, east: false, west: false }
            },
            {
                id: 'mall_food_court',
                floor: 'floor_apt',
                walls: [
                    { x: 200, y: 200, scaleX: 2, scaleY: 2 },
                    { x: 400, y: 200, scaleX: 2, scaleY: 2 },
                    { x: 600, y: 200, scaleX: 2, scaleY: 2 },
                    { x: 300, y: 450, scaleX: 2, scaleY: 2 },
                    { x: 500, y: 450, scaleX: 2, scaleY: 2 }
                ],
                spawnPoints: [
                    { x: 100, y: 300 }, { x: 700, y: 300 },
                    { x: 100, y: 500 }, { x: 700, y: 500 },
                    { x: 400, y: 350 }
                ],
                crateSlots: [
                    { x: 100, y: 150 }, { x: 700, y: 150 },
                    { x: 150, y: 400 }, { x: 650, y: 400 },
                    { x: 400, y: 550 }
                ],
                doorPositions: { north: true, south: true, east: true, west: true }
            }
        ],
        CEMETERY: [
            {
                id: 'cemetery_graveyard',
                floor: 'floor_grass',
                floorOverlay: { color: 0x001100, alpha: 0.5 },
                walls: [
                    { x: 150, y: 450, scaleX: 0.5, scaleY: 1, tint: 0x555555 },
                    { x: 250, y: 400, scaleX: 0.5, scaleY: 1, tint: 0x555555 },
                    { x: 350, y: 480, scaleX: 0.5, scaleY: 1, tint: 0x555555 },
                    { x: 450, y: 420, scaleX: 0.5, scaleY: 1, tint: 0x555555 },
                    { x: 550, y: 460, scaleX: 0.5, scaleY: 1, tint: 0x555555 },
                    { x: 650, y: 400, scaleX: 0.5, scaleY: 1, tint: 0x555555 }
                ],
                spawnPoints: [
                    { x: 200, y: 350 }, { x: 400, y: 350 },
                    { x: 600, y: 350 }, { x: 300, y: 250 },
                    { x: 500, y: 250 }
                ],
                crateSlots: [
                    { x: 100, y: 300 }, { x: 700, y: 300 },
                    { x: 200, y: 500 }, { x: 600, y: 500 },
                    { x: 400, y: 550 }
                ],
                doorPositions: { north: true, south: true, east: true, west: true }
            },
            {
                id: 'cemetery_church',
                floor: 'floor_grass',
                floorOverlay: { color: 0x001100, alpha: 0.5 },
                walls: [
                    { x: 200, y: 100, scaleX: 4, scaleY: 1 },
                    { x: 600, y: 100, scaleX: 4, scaleY: 1 },
                    { x: 100, y: 150, scaleX: 1, scaleY: 3 },
                    { x: 700, y: 150, scaleX: 1, scaleY: 3 }
                ],
                spawnPoints: [
                    { x: 400, y: 150 }, { x: 200, y: 300 },
                    { x: 600, y: 300 }, { x: 300, y: 450 },
                    { x: 500, y: 450 }
                ],
                crateSlots: [
                    { x: 150, y: 250 }, { x: 650, y: 250 },
                    { x: 200, y: 500 }, { x: 600, y: 500 },
                    { x: 400, y: 400 }
                ],
                doorPositions: { north: false, south: true, east: true, west: true },
                isBossRoom: true,
                churchVisual: true
            }
        ]
    }
};
const LIMB_MAX_HP = { head: 30, leftArm: 15, rightArm: 15, chest: 50, abdomen: 25, crotch: 15, leftLeg: 20, rightLeg: 20 };
// Limb target area weights for size-weighted random (chest/abdomen largest; used when picking one limb from a pool)
const LIMB_TARGET_WEIGHT = { head: 12, chest: 50, abdomen: 25, leftArm: 10, rightArm: 10, leftLeg: 15, rightLeg: 15, crotch: 8 };
// Melee sticky targeting: attacker picks one zone and keeps hitting that zone (upper/middle/lower)
const MELEE_TARGET_ZONES = {
    upper: ['head', 'leftArm', 'rightArm', 'chest'],
    middle: ['chest', 'abdomen', 'crotch'],
    lower: ['leftLeg', 'rightLeg', 'abdomen', 'crotch']
};
// Probability (out of 100) that melee attacker picks each zone: upper 60%, middle 30%, lower 10%
const MELEE_ZONE_WEIGHTS = { upper: 60, middle: 30, lower: 10 };
// Phase 2: Stance-based limb pools — upright = arms/chest/head, on-all-fours = legs/abdomen
const MELEE_LIMB_POOLS = {
    upright: ['leftArm', 'rightArm', 'chest', 'head'],
    onAllFours: ['leftLeg', 'rightLeg', 'abdomen']
};
// enemyType → stance (upright = walker/bandit/humanoid, onAllFours = leaper/crawler)
const MELEE_STANCE_BY_ENEMY = { walker: 'upright', bandit: 'upright', leaper: 'onAllFours', spitter: 'upright', exploder: 'upright', boss: 'upright', necromancer: 'upright' };
// Phase 4: Ranged limb selection by distance. close = upper/head, medium = torso, far = legs
const RANGED_CLOSE_MAX = 100;
const RANGED_MEDIUM_MAX = 250;
const RANGED_LIMB_BANDS = {
    close: ['head', 'chest', 'leftArm', 'rightArm'],
    medium: ['chest', 'abdomen'],
    far: ['leftLeg', 'rightLeg']
};
// Major bleed moves to this limb when current limb is blacked (chest has no entry = stops there)
// Major bleed damage tick propagates toward chest: leg → crotch → abdomen → chest (chain at most 4 limbs / 3 steps)
const MAJOR_BLEED_PROPAGATION = { head: 'chest', leftArm: 'chest', rightArm: 'chest', abdomen: 'chest', crotch: 'abdomen', leftLeg: 'crotch', rightLeg: 'crotch' };
const LIMB_EFFECT_LABELS = { minor_bleed: 'Minor bleed', major_bleed: 'Major bleed', break: 'Break', trauma: 'Trauma' };
// Phase 3: Base outcome table (cumulative %). One roll per hit in single-limb path.
const LIMB_OUTCOME_TABLE = { damage_only: 82, minor_bleed: 10, major_bleed: 5, break: 2.5, black: 0.5 };
// Phase 5: Consecutive-hit escalation. +pct to effect outcomes per hit, cap; timeout resets count.
const ESCALATION_PCT_PER_HIT = 5;
const ESCALATION_CAP_PCT = 25;
const ESCALATION_TIMEOUT_MS = 15000;
const ESCALATION_EFFECT_TOTAL = 10 + 5 + 2.5 + 0.5; // sum of minor_bleed, major_bleed, break, black
// Phase 6: Per-enemy outcome modifiers (additive % shifted from damage_only into effect)
const ENEMY_OUTCOME_MODIFIERS = {
    leaper: { breakBonus: 5 },
    spitter: { blackBonus: 3 },
    exploder: { majorBleedBonus: 3 },
    boss: { blackBonus: 2, breakBonus: 3 }
};
const LIMB_DISPLAY_NAMES = { head: 'Head', leftArm: 'L.Arm', rightArm: 'R.Arm', chest: 'Chest', abdomen: 'Abdomen', crotch: 'Crotch', leftLeg: 'L.Leg', rightLeg: 'R.Leg', hp: 'HP' };
function getDefaultLimbHp() {
    const o = {};
    for (const k of Object.keys(LIMB_MAX_HP)) {
        o[k] = { hp: LIMB_MAX_HP[k], maxHp: LIMB_MAX_HP[k], status: '', effects: [] };
    }
    return o;
}

export {
  CONFIG,
  LIMB_MAX_HP,
  LIMB_TARGET_WEIGHT,
  MELEE_TARGET_ZONES,
  MELEE_ZONE_WEIGHTS,
  MELEE_LIMB_POOLS,
  MELEE_STANCE_BY_ENEMY,
  RANGED_CLOSE_MAX,
  RANGED_MEDIUM_MAX,
  RANGED_LIMB_BANDS,
  MAJOR_BLEED_PROPAGATION,
  LIMB_EFFECT_LABELS,
  LIMB_OUTCOME_TABLE,
  ESCALATION_PCT_PER_HIT,
  ESCALATION_CAP_PCT,
  ESCALATION_TIMEOUT_MS,
  ESCALATION_EFFECT_TOTAL,
  ENEMY_OUTCOME_MODIFIERS,
  LIMB_DISPLAY_NAMES,
  getDefaultLimbHp
};
