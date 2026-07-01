'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import Topbar from '@/components/layout/Topbar'

const Sidebar = dynamic(() => import('@/components/layout/Sidebar'), { ssr: false })

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) return null

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}

