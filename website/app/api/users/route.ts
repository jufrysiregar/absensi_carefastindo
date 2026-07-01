import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { name, email, password, role, nip, shiftId } = await request.json()

    if (!name || !email || !password || !role || !nip) {
      return NextResponse.json({ error: 'Mohon lengkapi semua field wajib!' }, { status: 400 })
    }

    if (nip.length !== 6) {
      return NextResponse.json({ error: 'NIP harus berisi 6 digit angka!' }, { status: 400 })
    }

    // 1. Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    })

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    const userId = authData.user.id

    // 2. Insert into public.users
    const { error: userError } = await supabaseAdmin.from('users').insert({
      id: userId,
      email,
      name,
      role,
      nip,
      is_active: true
    })

    if (userError) {
      // rollback auth user creation
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: userError.message }, { status: 400 })
    }

    // 3. Insert into user_shifts
    if (shiftId) {
      const { error: shiftError } = await supabaseAdmin.from('user_shifts').insert({
        user_id: userId,
        shift_id: shiftId,
        effective_date: new Date().toISOString().split('T')[0]
      })
      if (shiftError) {
        console.error('Failed to assign initial user shift:', shiftError.message)
      }
    }

    return NextResponse.json({ success: true, userId })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { userId } = await request.json()

    if (!userId) {
      return NextResponse.json({ error: 'User ID wajib disertakan!' }, { status: 400 })
    }

    // Block deletion if the user is a superadmin
    const { data: userRecord, error: userFetchError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', userId)
      .single()

    if (userFetchError) {
      return NextResponse.json({ error: 'DB Fetch: ' + userFetchError.message }, { status: 400 })
    }

    if (userRecord && userRecord.role.toLowerCase() === 'superadmin') {
      return NextResponse.json(
        { error: 'Super Admin tidak dapat dihapus' },
        { status: 403 }
      )
    }

    // 1. Delete from Supabase Auth
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (authError) {
      return NextResponse.json({ error: 'Auth: ' + authError.message }, { status: 400 })
    }

    // 2. Delete from public.users (cascades to user_shifts)
    const { error: userError } = await supabaseAdmin.from('users').delete().eq('id', userId)
    if (userError) {
      return NextResponse.json({ error: 'DB: ' + userError.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
