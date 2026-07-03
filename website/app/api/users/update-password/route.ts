import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { userId, newPassword } = await request.json()

    if (!userId || !newPassword) {
      return NextResponse.json({ error: 'User ID dan password wajib disertakan!' }, { status: 400 })
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter!' }, { status: 400 })
    }

    // 1. Update password di Supabase Auth
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    )

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    // 2. Kirim notifikasi ke karyawan yang passwordnya diubah
    const { error: notifError } = await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      message: 'Admin telah memperbaharui password akun anda, silahkan coba relogin untuk memastikan password baru anda apakah sudah bisa digunakan. Terimakasih.',
      is_read: false,
      created_at: new Date().toISOString(),
    })

    if (notifError) {
      console.error('Failed to send password change notification:', notifError.message)
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
