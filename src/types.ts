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

export interface ChampionDetail extends ChampionBasic {
  skins: Skin[];
  lore: string;
}

export type ViewMode = 'select' | 'viewer';
