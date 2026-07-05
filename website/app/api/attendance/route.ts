import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// POST /api/attendance — INSERT attendance record baru (bypass RLS pakai service role)
export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const body = await request.json()
    const {
      user_id, date, check_in_time, check_out_time,
      break_start, break_end, status, note
    } = body

    if (!user_id || !date || !status) {
      return NextResponse.json({ error: 'user_id, date, dan status wajib diisi' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('attendance')
      .insert({
        user_id,
        date,
        check_in_time: check_in_time || null,
        check_out_time: check_out_time || null,
        break_start: break_start || null,
        break_end: break_end || null,
        status,
        note: note || null,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
