const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://rbhloslxavnlhnruzewo.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJiaGxvc2x4YXZubGhucnV6ZXdvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTE2NTkwMCwiZXhwIjoyMDk0NzQxOTAwfQ.8bwOA4EDLHeci0r71n-ePvw_jv1P8Cy3G2LuoPdqC6o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('attendance')
    .select('status')
    .limit(100);
  if (error) {
    console.error(error);
  } else {
    const statuses = [...new Set(data.map(d => d.status))];
    console.log('Existing statuses in database:', statuses);
  }
}
run();
