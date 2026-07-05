'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, CheckCircle, ClipboardList, HeartPulse, TrendingUp, Clock, QrCode, Download, Check, X, Loader2, AlertTriangle } from 'lucide-react'
import { motion } from 'framer-motion'
import { formatDate, formatTime } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import QRCode from 'qrcode'

interface Stats { total: number; hadir: number; izin: number; sakit: number; lembur: number; gantiOff: number }
interface RecentAttendance {
  id: string
  user_id: string
  user_name: string
  shift_name: string
  date: string
  check_in: string | null
  check_out: string | null
  break_start: string | null
  break_end: string | null
  status: string
  overtime_check_in: string | null
  overtime_check_out: string | null
}
interface WeeklyData { day: string; hadir: number }
interface ShiftCard { id: string; name: string; start_time: string; end_time: string }

function getShiftExpiration(startTimeStr: string, endTimeStr: string): string {
  const now = new Date()
  const [sh, sm] = startTimeStr.split(':').map(Number)
  const [eh, em] = endTimeStr.split(':').map(Number)

  const exp = new Date(now)
  exp.setHours(eh, em, 0, 0)

  if (eh < sh) {
    if (now.getHours() >= 12) {
      exp.setDate(exp.getDate() + 1)
    }
  } else {
    if (now.getHours() >= eh) {
      exp.setDate(exp.getDate() + 1)
    }
  }
  return exp.toISOString()
}

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qr_code_logs' }, () => {
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

      // Fetch emergency counts for today
      const { data: emergencyData } = await supabase
        .from('emergency_assignments')
        .select('reason')
        .eq('target_date', today)

      const lembur = (emergencyData ?? []).filter(r => r.reason === 'lembur').length
      const gantiOff = (emergencyData ?? []).filter(r => r.reason === 'ganti_off').length

      return { total, hadir, izin, sakit, lembur, gantiOff }
    },
  })

  // Fetch recent 5 attendance
  const { data: recent, isLoading: recentLoading } = useQuery<RecentAttendance[]>({
    queryKey: ['dashboard', 'recent'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('attendance')
        .select('id, status, check_in_time, check_out_time, break_start, break_end, date, user_id, users!attendance_user_id_fkey(name)')
        .eq('date', today)
        .order('check_in_time', { ascending: false })
        .limit(5)

      const rows = data ?? []
      const userIds = [...new Set(rows.map((r: any) => r.user_id))]

      // Fetch shift names
      let shiftMap: Record<string, string> = {}
      if (userIds.length > 0) {
        const { data: usData } = await supabase
          .from('user_shifts')
          .select('user_id, created_at, shifts(name)')
          .in('user_id', userIds)
          .not('shift_id', 'is', null)
          .neq('shift_type', 'off')
          .neq('shift_type', 'profile_edit')
          .order('created_at', { ascending: false })
        ;(usData ?? []).forEach((us: any) => {
          if (!shiftMap[us.user_id]) shiftMap[us.user_id] = (us.shifts as any)?.name ?? '—'
        })
      }

      // Fetch overtime
      let otMap: Record<string, { check_in: string | null; check_out: string | null }> = {}
      if (userIds.length > 0) {
        const { data: otData } = await supabase
          .from('overtime_assignments')
          .select('user_id, overtime_check_in, overtime_check_out')
          .in('user_id', userIds)
          .eq('assignment_date', today)
        ;(otData ?? []).forEach((ot: any) => {
          otMap[ot.user_id] = { check_in: ot.overtime_check_in, check_out: ot.overtime_check_out }
        })
      }

      return rows.map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        user_name: r.users?.name ?? '—',
        shift_name: shiftMap[r.user_id] ?? '—',
        date: r.date,
        check_in: r.check_in_time,
        check_out: r.check_out_time,
        break_start: r.break_start,
        break_end: r.break_end,
        status: r.status,
        overtime_check_in: otMap[r.user_id]?.check_in ?? null,
        overtime_check_out: otMap[r.user_id]?.check_out ?? null,
      }))
    },
  })

  // Fetch all shifts
  const { data: shifts = [] } = useQuery<ShiftCard[]>({
    queryKey: ['dashboard', 'shifts'],
    queryFn: async () => {
      const { data } = await supabase.from('shifts').select('id, name, start_time, end_time').order('name')
      return data ?? []
    }
  })

  // Fetch active QRs
  const { data: dbActiveQRs } = useQuery({
    queryKey: ['dashboard', 'activeQRs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('qr_code_logs')
        .select('id, shift_id, qr_code, expires_at')
        .gt('expires_at', new Date().toISOString())
        .eq('is_active', true)
        .order('generated_at', { ascending: false })

      if (error) throw error

      const latest: Record<string, { qr_code: string; expires_at: string }> = {}
      for (const item of (data || [])) {
        if (!latest[item.shift_id]) {
          latest[item.shift_id] = { qr_code: item.qr_code, expires_at: item.expires_at }
        }
      }
      return latest
    }
  })

  // Fetch 3 pending leave requests
  const { data: pendingLeaves = [], isLoading: leavesLoading } = useQuery({
    queryKey: ['dashboard', 'pendingLeaves'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leave_requests')
        .select('id, type, created_at, status, users(name)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(3)
      if (error) throw error

      return (data || []).map((r: any) => ({
        id: r.id,
        user_name: r.users?.name || '—',
        type: r.type,
        created_at: r.created_at,
        status: r.status
      }))
    }
  })

  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null)
  const [qrImages, setQrImages] = useState<Record<string, string>>({})

  // Determine active shifts based on current time
  const activeShifts = shifts.filter(s => {
    const [sh, sm] = s.start_time.split(':').map(Number)
    const [eh, em] = s.end_time.split(':').map(Number)
    const currentMinutes = new Date().getHours() * 60 + new Date().getMinutes()
    const startMinutes = sh * 60 + sm
    const endMinutes = eh * 60 + em

    if (endMinutes < startMinutes) {
      // Overnight
      return currentMinutes >= startMinutes || currentMinutes < endMinutes
    } else {
      // Normal
      return currentMinutes >= startMinutes && currentMinutes < endMinutes
    }
  })

  useEffect(() => {
    if (activeShifts.length > 0 && !selectedShiftId) {
      setSelectedShiftId(activeShifts[0].id)
    } else if (shifts.length > 0 && !selectedShiftId) {
      setSelectedShiftId(shifts[0].id)
    }
  }, [shifts, activeShifts, selectedShiftId])

  useEffect(() => {
    if (dbActiveQRs) {
      const renderQRs = async () => {
        const newImages: Record<string, string> = {}
        for (const [shiftId, item] of Object.entries(dbActiveQRs)) {
          try {
            const dataUrl = await QRCode.toDataURL(item.qr_code, {
              width: 256,
              margin: 2,
              color: { dark: '#0f172a', light: '#ffffff' }
            })
            newImages[shiftId] = dataUrl
          } catch (e) {
            console.error(e)
          }
        }
        setQrImages(newImages)
      }
      renderQRs()
    }
  }, [dbActiveQRs])

  // Mutation for generating QR
  const generateQRMutation = useMutation({
    mutationFn: async (shift: ShiftCard) => {
      const expiresAt = getShiftExpiration(shift.start_time, shift.end_time)
      const payload = JSON.stringify({
        shift_id: shift.id,
        shift_name: shift.name,
        expires_at: expiresAt,
        generated_at: new Date().toISOString()
      })

      // Set any previous active QRs for this shift to is_active = false
      await supabase
        .from('qr_code_logs')
        .update({ is_active: false })
        .eq('shift_id', shift.id)
        .eq('is_active', true)

      // Save to Supabase
      const { error } = await supabase.from('qr_code_logs').insert({
        shift_id: shift.id,
        qr_code: payload,
        generated_date: new Date().toISOString().split('T')[0],
        generated_at: new Date().toISOString(),
        expires_at: expiresAt,
        is_active: true
      })

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('QR Code berhasil digenerate')
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'activeQRs'] })
    },
    onError: (error: any) => {
      toast.error('Gagal generate QR Code: ' + error.message)
    }
  })

  // Mutation for updating leave status
  const updateLeaveStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => {
      const { error } = await supabase
        .from('leave_requests')
        .update({ status })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: (_, variables) => {
      toast.success(`Request berhasil di-${variables.status}`)
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'pendingLeaves'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] })
    },
    onError: (error: any) => {
      toast.error('Gagal memproses request: ' + error.message)
    }
  })

  function downloadQR(dataUrl: string, shiftName: string) {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `QR_${shiftName.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.png`
    a.click()
    toast.success('QR Code berhasil didownload!')
  }

  const pct = (n: number) => {
    if (!stats || stats.total === 0) return '0%'
    return `${((n / stats.total) * 100).toFixed(1)}%`
  }

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Total Pegawai</CardTitle>
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

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Lembur Hari Ini</CardTitle>
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
              <Clock className="w-4 h-4 text-blue-500" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-3xl font-bold text-slate-800">{stats?.lembur || 0}</div>
            )}
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Ganti Off Hari Ini</CardTitle>
            <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-3xl font-bold text-slate-800">{stats?.gantiOff || 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* QR Code & Leave Requests Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* QR CODE (KOTAK KIRI) */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-slate-100 bg-slate-50/50">
            <CardTitle className="text-base flex items-center gap-2">
              <QrCode className="w-4 h-4 text-blue-500" /> QR Code Shift
            </CardTitle>
            {shifts.length > 0 && (
              <select
                value={selectedShiftId || ''}
                onChange={e => setSelectedShiftId(e.target.value)}
                className="text-xs border border-slate-200 rounded p-1 outline-none bg-white text-slate-700 font-medium"
              >
                {shifts.map(s => {
                  const isActive = activeShifts.some(as => as.id === s.id)
                  return (
                    <option key={s.id} value={s.id}>
                      {s.name} {isActive ? '(Aktif)' : ''}
                    </option>
                  )
                })}
              </select>
            )}
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center p-6 h-[250px]">
            {(() => {
              const currentShift = shifts.find(s => s.id === selectedShiftId)
              if (!currentShift) return <Skeleton className="w-32 h-32 rounded-lg" />

              const qrImage = qrImages[currentShift.id]
              const isActive = activeShifts.some(as => as.id === currentShift.id)
              const formattedTimeRange = `${currentShift.start_time.slice(0, 5)} - ${currentShift.end_time.slice(0, 5)}`

              return (
                <div className="flex flex-col items-center text-center space-y-3">
                  <div>
                    <div className="flex items-center justify-center gap-2">
                      <h4 className="font-bold text-slate-800">{currentShift.name}</h4>
                      {isActive ? (
                        <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                          Aktif
                        </span>
                      ) : (
                        <span className="text-[10px] bg-slate-100 text-slate-500 font-medium px-2 py-0.5 rounded-full">
                          Tidak Aktif
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">{formattedTimeRange}</p>
                  </div>

                  {qrImage ? (
                    <div className="flex flex-col items-center space-y-2">
                      <img src={qrImage} alt="QR Code" className="w-28 h-28 border border-slate-100 rounded-lg p-1 bg-white shadow-sm" />
                      <button
                        onClick={() => downloadQR(qrImage, currentShift.name)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" /> Download QR
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-28 space-y-2">
                      <p className="text-xs text-slate-400">QR Code belum digenerate hari ini</p>
                      <button
                        onClick={() => generateQRMutation.mutate(currentShift)}
                        disabled={generateQRMutation.isPending}
                        className="flex items-center gap-1.5 text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 px-4 py-2 rounded-lg transition-all shadow-sm hover:shadow active:scale-95"
                      >
                        {generateQRMutation.isPending ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <QrCode className="w-3.5 h-3.5" />
                        )}
                        Generate QR
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}
          </CardContent>
        </Card>

        {/* PENGAJUAN CUTI KARYAWAN (KOTAK KANAN) */}
        <Card className="shadow-sm opacity-60 pointer-events-none select-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-slate-200 bg-slate-100/80">
            <CardTitle className="text-base flex items-center gap-2 text-slate-500">
              🏖️ Pengajuan Cuti Pegawai
            </CardTitle>
            <Badge variant="outline" className="text-slate-600 bg-slate-300 border-slate-300 font-mono text-[10px] uppercase tracking-wider">
              Segera Hadir
            </Badge>
          </CardHeader>
          <CardContent className="p-4 h-[250px] overflow-y-auto">
            <div className="flex flex-col items-center justify-center h-full text-center text-slate-400">
              <CheckCircle className="w-8 h-8 text-slate-300 mb-2" />
              <p className="text-xs">Fitur Pengajuan Cuti akan segera hadir</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Pegawai Terakhir Absen</CardTitle>
            <span className="text-xs text-emerald-500 font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
              Realtime
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-[#F8FAFC]">
              <TableRow className="hover:bg-transparent border-b border-slate-200">
                <TableHead className="w-[50px] pl-4 text-slate-600 font-semibold py-3">No</TableHead>
                <TableHead className="text-slate-600 font-semibold py-3">Nama</TableHead>
                <TableHead className="text-slate-600 font-semibold py-3">Shift</TableHead>
                <TableHead className="text-center text-slate-600 font-semibold py-3">Tanggal</TableHead>
                <TableHead className="text-center text-slate-600 font-semibold py-3">Jam Masuk</TableHead>
                <TableHead className="text-center text-slate-600 font-semibold py-3">Istirahat</TableHead>
                <TableHead className="text-center text-slate-600 font-semibold py-3">Jam Pulang</TableHead>
                <TableHead className="text-center text-slate-600 font-semibold py-3">Jam Lembur</TableHead>
                <TableHead className="text-center text-slate-600 font-semibold py-3">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-4"><Skeleton className="h-4 w-6" /></TableCell>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full max-w-[90px]" /></TableCell>
                    ))}
                    <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                  </TableRow>
                ))
              ) : recent?.length ? (
                recent.map((r, i) => (
                  <TableRow key={r.id} className="bg-white border-b border-slate-100 hover:bg-slate-50/50">
                    <TableCell className="font-mono text-xs text-slate-400 pl-4">{i + 1}</TableCell>
                    <TableCell className="font-medium text-slate-700">{r.user_name}</TableCell>
                    <TableCell className="text-slate-500">{r.shift_name}</TableCell>
                    <TableCell className="text-slate-500 text-center">{formatDate(r.date)}</TableCell>
                    <TableCell className="text-slate-500 text-center">{r.check_in ? formatTime(r.check_in) : '—'}</TableCell>
                    <TableCell className="text-slate-500 text-center">
                      {(() => {
                        if (!r.break_start) return '—'
                        const start = formatTime(r.break_start)
                        if (!r.break_end) return `${start} - --:--`
                        return `${start} - ${formatTime(r.break_end)}`
                      })()}
                    </TableCell>
                    <TableCell className="text-slate-500 text-center">{r.check_out ? formatTime(r.check_out) : '—'}</TableCell>
                    <TableCell className="text-slate-500 text-center">
                      {(() => {
                        if (!r.overtime_check_in && !r.overtime_check_out) return <span className="text-slate-400">—</span>
                        if (r.overtime_check_in && !r.overtime_check_out) return <span className="text-orange-500 font-medium text-xs">Berlangsung</span>
                        if (r.overtime_check_in && r.overtime_check_out) return <span className="text-slate-600 text-xs">{formatTime(r.overtime_check_in)} - {formatTime(r.overtime_check_out)}</span>
                        return <span className="text-slate-400">—</span>
                      })()}
                    </TableCell>
                    <TableCell className="text-center">
                      {(() => {
                        const statusColor =
                          r.status === 'hadir' ? { bg: '#DCFCE7', text: '#166534' }
                          : r.status === 'terlambat' ? { bg: '#FEF9C3', text: '#854D0E' }
                          : r.status === 'absen' || r.status === 'alfa' ? { bg: '#FEE2E2', text: '#991B1B' }
                          : r.status === 'sakit' ? { bg: '#DBEAFE', text: '#1E40AF' }
                          : r.status === 'izin' ? { bg: '#EDE9FE', text: '#5B21B6' }
                          : r.status === 'cuti' ? { bg: '#FCE7F3', text: '#9D174D' }
                          : r.status === 'off' ? { bg: '#F1F5F9', text: '#475569' }
                          : { bg: '#F3F4F6', text: '#374151' }
                        const label = r.status === 'off' ? 'Off' : r.status.charAt(0).toUpperCase() + r.status.slice(1)
                        return (
                          <span style={{ background: statusColor.bg, color: statusColor.text, padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {label}
                          </span>
                        )
                      })()}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-slate-400">
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
