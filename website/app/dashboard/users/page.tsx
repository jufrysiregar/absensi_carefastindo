'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDebounce } from '@/hooks/useDebounce'
import { formatDate, formatTime } from '@/lib/utils'
import { Search, X, Plus, Edit2, Trash2, Loader2, Eye, Download, AlertTriangle, Clock } from 'lucide-react'
import * as XLSX from 'xlsx'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

import pdfMake from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'
if (typeof window !== 'undefined' && pdfFonts && (pdfFonts as any).pdfMake) {
  (pdfMake as any).vfs = (pdfFonts as any).pdfMake.vfs
}

interface UserRow { 
  id: string
  name: string
  email: string
  role: string
  nip: string
  current_shift: string
  shift_id: string 
}

interface ShiftHistory { 
  id: string
  user_name: string
  old_shift: string
  new_shift: string
  effective_date: string
  created_at: string
  is_double?: boolean
}

interface AttendanceRow {
  id: string
  user_id: string
  user_name: string
  shift_name: string
  shift_type: string | null
  date: string
  check_in: string | null
  check_out: string | null
  break_start: string | null
  break_end: string | null
  status: string
  selfie_url: string | null
  location: string | null
  notes: string | null
  overtime_check_in: string | null
  overtime_check_out: string | null
}

interface OvertimeRow {
  id: string
  user_id: string
  user_name: string
  shift_id: string
  shift_name: string
  assignment_date: string
  assigned_by_name: string
  assigned_from: string
  status: string
  keterangan: string | null
  overtime_in: string | null
  overtime_out: string | null
  duration: number | null
  created_at: string
}

// ─── Off Day types ───────────────────────────────────────
interface OffDayRow {
  id: string
  user_id: string
  user_name: string
  effective_date: string
  reason: string | null
}

// ─── Emergency types ─────────────────────────────────────
interface EmergencyRow {
  id: string
  assigned_user_id: string
  assigned_user_name: string
  replacing_user_id: string | null
  replacing_user_name: string | null
  shift_id: string | null
  shift_name: string | null
  target_date: string
  reason: 'lembur' | 'ganti_off'
  status: string
  created_at: string
}

// ─── Activity Log types ───────────────────────────────────
interface ActivityLogRow {
  id: string
  source: 'shift' | 'off' | 'emergency'
  user_name: string
  activity_type: 'Change Shift' | 'Off Day' | 'Lembur' | 'Ganti Off'
  effective_date: string
  created_at: string
  // raw data for edit
  raw_shift_id?: string
  raw_user_id?: string
  raw_shift_name?: string
  raw_replacing_user_name?: string
  raw_replacing_user_id?: string
  raw_emergency_id?: string
}



