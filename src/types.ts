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

export interface KillEvent {
  eventTime: number;
  killerName: string;   // summoner name
  victimName: string;   // summoner name
  assisters: string[];  // champion names
  killerChamp: string;  // champion id name (for icon)
  victimChamp: string;  // champion id name (for icon)
}

export interface LiveGameData {
  gameTime: number;
  gameMode: string;
  gameResult?: string; // "Win" or "Lose" (from active player perspective)
  activePlayer: LiveGameActivePlayer;
  players: LiveGamePlayer[];
  killFeed?: KillEvent[];
}
