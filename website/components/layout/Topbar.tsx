'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useState, useEffect } from 'react'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/attendance': 'Attendance',
  '/dashboard/users': 'Management Employee',
  '/dashboard/qr-code': 'QR Code Generator',
  '/dashboard/announcements': 'Announcements',
  '/dashboard/reports': 'Reports',
}

export default function Topbar() {
  const pathname = usePathname()
  const title = pageTitles[pathname] ?? 'Dashboard'

  const [userEmail, setUserEmail] = useState('')
  const [userName, setUserName] = useState('Super Admin')

  useEffect(() => {
    async function getUser() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.email) setUserEmail(user.email)
      if (user?.user_metadata?.full_name) setUserName(user.user_metadata.full_name)
    }
    getUser()
  }, [])

  return (
    <header className="h-16 bg-white border-b border-slate-200 shadow-sm flex items-center justify-between px-6 shrink-0">
      {/* Breadcrumb Left */}
      <div className="flex items-center text-sm">
        <Link href="/dashboard" className="text-slate-400 hover:text-slate-600 transition-colors">
          Admin Panel
        </Link>
        <ChevronRight className="w-4 h-4 mx-2 text-slate-400" />
        <span className="font-semibold text-slate-800">{title}</span>
      </div>

      {/* Right side: User info */}
      <div className="flex flex-col items-end">
        <span className="text-[14px] font-bold leading-tight" style={{ color: '#0F172A' }}>
          {userName}
        </span>
        {userEmail && (
          <span className="text-[12px] leading-tight mt-0.5" style={{ color: '#64748B' }}>
            {userEmail}
          </span>
        )}
      </div>
    </header>
  )
}