export default function ManagementEmployeePage() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  const PAGE_SIZE = 10
  const ACT_PAGE_SIZE = 5

  // Tab State / Table Filter States
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('all')

  // Add User State (Modal)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addUserForm, setAddUserForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'cleaner',
    nip: '',
    shiftId: ''
  })
  const [addingUser, setAddingUser] = useState(false)
  const [showAddPassword, setShowAddPassword] = useState(false)

  // Edit User Modal state
  const [editingUser, setEditingUser] = useState<UserRow | null>(null)
  const [editForm, setEditForm] = useState({
    name: '',
    role: '',
    nip: '',
    shiftId: '',
    password: ''
  })
  const [updatingUser, setUpdatingUser] = useState(false)
  const [showEditPassword, setShowEditPassword] = useState(false)

  // Delete User Modal state
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Update Shift Form state
  // Update Shift / Overtime Form state
  const [shiftForm, setShiftForm] = useState({
    userId: '',
    shiftId: '',
    effectiveDate: new Date().toISOString().split('T')[0],
    shiftType: 'single',
    keterangan: ''
  })

  // Attendance table filters & pagination
  const todayStr = new Date().toISOString().split('T')[0]

  // ─── Modal Perubahan Jadwal state ──────────────────────
  const [showJadwalModal, setShowJadwalModal] = useState(false)
  const [jadwalMenu, setJadwalMenu] = useState<'change_shift' | 'atur_off' | 'lembur' | 'ganti_off' | ''>('')


  const [offForm, setOffForm] = useState({
    userId: '',
    offDate: new Date().toISOString().split('T')[0],
    reason: 'libur',
  })
  const [savingOff, setSavingOff] = useState(false)
  const [deleteOffId, setDeleteOffId] = useState<string | null>(null)

  // ─── Emergency state ────────────────────────────────────
  const [emergencyForm, setEmergencyForm] = useState({
    assigned_user_id: '',
    target_date: new Date().toISOString().split('T')[0],
    reason: 'lembur' as 'lembur' | 'ganti_off',
    replacing_user_id: '',
    shift_id: '',
    status: 'pending',
  })
  const [editEmergencyRow, setEditEmergencyRow] = useState<EmergencyRow | null>(null)
  const [showEmergencyForm, setShowEmergencyForm] = useState(false)
  const [deleteEmergencyId, setDeleteEmergencyId] = useState<string | null>(null)
  // For filtering users who are off on a specific date (ganti_off)
  const [offUsersOnDate, setOffUsersOnDate] = useState<{ id: string; name: string }[]>([])
  const [loadingOffUsers, setLoadingOffUsers] = useState(false)

  // Attendance table filters & pagination
  const [attPage, setAttPage] = useState(1)
  const [attSearch, setAttSearch] = useState('')
  const [attFilterDate, setAttFilterDate] = useState(todayStr)
  const [attFilterShift, setAttFilterShift] = useState('all')
  const [attFilterStatus, setAttFilterStatus] = useState('all')
  const [selectedAtt, setSelectedAtt] = useState<AttendanceRow | null>(null)
  const [editingAtt, setEditingAtt] = useState<AttendanceRow | null>(null)
  const [editAttForm, setEditAttForm] = useState({
    check_in: '',
    check_out: '',
    break_start: '',
    break_end: '',
    status: 'hadir',
    notes: '',
    overtime_in: '',
    overtime_out: '',
    shift_id: '',
  })

  // ─── Swap shift state ────────────────────────────────────
  const [swapTargetUserId, setSwapTargetUserId] = useState('')
  const [savingAtt, setSavingAtt] = useState(false)

  const debouncedAttSearch = useDebounce(attSearch, 500)

  // ─── Company Config / Radius state ─────────────────────
  const [showRadiusModal, setShowRadiusModal] = useState(false)
  const [radiusForm, setRadiusForm] = useState({
    officeLat: '',
    officeLng: '',
    radius: '',
    defaultStartTime: '',
    defaultEndTime: '',
  })
  const [savingRadius, setSavingRadius] = useState(false)


  const [actPage, setActPage] = useState(1)
  const [actFilterDate, setActFilterDate] = useState(todayStr)
  const [editActivityRow, setEditActivityRow] = useState<ActivityLogRow | null>(null)
  const [deleteActivityId, setDeleteActivityId] = useState<{ id: string; source: ActivityLogRow['source'] } | null>(null)

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('management-employee-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_shifts' }, () => {
        queryClient.invalidateQueries({ queryKey: ['users'] })
        queryClient.invalidateQueries({ queryKey: ['shiftHistory'] })
        queryClient.invalidateQueries({ queryKey: ['attendance'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        queryClient.invalidateQueries({ queryKey: ['users'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => {
        queryClient.invalidateQueries({ queryKey: ['attendance'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'overtime_assignments' }, () => {
        queryClient.invalidateQueries({ queryKey: ['overtime'] })
        queryClient.invalidateQueries({ queryKey: ['attendance'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'off_schedules' }, () => {
        // off dari Android (ganti_off DaruratLembur) → refresh tabel attendance
        queryClient.invalidateQueries({ queryKey: ['attendance'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_assignments' }, () => {
        // lembur/ganti_off dari Android/leader → refresh tabel attendance
        queryClient.invalidateQueries({ queryKey: ['attendance'] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, queryClient])

  // Fetch users query
  const { data: users = [], isLoading: usersLoading } = useQuery<UserRow[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await supabase
        .from('users')
        .select('id, name, email, role, nip, user_shifts(shift_id, created_at, shifts(name))')
        .order('name')

      return (data ?? []).map((u: any) => {
        const usList = Array.isArray(u.user_shifts) ? u.user_shifts : (u.user_shifts ? [u.user_shifts] : [])
        const sorted = [...usList].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        const us = sorted[0]
        return {
          id: u.id, 
          name: u.name, 
          email: u.email, 
          role: u.role,
          nip: u.nip ?? '—',
          current_shift: us?.shifts?.name ?? '—',
          shift_id: us?.shift_id ?? '',
        }
      })
    }
  })

  // Fetch shifts query
  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts-select'],
    queryFn: async () => {
      const { data } = await supabase.from('shifts').select('id, name, start_time').eq('is_active', true)
      return data ?? []
    }
  })

  // Fetch history query (limited to 3, only today)
  const { data: history = [], isLoading: historyLoading } = useQuery<ShiftHistory[]>({
    queryKey: ['shiftHistory'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('user_shifts')
        .select('id, effective_date, created_at, user_id, users(name), shifts(name)')
        .eq('effective_date', today)
        .order('created_at', { ascending: false })
        .limit(3)

      if (error) throw error

      const historyRows = await Promise.all((data ?? []).map(async (h: any) => {
        const { data: prevShift } = await supabase
          .from('user_shifts')
          .select('shifts(name)')
          .eq('user_id', h.user_id)
          .lt('created_at', h.created_at)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const { data: ot } = await supabase
          .from('overtime_assignments')
          .select('id')
          .eq('user_id', h.user_id)
          .eq('assignment_date', h.effective_date)
          .limit(1)
          .maybeSingle()

        return {
          id: h.id,
          user_name: h.users?.name ?? '—',
          old_shift: (prevShift as any)?.shifts?.name ?? 'Tanpa Shift',
          new_shift: h.shifts?.name ?? 'Tanpa Shift',
          effective_date: h.effective_date,
          created_at: h.created_at,
          is_double: !!ot,
        }
      }))

      return historyRows
    }
  })

  // ─── Activity Log query (semua jenis perubahan, pagination, filter tanggal) ──
  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ['activityLog', actPage, actFilterDate],
    queryFn: async () => {
      const rows: ActivityLogRow[] = []

      // 1. Change Shift dari user_shifts (shift_type bukan 'off' dan bukan 'profile_edit')
      const { data: shiftData } = await supabase
        .from('user_shifts')
        .select('id, user_id, shift_id, effective_date, created_at, users(name), shifts(name)')
        .neq('shift_type', 'off')
        .neq('shift_type', 'profile_edit')
        .eq('effective_date', actFilterDate)
        .order('created_at', { ascending: false })

      ;(shiftData ?? []).forEach((r: any) => {
        rows.push({
          id: r.id,
          source: 'shift',
          user_name: r.users?.name ?? '—',
          activity_type: 'Change Shift',
          effective_date: r.effective_date,
          created_at: r.created_at,
          raw_shift_id: r.shift_id,
          raw_user_id: r.user_id,
          raw_shift_name: r.shifts?.name ?? '—',
        })
      })

      // 2. Off Day dari user_shifts (shift_type = 'off')
      const { data: offData } = await supabase
        .from('user_shifts')
        .select('id, user_id, effective_date, created_at, users(name)')
        .eq('shift_type', 'off')
        .eq('effective_date', actFilterDate)
        .order('created_at', { ascending: false })

      ;(offData ?? []).forEach((r: any) => {
        rows.push({
          id: r.id,
          source: 'off',
          user_name: r.users?.name ?? '—',
          activity_type: 'Off Day',
          effective_date: r.effective_date,
          created_at: r.created_at,
          raw_user_id: r.user_id,
        })
      })

      // 3. Lembur & Ganti Off dari emergency_assignments
      const { data: emergData } = await supabase
        .from('emergency_assignments')
        .select('id, assigned_user_id, replacing_user_id, reason, target_date, created_at, assigned_user:users!emergency_assignments_assigned_user_id_fkey(name), replacing_user:users!emergency_assignments_replacing_user_id_fkey(name), shift:shifts(name)')
        .eq('target_date', actFilterDate)
        .order('created_at', { ascending: false })

      ;(emergData ?? []).forEach((r: any) => {
        rows.push({
          id: r.id,
          source: 'emergency',
          user_name: r.assigned_user?.name ?? '—',
          activity_type: r.reason === 'lembur' ? 'Lembur' : 'Ganti Off',
          effective_date: r.target_date,
          created_at: r.created_at,
          raw_user_id: r.assigned_user_id,
          raw_shift_name: r.shift?.name ?? undefined,
          raw_replacing_user_name: r.replacing_user?.name ?? undefined,
          raw_replacing_user_id: r.replacing_user_id ?? undefined,
          raw_emergency_id: r.id,
        })
      })

      // Sort by created_at desc, paginate
      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      const total = rows.length
      const paged = rows.slice((actPage - 1) * ACT_PAGE_SIZE, actPage * ACT_PAGE_SIZE)
      return { rows: paged, total }
    },
    placeholderData: (prev) => prev,
  })

  const actRows = activityData?.rows ?? []
  const actTotal = activityData?.total ?? 0
  const actTotalPages = Math.ceil(actTotal / ACT_PAGE_SIZE)

  // Delete activity mutation
  const deleteActivityMutation = useMutation({
    mutationFn: async ({ id, source }: { id: string; source: ActivityLogRow['source'] }) => {
      if (source === 'emergency') {
        const { error } = await supabase.from('emergency_assignments').delete().eq('id', id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('user_shifts').delete().eq('id', id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success('Data berhasil dihapus!')
      queryClient.invalidateQueries({ queryKey: ['activityLog'] })
      queryClient.invalidateQueries({ queryKey: ['offDays'] })
      queryClient.invalidateQueries({ queryKey: ['emergency-users'] })
      queryClient.invalidateQueries({ queryKey: ['shiftHistory'] })
      setDeleteActivityId(null)
    },
    onError: (e: any) => toast.error('Gagal menghapus: ' + e.message)
  })

  // ─── Company Config query & mutation ────────────────────
  const { data: companyConfig, refetch: refetchConfig } = useQuery({
    queryKey: ['companyConfig'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .eq('id', 'companyConfig')
        .maybeSingle()
      if (error) throw error
      return data
    }
  })

  function openRadiusModal() {
    setRadiusForm({
      officeLat: companyConfig?.office_lat?.toString() ?? '',
      officeLng: companyConfig?.office_lng?.toString() ?? '',
      radius: companyConfig?.radius?.toString() ?? '',
      defaultStartTime: companyConfig?.default_start_time ?? '08:00:00',
      defaultEndTime: companyConfig?.default_end_time ?? '17:00:00',
    })
    setShowRadiusModal(true)
  }

  async function handleSaveRadius(e: React.FormEvent) {
    e.preventDefault()
    const lat = parseFloat(radiusForm.officeLat)
    const lng = parseFloat(radiusForm.officeLng)
    const radius = parseInt(radiusForm.radius)
    if (isNaN(lat) || isNaN(lng) || isNaN(radius)) {
      toast.error('Semua kolom wajib diisi dengan benar!')
      return
    }
    setSavingRadius(true)
    try {
      const { error } = await supabase
        .from('settings')
        .update({
          office_lat: lat,
          office_lng: lng,
          radius,
        })
        .eq('id', 'companyConfig')
      if (error) throw error
      toast.success('Konfigurasi kantor berhasil diperbarui!')
      setShowRadiusModal(false)
      refetchConfig()
    } catch (err: any) {
      toast.error('Gagal menyimpan: ' + err.message)
    } finally {
      setSavingRadius(false)
    }
  }

  // Fetch attendance query
  const { data: attendanceData, isLoading: attendanceLoading } = useQuery({
    queryKey: ['attendance', attPage, debouncedAttSearch, attFilterDate, attFilterShift, attFilterStatus],
    queryFn: async () => {
      const targetDate = attFilterDate || new Date().toISOString().split('T')[0]

      // 1. Fetch semua user aktif kecuali superadmin
      const { data: allUsers } = await supabase
        .from('users')
        .select('id, name')
        .eq('is_active', true)
        .neq('role', 'superadmin')
        .order('name')

      const allUserList = allUsers ?? []

      // 2. Fetch attendance yang sudah ada untuk tanggal ini
      const { data: attData } = await supabase
        .from('attendance')
        .select('id, status, check_in_time, check_out_time, break_start, break_end, date, selfie_url, location_lat, location_lng, note, user_id')
        .eq('date', targetDate)

      const attMap: Record<string, any> = {}
      ;(attData ?? []).forEach((r: any) => { attMap[r.user_id] = r })

      // 3. Fetch user_shifts untuk tanggal ini (off/izin/sakit yang di-set admin)
      const { data: userShiftsData } = await supabase
        .from('user_shifts')
        .select('user_id, shift_type, shifts(id, name)')
        .eq('effective_date', targetDate)

      const userShiftMap: Record<string, { shift_name: string; shift_type: string | null }> = {}
      ;(userShiftsData ?? []).forEach((us: any) => {
        userShiftMap[us.user_id] = {
          shift_name: (us.shifts as any)?.name ?? '—',
          shift_type: us.shift_type ?? null,
        }
      })

      // 3b. Fetch off_schedules untuk tanggal ini (off yang di-set dari Android/DaruratLembur)
      const { data: offSchedulesData } = await supabase
        .from('off_schedules')
        .select('user_id')
        .eq('off_date', targetDate)

      const offScheduleUserIds = new Set<string>(
        (offSchedulesData ?? []).map((r: any) => r.user_id as string)
      )

      // 4. Fetch shift aktif per user (shift default mereka) — exclude off dan profile_edit
      const { data: defaultShifts } = await supabase
        .from('user_shifts')
        .select('user_id, created_at, shift_type, shifts(name)')
        .not('shift_id', 'is', null)
        .neq('shift_type', 'off')
        .neq('shift_type', 'profile_edit')
        .order('created_at', { ascending: false })

      // Fetch profile_edit shifts secara terpisah (ini shift aktif user dari edit profil)
      const { data: profileEditShifts } = await supabase
        .from('user_shifts')
        .select('user_id, created_at, shift_type, shifts(name)')
        .not('shift_id', 'is', null)
        .eq('shift_type', 'profile_edit')
        .order('created_at', { ascending: false })

      const defaultShiftMap: Record<string, string> = {}
      // Gabungkan keduanya, ambil yang terbaru per user
      const allDefaultShifts = [...(defaultShifts ?? []), ...(profileEditShifts ?? [])]
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      allDefaultShifts.forEach((us: any) => {
        if (!defaultShiftMap[us.user_id]) {
          defaultShiftMap[us.user_id] = (us.shifts as any)?.name ?? '—'
        }
      })

      // 5. Fetch overtime untuk tanggal ini
      const { data: otData } = await supabase
        .from('overtime_assignments')
        .select('user_id, assignment_date, overtime_check_in, overtime_check_out')
        .eq('assignment_date', targetDate)

      const overtimeMap: Record<string, { check_in: string | null; check_out: string | null }> = {}
      ;(otData ?? []).forEach((ot: any) => {
        overtimeMap[ot.user_id] = {
          check_in: ot.overtime_check_in,
          check_out: ot.overtime_check_out,
        }
      })

      // 6. Gabungkan semua user dengan data absensi / admin override
      let mapped = allUserList.map((u: any) => {
        const att = attMap[u.id]
        const shiftOverride = userShiftMap[u.id]
        // off bisa dari user_shifts (shift_type='off') ATAU off_schedules (dari Android)
        const isOffFromAndroid = offScheduleUserIds.has(u.id)
        const isOff = shiftOverride?.shift_type === 'off' || isOffFromAndroid
        const shiftName = isOff
          ? 'Off' 
          : (shiftOverride?.shift_name && shiftOverride.shift_name !== '—' 
            ? shiftOverride.shift_name 
            : (defaultShiftMap[u.id] ?? '—'))
        const shiftType = isOff ? 'off' : (shiftOverride?.shift_type ?? null)

        // Tentukan status:
        // - Ada record attendance → pakai status dari attendance
        // - Ada user_shifts dengan shift_type off ATAU off_schedules → 'off'
        // - Tanggal lampau (< hari ini) dan tidak ada absensi → 'alfa'
        // - Tanggal hari ini atau masa depan tanpa absensi → '-' (belum absen)
        let status = '-'
        if (att) {
          status = att.status
        } else if (isOff) {
          status = 'off'
        } else if (targetDate < new Date().toISOString().split('T')[0]) {
          status = 'alfa'
        }

        return {
          id: att?.id ?? `virtual_${u.id}`,
          user_id: u.id,
          user_name: u.name,
          shift_name: shiftName,
          shift_type: shiftType,
          date: targetDate,
          check_in: att?.check_in_time ?? null,
          check_out: att?.check_out_time ?? null,
          break_start: att?.break_start ?? null,
          break_end: att?.break_end ?? null,
          status,
          selfie_url: att?.selfie_url ?? null,
          location: att?.location_lat && att?.location_lng ? `${att.location_lat}, ${att.location_lng}` : '—',
          notes: att?.note ?? null,
          overtime_check_in: overtimeMap[u.id]?.check_in ?? null,
          overtime_check_out: overtimeMap[u.id]?.check_out ?? null,
        }
      })

      // 7. Filter pencarian & shift
      if (debouncedAttSearch) {
        mapped = mapped.filter(r => r.user_name.toLowerCase().includes(debouncedAttSearch.toLowerCase()))
      }
      if (attFilterShift !== 'all') {
        mapped = mapped.filter(r => r.shift_name === attFilterShift)
      }
      if (attFilterStatus !== 'all') {
        mapped = mapped.filter(r => r.status === attFilterStatus)
      }

      // 8. Pagination manual
      const total = mapped.length
      const from = (attPage - 1) * PAGE_SIZE
      const paged = mapped.slice(from, from + PAGE_SIZE)

      return { rows: paged, total }
    },
    placeholderData: (previousData) => previousData,
  })

  const attRows = attendanceData?.rows ?? []
  const attTotal = attendanceData?.total ?? 0
  const attTotalPages = Math.ceil(attTotal / PAGE_SIZE)

  // Add user submit handler
  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    if (!addUserForm.name || !addUserForm.email || !addUserForm.password || !addUserForm.role || !addUserForm.nip) {
      toast.error('Mohon isi semua kolom wajib!')
      return
    }
    if (addUserForm.nip.length !== 6 || isNaN(Number(addUserForm.nip))) {
      toast.error('NIP harus berisi 6 digit angka!')
      return
    }
    setAddingUser(true)
    try {
      // Cek duplikat NIP sebelum simpan
      const { data: existingNip } = await supabase
        .from('users')
        .select('id, name')
        .eq('nip', addUserForm.nip)
        .maybeSingle()
      if (existingNip) {
        toast.error(`NIP ${addUserForm.nip} sudah digunakan oleh karyawan "${existingNip.name}". Gunakan NIP yang berbeda.`)
        setAddingUser(false)
        return
      }

      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addUserForm)
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      
      toast.success('Karyawan baru berhasil ditambahkan!')
      setAddUserForm({ name: '', email: '', password: '', role: 'cleaner', nip: '', shiftId: '' })
      setShowAddModal(false)
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['shiftHistory'] })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setAddingUser(false)
    }
  }

  // Open Edit Modal helper
  function openEditModal(user: UserRow) {
    setEditingUser(user)
    setShowEditPassword(false)
    setEditForm({
      name: user.name,
      role: user.role,
      nip: user.nip === '—' ? '' : user.nip,
      shiftId: user.shift_id,
      password: ''
    })
  }

  // Edit user submit handler
  async function handleUpdateUser(e: React.FormEvent) {
    e.preventDefault()
    if (!editingUser) return
    if (!editForm.name || !editForm.role || !editForm.nip) {
      toast.error('Nama, Role, dan NIP wajib diisi!')
      return
    }
    if (editForm.nip.length !== 6 || isNaN(Number(editForm.nip))) {
      toast.error('NIP harus berisi 6 digit angka!')
      return
    }
    if (editForm.password && editForm.password.length < 6) {
      toast.error('Password minimal 6 karakter!')
      return
    }
    setUpdatingUser(true)
    try {
      // Cek duplikat NIP jika NIP berubah
      if (editForm.nip !== (editingUser.nip === '—' ? '' : editingUser.nip)) {
        const { data: existingNip } = await supabase
          .from('users')
          .select('id, name')
          .eq('nip', editForm.nip)
          .neq('id', editingUser.id)
          .maybeSingle()
        if (existingNip) {
          toast.error(`NIP ${editForm.nip} sudah digunakan oleh karyawan "${existingNip.name}". Gunakan NIP yang berbeda.`)
          setUpdatingUser(false)
          return
        }
      }
      // 1. Update public.users
      const { error: userError } = await supabase
        .from('users')
        .update({
          name: editForm.name,
          role: editForm.role,
          nip: editForm.nip
        })
        .eq('id', editingUser.id)

      if (userError) throw userError

      // 2. Update password jika diisi
      if (editForm.password && editForm.password.trim() !== '') {
        const res = await fetch('/api/users/update-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: editingUser.id, newPassword: editForm.password })
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)

        // Kirim notifikasi perubahan password ke karyawan
        await supabase.from('notifications').insert({
          user_id: editingUser.id,
          message: 'Admin telah memperbaharui password akun anda, silahkan coba relogin untuk memastikan password baru anda apakah sudah bisa digunakan. Terimakasih.',
          is_read: false,
        })
      }

      // 3. Update shift karyawan via user_shifts
      // Gunakan shift_type 'profile_edit' agar tidak muncul di Daftar Riwayat Aktivitas
      if (editForm.shiftId !== editingUser.shift_id) {
        const newShiftId = editForm.shiftId === 'none' || !editForm.shiftId ? null : editForm.shiftId
        const { error: shiftError } = await supabase
          .from('user_shifts')
          .insert({
            user_id: editingUser.id,
            shift_id: newShiftId,
            effective_date: new Date().toISOString().split('T')[0],
            shift_type: 'profile_edit',
          })
        if (shiftError) throw shiftError
      }

      toast.success('Data karyawan berhasil diperbarui!')
      setEditingUser(null)
      setShowEditPassword(false)
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['shiftHistory'] })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
    } catch (err: any) {
      toast.error('Gagal memperbarui data: ' + err.message)
    } finally {
      setUpdatingUser(false)
    }
  }

  // Delete user submit handler
  async function handleDeleteUser() {
    if (!deletingUserId) return
    setIsDeleting(true)
    try {
      const res = await fetch('/api/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: deletingUserId })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      toast.success('Karyawan berhasil dihapus!')
      setDeletingUserId(null)
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['shiftHistory'] })
    } catch (err: any) {
      toast.error('Gagal menghapus karyawan: ' + err.message)
    } finally {
      setIsDeleting(false)
    }
  }

  // Update shift mutation
  const updateShiftMutation = useMutation({
    mutationFn: async (payload: { userId: string; shiftId: string; effectiveDate: string; swapUserId?: string; swapShiftId?: string }) => {
      const { error } = await supabase
        .from('user_shifts')
        .insert({
          user_id: payload.userId,
          shift_id: payload.shiftId === 'none' ? null : payload.shiftId,
          effective_date: payload.effectiveDate,
        })

      if (error) throw error

      // Kirim notifikasi perubahan shift ke karyawan
      await supabase.from('notifications').insert({
        user_id: payload.userId,
        message: 'Admin mengubah jadwal shift kerja kamu, silahkan absen sesuai jam yang ditentukan. Tetap semangat dalam bekerja dan ciptakan kualitas kerja mu yang terbaik.',
        is_read: false,
      })

      // Tukar shift: user target mendapat shift lama user utama
      if (payload.swapUserId && payload.swapShiftId) {
        await supabase.from('user_shifts').insert({
          user_id: payload.swapUserId,
          shift_id: payload.swapShiftId,
          effective_date: payload.effectiveDate,
        })
        // Kirim notifikasi ke user target
        await supabase.from('notifications').insert({
          user_id: payload.swapUserId,
          message: 'Jadwal shift kamu telah ditukar dengan karyawan lain oleh admin. Silahkan absen sesuai jam yang ditentukan.',
          is_read: false,
        })
      }
    },
    onSuccess: () => {
      toast.success('Shift karyawan berhasil diperbarui!')
      setShiftForm({ userId: '', shiftId: '', effectiveDate: new Date().toISOString().split('T')[0], shiftType: 'single', keterangan: '' })
      setSwapTargetUserId('')
      setShowJadwalModal(false)
      setJadwalMenu('')
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['shiftHistory'] })
    },
    onError: (error: any) => {
      toast.error('Gagal memperbarui shift: ' + error.message)
    }
  })

  function handleUpdateShift(e: React.FormEvent) {
    e.preventDefault()
    if (!shiftForm.userId || !shiftForm.effectiveDate) {
      toast.error('Pilih karyawan dan tanggal efektif terlebih dahulu!')
      return
    }

    const selectedUser = users.find(u => u.id === shiftForm.userId)
    const currentShiftId = selectedUser?.shift_id || ''

    // Mode tukar shift: ambil shift dari masing-masing user secara otomatis
    if (swapTargetUserId) {
      const swapUser = users.find(u => u.id === swapTargetUserId)
      const swapShiftId = swapUser?.shift_id || ''

      if (!swapShiftId || !currentShiftId) {
        toast.error('Salah satu karyawan belum memiliki shift. Pastikan keduanya sudah ada shift.')
        return
      }

      if (currentShiftId === swapShiftId) {
        toast.error('Kedua karyawan sudah berada di shift yang sama. Tukar shift tidak diperlukan.')
        return
      }

      // User A mendapat shift B, User B mendapat shift A
      updateShiftMutation.mutate({
        userId: shiftForm.userId,
        shiftId: swapShiftId,       // shift user B → ke user A
        effectiveDate: shiftForm.effectiveDate,
        swapUserId: swapTargetUserId,
        swapShiftId: currentShiftId, // shift user A → ke user B
      })
    } else {
      // Mode ganti shift biasa — butuh shiftId manual, tampilkan error jika tidak ada
      if (!shiftForm.shiftId) {
        toast.error('Pilih shift baru atau pilih karyawan yang akan ditukar shiftnya.')
        return
      }

      const targetShiftId = shiftForm.shiftId === 'none' ? '' : shiftForm.shiftId
      if (currentShiftId === targetShiftId) {
        toast.error('Karyawan sudah berada di shift tersebut.')
        return
      }

      updateShiftMutation.mutate({
        userId: shiftForm.userId,
        shiftId: shiftForm.shiftId,
        effectiveDate: shiftForm.effectiveDate,
      })
    }
  }

  // Fetch overtime assignments
  const { data: overtimeList = [], isLoading: overtimeLoading } = useQuery<OvertimeRow[]>({
    queryKey: ['overtime'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('overtime_assignments')
        .select('id, user_id, shift_id, assignment_date, assigned_by, assigned_from, status, keterangan, overtime_in, overtime_out, duration, created_at, users!overtime_assignments_user_id_fkey(name), shifts(name), assigned_by_user:users!overtime_assignments_assigned_by_fkey(name)')
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error
      return (data ?? []).map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        user_name: r.users?.name ?? '—',
        shift_id: r.shift_id,
        shift_name: r.shifts?.name ?? '—',
        assignment_date: r.assignment_date,
        assigned_by_name: r.assigned_by_user?.name ?? '—',
        assigned_from: r.assigned_from,
        status: r.status,
        keterangan: r.keterangan,
        overtime_in: r.overtime_in,
        overtime_out: r.overtime_out,
        duration: r.duration,
        created_at: r.created_at,
      }))
    }
  })

  // Assign overtime mutation
  const assignOvertimeMutation = useMutation({
    mutationFn: async (payload: { userId: string; shiftId: string; date: string; keterangan: string }) => {
      // Get current logged-in user id
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('overtime_assignments')
        .insert({
          user_id: payload.userId,
          shift_id: payload.shiftId,
          assignment_date: payload.date,
          assigned_by: user?.id,
          assigned_from: 'website',
          shift_type: 'double',
          status: 'pending',
          keterangan: payload.keterangan || null,
        })
      if (error) throw error

      // Kirim notifikasi ke karyawan
      await supabase.from('notifications').insert({
        user_id: payload.userId,
        message: 'Ada tugas baru buat kamu, yaitu "Lembur". Silahkan melakukan absensi, agar kehitung di sistem untuk keperluan penggajian. Terimakasih.',
        is_read: false,
      })
    },
    onSuccess: () => {
      toast.success('Lembur berhasil di-assign!')
      setShiftForm({ userId: '', shiftId: '', effectiveDate: new Date().toISOString().split('T')[0], shiftType: 'single', keterangan: '' })
      setShowJadwalModal(false)
      setJadwalMenu('')
      queryClient.invalidateQueries({ queryKey: ['shiftHistory'] })
    },
    onError: (error: any) => {
      toast.error('Gagal assign lembur: ' + error.message)
    }
  })

  // Delete overtime mutation
  const deleteOvertimeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('overtime_assignments')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Tugas lembur berhasil dihapus!')
      queryClient.invalidateQueries({ queryKey: ['overtime'] })
    },
    onError: (error: any) => {
      toast.error('Gagal menghapus lembur: ' + error.message)
    }
  })

  // ─── Off Day queries & mutations ─────────────────────────
  const { data: offDays = [], isLoading: offDaysLoading } = useQuery<OffDayRow[]>({
    queryKey: ['offDays'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const nextWeek = new Date()
      nextWeek.setDate(nextWeek.getDate() + 7)
      const nextWeekStr = nextWeek.toISOString().split('T')[0]

      const { data, error } = await supabase
        .from('user_shifts')
        .select('id, user_id, effective_date, reason, users(name)')
        .is('shift_id', null)
        .eq('shift_type', 'off')
        .gte('effective_date', today)
        .lte('effective_date', nextWeekStr)
        .order('effective_date', { ascending: true })

      if (error) throw error
      return (data ?? []).map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        user_name: r.users?.name ?? '—',
        effective_date: r.effective_date,
        reason: r.reason ?? 'libur',
      }))
    }
  })

  async function handleSetOff(e: React.FormEvent) {
    e.preventDefault()
    if (!offForm.userId || !offForm.offDate || !offForm.reason) {
      toast.error('Semua field wajib diisi!'); return
    }
    setSavingOff(true)
    try {
      const { error } = await supabase.from('user_shifts').insert({
        user_id: offForm.userId,
        shift_id: null,
        shift_type: 'off',
        reason: offForm.reason,
        effective_date: offForm.offDate,
      })
      if (error) throw error

      // Sinkronisasi: jika ada record attendance di tanggal tsb, update statusnya ke 'off'
      const { data: attRecord } = await supabase
        .from('attendance')
        .select('id')
        .eq('user_id', offForm.userId)
        .eq('date', offForm.offDate)
        .maybeSingle()
      if (attRecord) {
        await supabase
          .from('attendance')
          .update({ status: 'off' })
          .eq('id', attRecord.id)
      }

      toast.success('Hari off berhasil diset!')
      setOffForm({ userId: '', offDate: new Date().toISOString().split('T')[0], reason: 'libur' })
      setShowJadwalModal(false)
      setJadwalMenu('')
      queryClient.invalidateQueries({ queryKey: ['offDays'] })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
    } catch (err: any) {
      toast.error('Gagal: ' + err.message)
    } finally {
      setSavingOff(false)
    }
  }

  const deleteOffMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('user_shifts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Data off berhasil dihapus!')
      queryClient.invalidateQueries({ queryKey: ['offDays'] })
      setDeleteOffId(null)
    },
    onError: (e: any) => toast.error('Gagal menghapus: ' + e.message)
  })

  // ─── Emergency queries & mutations ───────────────────────
  const { data: emergencyRows = [], isLoading: emergencyLoading } = useQuery<EmergencyRow[]>({
    queryKey: ['emergency-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('emergency_assignments')
        .select('id, assigned_user_id, replacing_user_id, shift_id, target_date, reason, status, created_at, assigned_user:users!emergency_assignments_assigned_user_id_fkey(name), replacing_user:users!emergency_assignments_replacing_user_id_fkey(name), shift:shifts(name)')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return (data ?? []).map((r: any) => ({
        id: r.id,
        assigned_user_id: r.assigned_user_id,
        assigned_user_name: r.assigned_user?.name ?? '—',
        replacing_user_id: r.replacing_user_id ?? null,
        replacing_user_name: r.replacing_user?.name ?? null,
        shift_id: r.shift_id ?? null,
        shift_name: r.shift?.name ?? null,
        target_date: r.target_date,
        reason: r.reason,
        status: r.status ?? 'pending',
        created_at: r.created_at,
      }))
    }
  })

  const saveEmergencyMutation = useMutation({
    mutationFn: async (payload: typeof emergencyForm & { id?: string }) => {
      const body: any = {
        assigned_user_id: payload.assigned_user_id,
        target_date: payload.target_date,
        reason: payload.reason,
        replacing_user_id: payload.reason === 'ganti_off' ? payload.replacing_user_id || null : null,
        shift_id: payload.reason === 'lembur' ? payload.shift_id || null : null,
        status: payload.status,
        assigned_from: 'website',
      }
      if (payload.id) {
        const { error } = await supabase.from('emergency_assignments').update(body).eq('id', payload.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('emergency_assignments').insert(body)
        if (error) throw error
      }

      // Kirim notifikasi ke karyawan yang di-assign
      if (payload.reason === 'lembur') {
        await supabase.from('notifications').insert({
          user_id: payload.assigned_user_id,
          message: 'Ada tugas baru buat kamu, yaitu "Lembur". Silahkan melakukan absensi, agar kehitung di sistem untuk keperluan penggajian. Terimakasih.',
          is_read: false,
        })
      } else if (payload.reason === 'ganti_off') {
        // Notifikasi ke karyawan yang digantikan (assigned_user_id)
        await supabase.from('notifications').insert({
          user_id: payload.assigned_user_id,
          message: 'Permintaan mu untuk ganti off dengan rekan kerja telah di perbaharui, silahkan cek. Terimakasih.',
          is_read: false,
        })
        // Kirim notifikasi juga ke karyawan pengganti (replacing_user_id) jika ada
        if (payload.replacing_user_id) {
          await supabase.from('notifications').insert({
            user_id: payload.replacing_user_id,
            message: 'Permintaan mu untuk ganti off dengan rekan kerja telah di perbaharui, silahkan cek. Terimakasih.',
            is_read: false,
          })

          // Sinkronisasi ke off_schedules: karyawan pengganti (replacing) dapat hari off di target_date
          // agar Android JadwalFragment dan DaruratLemburActivity membacanya konsisten
          if (!payload.id) {
            // Hanya saat INSERT baru, bukan update
            // Cari nama assigned_user untuk reason yang readable
            const { data: assignedUserData } = await supabase
              .from('users')
              .select('name')
              .eq('id', payload.assigned_user_id)
              .maybeSingle()
            const assignedUserName = (assignedUserData as any)?.name ?? payload.assigned_user_id

            await supabase.from('off_schedules').upsert({
              user_id: payload.replacing_user_id,
              off_date: payload.target_date,
              reason: `Ganti off dengan ${assignedUserName}`,
            }, { onConflict: 'user_id,off_date' })
          }
        }
      }
    },
    onSuccess: () => {
      toast.success(editEmergencyRow ? 'Penugasan diupdate!' : 'Penugasan disimpan!')
      queryClient.invalidateQueries({ queryKey: ['emergency-users'] })
      resetEmergencyForm()
    },
    onError: (e: any) => toast.error('Gagal: ' + e.message)
  })

  const deleteEmergencyMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('emergency_assignments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Penugasan dihapus!')
      queryClient.invalidateQueries({ queryKey: ['emergency-users'] })
      setDeleteEmergencyId(null)
    },
    onError: (e: any) => toast.error('Gagal: ' + e.message)
  })

  function resetEmergencyForm() {
    setEmergencyForm({ assigned_user_id: '', target_date: new Date().toISOString().split('T')[0], reason: 'lembur', replacing_user_id: '', shift_id: '', status: 'pending' })
    setEditEmergencyRow(null)
    setShowEmergencyForm(false)
    setShowJadwalModal(false)
    setJadwalMenu('')
    setOffUsersOnDate([])
  }

  function closeJadwalModal() {
    // Reset semua form state saat modal ditutup agar tidak ada data lama tersimpan
    setShowJadwalModal(false)
    setJadwalMenu('')
    setShiftForm({ userId: '', shiftId: '', effectiveDate: new Date().toISOString().split('T')[0], shiftType: 'single', keterangan: '' })
    setSwapTargetUserId('')
    setOffForm({ userId: '', offDate: new Date().toISOString().split('T')[0], reason: 'libur' })
    setEmergencyForm({ assigned_user_id: '', target_date: new Date().toISOString().split('T')[0], reason: 'lembur', replacing_user_id: '', shift_id: '', status: 'pending' })
    setEditEmergencyRow(null)
    setOffUsersOnDate([])
  }

  // ─── Open edit dari activity log ─────────────────────────
  function openEditFromActivity(row: ActivityLogRow) {
    setEditActivityRow(row)
    if (row.activity_type === 'Change Shift') {
      setJadwalMenu('change_shift')
      setShiftForm(f => ({ ...f, userId: row.raw_user_id ?? '', shiftId: row.raw_shift_id ?? '', effectiveDate: row.effective_date }))
    } else if (row.activity_type === 'Off Day') {
      setJadwalMenu('atur_off')
      setOffForm(f => ({ ...f, userId: row.raw_user_id ?? '', offDate: row.effective_date }))
    } else if (row.activity_type === 'Lembur') {
      setJadwalMenu('lembur')
      setEmergencyForm(f => ({ ...f, assigned_user_id: row.raw_user_id ?? '', target_date: row.effective_date, reason: 'lembur', shift_id: '' }))
    } else if (row.activity_type === 'Ganti Off') {
      setJadwalMenu('ganti_off')
      setEmergencyForm(f => ({ ...f, assigned_user_id: row.raw_user_id ?? '', target_date: row.effective_date, reason: 'ganti_off', replacing_user_id: row.raw_replacing_user_id ?? '' }))
      loadOffUsersOnDate(row.effective_date)
    }
    setShowJadwalModal(true)
  }

  async function loadOffUsersOnDate(date: string) {
    if (!date) { setOffUsersOnDate([]); return }
    setLoadingOffUsers(true)
    try {
      const { data } = await supabase
        .from('user_shifts')
        .select('user_id, users(name)')
        .is('shift_id', null)
        .eq('shift_type', 'off')
        .eq('effective_date', date)
      setOffUsersOnDate((data ?? []).map((r: any) => ({ id: r.user_id, name: r.users?.name ?? '—' })))
    } catch {
      setOffUsersOnDate([])
    } finally {
      setLoadingOffUsers(false)
    }
  }

  function handleSubmitEmergency(e: React.FormEvent) {
    e.preventDefault()
    if (!emergencyForm.assigned_user_id || !emergencyForm.target_date) {
      toast.error('Karyawan dan tanggal wajib diisi!'); return
    }
    if (emergencyForm.reason === 'ganti_off' && !emergencyForm.replacing_user_id) {
      toast.error('Karyawan yang digantikan wajib diisi!'); return
    }
    saveEmergencyMutation.mutate({ ...emergencyForm, id: editEmergencyRow?.id })
  }

  function openEditEmergency(row: EmergencyRow) {
    setEditEmergencyRow(row)
    setEmergencyForm({
      assigned_user_id: row.assigned_user_id,
      target_date: row.target_date,
      reason: row.reason,
      replacing_user_id: row.replacing_user_id ?? '',
      shift_id: row.shift_id ?? '',
      status: row.status,
    })
    if (row.reason === 'ganti_off') loadOffUsersOnDate(row.target_date)
    setShowEmergencyForm(true)
  }



  // Export excel function
  function exportExcel() {
    if (attRows.length === 0) {
      toast.error('Tidak ada data untuk diekspor')
      return
    }
    const ws = XLSX.utils.json_to_sheet(attRows.map(r => {
      const breakText = r.break_start ? (r.break_end ? `${formatTime(r.break_start)} - ${formatTime(r.break_end)}` : `${formatTime(r.break_start)} - --:--`) : '-'
      return {
        Nama: r.user_name, Shift: r.shift_name, Tanggal: r.date,
        'Jam Masuk': r.check_in ? formatTime(r.check_in) : '-',
        'Istirahat': breakText,
        'Jam Pulang': r.check_out ? formatTime(r.check_out) : '-',
        Status: r.status,
      }
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
    XLSX.writeFile(wb, `attendance_${attFilterDate || 'all'}.xlsx`)
    toast.success('Excel berhasil diekspor!')
  }

  // Export PDF function
  async function exportPDF() {
    const filterDate = new Date(attFilterDate)
    const year = filterDate.getFullYear()
    const month = filterDate.getMonth() // 0-indexed
    const monthName = filterDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })

    // Hitung range: 1 bulan penuh dari tanggal filter
    const firstDay = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const lastDayDate = new Date(year, month + 1, 0)
    const lastDay = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`

    toast.loading('Memuat data absensi sebulan...')

    try {
      // Fetch semua user aktif kecuali superadmin
      const { data: allUsers } = await supabase
        .from('users')
        .select('id, name')
        .eq('is_active', true)
        .neq('role', 'superadmin')
        .order('name')

      // Fetch semua attendance bulan tersebut
      const { data: attData } = await supabase
        .from('attendance')
        .select('id, user_id, date, status, check_in_time, check_out_time, break_start, break_end')
        .gte('date', firstDay)
        .lte('date', lastDay)
        .order('date', { ascending: true })

      // Fetch shift default per user
      const { data: shiftData } = await supabase
        .from('user_shifts')
        .select('user_id, created_at, shifts(name)')
        .not('shift_id', 'is', null)
        .neq('shift_type', 'off')
        .neq('shift_type', 'profile_edit')
        .order('created_at', { ascending: false })

      const shiftMap: Record<string, string> = {}
      ;(shiftData ?? []).forEach((us: any) => {
        if (!shiftMap[us.user_id]) shiftMap[us.user_id] = (us.shifts as any)?.name ?? '—'
      })

      // Build lookup: user_id+date → attendance
      const attLookup: Record<string, any> = {}
      ;(attData ?? []).forEach((a: any) => {
        attLookup[`${a.user_id}_${a.date}`] = a
      })

      // Generate semua kombinasi user x tanggal dalam bulan
      const rows: any[] = []
      const daysInMonth = lastDayDate.getDate()
      for (const u of (allUsers ?? [])) {
        for (let d = 1; d <= daysInMonth; d++) {
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          const att = attLookup[`${u.id}_${dateStr}`]
          const status = att ? att.status : (dateStr < new Date().toISOString().split('T')[0] ? 'alfa' : '-')
          rows.push({
            user_name: u.name,
            shift_name: shiftMap[u.id] ?? '—',
            date: dateStr,
            check_in: att?.check_in_time ?? null,
            check_out: att?.check_out_time ?? null,
            break_start: att?.break_start ?? null,
            break_end: att?.break_end ?? null,
            status,
          })
        }
      }

      if (rows.length === 0) {
        toast.dismiss()
        toast.error('Tidak ada data untuk bulan ini')
        return
      }

      const docDefinition = {
        pageOrientation: 'landscape' as const,
        content: [
          { text: 'Laporan Absensi Bulanan — PT. Carefastindo Indonesia', style: 'header' },
          { text: `Periode: ${monthName}  |  Tanggal Cetak: ${new Date().toLocaleDateString('id-ID')}`, style: 'subheader' },
          {
            style: 'tableExample',
            table: {
              headerRows: 1,
              widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
              body: [
                [
                  { text: 'Nama', style: 'tableHeader' },
                  { text: 'Shift', style: 'tableHeader' },
                  { text: 'Tanggal', style: 'tableHeader' },
                  { text: 'Jam Masuk', style: 'tableHeader' },
                  { text: 'Istirahat', style: 'tableHeader' },
                  { text: 'Jam Pulang', style: 'tableHeader' },
                  { text: 'Status', style: 'tableHeader' }
                ],
                ...rows.map(r => [
                  r.user_name,
                  r.shift_name,
                  new Date(r.date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
                  r.check_in ? formatTime(r.check_in) : '-',
                  r.break_start ? (r.break_end ? `${formatTime(r.break_start)} - ${formatTime(r.break_end)}` : `${formatTime(r.break_start)} - --:--`) : '-',
                  r.check_out ? formatTime(r.check_out) : '-',
                  r.status.charAt(0).toUpperCase() + r.status.slice(1),
                ])
              ]
            }
          }
        ],
        styles: {
          header: { fontSize: 16, bold: true, margin: [0, 0, 0, 5] },
          subheader: { fontSize: 9, italics: true, margin: [0, 0, 0, 12] },
          tableExample: { margin: [0, 5, 0, 15], fontSize: 8 },
          tableHeader: { bold: true, fontSize: 9, color: 'black', fillColor: '#F1F5F9' }
        }
      }

      toast.dismiss()
      // @ts-ignore
      pdfMake.createPdf(docDefinition).download(`laporan_absensi_${year}_${String(month + 1).padStart(2, '0')}.pdf`)
      toast.success('PDF berhasil diekspor!')
    } catch (err: any) {
      toast.dismiss()
      toast.error('Gagal ekspor PDF: ' + err.message)
    }
  }

  // Filtered users for table
  const filteredUsers = users.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) || 
                        u.email.toLowerCase().includes(search.toLowerCase()) ||
                        u.nip.toLowerCase().includes(search.toLowerCase())
    const matchRole = filterRole === 'all' || u.role.toLowerCase() === filterRole.toLowerCase()
    return matchSearch && matchRole
  })

  const roles = ['all', 'superadmin', 'supervisor', 'leader', 'cleaner', 'housekeeping', 'gardener', 'gondola']

  const getRoleVariant = (role: string) => {
    switch (role.toLowerCase()) {
      case 'superadmin': return 'default'
      case 'supervisor': return 'info'
      case 'leader': return 'warning'
      case 'cleaner':
      case 'housekeeping':
      case 'gardener':
      case 'gondola': return 'success'
      default: return 'outline'
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Manajemen Karyawan</h1>
          <p className="text-sm text-slate-500 mt-1">Kelola data karyawan, shift, dan absensi dalam satu halaman.</p>
        </div>
      </div>

      {/* 1. DAFTAR KARYAWAN (PALING ATAS) */}
      <Card className="shadow-sm">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle className="text-lg font-bold text-slate-800">👥 Daftar Karyawan</CardTitle>
            <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
              <Button
                onClick={() => openRadiusModal()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Atur Radius Lokasi Absensi
              </Button>
              <Button
                onClick={() => { closeJadwalModal(); setShowJadwalModal(true) }}
                className="bg-slate-600 hover:bg-slate-700 text-white font-medium"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Ubah Jadwal Karyawan
              </Button>
              <Button 
                onClick={() => { setShowAddModal(true); setShowAddPassword(false); setAddUserForm({ name: '', email: '', password: '', role: 'cleaner', nip: '', shiftId: '' }) }}
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Tambah Karyawan
              </Button>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Filter:</span>
              <select
                value={filterRole}
                onChange={e => setFilterRole(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-9 capitalize"
              >
                {roles.map(r => (
                  <option key={r} value={r}>{r === 'all' ? 'Semua Role' : r}</option>
                ))}
              </select>
            </div>
            
            <div className="relative flex-1 sm:max-w-[240px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Cari NIP, nama..."
                className="pl-9 pr-3 py-1.5 w-full border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-9"
              />
            </div>
            
            {(search || filterRole !== 'all') && (
              <Button variant="ghost" size="icon" onClick={() => { setSearch(''); setFilterRole('all') }} className="h-9 w-9 shrink-0">
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="border-collapse w-full">
              <TableHeader className="bg-[#F8FAFC]">
                <TableRow className="hover:bg-transparent border-b border-slate-200">
                  <TableHead className="text-slate-600 font-semibold py-3 pl-4 text-center">No</TableHead>
                  <TableHead className="text-slate-600 font-semibold py-3">Nama</TableHead>
                  <TableHead className="text-slate-600 font-semibold py-3">Email</TableHead>
                  <TableHead className="text-slate-600 font-semibold py-3 text-center">NIP</TableHead>
                  <TableHead className="text-slate-600 font-semibold py-3 text-center">Role</TableHead>
                  <TableHead className="text-slate-600 font-semibold py-3 text-center">Shift Saat Ini</TableHead>
                  <TableHead className="text-slate-600 font-semibold py-3 pr-4 text-center">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usersLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-6" /></TableCell>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full max-w-[120px]" /></TableCell>
                      ))}
                      <TableCell className="pr-4"><Skeleton className="h-4 w-16 mx-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-slate-400">
                      Tidak ada karyawan ditemukan
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((u, i) => (
                    <TableRow key={u.id} className="bg-white border-b border-slate-100 hover:bg-slate-50/50">
                      <TableCell className="font-mono text-xs text-slate-400 py-3 pl-4 text-center">{i + 1}</TableCell>
                      <TableCell className="font-semibold text-slate-700 py-3">{u.name}</TableCell>
                      <TableCell className="text-slate-500 text-sm py-3">{u.email}</TableCell>
                      <TableCell className="text-slate-600 font-mono text-sm py-3 text-center">
                        {u.role.toLowerCase() === 'superadmin' ? 'N/A' : u.nip}
                      </TableCell>
                      <TableCell className="py-3 text-center">
                        <Badge variant={getRoleVariant(u.role) as any} className="capitalize font-medium">
                          {u.role === 'supervisor' ? 'Supervisor' : u.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600 font-medium py-3 text-center">
                        {u.role.toLowerCase() === 'superadmin' ? 'N/A' : u.current_shift}
                      </TableCell>
                      <TableCell className="py-3 pr-4 text-center">
                        {u.role.toLowerCase() === 'superadmin' ? (
                          <span className="text-slate-400 font-medium text-sm">Permanent Data</span>
                        ) : (
                          <div className="flex items-center justify-center gap-2">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-8 w-8 p-0 text-blue-600 border-blue-200 hover:bg-blue-50"
                              onClick={() => openEditModal(u)}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-8 w-8 p-0 text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => setDeletingUserId(u.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
              {"\u231B"} Daftar Riwayat Perubahan Aktivitas
            </CardTitle>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={actFilterDate}
                max={todayStr}
                onChange={e => { setActFilterDate(e.target.value); setActPage(1) }}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="border-collapse w-full">
            <TableHeader className="bg-[#F8FAFC]">
              <TableRow className="hover:bg-transparent border-b border-slate-200">
                <TableHead className="text-slate-600 font-semibold py-3 pl-4">No</TableHead>
                <TableHead className="text-slate-600 font-semibold py-3">Nama Karyawan</TableHead>
                <TableHead className="text-slate-600 font-semibold py-3 text-center">Nama Perubahan Jadwal</TableHead>
                <TableHead className="text-slate-600 font-semibold py-3 text-center">Tanggal Efektif</TableHead>
                <TableHead className="text-slate-600 font-semibold py-3 text-center">Status</TableHead>
                <TableHead className="text-slate-600 font-semibold py-3 pr-4 text-center">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activityLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j} className={j === 0 ? 'pl-4' : ''}><Skeleton className="h-4 w-full max-w-[120px]" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : actRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-slate-400 pl-4">
                    Belum ada perubahan aktivitas pada tanggal ini
                  </TableCell>
                </TableRow>
              ) : actRows.map((row, idx) => (
                <TableRow key={`${row.source}-${row.id}`} className="bg-white border-b border-slate-100 hover:bg-slate-50/50">
                  <TableCell className="font-mono text-xs text-slate-400 py-3 pl-4">
                    {(actPage - 1) * ACT_PAGE_SIZE + idx + 1}
                  </TableCell>
                  <TableCell className="font-semibold text-slate-700 py-3">{row.user_name}</TableCell>
                  <TableCell className="py-3 text-center">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                      row.activity_type === 'Change Shift' ? 'bg-blue-100 text-blue-700' :
                      row.activity_type === 'Off Day' ? 'bg-orange-100 text-orange-700' :
                      row.activity_type === 'Lembur' ? 'bg-purple-100 text-purple-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {row.activity_type}
                    </span>
                  </TableCell>
                  <TableCell className="text-slate-500 py-3 text-center">{row.effective_date}</TableCell>
                  <TableCell className="py-3 text-center">
                    <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-green-500 text-white">
                      Berjalan
                    </span>
                  </TableCell>
                  <TableCell className="py-3 pr-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => openEditFromActivity(row)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-blue-500 hover:bg-blue-50 transition-all"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteActivityId({ id: row.id, source: row.source })}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          {actTotalPages > 1 && (
            <div className="flex items-center justify-end p-4 border-t border-slate-100 gap-3">
              <p className="text-xs text-slate-500">
                Menampilkan {actTotal === 0 ? 0 : Math.min((actPage - 1) * ACT_PAGE_SIZE + 1, actTotal)} - {Math.min(actPage * ACT_PAGE_SIZE, actTotal)} dari {actTotal} entri
              </p>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setActPage(p => Math.max(1, p - 1))} disabled={actPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setActPage(p => Math.min(actTotalPages, p + 1))} disabled={actPage === actTotalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* PENGAJUAN CUTI KARYAWAN */}
      <Card className="shadow-sm opacity-60 pointer-events-none select-none">
        <CardHeader className="bg-slate-100/80 border-b border-slate-200 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base font-bold text-slate-500 flex items-center gap-2">
                🏖️ Pengajuan Cuti Karyawan
              </CardTitle>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-300 text-slate-600 uppercase tracking-wider">
                Segera Hadir
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  placeholder="Cari nama karyawan..."
                  disabled
                  className="pl-9 pr-3 py-1.5 w-[200px] border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-400 h-9 cursor-not-allowed"
                />
              </div>
              <select disabled className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-slate-50 text-slate-400 h-9 cursor-not-allowed">
                <option>all</option>
              </select>
              <select disabled className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm bg-slate-50 text-slate-400 h-9 cursor-not-allowed">
                <option>pending</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="border-collapse w-full">
            <TableHeader className="bg-[#F8FAFC]">
              <TableRow className="hover:bg-transparent border-b border-slate-200">
                <TableHead className="text-slate-400 font-semibold py-3 pl-4">Nama Karyawan</TableHead>
                <TableHead className="text-slate-400 font-semibold py-3">Jenis Pengajuan</TableHead>
                <TableHead className="text-slate-400 font-semibold py-3">Tanggal Mulai</TableHead>
                <TableHead className="text-slate-400 font-semibold py-3">Tanggal Selesai</TableHead>
                <TableHead className="text-slate-400 font-semibold py-3">Alasan</TableHead>
                <TableHead className="text-slate-400 font-semibold py-3 text-center">Status</TableHead>
                <TableHead className="text-slate-400 font-semibold py-3 pr-4 text-center">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-slate-400">
                  Fitur Pengajuan Cuti akan segera hadir
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Confirm delete activity */}
      <AnimatePresence>
        {deleteActivityId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
          >
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">Hapus Data Aktivitas</h3>
                  <p className="text-sm text-slate-500">Data yang dihapus tidak dapat dikembalikan.</p>
                </div>
              </div>
              <div className="flex gap-3 justify-end mt-4">
                <button onClick={() => setDeleteActivityId(null)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all">
                  Batal
                </button>
                <button
                  onClick={() => deleteActivityMutation.mutate(deleteActivityId!)}
                  disabled={deleteActivityMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-all"
                >
                  {deleteActivityMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Hapus
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 4. TABEL ATTENDANCE (ABSENSI KARYAWAN - DI BAWAH RIWAYAT SHIFT) */}
      <Card className="shadow-sm">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-bold text-slate-800">{"\uD83D\uDCC5"} Tabel Absensi Karyawan</CardTitle>
            </div>
            <div className="flex gap-2">
              {(() => {
                const now = new Date()
                const filterDate = new Date(attFilterDate)
                // PDF aktif hanya jika bulan filter sudah berlalu (beda bulan dari sekarang)
                const isPastMonth = filterDate.getFullYear() < now.getFullYear() ||
                  (filterDate.getFullYear() === now.getFullYear() && filterDate.getMonth() < now.getMonth())
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportPDF}
                    disabled={!isPastMonth}
                    style={isPastMonth ? { backgroundColor: '#DC143C', borderColor: '#DC143C' } : { backgroundColor: '#CBD5E1', borderColor: '#CBD5E1' }}
                    className="text-white h-9 font-medium text-sm px-4 rounded-lg transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
                    title={isPastMonth ? 'Ekspor PDF' : 'PDF hanya tersedia untuk bulan yang sudah berlalu'}
                  >
                    <Download className="w-4 h-4 mr-1.5" /> PDF
                  </Button>
                )
              })()}
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider shrink-0">Filter:</span>
            <Input
              type="date"
              value={attFilterDate}
              onChange={e => { setAttFilterDate(e.target.value); setAttPage(1) }}
              className="w-[160px] bg-white h-9 shrink-0"
            />
            <Select value={attFilterShift} onValueChange={v => { setAttFilterShift(v as string); setAttPage(1) }}>
              <SelectTrigger className="w-[160px] bg-white h-9 shrink-0">
                <SelectValue>
                  {attFilterShift === 'all' ? 'Semua Shift' : attFilterShift}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Shift</SelectItem>
                {shifts.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={attFilterStatus} onValueChange={v => { setAttFilterStatus(v as string); setAttPage(1) }}>
              <SelectTrigger className="w-[160px] bg-white h-9 shrink-0">
                <SelectValue>
                  {attFilterStatus === 'all' ? 'Semua Status' : (attFilterStatus.charAt(0).toUpperCase() + attFilterStatus.slice(1))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="hadir">Hadir</SelectItem>
                <SelectItem value="izin">Izin</SelectItem>
                <SelectItem value="sakit">Sakit</SelectItem>
                <SelectItem value="alfa">Absen</SelectItem>
                <SelectItem value="terlambat">Terlambat</SelectItem>
                <SelectItem value="cuti">Cuti</SelectItem>
                <SelectItem value="cuti_segera" disabled className="text-slate-400 cursor-not-allowed">Cuti (Segera Hadir)</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative shrink-0 w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <Input
                value={attSearch}
                onChange={e => { setAttSearch(e.target.value); setAttPage(1) }}
                placeholder="Cari nama karyawan..."
                className="pl-9 bg-white w-full h-9 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
              />
            </div>
            {(attFilterDate !== todayStr || attFilterStatus !== 'all' || attFilterShift !== 'all' || attSearch) && (
              <Button
                variant="ghost"
                onClick={() => { setAttFilterDate(todayStr); setAttFilterShift('all'); setAttFilterStatus('all'); setAttSearch(''); setAttPage(1) }}
                className="px-3 h-9 shrink-0"
                title="Reset Filter"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-[#F8FAFC]">
                <TableRow className="hover:bg-transparent border-b border-slate-200">
                  <TableHead className="w-[50px] pl-4">No</TableHead>
                  <TableHead>Nama Karyawan</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead className="text-center">Tanggal</TableHead>
                  <TableHead className="text-center">Jam Masuk</TableHead>
                  <TableHead className="text-center">Istirahat</TableHead>
                  <TableHead className="text-center">Jam Pulang</TableHead>
                  <TableHead className="text-center">Jam Lembur</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center pr-4">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendanceLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-6" /></TableCell>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full max-w-[90px]" /></TableCell>
                      ))}
                      <TableCell className="pr-4"><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : attRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-32 text-center text-slate-400">
                      Tidak ada data absensi ditemukan
                    </TableCell>
                  </TableRow>
                ) : (
                  attRows.map((r, i) => (
                    <TableRow key={r.id} className="bg-white border-b border-slate-100 hover:bg-slate-50/50">
                      <TableCell className="font-mono text-xs text-slate-400 pl-4">{(attPage - 1) * PAGE_SIZE + i + 1}</TableCell>
                      <TableCell className="font-medium text-slate-700">{r.user_name}</TableCell>
                      <TableCell className="text-slate-500">{r.shift_name}</TableCell>
                      <TableCell className="text-slate-500 text-center">{formatDate(r.date)}</TableCell>
                      <TableCell className="text-slate-500 text-center">{r.check_in ? formatTime(r.check_in) : '—'}</TableCell>
                      <TableCell className="text-slate-500 text-center">
                        {(() => {
                          if (!r.break_start) return '—'
                          const start = formatTime(r.break_start)
                          if (!r.break_end) return `${start} - --:--`
                          const end = formatTime(r.break_end)
                          return `${start} - ${end}`
                        })()}
                      </TableCell>
                      <TableCell className="text-slate-500 text-center">{r.check_out ? formatTime(r.check_out) : '—'}</TableCell>
                      <TableCell className="text-slate-500 text-center">
                        {(() => {
                          const hasOt = r.overtime_check_in !== null || r.overtime_check_out !== null
                          if (!hasOt) return <span className="text-slate-400">—</span>
                          if (r.overtime_check_in && !r.overtime_check_out) {
                            return (
                              <span className="text-orange-500 font-medium text-xs whitespace-nowrap">
                                Sedang Berlangsung
                              </span>
                            )
                          }
                          if (r.overtime_check_in && r.overtime_check_out) {
                            return (
                              <span className="text-slate-600 text-xs whitespace-nowrap">
                                {formatTime(r.overtime_check_in)} - {formatTime(r.overtime_check_out)}
                              </span>
                            )
                          }
                          return <span className="text-slate-400">—</span>
                        })()}
                      </TableCell>
                      <TableCell className="text-center">
                        {(() => {
                          const statusColor = r.status === 'hadir'
                            ? { bg: '#DCFCE7', text: '#166534' }
                            : r.status === 'terlambat'
                            ? { bg: '#FEF9C3', text: '#854D0E' }
                            : r.status === 'absen' || r.status === 'alfa'
                            ? { bg: '#FEE2E2', text: '#991B1B' }
                            : r.status === 'sakit'
                            ? { bg: '#DBEAFE', text: '#1E40AF' }
                            : r.status === 'izin'
                            ? { bg: '#EDE9FE', text: '#5B21B6' }
                            : r.status === 'cuti'
                            ? { bg: '#FCE7F3', text: '#9D174D' }
                            : r.status === 'off'
                            ? { bg: '#F1F5F9', text: '#475569' }
                            : r.status === '-'
                            ? { bg: 'transparent', text: '#94A3B8' }
                            : { bg: '#F3F4F6', text: '#374151' }
                          const statusLabel = r.status === '-' ? '—' : (r.status === 'off' ? 'Off' : r.status.charAt(0).toUpperCase() + r.status.slice(1))
                          return (
                            <span style={{ background: statusColor.bg, color: statusColor.text, padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              {statusLabel}
                            </span>
                          )
                        })()}
                      </TableCell>
                      <TableCell className="text-center pr-4">
                        <div className="flex items-center justify-center gap-1">
                          {(() => {
                            // Aktif: tanggal <= hari ini DAN status bukan '-' (virtual row masa depan)
                            const isFuture = r.date > todayStr
                            const isVirtualNoData = r.status === '-' && !isFuture
                            const disablePreview = isFuture || (r.status === '-' && !r.check_in)
                            const disableEdit = isFuture
                            return (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                                  onClick={() => setSelectedAtt(r)}
                                  title="Detail"
                                  disabled={disablePreview}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                                  disabled={disableEdit}
                                  onClick={() => {
                                    setEditingAtt(r)
                                    setEditAttForm({
                                      check_in: r.check_in ? new Date(r.check_in).toTimeString().slice(0,5) : '',
                                      check_out: r.check_out ? new Date(r.check_out).toTimeString().slice(0,5) : '',
                                      break_start: r.break_start ? new Date(r.break_start).toTimeString().slice(0,5) : '',
                                      break_end: r.break_end ? new Date(r.break_end).toTimeString().slice(0,5) : '',
                                      status: r.status,
                                      notes: r.notes ?? '',
                                      overtime_in: r.overtime_check_in ? new Date(r.overtime_check_in).toTimeString().slice(0,5) : '',
                                      overtime_out: r.overtime_check_out ? new Date(r.overtime_check_out).toTimeString().slice(0,5) : '',
                                      shift_id: shifts.find((s: any) => s.name === r.shift_name)?.id ?? '',
                                    })
                                  }}
                                  title="Edit"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                              </>
                            )
                          })()}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-end p-4 border-t border-slate-100 gap-3">
            <p className="text-xs text-slate-500">
              Menampilkan {attTotal === 0 ? 0 : Math.min((attPage - 1) * PAGE_SIZE + 1, attTotal)} - {Math.min(attPage * PAGE_SIZE, attTotal || 0)} dari {attTotal || 0} entri
            </p>
            <button
              onClick={() => setAttPage(p => Math.max(1, p - 1))}
              disabled={attPage === 1}
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-all text-sm font-medium"
            >
              &lt;
            </button>
            <button
              onClick={() => setAttPage(p => Math.min(attTotalPages, p + 1))}
              disabled={attPage >= attTotalPages}
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-all text-sm font-medium"
            >
              &gt;
            </button>
          </div>
        </CardContent>
      </Card>

      {/* MODAL PERUBAHAN JADWAL */}
      <AnimatePresence>
        {showJadwalModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm overflow-y-auto py-6 px-4"
            onClick={e => { if (e.target === e.currentTarget) closeJadwalModal() }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Perubahan Jadwal</h2>
                </div>
                <button
                  onClick={() => closeJadwalModal()}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-500 transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Dropdown pilihan menu */}
              <div className="px-6 pt-4 pb-2">
                <label className="block text-sm font-semibold text-slate-700 mb-2">Jenis Perubahan</label>
                <select
                  value={jadwalMenu}
                  onChange={e => setJadwalMenu(e.target.value as typeof jadwalMenu)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800 bg-white text-slate-800"
                >
                  <option value="">-- Pilih Jenis Perubahan --</option>
                  <option value="change_shift">Change Shift</option>
                  <option value="atur_off">Off Day</option>
                  <option value="lembur">Lembur</option>
                  <option value="ganti_off">Ganti Off</option>
                  <option value="" disabled style={{ color: '#94A3B8' }}>Cuti (Segera Hadir)</option>
                </select>
              </div>

              {/* Konten berdasarkan pilihan */}
              <div className="px-6 pb-6 pt-2">

                {/* ── CHANGE SHIFT ── */}
                {jadwalMenu === 'change_shift' && (
                  <div className="mt-4">
                    <form onSubmit={handleUpdateShift} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-1">Karyawan <span className="text-red-500">*</span></label>
                          <select
                            value={shiftForm.userId}
                            onChange={e => setShiftForm(f => ({ ...f, userId: e.target.value }))}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
                          >
                            <option value="" disabled>Pilih Karyawan</option>
                            {users.filter(u => u.role.toLowerCase() !== 'superadmin').map(u => (
                              <option key={u.id} value={u.id}>{u.name} — shift: {u.current_shift || '—'}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-1">Tanggal Efektif <span className="text-red-500">*</span></label>
                          <input
                            type="date"
                            value={shiftForm.effectiveDate}
                            onChange={e => setShiftForm(f => ({ ...f, effectiveDate: e.target.value }))}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
                          />
                        </div>
                      </div>

                      {/* Tukar dengan Karyawan (opsional) */}
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">
                          Tukar Shift dengan Karyawan
                          <span className="text-slate-400 font-normal ml-1">(opsional)</span>
                        </label>
                        <select
                          value={swapTargetUserId}
                          onChange={e => setSwapTargetUserId(e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
                        >
                          <option value="">-- Tidak Tukar --</option>
                          {users.filter(u => u.role.toLowerCase() !== 'superadmin' && u.id !== shiftForm.userId).map(u => (
                            <option key={u.id} value={u.id}>{u.name} — shift: {u.current_shift || '—'}</option>
                          ))}
                        </select>
                        {swapTargetUserId && shiftForm.userId && (() => {
                          const userA = users.find(u => u.id === shiftForm.userId)
                          const userB = users.find(u => u.id === swapTargetUserId)
                          if (!userA || !userB) return null
                          return (
                            <div className="mt-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
                              <span className="font-semibold">{userA.name}</span> ({userA.current_shift || '—'}) akan mendapat shift <span className="font-semibold">{userB.current_shift || '—'}</span>, dan <span className="font-semibold">{userB.name}</span> akan mendapat shift <span className="font-semibold">{userA.current_shift || '—'}</span>.
                            </div>
                          )
                        })()}
                      </div>

                      {/* Keterangan — textarea penuh di bawah */}
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">Keterangan</label>
                        <textarea
                          rows={4}
                          placeholder="Tulis alasan perubahan shift atau catatan tambahan..."
                          value={shiftForm.keterangan}
                          onChange={e => setShiftForm(f => ({ ...f, keterangan: e.target.value }))}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800 resize-none"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={updateShiftMutation.isPending || assignOvertimeMutation.isPending}
                        className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                      >
                        {(updateShiftMutation.isPending || assignOvertimeMutation.isPending) && <Loader2 className="w-4 h-4 animate-spin" />}
                        Simpan Perubahan
                      </button>
                    </form>
                  </div>
                )}

                {/* ── ATUR HARI OFF ── */}
                {jadwalMenu === 'atur_off' && (
                  <div className="mt-4 space-y-4">
                    <form onSubmit={handleSetOff} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-1">Karyawan *</label>
                          <select
                            value={offForm.userId}
                            onChange={e => setOffForm(f => ({ ...f, userId: e.target.value }))}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
                          >
                            <option value="">-- Pilih Karyawan --</option>
                            {users.filter(u => u.role.toLowerCase() !== 'superadmin').map(u => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-1">Tanggal Off *</label>
                          <input
                            type="date"
                            value={offForm.offDate}
                            onChange={e => setOffForm(f => ({ ...f, offDate: e.target.value }))}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
                          />
                        </div>
                      </div>
                      <button
                        type="submit"
                        disabled={savingOff}
                        className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                      >
                        {savingOff && <Loader2 className="w-4 h-4 animate-spin" />}
                        Simpan Perubahan
                      </button>
                    </form>
                  </div>
                )}

                {/* ── LEMBUR ── */}
                {jadwalMenu === 'lembur' && (
                  <div className="mt-4 space-y-4">
                    <form onSubmit={e => {
                      e.preventDefault()
                      const payload = { ...emergencyForm, reason: 'lembur' as const }
                      if (!payload.assigned_user_id || !payload.target_date) { toast.error('Karyawan dan tanggal wajib diisi!'); return }
                      saveEmergencyMutation.mutate({ ...payload, id: editEmergencyRow?.id })
                    }} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-1">Karyawan Ditugaskan *</label>
                          <select
                            value={emergencyForm.assigned_user_id}
                            onChange={e => setEmergencyForm(f => ({ ...f, assigned_user_id: e.target.value }))}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
                          >
                            <option value="">-- Pilih Karyawan --</option>
                            {users.filter(u => u.role.toLowerCase() !== 'superadmin').map(u => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-1">Tanggal *</label>
                          <input
                            type="date"
                            value={emergencyForm.target_date}
                            onChange={e => setEmergencyForm(f => ({ ...f, target_date: e.target.value }))}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">Shift Lembur</label>
                        <select
                          value={emergencyForm.shift_id}
                          onChange={e => setEmergencyForm(f => ({ ...f, shift_id: e.target.value }))}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
                        >
                          <option value="">-- Pilih Shift --</option>
                          {shifts.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                      <button
                          type="submit"
                          disabled={saveEmergencyMutation.isPending}
                          className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                        >
                          {saveEmergencyMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                          Simpan Perubahan
                        </button>
                    </form>
                  </div>
                )}

                {/* ── GANTI OFF ── */}
                {jadwalMenu === 'ganti_off' && (
                  <div className="mt-4 space-y-4">
                    <form onSubmit={e => {
                      e.preventDefault()
                      const payload = { ...emergencyForm, reason: 'ganti_off' as const }
                      if (!payload.assigned_user_id || !payload.target_date) { toast.error('Karyawan dan tanggal wajib diisi!'); return }
                      if (!payload.replacing_user_id) { toast.error('Karyawan yang digantikan wajib diisi!'); return }
                      saveEmergencyMutation.mutate({ ...payload, id: editEmergencyRow?.id })
                    }} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-1">Karyawan Ditugaskan *</label>
                          <select
                            value={emergencyForm.assigned_user_id}
                            onChange={e => setEmergencyForm(f => ({ ...f, assigned_user_id: e.target.value }))}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
                          >
                            <option value="">-- Pilih Karyawan --</option>
                            {users.filter(u => u.role.toLowerCase() !== 'superadmin').map(u => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-1">Tanggal *</label>
                          <input
                            type="date"
                            value={emergencyForm.target_date}
                            onChange={e => {
                              setEmergencyForm(f => ({ ...f, target_date: e.target.value, replacing_user_id: '' }))
                              loadOffUsersOnDate(e.target.value)
                            }}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1">
                          Karyawan Digantikan *
                          <span className="text-xs font-normal text-slate-400 ml-1">(hanya yang off pada tanggal tersebut)</span>
                        </label>
                        {loadingOffUsers ? (
                          <div className="text-sm text-slate-400 py-2">Memuat karyawan yang off...</div>
                        ) : offUsersOnDate.length === 0 ? (
                          <div className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-100">
                            Tidak ada karyawan yang off pada tanggal ini. Set hari off terlebih dahulu.
                          </div>
                        ) : (
                          <select
                            value={emergencyForm.replacing_user_id}
                            onChange={e => setEmergencyForm(f => ({ ...f, replacing_user_id: e.target.value }))}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800"
                          >
                            <option value="">-- Pilih Karyawan --</option>
                            {offUsersOnDate.filter(u => u.id !== emergencyForm.assigned_user_id).map(u => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                      <button
                        type="submit"
                        disabled={saveEmergencyMutation.isPending}
                        className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-slate-800 hover:bg-slate-900 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                      >
                        {saveEmergencyMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                        Simpan Perubahan
                      </button>
                    </form>
                  </div>
                )}

              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL ATUR RADIUS LOKASI ABSENSI */}
      <AnimatePresence>
        {showRadiusModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
            onClick={e => { if (e.target === e.currentTarget) setShowRadiusModal(false) }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Atur Radius Lokasi Absensi</h2>
                </div>
                <button
                  onClick={() => setShowRadiusModal(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-500 transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Current config display */}
              {companyConfig && (
                <div className="mx-6 mt-4 px-4 py-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-600 flex flex-wrap gap-x-6 gap-y-1">
                  <span>📍 Lat: <strong>{companyConfig.office_lat}</strong></span>
                  <span>📍 Lng: <strong>{companyConfig.office_lng}</strong></span>
                  <span>📏 Radius: <strong>{companyConfig.radius} meter</strong></span>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleSaveRadius} className="px-6 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Latitude <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      step="any"
                      placeholder="cth: 3.5952"
                      value={radiusForm.officeLat}
                      onChange={e => setRadiusForm(f => ({ ...f, officeLat: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Longitude <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      step="any"
                      placeholder="cth: 98.6722"
                      value={radiusForm.officeLng}
                      onChange={e => setRadiusForm(f => ({ ...f, officeLng: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Radius (meter) <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    min="1"
                    placeholder="cth: 100 (= 100 meter), 1000 (= 1 km)"
                    value={radiusForm.radius}
                    onChange={e => setRadiusForm(f => ({ ...f, radius: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    required
                  />
                  {radiusForm.radius && !isNaN(parseInt(radiusForm.radius)) && (
                    <p className="text-xs text-slate-400 mt-1">= {(parseInt(radiusForm.radius) / 1000).toFixed(2)} km</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={savingRadius}
                  className="w-full py-2.5 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {savingRadius && <Loader2 className="w-4 h-4 animate-spin" />}
                  Simpan Konfigurasi
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* A. TAMBAH KARYAWAN BARU (MODAL DI TENGAH LAYAR) */}
      <AnimatePresence>
        {showAddModal && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ background: '#FFFFFF', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '560px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', overflowY: 'auto', maxHeight: '90vh' }}
            >
              {/* Header: Judul + X button */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#0F172A', margin: 0 }}>
                  Tambah Karyawan Baru
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{
                    width: '32px', height: '32px', borderRadius: '50%', border: 'none',
                    background: '#F1F5F9', color: '#64748B', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '16px', fontWeight: 'bold', flexShrink: 0,
                    transition: 'background 0.2s, color 0.2s, transform 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = '#FEE2E2'
                    ;(e.currentTarget as HTMLButtonElement).style.color = '#DC2626'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = '#F1F5F9'
                    ;(e.currentTarget as HTMLButtonElement).style.color = '#64748B'
                    ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
                  }}
                  onMouseDown={e => (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.9)'}
                  onMouseUp={e => (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'}
                  title="Tutup"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleAddUser} noValidate>
                {/* Baris 1: Nama Lengkap + Email */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>
                      Nama Lengkap <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={addUserForm.name}
                      onChange={e => setAddUserForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="cth. Andi Pratama"
                      style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none', boxSizing: 'border-box' }}
                      onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }}
                      onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>
                      Email <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <input
                      type="email"
                      value={addUserForm.email}
                      onChange={e => setAddUserForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="cth. andi@domain.com"
                      style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none', boxSizing: 'border-box' }}
                      onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }}
                      onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
                    />
                  </div>
                </div>

                {/* Baris 2: Password + NIP */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>
                      Password <span style={{ color: '#EF4444' }}>*</span>
                      <span style={{ fontWeight: '400', color: '#94A3B8', marginLeft: '4px' }}>(Min. 6 karakter)</span>
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        required
                        type={showAddPassword ? 'text' : 'password'}
                        value={addUserForm.password}
                        onChange={e => setAddUserForm(f => ({ ...f, password: e.target.value }))}
                        placeholder="••••••••"
                        style={{ width: '100%', padding: '10px 40px 10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none', boxSizing: 'border-box' }}
                        onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }}
                        onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowAddPassword(v => !v)}
                        style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 0 }}
                      >
                        {showAddPassword ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>
                      NIP <span style={{ color: '#EF4444' }}>*</span>
                      <span style={{ fontWeight: '400', color: '#94A3B8', marginLeft: '4px' }}>(6 digit)</span>
                    </label>
                    <input
                      required
                      maxLength={6}
                      type="text"
                      value={addUserForm.nip}
                      onChange={e => setAddUserForm(f => ({ ...f, nip: e.target.value }))}
                      placeholder="cth. 123456"
                      style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none', boxSizing: 'border-box' }}
                      onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }}
                      onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
                    />
                  </div>
                </div>

                {/* Baris 3: Role + Shift Awal (2 kolom) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>
                      Role <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <select
                      value={addUserForm.role}
                      onChange={e => setAddUserForm(f => ({ ...f, role: e.target.value }))}
                      style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none' }}
                      onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }}
                      onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
                    >
                      <option value="supervisor">Supervisor</option>
                      <option value="leader">Leader</option>
                      <option value="cleaner">Cleaner</option>
                      <option value="housekeeping">Housekeeping</option>
                      <option value="gardener">Gardener</option>
                      <option value="gondola">Gondola</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>
                      Shift Awal
                      <span style={{ fontWeight: '400', color: '#94A3B8', marginLeft: '4px' }}>(Opsional)</span>
                    </label>
                    <select
                      value={addUserForm.shiftId}
                      onChange={e => setAddUserForm(f => ({ ...f, shiftId: e.target.value }))}
                      style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none' }}
                      onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }}
                      onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
                    >
                      <option value="">Pilih Shift</option>
                      {shifts.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                      <option value="none">Tanpa Shift</option>
                    </select>
                  </div>
                </div>

                {/* Action Button: Simpan full-width */}
                <div style={{ marginTop: '28px' }}>
                  <button
                    type="submit"
                    disabled={addingUser}
                    style={{
                      width: '100%',
                      padding: '11px',
                      background: addingUser ? '#93C5FD' : '#3B82F6',
                      color: '#FFFFFF',
                      fontSize: '14px',
                      fontWeight: '600',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: addingUser ? 'not-allowed' : 'pointer',
                      transition: 'background 0.2s, transform 0.15s, box-shadow 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      boxShadow: '0 1px 3px rgba(59,130,246,0.3)',
                    }}
                    onMouseEnter={e => {
                      if (!addingUser) {
                        (e.currentTarget as HTMLButtonElement).style.background = '#2563EB'
                        ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 12px rgba(59,130,246,0.4)'
                      }
                    }}
                    onMouseLeave={e => {
                      if (!addingUser) {
                        (e.currentTarget as HTMLButtonElement).style.background = '#3B82F6'
                        ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 3px rgba(59,130,246,0.3)'
                        ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
                      }
                    }}
                    onMouseDown={e => { if (!addingUser) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)' }}
                    onMouseUp={e => { if (!addingUser) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
                  >
                    {addingUser ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />Menyimpan...</>
                    ) : 'Simpan'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* B. FITUR EDIT USER (Modal di Tengah Layar) */}
      <AnimatePresence>
        {editingUser && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden p-6"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                <h3 className="font-bold text-slate-800 text-lg">✏️ Edit Data Karyawan</h3>
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    border: 'none',
                    background: '#F1F5F9',
                    color: '#64748B',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    flexShrink: 0,
                    transition: 'background 0.2s, color 0.2s, transform 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = '#FEE2E2'
                    ;(e.currentTarget as HTMLButtonElement).style.color = '#DC2626'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = '#F1F5F9'
                    ;(e.currentTarget as HTMLButtonElement).style.color = '#64748B'
                    ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
                  }}
                  onMouseDown={e => (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.9)'}
                  onMouseUp={e => (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'}
                  title="Tutup"
                >
                  ✕
                </button>
              </div>
              <form onSubmit={handleUpdateUser} className="space-y-4">
                <div className="flex flex-col">
                  <label className="text-sm font-medium text-slate-600 mb-1">Nama Lengkap *</label>
                  <Input
                    required
                    value={editForm.name}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    className="h-10 border-slate-200 focus:!ring-2 focus:!ring-blue-500 focus:!border-blue-500"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="text-sm font-medium text-slate-600 mb-1">Email (tidak dapat diubah)</label>
                  <Input
                    disabled
                    value={editingUser.email}
                    className="h-10 bg-slate-50 border-slate-200 text-slate-500"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="text-sm font-medium text-slate-600 mb-1">NIP * (6 digit)</label>
                  <Input
                    required
                    maxLength={6}
                    value={editForm.nip}
                    onChange={e => setEditForm(f => ({ ...f, nip: e.target.value }))}
                    className="h-10 border-slate-200 focus:!ring-2 focus:!ring-blue-500 focus:!border-blue-500"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="text-sm font-medium text-slate-600 mb-1">
                    Password Baru <span className="text-slate-400 font-normal">(kosongkan jika tidak diubah)</span>
                  </label>
                  <div className="relative">
                    <Input
                      type={showEditPassword ? 'text' : 'password'}
                      placeholder="Min. 6 karakter"
                      value={editForm.password}
                      onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))}
                      className="h-10 border-slate-200 pr-10 focus:!ring-2 focus:!ring-blue-500 focus:!border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showEditPassword ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col">
                  <label className="text-sm font-medium text-slate-600 mb-1">Role *</label>
                  <select
                    value={editForm.role}
                    onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                    className="w-full h-10 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 capitalize"
                  >
                    <option value="supervisor">Supervisor</option>
                    <option value="leader">Leader</option>
                    <option value="cleaner">Cleaner</option>
                    <option value="housekeeping">Housekeeping</option>
                    <option value="gardener">Gardener</option>
                    <option value="gondola">Gondola</option>
                  </select>
                </div>

                <div className="flex flex-col">
                  <label className="text-sm font-medium text-slate-600 mb-1">Shift</label>
                  <select
                    value={editForm.shiftId}
                    onChange={e => setEditForm(f => ({ ...f, shiftId: e.target.value }))}
                    className="w-full h-10 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Pilih Shift (Opsional)</option>
                    {shifts.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                    <option value="none">Tanpa Shift</option>
                  </select>
                </div>

                {/* Action Button: Simpan full-width */}
                <div style={{ marginTop: '28px' }}>
                  <button
                    type="submit"
                    disabled={updatingUser}
                    style={{
                      width: '100%',
                      padding: '11px',
                      background: updatingUser ? '#93C5FD' : '#3B82F6',
                      color: '#FFFFFF',
                      fontSize: '14px',
                      fontWeight: '600',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: updatingUser ? 'not-allowed' : 'pointer',
                      transition: 'background 0.2s, transform 0.15s, box-shadow 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      boxShadow: '0 1px 3px rgba(59,130,246,0.3)',
                    }}
                    onMouseEnter={e => {
                      if (!updatingUser) {
                        (e.currentTarget as HTMLButtonElement).style.background = '#2563EB'
                        ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 12px rgba(59,130,246,0.4)'
                      }
                    }}
                    onMouseLeave={e => {
                      if (!updatingUser) {
                        (e.currentTarget as HTMLButtonElement).style.background = '#3B82F6'
                        ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 3px rgba(59,130,246,0.3)'
                        ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
                      }
                    }}
                    onMouseDown={e => { if (!updatingUser) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)' }}
                    onMouseUp={e => { if (!updatingUser) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
                  >
                    {updatingUser ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />Menyimpan...</>
                    ) : 'Simpan'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* C. FITUR HAPUS USER (Modal Konfirmasi Tengah Layar) */}
      <AnimatePresence>
        {deletingUserId && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden p-6 text-center"
            >
              <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600 mb-4">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-slate-800 text-lg mb-2">Hapus Karyawan</h3>
              <p className="text-sm text-slate-500 mb-6">
                Apakah Anda yakin ingin menghapus karyawan ini secara permanen dari sistem? Tindakan ini tidak dapat dibatalkan.
              </p>
              <div className="flex justify-center gap-3">
                <Button 
                  variant="outline" 
                  onClick={() => setDeletingUserId(null)} 
                  disabled={isDeleting}
                  className="px-5 h-10"
                >
                  Batal
                </Button>
                <Button 
                  onClick={handleDeleteUser} 
                  disabled={isDeleting}
                  className="bg-red-600 hover:bg-red-700 text-white px-5 h-10"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Menghapus...
                    </>
                  ) : (
                    'Ya, Hapus'
                  )}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* D. DETAIL ABSENSI POP-UP MODAL */}
      <AnimatePresence>
        {selectedAtt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedAtt(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <h3 className="font-semibold text-slate-800 text-lg">Detail Absensi</h3>
                <Button variant="ghost" size="icon" onClick={() => setSelectedAtt(null)} className="h-8 w-8 rounded-full">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="p-5 space-y-4 text-sm">
                <div className="grid grid-cols-[100px_1fr] gap-2">
                  <span className="text-slate-500">Nama</span>
                  <span className="font-medium text-slate-800">{selectedAtt.user_name}</span>
                  
                  <span className="text-slate-500">Tanggal</span>
                  <span className="font-medium text-slate-800">{formatDate(selectedAtt.date)}</span>
                  
                  <span className="text-slate-500">Jam Masuk</span>
                  <span className="font-medium text-slate-800">{selectedAtt.check_in ? formatTime(selectedAtt.check_in) : '--:--'}</span>

                  <span className="text-slate-500">Istirahat</span>
                  <span className="font-medium text-slate-800 font-mono">
                    {selectedAtt.break_start ? (selectedAtt.break_end ? `${formatTime(selectedAtt.break_start)} s/d ${formatTime(selectedAtt.break_end)}` : `${formatTime(selectedAtt.break_start)} s/d --:--`) : '--:--'}
                  </span>

                  <span className="text-slate-500">Jam Pulang</span>
                  <span className="font-medium text-slate-800">{selectedAtt.check_out ? formatTime(selectedAtt.check_out) : '--:--'}</span>
                  
                  <span className="text-slate-500">Status</span>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const statusColor = selectedAtt.status === 'hadir' ? { bg: '#DCFCE7', text: '#166534' } : selectedAtt.status === 'terlambat' ? { bg: '#FEF9C3', text: '#854D0E' } : selectedAtt.status === 'absen' || selectedAtt.status === 'alfa' ? { bg: '#FEE2E2', text: '#991B1B' } : selectedAtt.status === 'sakit' ? { bg: '#DBEAFE', text: '#1E40AF' } : selectedAtt.status === 'izin' ? { bg: '#EDE9FE', text: '#5B21B6' } : selectedAtt.status === 'cuti' ? { bg: '#FCE7F3', text: '#9D174D' } : { bg: '#F3F4F6', text: '#374151' }
                      return <span style={{ background: statusColor.bg, color: statusColor.text, padding: '2px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600 }}>{selectedAtt.status.charAt(0).toUpperCase() + selectedAtt.status.slice(1)}</span>
                    })()}
                  </div>
                  
                  <span className="text-slate-500">Lokasi</span>
                  <span className="font-medium text-slate-800">{selectedAtt.location || 'Tidak ada data lokasi'}</span>
                  
                  <span className="text-slate-500">Catatan</span>
                  <span className="font-medium text-slate-800">{selectedAtt.notes || '—'}</span>
                </div>

                {selectedAtt.selfie_url && (
                  <div className="pt-2">
                    <p className="text-slate-500 mb-2">Foto Bukti / Selfie</p>
                    <div className="rounded-xl overflow-hidden border border-slate-100 bg-slate-50">
                      <img src={selectedAtt.selfie_url} alt="Selfie" className="w-full h-auto object-cover max-h-64" />
                    </div>
                  </div>
                )}
              </div>
              <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end">
                <Button onClick={() => setSelectedAtt(null)}>Tutup</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* E. EDIT ABSENSI MODAL */}
      <AnimatePresence>
        {editingAtt && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ background: '#FFFFFF', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '520px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', overflowY: 'auto', maxHeight: '90vh' }}
            >
              {/* Header: Judul + X button */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div>
                  <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#0F172A', margin: 0 }}>Edit Absensi</h3>
                  <p style={{ fontSize: '13px', color: '#64748B', marginTop: '4px', marginBottom: 0 }}>{editingAtt.user_name} — {formatDate(editingAtt.date)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingAtt(null)}
                  style={{
                    width: '32px', height: '32px', borderRadius: '50%', border: 'none',
                    background: '#F1F5F9', color: '#64748B', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '16px', fontWeight: 'bold', flexShrink: 0,
                    transition: 'background 0.2s, color 0.2s, transform 0.15s',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = '#FEE2E2'
                    ;(e.currentTarget as HTMLButtonElement).style.color = '#DC2626'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = '#F1F5F9'
                    ;(e.currentTarget as HTMLButtonElement).style.color = '#64748B'
                    ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
                  }}
                  onMouseDown={e => (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.9)'}
                  onMouseUp={e => (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'}
                  title="Tutup"
                >
                  ✕
                </button>
              </div>
              <div style={{ height: '16px' }} />

              <form onSubmit={async (e) => {
                e.preventDefault()
                setSavingAtt(true)
                try {
                  // Helper: convert time HH:mm to timestamp. If hour < 12, assume next day (overnight)
                  const toTs = (date: string, time: string) => {
                    if (!time) return null
                    const hour = parseInt(time.split(':')[0], 10)
                    if (hour < 12) {
                      const d = new Date(date)
                      d.setDate(d.getDate() + 1)
                      return `${d.toISOString().split('T')[0]}T${time}:00`
                    }
                    return `${date}T${time}:00`
                  }
                  const toTsSameDay = (date: string, time: string) => time ? `${date}T${time}:00` : null

                  // ─── Auto-recalculate status from check_in vs shift start_time ───
                  // Only auto-recalculate if check_in is provided and status is hadir/terlambat
                  // (leave izin/sakit/alfa/cuti unchanged — admin set those intentionally)
                  let finalStatus = editAttForm.status
                  if (editAttForm.check_in && (editAttForm.status === 'hadir' || editAttForm.status === 'terlambat')) {
                    const matchedShift = shifts.find((s: any) => s.name === editingAtt.shift_name)
                    if (matchedShift?.start_time) {
                      const [sh, sm] = matchedShift.start_time.split(':').map(Number)
                      const shiftStartMin = sh * 60 + sm
                      const [ch, cm] = editAttForm.check_in.split(':').map(Number)
                      const checkInMin = ch * 60 + cm
                      finalStatus = checkInMin <= shiftStartMin + 30 ? 'hadir' : 'terlambat'
                    }
                  }

                  // ─── Recalculate lateness_count if status changed ────────────────
                  const oldStatus = editingAtt.status
                  const wasLate = oldStatus === 'terlambat'
                  const isNowLate = finalStatus === 'terlambat'
                  if (wasLate !== isNowLate) {
                    const { data: userData } = await supabase
                      .from('users')
                      .select('lateness_count')
                      .eq('id', editingAtt.user_id)
                      .maybeSingle()
                    const currentCount = userData?.lateness_count ?? 0
                    const newCount = isNowLate
                      ? currentCount + 1
                      : Math.max(0, currentCount - 1)
                    await supabase
                      .from('users')
                      .update({ lateness_count: newCount })
                      .eq('id', editingAtt.user_id)
                  }

                  // 1. Update attendance table
                  const { error } = await supabase.from('attendance').update({
                    check_in_time: toTsSameDay(editingAtt.date, editAttForm.check_in),
                    check_out_time: toTs(editingAtt.date, editAttForm.check_out),
                    break_start: toTs(editingAtt.date, editAttForm.break_start),
                    break_end: toTs(editingAtt.date, editAttForm.break_end),
                    status: finalStatus,
                    note: editAttForm.notes || null,
                  }).eq('id', editingAtt.id)
                  if (error) throw error

                  // 1b. Jika shift_id diisi, update user_shifts
                  if (editAttForm.shift_id) {
                    const { data: existingShift } = await supabase
                      .from('user_shifts')
                      .select('id')
                      .eq('user_id', editingAtt.user_id)
                      .eq('effective_date', editingAtt.date)
                      .maybeSingle()

                    if (existingShift) {
                      await supabase.from('user_shifts').update({ shift_id: editAttForm.shift_id }).eq('id', existingShift.id)
                    } else {
                      await supabase.from('user_shifts').insert({ user_id: editingAtt.user_id, shift_id: editAttForm.shift_id, effective_date: editingAtt.date })
                    }
                  }

                  // 2. If double shift, also update overtime_assignments
                  if (editingAtt.shift_type === 'double') {
                    const { data: existingOT } = await supabase
                      .from('overtime_assignments')
                      .select('id')
                      .eq('user_id', editingAtt.user_id)
                      .eq('assignment_date', editingAtt.date)
                      .maybeSingle()

                    const otPayload = {
                      user_id: editingAtt.user_id,
                      assignment_date: editingAtt.date,
                      overtime_check_in: toTs(editingAtt.date, editAttForm.overtime_in),
                      overtime_check_out: toTs(editingAtt.date, editAttForm.overtime_out),
                    }

                    if (existingOT) {
                      await supabase.from('overtime_assignments').update(otPayload).eq('id', existingOT.id)
                    } else if (editAttForm.overtime_in || editAttForm.overtime_out) {
                      await supabase.from('overtime_assignments').insert({ ...otPayload, status: 'active' })
                    }
                  }

                  toast.success('Data absensi berhasil diperbarui!')
                  queryClient.invalidateQueries({ queryKey: ['attendance'] })
                  setEditingAtt(null)
                } catch (err: any) {
                  toast.error(err.message || 'Gagal menyimpan perubahan')
                } finally {
                  setSavingAtt(false)
                }
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  {/* Nama (readonly) */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>Nama</label>
                    <input value={editingAtt.user_name} readOnly style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#64748B', background: '#F8FAFC', boxSizing: 'border-box' }} />
                  </div>
                  {/* Tanggal (readonly) */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>Tanggal</label>
                    <input value={formatDate(editingAtt.date)} readOnly style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#64748B', background: '#F8FAFC', boxSizing: 'border-box' }} />
                  </div>
                </div>

                {/* Dropdown Shift */}
                <div style={{ marginTop: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>Shift</label>
                  <select
                    value={editAttForm.shift_id}
                    onChange={e => setEditAttForm(f => ({ ...f, shift_id: e.target.value }))}
                    style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none' }}
                    onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }}
                    onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
                  >
                    <option value="">-- Pilih Shift (opsional) --</option>
                    {shifts.map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
                  {/* Jam Masuk */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>Jam Masuk</label>
                    <input type="time" value={editAttForm.check_in} onChange={e => setEditAttForm(f => ({ ...f, check_in: e.target.value }))} style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none', boxSizing: 'border-box' }} onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }} onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }} />
                  </div>
                  {/* Jam Pulang */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>Jam Pulang</label>
                    <input type="time" value={editAttForm.check_out} onChange={e => setEditAttForm(f => ({ ...f, check_out: e.target.value }))} style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none', boxSizing: 'border-box' }} onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }} onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }} />
                  </div>
                  {/* Istirahat Mulai */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>Istirahat Mulai</label>
                    <input type="time" value={editAttForm.break_start} onChange={e => setEditAttForm(f => ({ ...f, break_start: e.target.value }))} style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none', boxSizing: 'border-box' }} onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }} onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }} />
                  </div>
                  {/* Istirahat Selesai */}
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>Istirahat Selesai</label>
                    <input type="time" value={editAttForm.break_end} onChange={e => setEditAttForm(f => ({ ...f, break_end: e.target.value }))} style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none', boxSizing: 'border-box' }} onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }} onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }} />
                  </div>
                </div>

                {/* Status Kehadiran */}
                <div style={{ marginTop: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>
                    Status Kehadiran <span style={{ color: '#EF4444' }}>*</span>
                    {(() => {
                      // Show auto-calculated status hint if check_in & shift has start_time
                      if (!editAttForm.check_in) return null
                      if (editAttForm.status !== 'hadir' && editAttForm.status !== 'terlambat') return null
                      const matchedShift = shifts.find((s: any) => s.name === editingAtt.shift_name)
                      if (!matchedShift?.start_time) return null
                      const [sh, sm] = matchedShift.start_time.split(':').map(Number)
                      const [ch, cm] = editAttForm.check_in.split(':').map(Number)
                      const autoStatus = (ch * 60 + cm) <= (sh * 60 + sm + 30) ? 'hadir' : 'terlambat'
                      return (
                        <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: '600', padding: '2px 7px', borderRadius: '9999px', background: autoStatus === 'hadir' ? '#DCFCE7' : '#FEF9C3', color: autoStatus === 'hadir' ? '#166534' : '#854D0E' }}>
                          Auto: {autoStatus === 'hadir' ? 'Hadir' : 'Terlambat'}
                        </span>
                      )
                    })()}
                  </label>
                  <select value={editAttForm.status} onChange={e => setEditAttForm(f => ({ ...f, status: e.target.value }))} style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none' }} onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }} onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}>
                    <option value="hadir">Hadir</option>
                    <option value="terlambat">Terlambat</option>
                    <option value="sakit">Sakit</option>
                    <option value="izin">Izin</option>
                    <option value="absen">Absen</option>
                    <option value="cuti">Cuti</option>
                    <option value="cuti_segera" disabled style={{ color: '#94A3B8' }}>Cuti (Segera Hadir)</option>
                  </select>
                  {editAttForm.check_in && (editAttForm.status === 'hadir' || editAttForm.status === 'terlambat') && shifts.find((s: any) => s.name === editingAtt.shift_name)?.start_time && (
                    <p style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>
                      Status akan dihitung otomatis dari jam masuk vs jam mulai shift (toleransi 30 menit).
                    </p>
                  )}
                </div>

                {/* Catatan */}
                <div style={{ marginTop: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>Catatan</label>
                  <textarea value={editAttForm.notes} onChange={e => setEditAttForm(f => ({ ...f, notes: e.target.value }))} placeholder="Catatan tambahan (opsional)..." rows={3} style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }} onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }} />
                </div>

                {/* Overtime fields — only shown for double shift */}
                {editingAtt.shift_type === 'double' && (
                  <div style={{ marginTop: '16px', padding: '14px 16px', background: '#FFF7ED', borderRadius: '10px', border: '1px solid #FED7AA' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#C2410C' }}>⏱ Jam Lembur (Double Shift)</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#92400E', marginBottom: '4px' }}>Mulai Lembur</label>
                        <input
                          type="time"
                          value={editAttForm.overtime_in}
                          onChange={e => setEditAttForm(f => ({ ...f, overtime_in: e.target.value }))}
                          style={{ width: '100%', padding: '10px 14px', border: '1px solid #FDBA74', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none', boxSizing: 'border-box' }}
                          onFocus={e => { e.currentTarget.style.border = '1px solid #F97316'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(249,115,22,0.15)' }}
                          onBlur={e => { e.currentTarget.style.border = '1px solid #FDBA74'; e.currentTarget.style.boxShadow = 'none' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#92400E', marginBottom: '4px' }}>Selesai Lembur</label>
                        <input
                          type="time"
                          value={editAttForm.overtime_out}
                          onChange={e => setEditAttForm(f => ({ ...f, overtime_out: e.target.value }))}
                          style={{ width: '100%', padding: '10px 14px', border: '1px solid #FDBA74', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none', boxSizing: 'border-box' }}
                          onFocus={e => { e.currentTarget.style.border = '1px solid #F97316'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(249,115,22,0.15)' }}
                          onBlur={e => { e.currentTarget.style.border = '1px solid #FDBA74'; e.currentTarget.style.boxShadow = 'none' }}
                        />
                      </div>
                    </div>
                    <p style={{ fontSize: '11px', color: '#92400E', marginTop: '8px', margin: '8px 0 0 0' }}>💡 Jika selesai lembur melewati tengah malam, masukkan jam &lt; 12:00 (sistem otomatis hari berikutnya)</p>
                  </div>
                )}

                {/* Action Button: Simpan full-width */}
                <div style={{ marginTop: '28px' }}>
                  <button
                    type="submit"
                    disabled={savingAtt}
                    style={{
                      width: '100%',
                      padding: '11px',
                      background: savingAtt ? '#93C5FD' : '#3B82F6',
                      color: '#FFFFFF',
                      fontSize: '14px',
                      fontWeight: '600',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: savingAtt ? 'not-allowed' : 'pointer',
                      transition: 'background 0.2s, transform 0.15s, box-shadow 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      boxShadow: '0 1px 3px rgba(59,130,246,0.3)',
                    }}
                    onMouseEnter={e => {
                      if (!savingAtt) {
                        (e.currentTarget as HTMLButtonElement).style.background = '#2563EB'
                        ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 12px rgba(59,130,246,0.4)'
                      }
                    }}
                    onMouseLeave={e => {
                      if (!savingAtt) {
                        (e.currentTarget as HTMLButtonElement).style.background = '#3B82F6'
                        ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 1px 3px rgba(59,130,246,0.3)'
                        ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
                      }
                    }}
                    onMouseDown={e => { if (!savingAtt) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.98)' }}
                    onMouseUp={e => { if (!savingAtt) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)' }}
                  >
                    {savingAtt ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />Menyimpan...</>
                    ) : 'Simpan'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* F. KONFIRMASI HAPUS OFF DAY */}
      <AnimatePresence>
        {deleteOffId && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }} transition={{ duration: 0.2 }}
              className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center"
            >
              <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600 mb-4">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-slate-800 text-lg mb-2">Hapus Jadwal Off</h3>
              <p className="text-sm text-slate-500 mb-6">Yakin ingin menghapus jadwal off ini?</p>
              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={() => setDeleteOffId(null)} disabled={deleteOffMutation.isPending} className="px-5 h-10">Batal</Button>
                <Button onClick={() => deleteOffMutation.mutate(deleteOffId!)} disabled={deleteOffMutation.isPending} className="bg-red-600 hover:bg-red-700 text-white px-5 h-10">
                  {deleteOffMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Menghapus...</> : 'Ya, Hapus'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* G. KONFIRMASI HAPUS EMERGENCY */}
      <AnimatePresence>
        {deleteEmergencyId && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }} transition={{ duration: 0.2 }}
              className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center"
            >
              <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600 mb-4">
                <Trash2 className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-slate-800 text-lg mb-2">Hapus Penugasan</h3>
              <p className="text-sm text-slate-500 mb-6">Yakin ingin menghapus penugasan darurat ini?</p>
              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={() => setDeleteEmergencyId(null)} disabled={deleteEmergencyMutation.isPending} className="px-5 h-10">Batal</Button>
                <Button onClick={() => deleteEmergencyMutation.mutate(deleteEmergencyId!)} disabled={deleteEmergencyMutation.isPending} className="bg-red-600 hover:bg-red-700 text-white px-5 h-10">
                  {deleteEmergencyMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Menghapus...</> : 'Ya, Hapus'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
function ChevronLeft(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="m15 18-6-6 6-6"/></svg>
  )
}

function ChevronRight(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="m9 18 6-6-6-6"/></svg>
  )
}
