-- ================================================================
-- MIGRATION: Tabel untuk halaman Reports (Versi Terbaru)
-- Jalankan script ini di Supabase SQL Editor
-- ================================================================

-- ----------------------------------------------------------------
-- 1. Tabel daily_reports (Laporan Harian)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_reports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE        NOT NULL DEFAULT CURRENT_DATE,
  shift       TEXT        NOT NULL DEFAULT 'Shift 1', -- Shift 1, 2, 3, Kantor
  title       TEXT        NOT NULL,
  area        TEXT        NOT NULL,
  officer_name TEXT       NOT NULL,
  job_description TEXT    NOT NULL,
  photos      TEXT[]      NOT NULL DEFAULT '{}',
  status      TEXT        NOT NULL DEFAULT 'draft', -- draft, transferred
  created_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index untuk filter periode & status
CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_daily_reports_status ON daily_reports(status);
CREATE INDEX IF NOT EXISTS idx_daily_reports_shift ON daily_reports(shift);

-- Enable RLS
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;

-- Policy: semua authenticated user bisa CRUD
DROP POLICY IF EXISTS "Allow all for authenticated" ON daily_reports;
CREATE POLICY "Allow all for authenticated" ON daily_reports
  FOR ALL USING (auth.role() = 'authenticated');

-- ----------------------------------------------------------------
-- 2. Tabel contracts (Kontrak Kerja)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contracts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  vendor_name TEXT        NOT NULL DEFAULT 'Rumah Sakit Columbia Asian Medan',
  start_date  DATE        NOT NULL,
  end_date    DATE        NOT NULL,
  file_url    TEXT,
  created_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_contracts_dates ON contracts(start_date, end_date);

-- Enable RLS
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

-- Policy: semua authenticated user bisa CRUD
DROP POLICY IF EXISTS "Allow all for authenticated" ON contracts;
CREATE POLICY "Allow all for authenticated" ON contracts
  FOR ALL USING (auth.role() = 'authenticated');

-- ----------------------------------------------------------------
-- 3. Storage Buckets
-- Buat manual di Supabase Dashboard > Storage, atau jalankan ini:
-- ----------------------------------------------------------------

-- Bucket untuk foto laporan harian
INSERT INTO storage.buckets (id, name, public)
VALUES ('report-photos', 'report-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Bucket untuk file PDF kontrak
INSERT INTO storage.buckets (id, name, public)
VALUES ('contracts', 'contracts', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies untuk report-photos
DROP POLICY IF EXISTS "Public read report-photos" ON storage.objects;
CREATE POLICY "Public read report-photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'report-photos');

DROP POLICY IF EXISTS "Auth upload report-photos" ON storage.objects;
CREATE POLICY "Auth upload report-photos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'report-photos' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Auth delete report-photos" ON storage.objects;
CREATE POLICY "Auth delete report-photos" ON storage.objects
  FOR DELETE USING (bucket_id = 'report-photos' AND auth.role() = 'authenticated');

-- Storage policies untuk contracts
DROP POLICY IF EXISTS "Public read contracts" ON storage.objects;
CREATE POLICY "Public read contracts" ON storage.objects
  FOR SELECT USING (bucket_id = 'contracts');

DROP POLICY IF EXISTS "Auth upload contracts" ON storage.objects;
CREATE POLICY "Auth upload contracts" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'contracts' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Auth delete contracts" ON storage.objects;
CREATE POLICY "Auth delete contracts" ON storage.objects
  FOR DELETE USING (bucket_id = 'contracts' AND auth.role() = 'authenticated');
