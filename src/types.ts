export interface UserData {
  id: string;
  username: string;
  displayName: string;
  profileImage: string;
  authMethod?: 'x' | 'email' | 'clerk';
  isAdmin?: boolean;
}

export interface ScheduledPost {
  id: number;
  content: string;
  scheduled_at: string;
  status: 'pending' | 'posted' | 'failed';
  error_code?: string;
  error_message?: string;
}

export interface ReportSchedule {
  id: number;
  report_type: string;
  custom_topic?: string;
  schedule_time: string;
  days: string;
  enabled: boolean;
  last_run?: string;
}

export interface SocialAccount {
  platform: string;
  handle: string;
}

// ChokePoint Watch

export type ProducerTier = 'primary' | 'secondary' | 'minor' | null;

export interface Country {
  iso3: string;
  name: string;
  centroid_lat: number | null;
  centroid_lng: number | null;
  oil_producer_tier: ProducerTier;
  lng_producer_tier: ProducerTier;
  created_at: string;
  updated_at: string;
}

export type ChokepointId =
  | 'hormuz'
  | 'bab_el_mandeb'
  | 'malacca'
  | 'suez'
  | 'bosporus'
  | 'panama'
  | 'cape_of_good_hope';

export interface Chokepoint {
  id: ChokepointId;
  name: string;
  center_lat: number;
  center_lng: number;
  bbox_min_lat: number;
  bbox_min_lng: number;
  bbox_max_lat: number;
  bbox_max_lng: number;
  created_at: string;
}

export type InfrastructureType =
  | 'rig'
  | 'field'
  | 'terminal_export'
  | 'terminal_import'
  | 'refinery'
  | 'storage';

export interface Infrastructure {
  id: string;
  country_iso3: string;
  type: InfrastructureType;
  name: string;
  lat: number;
  lng: number;
  capacity_value: number | null;
  capacity_unit: string | null;
  capacity_as_of: string | null;
  source: string | null;
  created_at: string;
}

export type FlowProduct = 'crude' | 'lng' | 'naphtha' | 'lpg' | 'condensate';
export type FlowVolumeUnit = 'kbd' | 'mt' | 'bcm' | 'm3';
export type FlowSource = 'jodi' | 'eia' | 'giignl' | 'manual';
export type FlowConfidence = 'high' | 'medium' | 'low';

export interface FlowMonthly {
  id: string;
  origin_iso3: string;
  destination_iso3: string;
  product: FlowProduct;
  month: string;
  volume_value: number;
  volume_unit: FlowVolumeUnit;
  source: FlowSource;
  confidence: FlowConfidence;
  created_at: string;
}

export type AnomalySeverity = 'low' | 'medium' | 'high';

export interface AgentAnomaly {
  type: 'flow' | 'vessel' | 'event' | 'sanctions';
  severity: AnomalySeverity;
  chokepoint_id: ChokepointId | null;
  summary: string;
  details: Record<string, unknown>;
}

export interface ChokepointAgentRun {
  id: string;
  ts: string;
  baseline_window: string;
  anomalies_detected: AgentAnomaly[];
  synthesis_md: string | null;
  model_used: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

export type StatusPill = 'green' | 'yellow' | 'red';

export interface ChokepointStatus {
  id: string;
  chokepoint_id: ChokepointId;
  ts: string;
  status: StatusPill;
  headline_signal: string | null;
  flow_delta_pct: number | null;
  event_count_24h: number | null;
  sanctions_delta_24h: number | null;
  agent_run_id: string | null;
  created_at: string;
}
