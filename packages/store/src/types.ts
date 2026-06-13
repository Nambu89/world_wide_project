// packages/store/src/types.ts
// Domain types — map 1:1 to DB columns (D-100: wide-typed, no EAV)

export interface MarketSnapshot {
  id?: number;
  source: string;
  symbol: string;
  asset_class: string;
  price: number;
  change_pct: number | null;
  captured_at: number; // epoch ms INTEGER (D-101)
}

export interface GdeltEvent {
  id?: number;
  source: string;
  event_id: string;
  category: string | null;
  severity: number | null;
  lat: number | null;
  lon: number | null;
  captured_at: number; // epoch ms INTEGER (D-101)
}

export interface NewsItem {
  id?: number;
  source: string;
  feed_domain: string;
  title: string;
  url: string;
  published_at: number | null;
  captured_at: number; // epoch ms INTEGER (D-101)
}

export interface Briefing {
  id?: number;
  domain: string;
  body_md: string;
  model: string;
  created_at: number;  // epoch ms
  valid_until: number; // epoch ms — getCachedBriefing checks this
}

export interface MarketDaily {
  symbol: string;
  day: number; // epoch ms of the day (midnight UTC)
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}
