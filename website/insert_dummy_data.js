const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://rbhloslxavnlhnruzewo.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJiaGxvc2x4YXZubGhucnV6ZXdvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTE2NTkwMCwiZXhwIjoyMDk0NzQxOTAwfQ.8bwOA4EDLHeci0r71n-ePvw_jv1P8Cy3G2LuoPdqC6o';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`\n========================================`);
    console.log(`Inserting dummy attendance data for: ${today}`);
    console.log(`========================================\n`);

    // Fetch all users
    const { data: users, error: userErr } = await supabase
      .from('users')
      .select('id, email, name');
    if (userErr) throw userErr;
    console.log(`Found ${users.length} users in database`);

    // Fetch all shifts
    const { data: shifts, error: shiftErr } = await supabase
      .from('shifts')
      .select('id, name');
    if (shiftErr) throw shiftErr;
    console.log(`Found ${shifts.length} shifts in database\n`);

    const findUser  = (email) => users.find(u => u.email.toLowerCase() === email.toLowerCase());
    const findShift = (name)  => shifts.find(s => s.name.toLowerCase() === name.toLowerCase());

    // Helper: convert HH:mm to full ISO timestamp (same day)
    const toTs = (timeStr) => timeStr ? `${today}T${timeStr}:00` : null;

    // Helper: convert HH:mm to timestamp — if hour < 12, assume next day (overnight)
    const toTsNextDay = (timeStr) => {
      if (!timeStr) return null;
      const hour = parseInt(timeStr.split(':')[0], 10);
      if (hour < 12) {
        const d = new Date(today);
        d.setDate(d.getDate() + 1);
        return `${d.toISOString().split('T')[0]}T${timeStr}:00`;
      }
      return `${today}T${timeStr}:00`;
    };

    // ============================================================
    // DUMMY DATA - 6 Karyawan Utama
    // ============================================================
    const dummyList = [
      {
        email:      'ahmad.faisal@dummy.com',
        shiftName:  'Shift Kantor',
        checkIn:    '07:15',
        breakStart: '12:00',
        breakEnd:   '13:00',
        checkOut:   '17:10',
        status:     'hadir',
        shiftType:  'single',
        notes:      null
      },
      {
        email:      'bambang.utomo@dummy.com',
        shiftName:  'Shift 1',
        checkIn:    '08:45',
        breakStart: '12:00',
        breakEnd:   '13:00',
        checkOut:   '15:30',
        status:     'terlambat',
        shiftType:  'single',
        notes:      null
      },
      {
        email:      'citra.kirana@dummy.com',
        shiftName:  'Shift 2',
        checkIn:    null,
        breakStart: null,
        breakEnd:   null,
        checkOut:   null,
        status:     'izin',
        shiftType:  'single',
        notes:      'Izin keperluan keluarga'
      },
      {
        email:      'dedi.kusnadi@dummy.com',
        shiftName:  'Shift 1',
        checkIn:    '06:50',
        breakStart: '11:30',
        breakEnd:   '12:30',
        checkOut:   '15:05',
        status:     'hadir',
        shiftType:  'single',
        notes:      null
      },
      {
        email:      'eka.saputra@dummy.com',
        shiftName:  'Shift 3',
        checkIn:    '22:50',
        breakStart: '03:00',
        breakEnd:   '04:00',
        checkOut:   '07:05',
        status:     'hadir',
        shiftType:  'single',
        notes:      null
      },
      {
        email:         'mjuffrisiregar@gmail.com',
        shiftName:     'Shift 2',
        checkIn:       '14:52',
        breakStart:    '18:00',
        breakEnd:      '19:15',
        checkOut:      '23:01',
        status:        'hadir',
        shiftType:     'double',
        notes:         'Pembersihan kaca luar tower A',
        overtimeStart: '23:01',
        overtimeEnd:   '02:00'   // next day
      }
    ];

    // ============================================================
    // UPSERT: user_shifts + attendance + overtime_assignments
    // ============================================================
    for (const d of dummyList) {
      const u = findUser(d.email);
      if (!u) {
        console.warn(`  ⚠️  User ${d.email} NOT FOUND — skipped`);
        continue;
      }
      const s = findShift(d.shiftName);
      if (!s) {
        console.warn(`  ⚠️  Shift "${d.shiftName}" NOT FOUND for ${u.name} — skipped`);
        continue;
      }

      console.log(`\n[${u.name}] (${d.status.toUpperCase()})`);

      // 1. Upsert user_shifts (shift assignment for today)
      const { data: existingUS } = await supabase
        .from('user_shifts')
        .select('id')
        .eq('user_id', u.id)
        .eq('effective_date', today)
        .maybeSingle();

      const usData = {
        user_id:        u.id,
        shift_id:       s.id,
        effective_date: today,
        shift_type:     d.shiftType
      };

      if (existingUS) {
        const { error: e } = await supabase.from('user_shifts').update(usData).eq('id', existingUS.id);
        if (e) { console.error(`  ✗ user_shifts update: ${e.message}`); } else { console.log(`  ✓ user_shifts UPDATED`); }
      } else {
        const { error: e } = await supabase.from('user_shifts').insert(usData);
        if (e) { console.error(`  ✗ user_shifts insert: ${e.message}`); } else { console.log(`  ✓ user_shifts INSERTED`); }
      }

      // 2. Upsert attendance
      const { data: existingAtt } = await supabase
        .from('attendance')
        .select('id')
        .eq('user_id', u.id)
        .eq('date', today)
        .maybeSingle();

      const attData = {
        user_id:        u.id,
        date:           today,
        check_in_time:  toTs(d.checkIn),
        break_start:    d.breakStart && parseInt(d.breakStart) < 12 ? toTsNextDay(d.breakStart) : toTs(d.breakStart),
        break_end:      d.breakEnd   && parseInt(d.breakEnd)   < 12 ? toTsNextDay(d.breakEnd)   : toTs(d.breakEnd),
        check_out_time: d.checkOut   && parseInt(d.checkOut)   < 12 ? toTsNextDay(d.checkOut)   : toTs(d.checkOut),
        status:         d.status,
        note:           d.notes
      };

      if (existingAtt) {
        const { error: e } = await supabase.from('attendance').update(attData).eq('id', existingAtt.id);
        if (e) { console.error(`  ✗ attendance update: ${e.message}`); } else { console.log(`  ✓ attendance UPDATED`); }
      } else {
        const { error: e } = await supabase.from('attendance').insert(attData);
        if (e) { console.error(`  ✗ attendance insert: ${e.message}`); } else { console.log(`  ✓ attendance INSERTED`); }
      }

      // 3. Overtime (only for double shift)
      if (d.shiftType === 'double' && d.overtimeStart && d.overtimeEnd) {
        const { data: existingOT } = await supabase
          .from('overtime_assignments')
          .select('id')
          .eq('user_id', u.id)
          .eq('assignment_date', today)
          .maybeSingle();

        const otData = {
          user_id:           u.id,
          shift_id:          s.id,
          assignment_date:   today,
          overtime_check_in:  toTs(d.overtimeStart),
          overtime_check_out: toTsNextDay(d.overtimeEnd),
          status:            'active'
        };

        if (existingOT) {
          const { error: e } = await supabase.from('overtime_assignments').update(otData).eq('id', existingOT.id);
          if (e) { console.error(`  ✗ overtime update: ${e.message}`); } else { console.log(`  ✓ overtime_assignments UPDATED`); }
        } else {
          const { error: e } = await supabase.from('overtime_assignments').insert(otData);
          if (e) { console.error(`  ✗ overtime insert: ${e.message}`); } else { console.log(`  ✓ overtime_assignments INSERTED`); }
        }
      }
    }

    // ============================================================
    // RANDOM STATUS FOR OTHER USERS (not in the main 6)
    // ============================================================
    const mainEmails = dummyList.map(d => d.email.toLowerCase());
    const superAdminEmail = 'superadmin.mjs@gmail.com';
    const otherUsers = users.filter(u =>
      !mainEmails.includes(u.email.toLowerCase()) &&
      u.email.toLowerCase() !== superAdminEmail.toLowerCase()
    );

    if (otherUsers.length > 0) {
      console.log(`\n[Other users: ${otherUsers.length}]`);
      for (const ou of otherUsers) {
        const { data: existingAtt } = await supabase
          .from('attendance')
          .select('id')
          .eq('user_id', ou.id)
          .eq('date', today)
          .maybeSingle();

        if (!existingAtt) {
          const isHadir = Math.random() > 0.3;
          const attData = {
            user_id:        ou.id,
            date:           today,
            status:         isHadir ? 'hadir' : 'absen',
            check_in_time:  isHadir ? `${today}T07:05:00` : null,
            check_out_time: isHadir ? `${today}T15:00:00` : null
          };
          const { error: e } = await supabase.from('attendance').insert(attData);
          if (e) {
            console.log(`  ✗ ${ou.name}: ${e.message}`);
          } else {
            console.log(`  ✓ ${ou.name}: ${attData.status}`);
          }
        } else {
          console.log(`  → ${ou.name}: attendance already exists (skipped)`);
        }
      }
    }

    console.log(`\n========================================`);
    console.log(`SELESAI! Dummy data berhasil dimasukkan.`);
    console.log(`========================================\n`);

  } catch (error) {
    console.error('\n✗ Fatal error:', error.message || error);
    process.exit(1);
  }
}

run();
