const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://rbhloslxavnlhnruzewo.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJiaGxvc2x4YXZubGhucnV6ZXdvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTE2NTkwMCwiZXhwIjoyMDk0NzQxOTAwfQ.8bwOA4EDLHeci0r71n-ePvw_jv1P8Cy3G2LuoPdqC6o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const userId = '3956bcb1-8d29-48ea-b4b2-0064c6111975'; // Citra Kirana ID
  const today = '2026-07-01';

  const testStatuses = ['hadir', 'terlambat', 'alfa', 'sakit', 'izin', 'absen', 'tidak_absen', 'Hadir', 'Terlambat', 'Alfa', 'Sakit', 'Izin', 'Absen'];

  for (const status of testStatuses) {
    try {
      // Delete if exists first
      await supabase.from('attendance').delete().eq('user_id', userId).eq('date', today);

      const { data, error } = await supabase
        .from('attendance')
        .insert({
          user_id: userId,
          date: today,
          status: status
        });

      if (error) {
        console.log(`Status [${status}] -> FAILED:`, error.message);
      } else {
        console.log(`Status [${status}] -> SUCCESS!`);
      }
    } catch (e) {
      console.log(`Status [${status}] -> EXCEPTION:`, e.message);
    }
  }
}
run();
