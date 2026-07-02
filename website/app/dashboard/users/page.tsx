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

const PAGE_SIZE = 10

function calculateBreakDuration(start: string | null, end: string | null): { text: string; isWarning: boolean } {
  if (!start || !end) return { text: '—', isWarning: false }
  try {
    const s = new Date(start)
    const e = new Date(end)
    const diffMs = e.getTime() - s.getTime()
    if (diffMs <= 0) return { text: '—', isWarning: false }
    const diffMins = Math.round(diffMs / 60000)
    
    const hrs = Math.floor(diffMins / 60)
    const mins = diffMins % 60
    let durationText = ''
    if (hrs > 0) {
      durationText = `${hrs} jam ${mins} menit`
    } else {
      durationText = `${mins} menit`
    }
    return {
      text: durationText,
      isWarning: diffMins > 60
    }
  } catch (err) {
    return { text: '—', isWarning: false }
  }
}

export default function ManagementEmployeePage() {
  const supabase = createClient()
  const queryClient = useQueryClient()

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

  // Edit User Modal state
  const [editingUser, setEditingUser] = useState<UserRow | null>(null)
  const [editForm, setEditForm] = useState({
    name: '',
    role: '',
    nip: '',
    shiftId: ''
  })
  const [updatingUser, setUpdatingUser] = useState(false)

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

  // ─── Off Day state ──────────────────────────────────────
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
  })
  const [savingAtt, setSavingAtt] = useState(false)

  const debouncedAttSearch = useDebounce(attSearch, 500)

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
      const { data } = await supabase.from('shifts').select('id, name').eq('is_active', true)
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

  // Fetch attendance query
  const { data: attendanceData, isLoading: attendanceLoading } = useQuery({
    queryKey: ['attendance', attPage, debouncedAttSearch, attFilterDate, attFilterShift, attFilterStatus],
    queryFn: async () => {
      let query = supabase
        .from('attendance')
        .select('id, status, check_in_time, check_out_time, break_start, break_end, date, selfie_url, location_lat, location_lng, note, user_id, users!attendance_user_id_fkey(name, user_shifts(shift_type, shifts(id, name)))', { count: 'exact' })
        .order('date', { ascending: false })
        .order('check_in_time', { ascending: false })

      if (attFilterDate) query = query.eq('date', attFilterDate)
      if (attFilterStatus !== 'all') query = query.eq('status', attFilterStatus)

      const from = (attPage - 1) * PAGE_SIZE
      const { data, count } = await query.range(from, from + PAGE_SIZE - 1)

      // Fetch overtime data for all rows in batch
      const rowsData = data ?? []
      const userDatePairs = rowsData.map((r: any) => ({ user_id: r.user_id, date: r.date }))

      let overtimeMap: Record<string, { check_in: string | null; check_out: string | null }> = {}
      if (userDatePairs.length > 0) {
        const uniqueDates = [...new Set(userDatePairs.map((p: any) => p.date))]
        const uniqueUsers = [...new Set(userDatePairs.map((p: any) => p.user_id))]
        const { data: otData } = await supabase
          .from('overtime_assignments')
          .select('user_id, assignment_date, overtime_check_in, overtime_check_out')
          .in('user_id', uniqueUsers)
          .in('assignment_date', uniqueDates)
        ;(otData ?? []).forEach((ot: any) => {
          overtimeMap[`${ot.user_id}_${ot.assignment_date}`] = {
            check_in: ot.overtime_check_in,
            check_out: ot.overtime_check_out,
          }
        })
      }

      // Fetch user_shifts filtered by the exact attendance dates (to get correct shift_type per day)
      let userShiftMap: Record<string, { shift_name: string; shift_type: string | null }> = {}
      if (userDatePairs.length > 0) {
        const uniqDates2 = [...new Set(userDatePairs.map((p: any) => p.date))]
        const uniqUsers2 = [...new Set(userDatePairs.map((p: any) => p.user_id))]
        const { data: usData } = await supabase
          .from('user_shifts')
          .select('user_id, effective_date, shift_type, shifts(name)')
          .in('user_id', uniqUsers2)
          .in('effective_date', uniqDates2)
        ;(usData ?? []).forEach((us: any) => {
          userShiftMap[`${us.user_id}_${us.effective_date}`] = {
            shift_name: (us.shifts as any)?.name ?? '—',
            shift_type: us.shift_type ?? null,
          }
        })
      }

      let mapped = rowsData.map((r: any) => {
        const shiftKey = `${r.user_id}_${r.date}`
        const matchedShift = userShiftMap[shiftKey]
        return {
          id: r.id,
          user_id: r.user_id,
          user_name: r.users?.name ?? '—',
          shift_name: matchedShift?.shift_name ?? r.users?.user_shifts?.[0]?.shifts?.name ?? '—',
          shift_type: matchedShift?.shift_type ?? r.users?.user_shifts?.[0]?.shift_type ?? null,
          date: r.date,
          check_in: r.check_in_time,
          check_out: r.check_out_time,
          break_start: r.break_start,
          break_end: r.break_end,
          status: r.status,
          selfie_url: r.selfie_url,
          location: r.location_lat && r.location_lng ? `${r.location_lat}, ${r.location_lng}` : '—',
          notes: r.note,
          overtime_check_in: overtimeMap[`${r.user_id}_${r.date}`]?.check_in ?? null,
          overtime_check_out: overtimeMap[`${r.user_id}_${r.date}`]?.check_out ?? null,
        }
      })

      if (debouncedAttSearch) {
        mapped = mapped.filter(r => r.user_name.toLowerCase().includes(debouncedAttSearch.toLowerCase()))
      }
      if (attFilterShift !== 'all') {
        mapped = mapped.filter(r => r.shift_name === attFilterShift)
      }

      return { rows: mapped, total: count ?? 0 }
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
    setEditForm({
      name: user.name,
      role: user.role,
      nip: user.nip === '—' ? '' : user.nip,
      shiftId: user.shift_id
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
    setUpdatingUser(true)
    try {
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

      // 2. Insert new user_shifts row if shift changed (maintaining historical logs)
      if (editForm.shiftId !== editingUser.shift_id) {
        const { error: shiftError } = await supabase
          .from('user_shifts')
          .insert({
            user_id: editingUser.id,
            shift_id: editForm.shiftId === 'none' || !editForm.shiftId ? null : editForm.shiftId,
            effective_date: new Date().toISOString().split('T')[0]
          })

        if (shiftError) throw shiftError
      }

      toast.success('Data karyawan berhasil diperbarui!')
      setEditingUser(null)
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['shiftHistory'] })
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
    mutationFn: async (payload: { userId: string; shiftId: string; effectiveDate: string }) => {
      const { error } = await supabase
        .from('user_shifts')
        .insert({
          user_id: payload.userId,
          shift_id: payload.shiftId === 'none' ? null : payload.shiftId,
          effective_date: payload.effectiveDate,
        })

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Shift karyawan berhasil diperbarui!')
      setShiftForm({ userId: '', shiftId: '', effectiveDate: new Date().toISOString().split('T')[0], shiftType: 'single', keterangan: '' })
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['shiftHistory'] })
    },
    onError: (error: any) => {
      toast.error('Gagal memperbarui shift: ' + error.message)
    }
  })

  function handleUpdateShift(e: React.FormEvent) {
    e.preventDefault()
    if (!shiftForm.userId || !shiftForm.shiftId || !shiftForm.effectiveDate) {
      toast.error('Isi semua kolom form terlebih dahulu!')
      return
    }

    if (shiftForm.shiftType === 'single') {
      const selectedUser = users.find(u => u.id === shiftForm.userId)
      const currentShiftId = selectedUser?.shift_id || ''
      const targetShiftId = shiftForm.shiftId === 'none' ? '' : shiftForm.shiftId

      if (currentShiftId === targetShiftId) {
        toast.error('Gagal memperbarui shift: Karyawan sudah berada di shift tersebut! Perubahan shift tidak valid.')
        return
      }

      updateShiftMutation.mutate({ userId: shiftForm.userId, shiftId: shiftForm.shiftId, effectiveDate: shiftForm.effectiveDate })
    } else {
      if (!shiftForm.keterangan) {
        toast.error('Keterangan wajib diisi untuk penugasan lembur!')
        return
      }
      assignOvertimeMutation.mutate({ 
        userId: shiftForm.userId, 
        shiftId: shiftForm.shiftId, 
        date: shiftForm.effectiveDate, 
        keterangan: shiftForm.keterangan 
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
    },
    onSuccess: () => {
      toast.success('Lembur berhasil di-assign!')
      setShiftForm({ userId: '', shiftId: '', effectiveDate: new Date().toISOString().split('T')[0], shiftType: 'single', keterangan: '' })
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
      toast.success('Hari off berhasil diset!')
      setOffForm({ userId: '', offDate: new Date().toISOString().split('T')[0], reason: 'libur' })
      queryClient.invalidateQueries({ queryKey: ['offDays'] })
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
    setOffUsersOnDate([])
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
  function exportPDF() {
    if (attRows.length === 0) {
      toast.error('Tidak ada data untuk diekspor')
      return
    }

    const docDefinition = {
      content: [
        { text: 'Laporan Absensi — Carefastindo', style: 'header' },
        { text: `Tanggal Cetak: ${new Date().toLocaleDateString('id-ID')}`, style: 'subheader' },
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
              ...attRows.map(r => [
                r.user_name,
                r.shift_name,
                r.date,
                r.check_in ? formatTime(r.check_in) : '-',
                r.break_start ? (r.break_end ? `${formatTime(r.break_start)} - ${formatTime(r.break_end)}` : `${formatTime(r.break_start)} - --:--`) : '-',
                r.check_out ? formatTime(r.check_out) : '-',
                r.status
              ])
            ]
          }
        }
      ],
      styles: {
        header: { fontSize: 18, bold: true, margin: [0, 0, 0, 5] },
        subheader: { fontSize: 10, italics: true, margin: [0, 0, 0, 15] },
        tableExample: { margin: [0, 5, 0, 15] },
        tableHeader: { bold: true, fontSize: 11, color: 'black' }
      }
    }
    // @ts-ignore
    pdfMake.createPdf(docDefinition).download(`attendance_${attFilterDate || 'all'}.pdf`)
    toast.success('PDF berhasil diekspor!')
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
            <Button 
              onClick={() => setShowAddModal(true)} 
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium self-start sm:self-auto"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Tambah Karyawan
            </Button>
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
                  <TableHead className="text-slate-600 font-semibold py-3 pl-4">No</TableHead>
                  <TableHead className="text-slate-600 font-semibold py-3">Nama</TableHead>
                  <TableHead className="text-slate-600 font-semibold py-3">Email</TableHead>
                  <TableHead className="text-slate-600 font-semibold py-3">NIP</TableHead>
                  <TableHead className="text-slate-600 font-semibold py-3">Role</TableHead>
                  <TableHead className="text-slate-600 font-semibold py-3">Shift Saat Ini</TableHead>
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
                      <TableCell className="font-mono text-xs text-slate-400 py-3 pl-4">{i + 1}</TableCell>
                      <TableCell className="font-semibold text-slate-700 py-3">{u.name}</TableCell>
                      <TableCell className="text-slate-500 text-sm py-3">{u.email}</TableCell>
                      <TableCell className="text-slate-600 font-mono text-sm py-3">
                        {u.role.toLowerCase() === 'superadmin' ? 'N/A' : u.nip}
                      </TableCell>
                      <TableCell className="py-3">
                        <Badge variant={getRoleVariant(u.role) as any} className="capitalize font-medium">
                          {u.role === 'supervisor' ? 'Supervisor' : u.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600 font-medium py-3">
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
                              className="h-8 px-2.5 text-blue-600 border-blue-200 hover:bg-blue-50"
                              onClick={() => openEditModal(u)}
                            >
                              <Edit2 className="w-3.5 h-3.5 mr-1" />
                              Edit
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="h-8 px-2.5 text-red-600 border-red-200 hover:bg-red-50"
                              onClick={() => setDeletingUserId(u.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-1" />
                              Hapus
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

      {/* 2. UBAH SHIFT / KERJA LEMBUR */}
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #E2E8F0',
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}>
        <h3 style={{
          fontSize: '18px',
          fontWeight: 'bold',
          color: '#0F172A',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          🔄 Ubah Shift / Kerja Lembur
        </h3>

        <form onSubmit={handleUpdateShift}>
          {/* BARIS 1 & 2: 4 input dalam grid 2 kolom */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Karyawan */}
            <div>
              <label htmlFor="shiftUserId" style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>
                Karyawan <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <select
                id="shiftUserId"
                value={shiftForm.userId}
                onChange={e => setShiftForm(f => ({ ...f, userId: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px',
                  fontSize: '14px',
                  color: '#0F172A',
                  background: '#FFFFFF',
                  outline: 'none',
                  transition: 'border 0.2s, box-shadow 0.2s',
                }}
                onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }}
                onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
              >
                <option value="" disabled>Pilih Karyawan</option>
                {users
                  .filter(u => u.role.toLowerCase() !== 'superadmin')
                  .map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.nip !== '—' ? u.nip : u.role})</option>
                  ))
                }
              </select>
            </div>

            {/* Tanggal Efektif */}
            <div>
              <label htmlFor="shiftDate" style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>
                Tanggal Efektif <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <input
                id="shiftDate"
                type="date"
                value={shiftForm.effectiveDate}
                onChange={e => setShiftForm(f => ({ ...f, effectiveDate: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px',
                  fontSize: '14px',
                  color: '#0F172A',
                  background: '#FFFFFF',
                  outline: 'none',
                  transition: 'border 0.2s, box-shadow 0.2s',
                  boxSizing: 'border-box',
                }}
                onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }}
                onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </div>

            {/* Shift Baru */}
            <div>
              <label htmlFor="shiftNewId" style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>
                Shift Baru <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <select
                id="shiftNewId"
                value={shiftForm.shiftId}
                onChange={e => setShiftForm(f => ({ ...f, shiftId: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px',
                  fontSize: '14px',
                  color: '#0F172A',
                  background: '#FFFFFF',
                  outline: 'none',
                  transition: 'border 0.2s, box-shadow 0.2s',
                }}
                onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }}
                onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
              >
                <option value="" disabled>Pilih Shift Baru</option>
                {shifts.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
                {shiftForm.shiftType === 'single' && <option value="none">Tanpa Shift</option>}
              </select>
            </div>

            {/* Keterangan */}
            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>
                Keterangan
              </label>
              <input
                type="text"
                placeholder="Alasan lembur / perubahan shift..."
                value={shiftForm.keterangan}
                onChange={e => setShiftForm(f => ({ ...f, keterangan: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  border: '1px solid #E2E8F0',
                  borderRadius: '8px',
                  fontSize: '14px',
                  color: '#0F172A',
                  background: '#FFFFFF',
                  outline: 'none',
                  transition: 'border 0.2s, box-shadow 0.2s',
                  boxSizing: 'border-box',
                }}
                onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }}
                onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </div>
          </div>

          {/* Tipe Perubahan */}
          <div style={{ marginTop: '16px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#334155', marginBottom: '4px' }}>
              Tipe Perubahan <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="shiftType"
                  value="single"
                  checked={shiftForm.shiftType === 'single'}
                  onChange={e => setShiftForm(f => ({ ...f, shiftType: e.target.value }))}
                  style={{ width: '16px', height: '16px', accentColor: '#3B82F6' }}
                />
                <span style={{ fontSize: '14px', color: '#334155' }}>Ganti Shift (Single Shift)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="shiftType"
                  value="double"
                  checked={shiftForm.shiftType === 'double'}
                  onChange={e => setShiftForm(f => ({ ...f, shiftType: e.target.value }))}
                  style={{ width: '16px', height: '16px', accentColor: '#3B82F6' }}
                />
                <span style={{ fontSize: '14px', color: '#334155' }}>Tambah Shift Lembur (Double Shift)</span>
              </label>
            </div>
          </div>

          {/* Tombol Update Shift */}
          <div style={{ marginTop: '20px' }}>
            <button
              type="submit"
              disabled={updateShiftMutation.isPending || assignOvertimeMutation.isPending}
              style={{
                width: '100%',
                padding: '10px',
                background: updateShiftMutation.isPending || assignOvertimeMutation.isPending ? '#93C5FD' : '#3B82F6',
                color: '#FFFFFF',
                fontSize: '14px',
                fontWeight: '600',
                borderRadius: '8px',
                border: 'none',
                cursor: updateShiftMutation.isPending || assignOvertimeMutation.isPending ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
              onMouseEnter={e => {
                if (!updateShiftMutation.isPending && !assignOvertimeMutation.isPending)
                  (e.currentTarget as HTMLButtonElement).style.background = '#2563EB'
              }}
              onMouseLeave={e => {
                if (!updateShiftMutation.isPending && !assignOvertimeMutation.isPending)
                  (e.currentTarget as HTMLButtonElement).style.background = '#3B82F6'
              }}
            >
              {updateShiftMutation.isPending || assignOvertimeMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Memproses...</>
              ) : (
                'Update Shift'
              )}
            </button>
          </div>
        </form>
      </div>

      {/* 3. ATUR HARI OFF KARYAWAN */}
      <Card className="shadow-sm">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
          <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
            🏖️ Atur Hari Off Karyawan
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {/* Form Set Off */}
          <form onSubmit={handleSetOff}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Karyawan *</label>
                <select
                  value={offForm.userId}
                  onChange={e => setOffForm(f => ({ ...f, userId: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
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
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Alasan Off *</label>
                <select
                  value={offForm.reason}
                  onChange={e => setOffForm(f => ({ ...f, reason: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                >
                  <option value="libur">Libur</option>
                  <option value="sakit">Sakit</option>
                  <option value="cuti">Cuti</option>
                  <option value="lainnya">Lainnya</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button
                type="submit"
                disabled={savingOff}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-all"
                style={{ background: '#F97316' }}
                onMouseEnter={e => { if (!savingOff) (e.currentTarget as HTMLButtonElement).style.background = '#EA580C' }}
                onMouseLeave={e => { if (!savingOff) (e.currentTarget as HTMLButtonElement).style.background = '#F97316' }}
              >
                {savingOff && <Loader2 className="w-4 h-4 animate-spin" />}
                Set Off
              </button>
              <button
                type="button"
                onClick={() => setOffForm({ userId: '', offDate: new Date().toISOString().split('T')[0], reason: 'libur' })}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all"
              >
                Batal
              </button>
            </div>
          </form>

          {/* Tabel Hari Off 7 hari ke depan */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Jadwal Off (7 hari ke depan)</p>
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="pl-4">Karyawan</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Alasan</TableHead>
                  <TableHead className="text-center pr-4">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {offDaysLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 4 }).map((_, j) => (
                        <TableCell key={j}><div className="h-4 bg-slate-100 rounded animate-pulse w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : offDays.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-6 text-slate-400 pl-4">
                      Tidak ada jadwal off dalam 7 hari ke depan
                    </TableCell>
                  </TableRow>
                ) : offDays.map(od => (
                  <TableRow key={od.id} className="hover:bg-slate-50/50">
                    <TableCell className="font-medium text-slate-800 pl-4">{od.user_name}</TableCell>
                    <TableCell className="text-slate-600">{od.effective_date}</TableCell>
                    <TableCell>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full capitalize bg-orange-100 text-orange-700">
                        {od.reason}
                      </span>
                    </TableCell>
                    <TableCell className="text-center pr-4">
                      <button
                        onClick={() => setDeleteOffId(od.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 transition-all mx-auto"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* 4. DARURAT & LEMBUR */}
      <Card className="shadow-sm">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
              ⚡ Darurat &amp; Lembur
            </CardTitle>
            <button
              onClick={() => { setEditEmergencyRow(null); setEmergencyForm({ assigned_user_id: '', target_date: new Date().toISOString().split('T')[0], reason: 'lembur', replacing_user_id: '', shift_id: '', status: 'pending' }); setOffUsersOnDate([]); setShowEmergencyForm(true) }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-all"
            >
              <Plus className="w-4 h-4" /> Tambah
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Inline form — muncul kalau showEmergencyForm */}
          {showEmergencyForm && (
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 space-y-4">
              <form onSubmit={handleSubmitEmergency} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Karyawan Ditugaskan *</label>
                    <select
                      value={emergencyForm.assigned_user_id}
                      onChange={e => setEmergencyForm(f => ({ ...f, assigned_user_id: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        if (emergencyForm.reason === 'ganti_off') loadOffUsersOnDate(e.target.value)
                      }}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Tipe Penugasan *</label>
                  <div className="flex gap-6">
                    {(['lembur', 'ganti_off'] as const).map(r => (
                      <label key={r} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio" value={r} checked={emergencyForm.reason === r}
                          onChange={() => {
                            setEmergencyForm(f => ({ ...f, reason: r, replacing_user_id: '', shift_id: '' }))
                            if (r === 'ganti_off') loadOffUsersOnDate(emergencyForm.target_date)
                            else setOffUsersOnDate([])
                          }}
                          className="accent-blue-600"
                        />
                        <span className="text-sm font-medium">{r === 'ganti_off' ? 'Ganti Off' : 'Lembur'}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {emergencyForm.reason === 'ganti_off' && (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">
                      Karyawan Digantikan *
                      <span className="text-xs font-normal text-slate-400 ml-1">(hanya karyawan yang off pada tanggal tersebut)</span>
                    </label>
                    {loadingOffUsers ? (
                      <div className="text-sm text-slate-400 py-2">Memuat karyawan yang off...</div>
                    ) : offUsersOnDate.length === 0 ? (
                      <div className="text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-lg border border-amber-100">
                        Tidak ada karyawan yang off pada tanggal ini. Set hari off terlebih dahulu di section di atas.
                      </div>
                    ) : (
                      <select
                        value={emergencyForm.replacing_user_id}
                        onChange={e => setEmergencyForm(f => ({ ...f, replacing_user_id: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- Pilih Karyawan --</option>
                        {offUsersOnDate.filter(u => u.id !== emergencyForm.assigned_user_id).map(u => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {emergencyForm.reason === 'lembur' && (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Shift Lembur</label>
                    <select
                      value={emergencyForm.shift_id}
                      onChange={e => setEmergencyForm(f => ({ ...f, shift_id: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Pilih Shift --</option>
                      {shifts.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}

                {editEmergencyRow && (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Status</label>
                    <select
                      value={emergencyForm.status}
                      onChange={e => setEmergencyForm(f => ({ ...f, status: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="pending">Pending</option>
                      <option value="active">Aktif</option>
                      <option value="selesai">Selesai</option>
                    </select>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={saveEmergencyMutation.isPending}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-all"
                  >
                    {saveEmergencyMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    {editEmergencyRow ? 'Simpan Perubahan' : 'Tambah Penugasan'}
                  </button>
                  <button type="button" onClick={resetEmergencyForm}
                    className="px-5 py-2 rounded-lg text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all">
                    Batal
                  </button>
                </div>
              </form>
            </div>
          )}

          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="pl-4">No</TableHead>
                <TableHead>Karyawan</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center pr-4">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {emergencyLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><div className="h-4 bg-slate-100 rounded animate-pulse w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : emergencyRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-slate-400">
                    Belum ada penugasan darurat
                  </TableCell>
                </TableRow>
              ) : emergencyRows.map((row, idx) => (
                <TableRow key={row.id} className="hover:bg-slate-50/50">
                  <TableCell className="pl-4 text-slate-400 text-sm">{idx + 1}</TableCell>
                  <TableCell className="font-medium text-slate-800">{row.assigned_user_name}</TableCell>
                  <TableCell className="text-slate-600 text-sm">{row.target_date}</TableCell>
                  <TableCell>
                    {row.reason === 'lembur' ? (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Lembur</span>
                    ) : (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Ganti Off</span>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-600 text-sm">
                    {row.reason === 'ganti_off' ? (row.replacing_user_name ?? '—') : (row.shift_name ?? '—')}
                  </TableCell>
                  <TableCell>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${
                      row.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      row.status === 'active' ? 'bg-green-100 text-green-800' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {row.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-center pr-4">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => openEditEmergency(row)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-blue-500 hover:bg-blue-50 transition-all">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteEmergencyId(row.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 transition-all">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
          <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
            📜 Riwayat Perubahan Shift (3 data terakhir)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="border-collapse w-full">
            <TableHeader className="bg-[#F8FAFC]">
              <TableRow className="hover:bg-transparent border-b border-slate-200">
                <TableHead className="text-slate-600 font-semibold py-3 pl-4">Karyawan</TableHead>
                <TableHead className="text-slate-600 font-semibold py-3">Shift Lama</TableHead>
                <TableHead className="text-slate-600 font-semibold py-3">Shift Baru</TableHead>
                <TableHead className="text-slate-600 font-semibold py-3">Tanggal Efektif</TableHead>
                <TableHead className="text-slate-600 font-semibold py-3 pr-4">Status Shift</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="pr-4"><Skeleton className="h-5 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-slate-400 pl-4">
                    Belum ada perubahan shift hari ini
                  </TableCell>
                </TableRow>
              ) : (
                history.map(h => (
                  <TableRow key={h.id} className="bg-white border-b border-slate-100 hover:bg-slate-50/50">
                    <TableCell className="font-semibold text-slate-700 py-3 pl-4">{h.user_name}</TableCell>
                    <TableCell className="text-slate-500 py-3">{h.old_shift}</TableCell>
                    <TableCell className="text-slate-600 font-medium py-3">{h.new_shift}</TableCell>
                    <TableCell className="text-slate-500 py-3">{h.effective_date}</TableCell>
                    <TableCell className="py-3 pr-4">
                      {h.is_double ? (
                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-orange-100 text-orange-700">
                          Double Shift
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">
                          Single Shift
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 4. TABEL ATTENDANCE (ABSENSI KARYAWAN - DI BAWAH RIWAYAT SHIFT) */}
      <Card className="shadow-sm">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-bold text-slate-800">📋 Tabel Absensi Karyawan</CardTitle>
              <p className="text-xs text-slate-400 mt-0.5">Tinjau dan ekspor laporan kehadiran pegawai harian</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportExcel} className="bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100 hover:text-emerald-700 h-9 font-medium">
                <Download className="w-4 h-4 mr-1.5" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={exportPDF} className="bg-red-50 text-red-600 border-red-200 hover:bg-red-100 hover:text-red-700 h-9 font-medium">
                <Download className="w-4 h-4 mr-1.5" /> PDF
              </Button>
            </div>
          </div>
          
          <div className="flex flex-col md:flex-row gap-3 mt-4">
            <div className="flex flex-wrap sm:flex-nowrap gap-3 flex-1">
              <Input
                type="date"
                value={attFilterDate}
                onChange={e => { setAttFilterDate(e.target.value); setAttPage(1) }}
                className="w-full sm:w-[160px] bg-white h-9"
              />
              <Select value={attFilterShift} onValueChange={v => { setAttFilterShift(v as string); setAttPage(1) }}>
                <SelectTrigger className="w-full sm:w-[160px] bg-white h-9">
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
                <SelectTrigger className="w-full sm:w-[160px] bg-white h-9">
                  <SelectValue>
                    {attFilterStatus === 'all' ? 'Semua Status' : (attFilterStatus.charAt(0).toUpperCase() + attFilterStatus.slice(1))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="hadir">Hadir</SelectItem>
                  <SelectItem value="izin">Izin</SelectItem>
                  <SelectItem value="sakit">Sakit</SelectItem>
                  <SelectItem value="alfa">Alfa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-[240px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  value={attSearch}
                  onChange={e => { setAttSearch(e.target.value); setAttPage(1) }}
                  placeholder="Cari nama karyawan..."
                  className="pl-9 bg-white w-full h-9"
                />
              </div>
              {(attFilterDate !== todayStr || attFilterStatus !== 'all' || attFilterShift !== 'all' || attSearch) && (
                <Button
                  variant="ghost"
                  onClick={() => { setAttFilterDate(todayStr); setAttFilterShift('all'); setAttFilterStatus('all'); setAttSearch(''); setAttPage(1) }}
                  className="px-3 h-9"
                  title="Reset Filter"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-[#F8FAFC]">
                <TableRow className="hover:bg-transparent border-b border-slate-200">
                  <TableHead className="w-[50px] pl-4">No</TableHead>
                  <TableHead>Nama</TableHead>
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
                          const dur = calculateBreakDuration(r.break_start, r.break_end)
                          return (
                            <span className={dur.isWarning ? "text-red-600 font-semibold" : "text-slate-500"}>
                              {start} - {end}
                            </span>
                          )
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
                          const shiftLabel = r.shift_type === 'double' ? 'Double Shift' : r.shift_name !== '—' ? 'Single Shift' : 'Tidak Ada'
                          const shiftColor = r.shift_type === 'double'
                            ? { bg: '#FED7AA', text: '#9A3412' }
                            : r.shift_name !== '—'
                            ? { bg: '#DCFCE7', text: '#166534' }
                            : { bg: '#F3F4F6', text: '#374151' }
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
                            : { bg: '#F3F4F6', text: '#374151' }
                          const statusLabel = r.status.charAt(0).toUpperCase() + r.status.slice(1)
                          return (
                            <div className="flex items-center justify-center gap-1 flex-wrap">
                              <span style={{ background: shiftColor.bg, color: shiftColor.text, padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {shiftLabel}
                              </span>
                              <span className="text-slate-300 text-xs">/</span>
                              <span style={{ background: statusColor.bg, color: statusColor.text, padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {statusLabel}
                              </span>
                            </div>
                          )
                        })()}
                      </TableCell>
                      <TableCell className="text-center pr-4">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                            onClick={() => setSelectedAtt(r)}
                            title="Detail"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-500 hover:text-slate-700 hover:bg-slate-100"
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
                              })
                            }}
                            title="Edit"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between p-4 border-t border-slate-100 gap-4">
            <p className="text-xs text-slate-500">
              Menampilkan {Math.min((attPage - 1) * PAGE_SIZE + 1, attTotal || 0)} - {Math.min(attPage * PAGE_SIZE, attTotal || 0)} dari {attTotal || 0} entri
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAttPage(p => Math.max(1, p - 1))} disabled={attPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: Math.min(5, attTotalPages || 1) }, (_, i) => {
                const p = i + 1
                return (
                  <Button key={p} variant={attPage === p ? 'default' : 'outline'} size="sm" className={`h-8 w-8 ${attPage === p ? 'bg-blue-500' : ''}`} onClick={() => setAttPage(p)}>
                    {p}
                  </Button>
                )
              })}
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAttPage(p => Math.min(attTotalPages, p + 1))} disabled={attPage >= attTotalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

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

              <form onSubmit={handleAddUser}>
                {/* Baris 1: Nama Lengkap + Email */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>
                      Nama Lengkap <span style={{ color: '#EF4444' }}>*</span>
                    </label>
                    <input
                      required
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
                      required
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
                    <input
                      required
                      type="password"
                      value={addUserForm.password}
                      onChange={e => setAddUserForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="••••••••"
                      style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none', boxSizing: 'border-box' }}
                      onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }}
                      onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}
                    />
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
                    className="h-10 border-slate-200"
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
                    className="h-10 border-slate-200"
                  />
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
                  
                  <span className="text-slate-500">Shift</span>
                  <div>
                    {(() => {
                      const shiftLabel = selectedAtt.shift_type === 'double' ? 'Double Shift' : selectedAtt.shift_name !== '—' ? 'Single Shift' : 'Tidak Ada'
                      const shiftColor = selectedAtt.shift_type === 'double' ? { bg: '#FED7AA', text: '#9A3412' } : selectedAtt.shift_name !== '—' ? { bg: '#DCFCE7', text: '#166534' } : { bg: '#F3F4F6', text: '#374151' }
                      return <span style={{ background: shiftColor.bg, color: shiftColor.text, padding: '2px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600 }}>{shiftLabel}</span>
                    })()}
                  </div>

                  <span className="text-slate-500">Status</span>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const statusColor = selectedAtt.status === 'hadir' ? { bg: '#DCFCE7', text: '#166534' } : selectedAtt.status === 'terlambat' ? { bg: '#FEF9C3', text: '#854D0E' } : selectedAtt.status === 'absen' || selectedAtt.status === 'alfa' ? { bg: '#FEE2E2', text: '#991B1B' } : selectedAtt.status === 'sakit' ? { bg: '#DBEAFE', text: '#1E40AF' } : selectedAtt.status === 'izin' ? { bg: '#EDE9FE', text: '#5B21B6' } : { bg: '#F3F4F6', text: '#374151' }
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

                  // 1. Update attendance table
                  const { error } = await supabase.from('attendance').update({
                    check_in_time: toTsSameDay(editingAtt.date, editAttForm.check_in),
                    check_out_time: toTs(editingAtt.date, editAttForm.check_out),
                    break_start: toTs(editingAtt.date, editAttForm.break_start),
                    break_end: toTs(editingAtt.date, editAttForm.break_end),
                    status: editAttForm.status,
                    note: editAttForm.notes || null,
                  }).eq('id', editingAtt.id)
                  if (error) throw error

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
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '4px' }}>Status Kehadiran <span style={{ color: '#EF4444' }}>*</span></label>
                  <select value={editAttForm.status} onChange={e => setEditAttForm(f => ({ ...f, status: e.target.value }))} style={{ width: '100%', padding: '10px 14px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: '14px', color: '#0F172A', background: '#FFFFFF', outline: 'none' }} onFocus={e => { e.currentTarget.style.border = '1px solid #3B82F6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)' }} onBlur={e => { e.currentTarget.style.border = '1px solid #E2E8F0'; e.currentTarget.style.boxShadow = 'none' }}>
                    <option value="hadir">Hadir</option>
                    <option value="terlambat">Terlambat</option>
                    <option value="sakit">Sakit</option>
                    <option value="izin">Izin</option>
                    <option value="absen">Absen</option>
                  </select>
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
