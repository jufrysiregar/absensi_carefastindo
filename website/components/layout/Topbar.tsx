'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/attendance': 'Attendance',
  '/dashboard/users': 'Users & Shift Management',
  '/dashboard/qr-code': 'QR Code Generator',
  '/dashboard/announcements': 'Announcements',
  '/dashboard/reports': 'Reports',
  '/dashboard/leave-requests': 'Leave Requests',
}

export default function Topbar() {
  const pathname = usePathname()
  const title = pageTitles[pathname] ?? 'Dashboard'

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


    </header>
  )
}
