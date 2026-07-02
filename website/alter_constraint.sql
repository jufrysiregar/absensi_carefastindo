-- ============================================
-- STEP 1: ALTER CHECK CONSTRAINT PADA TABLE ATTENDANCE
-- Jalankan script ini di Supabase SQL Editor
-- ============================================

-- Drop constraint lama
ALTER TABLE attendance 
DROP CONSTRAINT IF EXISTS attendance_status_check;

-- Buat constraint baru yang include semua status yang dibutuhkan
ALTER TABLE attendance 
ADD CONSTRAINT attendance_status_check 
CHECK (status IN ('hadir', 'terlambat', 'tidak_absen', 'izin', 'sakit', 'absen', 'alfa'));

-- Verifikasi constraint berhasil ditambahkan
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conname = 'attendance_status_check';
