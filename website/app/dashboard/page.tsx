'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Users, CheckCircle, ClipboardList, HeartPulse, TrendingUp, Clock } from 'lucide-react'
import { motion } from 'framer-motion'
import { formatDate, formatTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { Skeleton } from '@/components/ui/skeleton'

interface Stats { total: number; hadir: number; izin: number; sakit: number }
interface RecentAttendance {
  id: string; user_name: string; shift_name: string
  date: string; check_in: string | null; status: string
}
interface WeeklyData { day: string; hadir: number }

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

export default function DashboardPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [userName, setUserName] = useState('Super Admin')

  useEffect(() => {
    async function getUser() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.user_metadata?.name) {
        setUserName(user.user_metadata.name)
      }
    }
    getUser()
  }, [supabase])

  // Realtime subscription setup
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, queryClient])

  // Fetch general stats
  const { data: stats, isLoading: statsLoading } = useQuery<Stats>({
    queryKey: ['dashboard', 'stats'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const [usersRes, attendanceRes] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true }),
        supabase.from('attendance').select('id, status').eq('date', today),
      ])

      const total = usersRes.count ?? 0
      const records = attendanceRes.data ?? []
      const hadir = records.filter(r => r.status === 'hadir').length
      const izin = records.filter(r => r.status === 'izin').length
      const sakit = records.filter(r => r.status === 'sakit').length

      return { total, hadir, izin, sakit }
    },
  })

  // Fetch recent 5 attendance
  const { data: recent, isLoading: recentLoading } = useQuery<RecentAttendance[]>({
    queryKey: ['dashboard', 'recent'],
    queryFn: async () => {
      const { data } = await supabase
        .from('attendance')
        .select('id, status, check_in_time, date, users(name), user_shifts(shifts(name))')
        .order('created_at', { ascending: false })
        .limit(5)

      return (data ?? []).map((r: any) => ({
        id: r.id,
        user_name: r.users?.name ?? '—',
        shift_name: r.user_shifts?.shifts?.name ?? '—',
        date: r.date,
        check_in: r.check_in_time,
        status: r.status,
      }))
    },
  })

  // Fetch weekly chart data
  const { data: weekly, isLoading: weeklyLoading } = useQuery<WeeklyData[]>({
    queryKey: ['dashboard', 'weekly'],
    queryFn: async () => {
      const days: WeeklyData[] = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const dateStr = d.toISOString().split('T')[0]
        const { count } = await supabase
          .from('attendance')
          .select('id', { count: 'exact', head: true })
          .eq('date', dateStr)
          .eq('status', 'hadir')

        days.push({ day: DAYS[d.getDay()], hadir: count ?? 0 })
      }
      return days
    },
  })

  const pct = (n: number) => {
    if (!stats || stats.total === 0) return '0%'
    return `${((n / stats.total) * 100).toFixed(1)}%`
  }

  const pieData = stats ? [
    { name: 'Hadir', value: stats.hadir, color: '#22c55e' },
    { name: 'Izin', value: stats.izin, color: '#f59e0b' },
    { name: 'Sakit', value: stats.sakit, color: '#ef4444' }
  ] : []

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Selamat datang, {userName} —{' '}
            {new Date().toLocaleDateString('id-ID', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            })}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 text-xs text-blue-600 font-semibold bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-full w-fit">
          <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          Live updates active
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Total Karyawan</CardTitle>
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
              <Users className="w-4 h-4 text-blue-500" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-3xl font-bold text-slate-800">{stats?.total || 0}</div>
            )}
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Hadir Hari Ini</CardTitle>
            <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center">
              <CheckCircle className="w-4 h-4 text-green-500" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-3xl font-bold text-slate-800">{stats?.hadir || 0}</div>
                <p className="text-xs text-slate-400 mt-1">{pct(stats?.hadir || 0)} dari total</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Izin</CardTitle>
            <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center">
              <ClipboardList className="w-4 h-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-3xl font-bold text-slate-800">{stats?.izin || 0}</div>
                <p className="text-xs text-slate-400 mt-1">{pct(stats?.izin || 0)} dari total</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Sakit</CardTitle>
            <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center">
              <HeartPulse className="w-4 h-4 text-red-500" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-3xl font-bold text-slate-800">{stats?.sakit || 0}</div>
                <p className="text-xs text-slate-400 mt-1">{pct(stats?.sakit || 0)} dari total</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-500" /> Kehadiran Minggu Ini
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[250px]">
            {weeklyLoading ? <Skeleton className="w-full h-full rounded-xl" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekly || []}>
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <RechartsTooltip cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                  <Bar dataKey="hadir" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-500" /> Persentase Hari Ini
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[250px] flex items-center justify-center">
            {statsLoading ? <Skeleton className="w-48 h-48 rounded-full" /> : 
             stats && (stats.hadir + stats.izin + stats.sakit > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-slate-400">Belum ada data</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">5 Karyawan Terakhir Absen</CardTitle>
            <span className="text-xs text-emerald-500 font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
              Realtime
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Nama</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Jam Masuk</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                  </TableRow>
                ))
              ) : recent?.length ? (
                recent.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-slate-700">{r.user_name}</TableCell>
                    <TableCell className="text-slate-500">{r.shift_name}</TableCell>
                    <TableCell className="text-slate-500">{formatDate(r.date)}</TableCell>
                    <TableCell className="text-slate-500">{r.check_in ? formatTime(r.check_in) : '—'}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'hadir' ? 'success' : r.status === 'izin' ? 'warning' : r.status === 'sakit' ? 'destructive' : 'default'}>
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-slate-400">
                    Belum ada data absensi hari ini
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </motion.div>
  )
}
