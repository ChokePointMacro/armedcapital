-- ChokePoint Watch (maritime energy chokepoints + Tension Agent)
-- Six tables: countries, chokepoints, infrastructure, flows_monthly,
-- chokepoint_agent_runs, chokepoint_status. The agent runs daily on
-- Vercel cron, writes anomaly detections + a synthesis row, plus one
-- chokepoint_status pill per chokepoint. Reference data is seeded at
-- the end of this file (idempotent on conflict).

CREATE TABLE IF NOT EXISTS countries (
  iso3 TEXT PRIMARY KEY,                                        -- ISO 3166-1 alpha-3
  name TEXT NOT NULL,
  centroid_lat NUMERIC,
  centroid_lng NUMERIC,
  oil_producer_tier TEXT CHECK (oil_producer_tier IN ('primary','secondary','minor')),
  lng_producer_tier TEXT CHECK (lng_producer_tier IN ('primary','secondary','minor')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chokepoints (
  id TEXT PRIMARY KEY,                                          -- slug: 'hormuz', 'suez', etc.
  name TEXT NOT NULL,
  center_lat NUMERIC NOT NULL,
  center_lng NUMERIC NOT NULL,
  bbox_min_lat NUMERIC NOT NULL,
  bbox_min_lng NUMERIC NOT NULL,
  bbox_max_lat NUMERIC NOT NULL,
  bbox_max_lng NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS infrastructure (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  country_iso3 TEXT NOT NULL REFERENCES countries(iso3) ON DELETE CASCADE,
  type TEXT NOT NULL
    CHECK (type IN ('rig','field','terminal_export','terminal_import','refinery','storage')),
  name TEXT NOT NULL,
  lat NUMERIC NOT NULL,
  lng NUMERIC NOT NULL,
  capacity_value NUMERIC,
  capacity_unit TEXT,
  capacity_as_of DATE,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flows_monthly (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  origin_iso3 TEXT NOT NULL REFERENCES countries(iso3),
  destination_iso3 TEXT NOT NULL REFERENCES countries(iso3),
  product TEXT NOT NULL CHECK (product IN ('crude','lng','naphtha','lpg','condensate')),
  month DATE NOT NULL,
  volume_value NUMERIC NOT NULL,
  volume_unit TEXT NOT NULL CHECK (volume_unit IN ('kbd','mt','bcm','m3')),
  source TEXT NOT NULL CHECK (source IN ('jodi','eia','giignl','manual')),
  confidence TEXT NOT NULL DEFAULT 'high' CHECK (confidence IN ('high','medium','low')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (origin_iso3, destination_iso3, product, month, source)
);

CREATE TABLE IF NOT EXISTS chokepoint_agent_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ts TIMESTAMPTZ DEFAULT NOW(),
  baseline_window TEXT NOT NULL DEFAULT '90d',
  anomalies_detected JSONB NOT NULL DEFAULT '[]'::jsonb,
  synthesis_md TEXT,
  model_used TEXT,
  tokens_in INT,
  tokens_out INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chokepoint_status (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chokepoint_id TEXT NOT NULL REFERENCES chokepoints(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('green','yellow','red')),
  headline_signal TEXT,
  flow_delta_pct NUMERIC,
  event_count_24h INT,
  sanctions_delta_24h INT,
  agent_run_id UUID REFERENCES chokepoint_agent_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_countries_oil_tier ON countries(oil_producer_tier) WHERE oil_producer_tier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_countries_lng_tier ON countries(lng_producer_tier) WHERE lng_producer_tier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_infrastructure_country ON infrastructure(country_iso3);
CREATE INDEX IF NOT EXISTS idx_infrastructure_type ON infrastructure(type);
CREATE INDEX IF NOT EXISTS idx_flows_origin ON flows_monthly(origin_iso3, month DESC);
CREATE INDEX IF NOT EXISTS idx_flows_destination ON flows_monthly(destination_iso3, month DESC);
CREATE INDEX IF NOT EXISTS idx_flows_product_month ON flows_monthly(product, month DESC);
CREATE INDEX IF NOT EXISTS idx_chokepoint_agent_runs_ts ON chokepoint_agent_runs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_chokepoint_status_lookup ON chokepoint_status(chokepoint_id, ts DESC);

ALTER TABLE countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE chokepoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE infrastructure ENABLE ROW LEVEL SECURITY;
ALTER TABLE flows_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE chokepoint_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chokepoint_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON countries FOR ALL USING (true);
CREATE POLICY "Allow all" ON chokepoints FOR ALL USING (true);
CREATE POLICY "Allow all" ON infrastructure FOR ALL USING (true);
CREATE POLICY "Allow all" ON flows_monthly FOR ALL USING (true);
CREATE POLICY "Allow all" ON chokepoint_agent_runs FOR ALL USING (true);
CREATE POLICY "Allow all" ON chokepoint_status FOR ALL USING (true);

-- Seed: 7 maritime chokepoints with approximate bounding boxes
INSERT INTO chokepoints (id, name, center_lat, center_lng, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng) VALUES
  ('hormuz',            'Strait of Hormuz',     26.566,  56.250,  25.500,  54.500,  27.500,  57.500),
  ('bab_el_mandeb',     'Bab el-Mandeb',        12.583,  43.333,  11.800,  42.500,  13.500,  44.200),
  ('malacca',           'Strait of Malacca',     2.500, 101.500,   1.000,  98.500,   6.000, 103.500),
  ('suez',              'Suez Canal',           30.500,  32.500,  29.800,  32.300,  31.600,  32.700),
  ('bosporus',          'Bosporus',             41.150,  29.050,  40.950,  28.900,  41.350,  29.250),
  ('panama',            'Panama Canal',          9.080, -79.680,   8.850, -80.000,   9.450, -79.500),
  ('cape_of_good_hope', 'Cape of Good Hope',   -34.350,  18.500, -35.500,  17.000, -33.500,  20.500)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  center_lat = EXCLUDED.center_lat,
  center_lng = EXCLUDED.center_lng,
  bbox_min_lat = EXCLUDED.bbox_min_lat,
  bbox_min_lng = EXCLUDED.bbox_min_lng,
  bbox_max_lat = EXCLUDED.bbox_max_lat,
  bbox_max_lng = EXCLUDED.bbox_max_lng;

-- Seed: producer countries (15 oil >1 MMbbl/d + 4 LNG-only majors) and importer destinations
INSERT INTO countries (iso3, name, centroid_lat, centroid_lng, oil_producer_tier, lng_producer_tier) VALUES
  -- Primary oil producers (>1 MMbbl/d)
  ('USA', 'United States',         39.83,  -98.58, 'primary',   'primary'),
  ('SAU', 'Saudi Arabia',          23.89,   45.08, 'primary',   NULL),
  ('RUS', 'Russia',                61.52,  105.32, 'primary',   'primary'),
  ('CAN', 'Canada',                56.13, -106.35, 'primary',   NULL),
  ('IRQ', 'Iraq',                  33.22,   43.68, 'primary',   NULL),
  ('CHN', 'China',                 35.86,  104.20, 'primary',   NULL),
  ('ARE', 'United Arab Emirates',  23.42,   53.85, 'primary',   'secondary'),
  ('IRN', 'Iran',                  32.43,   53.69, 'primary',   NULL),
  ('BRA', 'Brazil',               -14.24,  -51.93, 'primary',   NULL),
  ('KWT', 'Kuwait',                29.31,   47.48, 'primary',   NULL),
  ('NOR', 'Norway',                60.47,    8.47, 'primary',   'secondary'),
  ('MEX', 'Mexico',                23.63, -102.55, 'primary',   NULL),
  ('KAZ', 'Kazakhstan',            48.02,   66.92, 'primary',   NULL),
  ('NGA', 'Nigeria',                9.08,    8.68, 'primary',   'secondary'),
  ('QAT', 'Qatar',                 25.35,   51.18, 'primary',   'primary'),
  -- LNG-only majors
  ('AUS', 'Australia',            -25.27,  133.78, NULL,        'primary'),
  ('MYS', 'Malaysia',               4.21,  101.98, NULL,        'primary'),
  ('IDN', 'Indonesia',             -0.79,  113.92, NULL,        'primary'),
  ('TTO', 'Trinidad and Tobago',   10.69,  -61.22, NULL,        'primary'),
  -- Importer destinations (FK targets for JODI flows)
  ('IND', 'India',                 20.59,   78.96, NULL,        NULL),
  ('JPN', 'Japan',                 36.20,  138.25, NULL,        NULL),
  ('KOR', 'South Korea',           35.91,  127.77, NULL,        NULL),
  ('TWN', 'Taiwan',                23.70,  120.96, NULL,        NULL),
  ('SGP', 'Singapore',              1.35,  103.82, NULL,        NULL),
  ('THA', 'Thailand',              15.87,  100.99, NULL,        NULL),
  ('PHL', 'Philippines',           12.88,  121.77, NULL,        NULL),
  ('VNM', 'Vietnam',               14.06,  108.28, NULL,        NULL),
  ('PAK', 'Pakistan',              30.38,   69.35, NULL,        NULL),
  ('GBR', 'United Kingdom',        55.38,   -3.44, NULL,        NULL),
  ('FRA', 'France',                46.23,    2.21, NULL,        NULL),
  ('DEU', 'Germany',               51.17,   10.45, NULL,        NULL),
  ('ITA', 'Italy',                 41.87,   12.57, NULL,        NULL),
  ('ESP', 'Spain',                 40.46,   -3.75, NULL,        NULL),
  ('NLD', 'Netherlands',           52.13,    5.29, NULL,        NULL),
  ('BEL', 'Belgium',               50.50,    4.47, NULL,        NULL),
  ('TUR', 'Turkey',                38.96,   35.24, NULL,        NULL),
  ('GRC', 'Greece',                39.07,   21.82, NULL,        NULL),
  ('EGY', 'Egypt',                 26.82,   30.80, NULL,        NULL),
  ('ZAF', 'South Africa',         -30.56,   22.94, NULL,        NULL)
ON CONFLICT (iso3) DO UPDATE SET
  name = EXCLUDED.name,
  centroid_lat = EXCLUDED.centroid_lat,
  centroid_lng = EXCLUDED.centroid_lng,
  oil_producer_tier = EXCLUDED.oil_producer_tier,
  lng_producer_tier = EXCLUDED.lng_producer_tier,
  updated_at = NOW();
