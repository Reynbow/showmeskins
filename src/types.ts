export interface ChampionBasic {
  id: string;
  key: string;
  name: string;
  title: string;
  image: {
    full: string;
  };
  tags: string[];
}

export interface Skin {
  id: string;
  num: number;
  name: string;
  chromas: boolean;
}

export interface ChromaInfo {
  id: number;
  name: string;
  colors: string[];   // hex color(s) from CommunityDragon, e.g. ["#9C68D7","#9C68D7"]
}

/** Champion info bars (attack, defense, magic, difficulty 1–10) from Data Dragon */
export interface ChampionInfo {
  attack: number;
  defense: number;
  magic: number;
  difficulty: number;
}

/** Champion base stats from Data Dragon */
export interface ChampionStats {
  hp: number;
  hpperlevel?: number;
  mp: number;
  mpperlevel?: number;
  movespeed: number;
  armor: number;
  armorperlevel?: number;
  spellblock: number;
  spellblockperlevel?: number;
  attackrange: number;
  hpregen?: number;
  mpregen?: number;
  crit?: number;
  critperlevel?: number;
  attackdamage: number;
  attackdamageperlevel?: number;
  attackspeed: number;
  attackspeedperlevel?: number;
}

export interface ChampionDetail extends ChampionBasic {
  skins: Skin[];
  lore: string;
  info?: ChampionInfo;
  stats?: ChampionStats;
}

export interface ItemInfo {
  name: string;
  descriptionHtml: string;  // HTML with styled spans for rich rendering
  plaintext: string;        // one-line summary
  goldTotal: number;
}

export type ViewMode = 'select' | 'viewer';

// ── Live game data (from companion app → Live Client Data API) ──────────

export interface LiveGameItem {
  itemID: number;
  displayName: string;
  count: number;
  slot: number;
  price: number;
}

export interface LiveGameStats {
  attackDamage: number;
  abilityPower: number;
  armor: number;
  magicResist: number;
  attackSpeed: number;
  critChance: number;
  critDamage: number;
  moveSpeed: number;
  maxHealth: number;
  currentHealth: number;
  resourceMax: number;
  resourceValue: number;
  resourceType: string;
  abilityHaste: number;
  lifeSteal: number;
  omnivamp: number;
  physicalLethality: number;
  magicLethality: number;
  armorPenetrationFlat: number;
  armorPenetrationPercent: number;
  magicPenetrationFlat: number;
  magicPenetrationPercent: number;
  tenacity: number;
  healShieldPower: number;
  attackRange: number;
  healthRegenRate: number;
  resourceRegenRate: number;
}

export type PlayerPosition = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY' | '';

export interface LiveGamePlayer {
  summonerName: string;
  championName: string;
  team: 'ORDER' | 'CHAOS';
  position: PlayerPosition;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  wardScore: number;
  items: LiveGameItem[];
  skinID: number;
  isActivePlayer: boolean;
  isDead: boolean;
  respawnTimer: number;
}

export interface LiveGameActivePlayer {
  summonerName: string;
  level: number;
  currentGold: number;
  stats: LiveGameStats;
}

/** Multi-kill: 2–5 kills in quick succession (within ~10s) */
export type MultiKillType = 'double' | 'triple' | 'quadra' | 'penta';

/** Kill streak: 3+ kills without dying (League announcer terms) */
export type KillStreakType = 'killing_spree' | 'rampage' | 'unstoppable' | 'godlike' | 'legendary';

export interface KillEvent {
  eventTime: number;
  killerName: string;   // summoner name
  victimName: string;   // summoner name
  assisters: string[];  // champion names
  killerChamp: string;  // champion id name (for icon)
  victimChamp: string;  // champion id name (for icon)
  /** Computed: double/triple/quadra/penta when killer got 2–5 kills in quick succession */
  multiKill?: MultiKillType;
  /** Computed: killing_spree→legendary when killer has 3+ kills without dying */
  killStreak?: KillStreakType;
  /** Computed: first player-vs-player champion kill of the match */
  firstBlood?: boolean;
  /** Computed: victim had a kill streak (3+) that was ended by this kill */
  shutdown?: boolean;
  /** Computed: this kill resulted in all 5 enemies of the victim team being dead */
  ace?: boolean;
  /** Computed: victim died to non-player source with no assisters */
  execute?: boolean;
  /** Computed: Nth time this champion achieved this multiKill this game (for multiplier display) */
  multiKillCount?: number;
  /** Computed: Nth time this champion achieved this killStreak this game (for multiplier display) */
  killStreakCount?: number;
}

export interface KillEventPlayerSnapshot {
  byName: Record<string, LiveGamePlayer>;
  byChamp: Record<string, LiveGamePlayer>;
}

export interface LiveGameEvent {
  eventName: string;
  eventTime: number;
  killerName?: string;
  victimName?: string;
  assisters?: string[];
  turretKilled?: string;
  inhibKilled?: string;
  monsterType?: string;
  dragonType?: string;
  stolen?: boolean;
  killStreak?: number;   // Multikill event: multi-kill count (2=double..5=penta)
  acer?: string;         // Ace event: player who scored the ace
  acingTeam?: string;    // Ace event: team that aced ("ORDER" or "CHAOS")
  recipient?: string;    // FirstBlood event: player who got first blood
}

export interface LiveGameData {
  gameTime: number;
  gameMode: string;
  gameResult?: string; // "Win" or "Lose" (from active player perspective)
  activePlayer: LiveGameActivePlayer;
  players: LiveGamePlayer[];
  partyMembers?: string[];
  killFeed?: KillEvent[];
  liveEvents?: LiveGameEvent[];
  /** Frozen player state at the moment each kill happened, keyed by eventTime */
  killFeedSnapshots?: Record<number, KillEventPlayerSnapshot>;
}
