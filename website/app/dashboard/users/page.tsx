'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDebounce } from '@/hooks/useDebounce'
import { formatDate, formatTime } from '@/lib/utils'
import { Search, X, Plus, Edit2, Trash2, Loader2, Eye, Download } from 'lucide-react'
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
}

interface AttendanceRow {
  id: string
  user_name: string
  shift_name: string
  date: string
  check_in: string | null
  check_out: string | null
  break_start: string | null
  break_end: string | null
  status: string
  selfie_url: string | null
  location: string | null
  notes: string | null
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
  const [shiftForm, setShiftForm] = useState({
    userId: '',
    shiftId: '',
    effectiveDate: new Date().toISOString().split('T')[0]
  })

  // Attendance table filters & pagination
  const [attPage, setAttPage] = useState(1)
  const [attSearch, setAttSearch] = useState('')
  const [attFilterDate, setAttFilterDate] = useState('')
  const [attFilterShift, setAttFilterShift] = useState('all')
  const [attFilterStatus, setAttFilterStatus] = useState('all')
  const [selectedAtt, setSelectedAtt] = useState<AttendanceRow | null>(null)

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

  // Fetch history query (limited to 3)
  const { data: history = [], isLoading: historyLoading } = useQuery<ShiftHistory[]>({
    queryKey: ['shiftHistory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_shifts')
        .select('id, effective_date, created_at, user_id, users(name), shifts(name)')
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

        return {
          id: h.id,
          user_name: h.users?.name ?? '—',
          old_shift: (prevShift as any)?.shifts?.name ?? 'Tanpa Shift',
          new_shift: h.shifts?.name ?? 'Tanpa Shift',
          effective_date: h.effective_date,
          created_at: h.created_at,
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
        .select('id, status, check_in_time, check_out_time, break_start, break_end, date, selfie_url, location_lat, location_lng, note, users(name), user_shifts(shifts(id, name))', { count: 'exact' })
        .order('date', { ascending: false })
        .order('check_in_time', { ascending: false })

      if (attFilterDate) query = query.eq('date', attFilterDate)
      if (attFilterStatus !== 'all') query = query.eq('status', attFilterStatus)

      const from = (attPage - 1) * PAGE_SIZE
      const { data, count } = await query.range(from, from + PAGE_SIZE - 1)

      let mapped = (data ?? []).map((r: any) => ({
        id: r.id,
        user_name: r.users?.name ?? '—',
        shift_name: r.user_shifts?.shifts?.name ?? '—',
        date: r.date,
        check_in: r.check_in_time,
        check_out: r.check_out_time,
        break_start: r.break_start,
        break_end: r.break_end,
        status: r.status,
        selfie_url: r.selfie_url,
        location: r.location_lat && r.location_lng ? `${r.location_lat}, ${r.location_lng}` : '—',
        notes: r.note,
      }))

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
      setShiftForm({ userId: '', shiftId: '', effectiveDate: new Date().toISOString().split('T')[0] })
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

    // Check if target shift is the same as the current shift
    const selectedUser = users.find(u => u.id === shiftForm.userId)
    const currentShiftId = selectedUser?.shift_id || ''
    const targetShiftId = shiftForm.shiftId === 'none' ? '' : shiftForm.shiftId

    if (currentShiftId === targetShiftId) {
      toast.error('Gagal memperbarui shift: Karyawan sudah berada di shift tersebut! Perubahan shift tidak valid.')
      return
    }

    updateShiftMutation.mutate(shiftForm)
  }

  // Export excel function
  function exportExcel() {
    if (attRows.length === 0) {
      toast.error('Tidak ada data untuk diekspor')
      return
    }
    const ws = XLSX.utils.json_to_sheet(attRows.map(r => {
      const dur = calculateBreakDuration(r.break_start, r.break_end)
      return {
        Nama: r.user_name, Shift: r.shift_name, Tanggal: r.date,
        'Check-in': r.check_in ? formatTime(r.check_in) : '-',
        'Istirahat Mulai': r.break_start ? formatTime(r.break_start) : '-',
        'Istirahat Selesai': r.break_end ? formatTime(r.break_end) : '-',
        'Durasi Istirahat': dur.text,
        'Check-out': r.check_out ? formatTime(r.check_out) : '-',
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
            widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
            body: [
              [
                { text: 'Nama', style: 'tableHeader' },
                { text: 'Shift', style: 'tableHeader' },
                { text: 'Tanggal', style: 'tableHeader' },
                { text: 'Check-in', style: 'tableHeader' },
                { text: 'Istirahat Mulai', style: 'tableHeader' },
                { text: 'Istirahat Selesai', style: 'tableHeader' },
                { text: 'Durasi', style: 'tableHeader' },
                { text: 'Check-out', style: 'tableHeader' },
                { text: 'Status', style: 'tableHeader' }
              ],
              ...attRows.map(r => [
                r.user_name,
                r.shift_name,
                r.date,
                r.check_in ? formatTime(r.check_in) : '-',
                r.break_start ? formatTime(r.break_start) : '-',
                r.break_end ? formatTime(r.break_end) : '-',
                calculateBreakDuration(r.break_start, r.break_end).text,
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
      case 'housekeeping': return 'success'
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

      {/* 2. UBAH SHIFT KARYAWAN (KEMBALIKAN FUNGSIONALITAS) */}
      <Card className="shadow-sm border-blue-100 bg-blue-50/20">
        <CardHeader className="pb-3 border-b border-blue-100/50">
          <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
            🔄 Ubah Shift Karyawan
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={handleUpdateShift} className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex flex-col w-full md:w-64">
              <label htmlFor="shiftUserId" className="text-sm font-medium text-slate-600 mb-1.5">Karyawan</label>
              <select
                id="shiftUserId"
                value={shiftForm.userId}
                onChange={e => setShiftForm(f => ({ ...f, userId: e.target.value }))}
                className="w-full h-10 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="" disabled>Pilih Karyawan</option>
                {users
                  .filter(u => u.role.toLowerCase() !== 'superadmin')
                  .map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.nip})</option>
                  ))
                }
              </select>
            </div>
            
            <div className="flex flex-col w-full md:w-56">
              <label htmlFor="shiftNewId" className="text-sm font-medium text-slate-600 mb-1.5">Shift Baru</label>
              <select
                id="shiftNewId"
                value={shiftForm.shiftId}
                onChange={e => setShiftForm(f => ({ ...f, shiftId: e.target.value }))}
                className="w-full h-10 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="" disabled>Pilih Shift Baru</option>
                {shifts.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
                <option value="none">Tanpa Shift</option>
              </select>
            </div>
            
            <div className="flex flex-col w-full md:w-48">
              <label htmlFor="shiftDate" className="text-sm font-medium text-slate-600 mb-1.5">Tanggal Efektif</label>
              <Input
                id="shiftDate"
                type="date"
                value={shiftForm.effectiveDate}
                onChange={e => setShiftForm(f => ({ ...f, effectiveDate: e.target.value }))}
                className="h-10 border-slate-200 bg-white"
              />
            </div>
            
            <Button 
              type="submit" 
              disabled={updateShiftMutation.isPending} 
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium h-10 px-6 w-full md:w-auto shrink-0"
            >
              {updateShiftMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Mengubah...
                </>
              ) : (
                'Update Shift'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* 3. RIWAYAT PERUBAHAN (3 DATA TERAKHIR - DI PALING BAWAH RIWAYAT SHIFT) */}
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
                <TableHead className="text-slate-600 font-semibold py-3 pr-4">Tanggal Efektif</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-4"><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell className="pr-4"><Skeleton className="h-4 w-20" /></TableCell>
                  </TableRow>
                ))
              ) : history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-slate-400 pl-4">
                    Belum ada riwayat perubahan shift
                  </TableCell>
                </TableRow>
              ) : (
                history.map(h => (
                  <TableRow key={h.id} className="bg-white border-b border-slate-100 hover:bg-slate-50/50">
                    <TableCell className="font-semibold text-slate-700 py-3 pl-4">{h.user_name}</TableCell>
                    <TableCell className="text-slate-500 py-3">{h.old_shift}</TableCell>
                    <TableCell className="text-slate-600 font-medium py-3">{h.new_shift}</TableCell>
                    <TableCell className="text-slate-500 py-3 pr-4">{h.effective_date}</TableCell>
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
                  <SelectValue placeholder="Semua Shift" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Shift</SelectItem>
                  {shifts.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={attFilterStatus} onValueChange={v => { setAttFilterStatus(v as string); setAttPage(1) }}>
                <SelectTrigger className="w-full sm:w-[160px] bg-white h-9">
                  <SelectValue placeholder="Semua Status" />
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
              {(attFilterDate || attFilterStatus !== 'all' || attFilterShift !== 'all' || attSearch) && (
                <Button
                  variant="ghost"
                  onClick={() => { setAttFilterDate(''); setAttFilterShift('all'); setAttFilterStatus('all'); setAttSearch(''); setAttPage(1) }}
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
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Check-in</TableHead>
                  <TableHead>Istirahat Mulai</TableHead>
                  <TableHead>Istirahat Selesai</TableHead>
                  <TableHead>Durasi Istirahat</TableHead>
                  <TableHead>Check-out</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center pr-4">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendanceLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-6" /></TableCell>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full max-w-[90px]" /></TableCell>
                      ))}
                      <TableCell className="pr-4"><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : attRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="h-32 text-center text-slate-400">
                      Tidak ada data absensi ditemukan
                    </TableCell>
                  </TableRow>
                ) : (
                  attRows.map((r, i) => (
                    <TableRow key={r.id} className="bg-white border-b border-slate-100 hover:bg-slate-50/50">
                      <TableCell className="font-mono text-xs text-slate-400 pl-4">{(attPage - 1) * PAGE_SIZE + i + 1}</TableCell>
                      <TableCell className="font-medium text-slate-700">{r.user_name}</TableCell>
                      <TableCell className="text-slate-500">{r.shift_name}</TableCell>
                      <TableCell className="text-slate-500">{formatDate(r.date)}</TableCell>
                      <TableCell className="text-slate-500">{r.check_in ? formatTime(r.check_in) : '—'}</TableCell>
                      <TableCell className="text-slate-500">{r.break_start ? formatTime(r.break_start) : '—'}</TableCell>
                      <TableCell className="text-slate-500">{r.break_end ? formatTime(r.break_end) : '—'}</TableCell>
                      <TableCell>
                        {(() => {
                          const dur = calculateBreakDuration(r.break_start, r.break_end)
                          return (
                            <span className={dur.isWarning ? "text-red-600 font-semibold" : "text-slate-500"}>
                              {dur.text}
                            </span>
                          )
                        })()}
                      </TableCell>
                      <TableCell className="text-slate-500">{r.check_out ? formatTime(r.check_out) : '—'}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === 'hadir' ? 'success' : r.status === 'izin' ? 'warning' : r.status === 'sakit' ? 'destructive' : 'default'}>
                          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center pr-4">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                          onClick={() => setSelectedAtt(r)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
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
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden p-6"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                <h3 className="font-bold text-slate-800 text-lg">➕ Tambah Karyawan Baru</h3>
                <Button variant="ghost" size="icon" onClick={() => setShowAddModal(false)} className="h-8 w-8 rounded-full">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <form onSubmit={handleAddUser} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col">
                    <label className="text-sm font-medium text-slate-600 mb-1">Nama Lengkap *</label>
                    <input
                      required
                      type="text"
                      value={addUserForm.name}
                      onChange={e => setAddUserForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="cth. Andi"
                      className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                    />
                  </div>
                  
                  <div className="flex flex-col">
                    <label className="text-sm font-medium text-slate-600 mb-1">Email *</label>
                    <input
                      required
                      type="email"
                      value={addUserForm.email}
                      onChange={e => setAddUserForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="cth. andi@domain.com"
                      className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col">
                    <label className="text-sm font-medium text-slate-600 mb-1">Password * (Min. 6 Karakter)</label>
                    <input
                      required
                      type="password"
                      value={addUserForm.password}
                      onChange={e => setAddUserForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="••••••••"
                      className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                    />
                  </div>
                  
                  <div className="flex flex-col">
                    <label className="text-sm font-medium text-slate-600 mb-1">NIP * (6 digit)</label>
                    <input
                      required
                      maxLength={6}
                      type="text"
                      value={addUserForm.nip}
                      onChange={e => setAddUserForm(f => ({ ...f, nip: e.target.value }))}
                      placeholder="cth. 123456"
                      className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col">
                    <label className="text-sm font-medium text-slate-600 mb-1">Role *</label>
                    <select
                      value={addUserForm.role}
                      onChange={e => setAddUserForm(f => ({ ...f, role: e.target.value }))}
                      className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-10 capitalize"
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
                    <label className="text-sm font-medium text-slate-600 mb-1">Shift Awal</label>
                    <select
                      value={addUserForm.shiftId}
                      onChange={e => setAddUserForm(f => ({ ...f, shiftId: e.target.value }))}
                      className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                    >
                      <option value="">Pilih Shift (Opsional)</option>
                      {shifts.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                      <option value="none">Tanpa Shift</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-center gap-3 pt-4 border-t border-slate-100">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setShowAddModal(false)} 
                    className="px-6 h-10"
                  >
                    Batal
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={addingUser}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 h-10"
                  >
                    {addingUser ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Menyimpan...
                      </>
                    ) : (
                      'Simpan'
                    )}
                  </Button>
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
                <Button variant="ghost" size="icon" onClick={() => setEditingUser(null)} className="h-8 w-8 rounded-full">
                  <X className="w-4 h-4" />
                </Button>
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

                <div className="flex justify-center gap-3 pt-4 border-t border-slate-100">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setEditingUser(null)} 
                    className="px-6 h-10"
                  >
                    Batal
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={updatingUser}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 h-10"
                  >
                    {updatingUser ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Menyimpan...
                      </>
                    ) : (
                      'Simpan'
                    )}
                  </Button>
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
                  
                  <span className="text-slate-500">Shift</span>
                  <span className="font-medium text-slate-800">{selectedAtt.shift_name}</span>
                  
                  <span className="text-slate-500">Tanggal</span>
                  <span className="font-medium text-slate-800">{formatDate(selectedAtt.date)}</span>
                  
                  <span className="text-slate-500">Waktu</span>
                  <span className="font-medium text-slate-800">
                    {selectedAtt.check_in ? formatTime(selectedAtt.check_in) : '--:--'} s/d {selectedAtt.check_out ? formatTime(selectedAtt.check_out) : '--:--'}
                  </span>

                  <span className="text-slate-500">Istirahat</span>
                  <span className="font-medium text-slate-800 font-mono">
                    {selectedAtt.break_start ? formatTime(selectedAtt.break_start) : '--:--'} s/d {selectedAtt.break_end ? formatTime(selectedAtt.break_end) : '--:--'}
                    {selectedAtt.break_start && selectedAtt.break_end ? ` (${calculateBreakDuration(selectedAtt.break_start, selectedAtt.break_end).text})` : ''}
                  </span>
                  
                  <span className="text-slate-500">Status</span>
                  <div>
                    <Badge variant={selectedAtt.status === 'hadir' ? 'success' : selectedAtt.status === 'izin' ? 'warning' : selectedAtt.status === 'sakit' ? 'destructive' : 'default'}>
                      {selectedAtt.status.charAt(0).toUpperCase() + selectedAtt.status.slice(1)}
                    </Badge>
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
    </motion.div>
  )
}

// Icons placeholders for Chevron pagination
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
