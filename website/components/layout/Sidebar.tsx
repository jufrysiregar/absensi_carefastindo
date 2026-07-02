'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/qr-code', label: 'QR Generator' },
  { href: '/dashboard/users', label: 'Management Employee' },
  { href: '/dashboard/emergency', label: 'Darurat & Lembur' },
  { href: '/dashboard/leave-requests', label: 'Leave Requests' },
  { href: '/dashboard/reports', label: 'Reports' },
  { href: '/dashboard/announcements', label: 'Announcements' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [userEmail, setUserEmail] = useState('')

  useEffect(() => {
    async function getUser() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.email) setUserEmail(user.email)
    }
    getUser()
  }, [])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside
      className={cn(
        'relative flex flex-col h-screen bg-white border-r border-slate-200 transition-all duration-300 ease-in-out shrink-0 text-slate-800',
        collapsed ? 'w-16' : 'w-[240px]'
      )}
    >
      <div className={cn('flex items-center justify-center py-6', collapsed ? 'px-2' : 'px-6')}>
        <div className="relative w-full h-10 flex items-center justify-center">
          {/* Using a placeholder logo style or the actual logo if it exists */}
          {!collapsed && (
            <Image 
              src="/logoweb.png" 
              alt="Carefast Logo" 
              width={160} 
              height={45} 
              className="object-contain h-[40px] w-auto" 
              priority 
            />
          )}
          {collapsed && (
            <Image 
              src="/icon.png" 
              alt="Carefast Icon" 
              width={40} 
              height={40} 
              className="object-contain h-[32px] w-auto rounded-md" 
            />
          )}
        </div>
      </div>

      {/* Garis pemisah bawah logo */}
      <div className="mb-4 border-t border-slate-200" />

      {/* Collapse toggle (can be placed elsewhere or visible on mobile only. Hidden on desktop as per standard sidebar unless requested) */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-8 w-6 h-6 bg-white border border-slate-200 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-800 hover:bg-slate-50 z-10 transition-colors md:hidden"
      >
        <span className="sr-only">Toggle</span>
        {/* toggle icon */}
      </button>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 space-y-1">
        {navItems.map(({ href, label }) => {
          const isActive = href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={cn(
                'flex items-center px-4 py-2 text-[14px] font-medium text-left transition-all duration-150 border-l-2',
                isActive
                  ? 'text-blue-600 bg-transparent border-blue-600'
                  : 'text-slate-600 border-transparent hover:bg-slate-50 hover:text-slate-900',
                collapsed && 'justify-center px-0 border-l-0 mx-2 rounded-md'
              )}
            >
              {!collapsed ? (
                <span>{label}</span>
              ) : (
                <span className="font-semibold">{label.charAt(0)}</span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Bottom: Keluar */}
      <div className="border-t border-slate-200 p-3">
        <button
          onClick={handleLogout}
          className={cn(
            'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-[13px] font-semibold text-slate-600 hover:bg-red-50 hover:text-red-600 transition-all duration-150',
            collapsed && 'justify-center px-0'
          )}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Keluar</span>}
        </button>
      </div>
    </aside>
  )
}
