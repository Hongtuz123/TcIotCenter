export interface Sensor {
  id: string;
  name: string;
  lat: number;
  lon: number;
  county: string;
  status: string;
}

export interface Observation {
  sensor_id: string;
  time: string;
  pm2_5: number | null;
  temperature: number | null;
  humidity: number | null;
  voc: number | null;
  tvoc: number | null;
  prev_temperature?: number;
  tempDiff?: number;
  isAnomaly?: boolean;
  anomalyType?: string;
  score?: number;
}

export interface Event {
  id: string;
  title: string;
  description: string;
  status: '待確認' | '調查中' | '已結案';
  created_at: string;
  updated_at: string;
  bounds?: {
    center: { lat: number; lon: number };
    radiusKm: number;
  } | null;
  sensors?: Sensor[];
}

export interface Cluster {
  id: string;
  center: { lat: number; lon: number };
  radiusKm: number;
  stationsCount: number;
  avgPm25: number;
  maxScore: number;
  dominantType: string;
  stations: { id: string; name: string; pm2_5: number | null }[];
}

export interface SystemSettings {
  pm25_threshold: number;
  temp_increase_threshold: number;
  voc_threshold: number;
  cluster_radius_km: number;
  min_cluster_stations: number;
}
