-- WaveWorld Knowledge DB schema (SQLite dialect, Postgres-portable types)
-- Authority: docs/knowledge-db.md
-- Apply via migration runner; do not hand-edit production DB without migration id.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_cursors (
  provider TEXT PRIMARY KEY,
  cursor TEXT,
  updated_at TEXT NOT NULL,
  meta_json TEXT
);

-- ─── G1 Symbol skeleton ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS energy_nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES energy_nodes(id),
  name TEXT NOT NULL,
  name_en TEXT,
  symbol TEXT,
  icon TEXT,
  color TEXT,
  desc_zh TEXT NOT NULL DEFAULT '',
  desc_en TEXT,
  quantities_json TEXT NOT NULL DEFAULT '[]',
  consensus_json TEXT NOT NULL DEFAULT '{}',
  refs_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_energy_nodes_parent ON energy_nodes(parent_id);

CREATE TABLE IF NOT EXISTS conversion_edges (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL REFERENCES energy_nodes(id),
  to_node_id TEXT NOT NULL REFERENCES energy_nodes(id),
  name TEXT NOT NULL,
  name_en TEXT,
  principle TEXT NOT NULL DEFAULT '',
  principle_en TEXT,
  efficiency_kind TEXT NOT NULL DEFAULT 'conversion'
    CHECK (efficiency_kind IN ('conversion', 'transport')),
  -- legacy mirrors from static JSON (migration window); truth → claims
  efficiency_json TEXT,
  formula_json TEXT,
  loss_mechanisms_json TEXT,
  maturity TEXT,
  apps_json TEXT,
  consensus_json TEXT NOT NULL DEFAULT '{}',
  refs_json TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'deprecated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_from ON conversion_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON conversion_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_from_to ON conversion_edges(from_node_id, to_node_id);

CREATE TABLE IF NOT EXISTS edge_devices (
  id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL REFERENCES conversion_edges(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  label_en TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_edge_devices_edge ON edge_devices(edge_id);

CREATE TABLE IF NOT EXISTS edge_products (
  id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL REFERENCES conversion_edges(id) ON DELETE CASCADE,
  vendor TEXT,
  vendor_en TEXT,
  model TEXT NOT NULL,
  model_en TEXT,
  spec TEXT,
  spec_en TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_edge_products_edge ON edge_products(edge_id);

-- ─── G2 Materials ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS material_categories (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  label_en TEXT,
  cross_check TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  category_id TEXT REFERENCES material_categories(id),
  name TEXT NOT NULL,
  name_en TEXT,
  formula TEXT,
  kind TEXT NOT NULL DEFAULT 'other'
    CHECK (kind IN ('forcefield_lj', 'fluid_continuum', 'device_product', 'other')),
  fidelity TEXT
    CHECK (fidelity IS NULL OR fidelity IN ('quantitative', 'qualitative')),
  forcefield TEXT,
  notes TEXT,
  source_text TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category_id);
CREATE INDEX IF NOT EXISTS idx_materials_kind ON materials(kind);

CREATE TABLE IF NOT EXISTS material_properties (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_num REAL,
  value_text TEXT,
  unit TEXT NOT NULL,
  condition_json TEXT,
  fidelity TEXT,
  claim_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (material_id, key, condition_json)
);

CREATE INDEX IF NOT EXISTS idx_mat_props_material ON material_properties(material_id);

-- ─── G3 Source snapshots ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS source_snapshots (
  id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  locator TEXT NOT NULL,
  locator_kind TEXT NOT NULL
    CHECK (locator_kind IN ('url', 'doi', 'citation', 'other')),
  captured_at TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  capture_status TEXT NOT NULL
    CHECK (capture_status IN ('locator-only', 'bytes-captured')),
  content_type TEXT,
  byte_length INTEGER,
  license TEXT,
  cursor TEXT,
  title TEXT,
  provider TEXT,
  -- relative path under knowledge-blobs when bytes-captured
  blob_relpath TEXT,
  UNIQUE (content_sha256, locator)
);

CREATE INDEX IF NOT EXISTS idx_snap_sha ON source_snapshots(content_sha256);
CREATE INDEX IF NOT EXISTS idx_snap_provider ON source_snapshots(provider);

-- ─── G4 Claims & evidence ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  statement_json TEXT NOT NULL,
  state TEXT NOT NULL
    CHECK (state IN ('candidate', 'quarantine', 'validated', 'released')),
  confidence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_claims_subject ON claims(subject_id);
CREATE INDEX IF NOT EXISTS idx_claims_kind_state ON claims(kind, state);
CREATE INDEX IF NOT EXISTS idx_claims_state ON claims(state);

CREATE TABLE IF NOT EXISTS evidence_bindings (
  id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  source_snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
  support TEXT NOT NULL DEFAULT 'supports'
    CHECK (support IN ('supports', 'refutes', 'context')),
  locator_json TEXT,
  provider TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bind_claim ON evidence_bindings(claim_id);
CREATE INDEX IF NOT EXISTS idx_bind_snap ON evidence_bindings(source_snapshot_id);

CREATE TABLE IF NOT EXISTS conflict_sets (
  id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  subject_id TEXT NOT NULL,
  reason TEXT,
  resolution_note TEXT,
  state TEXT NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'resolved')),
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS conflict_members (
  conflict_id TEXT NOT NULL REFERENCES conflict_sets(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  PRIMARY KEY (conflict_id, claim_id)
);

-- ─── G5 Releases ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_releases (
  id TEXT PRIMARY KEY,
  contract_version INTEGER NOT NULL DEFAULT 1,
  released_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'released'
    CHECK (state IN ('released')),
  sha256 TEXT NOT NULL,
  -- optional canonical JSON export path for static CDN
  export_relpath TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_releases_time ON knowledge_releases(released_at DESC);

CREATE TABLE IF NOT EXISTS release_claims (
  release_id TEXT NOT NULL REFERENCES knowledge_releases(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL REFERENCES claims(id),
  PRIMARY KEY (release_id, claim_id)
);

CREATE TABLE IF NOT EXISTS release_snapshots (
  release_id TEXT NOT NULL REFERENCES knowledge_releases(id) ON DELETE CASCADE,
  source_snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
  PRIMARY KEY (release_id, source_snapshot_id)
);

CREATE TABLE IF NOT EXISTS release_bindings (
  release_id TEXT NOT NULL REFERENCES knowledge_releases(id) ON DELETE CASCADE,
  binding_id TEXT NOT NULL REFERENCES evidence_bindings(id),
  PRIMARY KEY (release_id, binding_id)
);

CREATE TABLE IF NOT EXISTS release_conflicts (
  release_id TEXT NOT NULL REFERENCES knowledge_releases(id) ON DELETE CASCADE,
  conflict_id TEXT NOT NULL REFERENCES conflict_sets(id),
  PRIMARY KEY (release_id, conflict_id)
);

-- ─── Convenience views (read models) ──────────────────────────────

CREATE VIEW IF NOT EXISTS v_released_claims AS
SELECT c.*
FROM claims c
WHERE c.state = 'released'
  AND EXISTS (
    SELECT 1 FROM release_claims rc WHERE rc.claim_id = c.id
  );
