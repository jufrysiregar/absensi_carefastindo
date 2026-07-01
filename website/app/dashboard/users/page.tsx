'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRoleBadgeClass } from '@/lib/utils'
import { Search, X, Plus, Edit2, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

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

export default function UsersPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('all')

  // Add User Form state
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

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('users-shift-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_shifts' }, () => {
        queryClient.invalidateQueries({ queryKey: ['users'] })
        queryClient.invalidateQueries({ queryKey: ['shiftHistory'] })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        queryClient.invalidateQueries({ queryKey: ['users'] })
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
        .select('id, name, email, role, nip, user_shifts(shift_id, shifts(name))')
        .order('name')

      return (data ?? []).map((u: any) => {
        const us = Array.isArray(u.user_shifts) ? u.user_shifts[0] : u.user_shifts
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

  // Fetch history query
  const { data: history = [], isLoading: historyLoading } = useQuery<ShiftHistory[]>({
    queryKey: ['shiftHistory'],
    queryFn: async () => {
      const { data } = await supabase
        .from('user_shifts')
        .select('id, effective_date, created_at, users(name), shifts(name), old_shift_id')
        .order('created_at', { ascending: false })
        .limit(10)

      return (data ?? []).map((h: any) => ({
        id: h.id,
        user_name: h.users?.name ?? '—',
        old_shift: h.old_shift_id ?? '—',
        new_shift: h.shifts?.name ?? '—',
        effective_date: h.effective_date,
        created_at: h.created_at,
      }))
    }
  })

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

      // 2. Update user_shifts if shift changed
      if (editForm.shiftId !== editingUser.shift_id) {
        const { data: existingShifts, error: fetchError } = await supabase
          .from('user_shifts')
          .select('id')
          .eq('user_id', editingUser.id)

        if (fetchError) throw fetchError

        if (existingShifts && existingShifts.length > 0) {
          const { error: shiftError } = await supabase
            .from('user_shifts')
            .update({
              shift_id: editForm.shiftId || null,
              effective_date: new Date().toISOString().split('T')[0]
            })
            .eq('id', existingShifts[0].id)

          if (shiftError) throw shiftError
        } else {
          const { error: shiftError } = await supabase
            .from('user_shifts')
            .insert({
              user_id: editingUser.id,
              shift_id: editForm.shiftId || null,
              effective_date: new Date().toISOString().split('T')[0]
            })

          if (shiftError) throw shiftError
        }
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

  const filtered = users.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) || 
                        u.email.toLowerCase().includes(search.toLowerCase()) ||
                        u.nip.toLowerCase().includes(search.toLowerCase())
    const matchRole = filterRole === 'all' || u.role.toLowerCase() === filterRole.toLowerCase()
    return matchSearch && matchRole
  })

  const roles = ['all', 'superadmin', 'spv', 'leader', 'cleaner', 'housekeeping', 'gardener', 'gondola']

  const getRoleVariant = (role: string) => {
    switch (role.toLowerCase()) {
      case 'superadmin': return 'default'
      case 'spv': return 'info'
      case 'leader': return 'warning'
      case 'cleaner':
      case 'housekeeping': return 'success'
      default: return 'outline'
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Manajemen Karyawan & Shift</h1>
        <p className="text-sm text-slate-500 mt-1">Kelola data karyawan, tambahkan baru, dan perbarui jadwal shift.</p>
      </div>

      {/* A. FITUR ADD USER (Form Tambah Karyawan Baru) */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Tambah Karyawan Baru
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="flex flex-col">
              <label className="text-sm font-medium text-slate-600 mb-1">Nama Lengkap *</label>
              <input
                type="text"
                required
                placeholder="cth. Budi Santoso"
                value={addUserForm.name}
                onChange={e => setAddUserForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 h-10 text-slate-800"
              />
            </div>
            
            <div className="flex flex-col">
              <label className="text-sm font-medium text-slate-600 mb-1">Email *</label>
              <input
                type="email"
                required
                placeholder="cth. budi@carefast.co.id"
                value={addUserForm.email}
                onChange={e => setAddUserForm(f => ({ ...f, email: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 h-10 text-slate-800"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-sm font-medium text-slate-600 mb-1">Password *</label>
              <input
                type="password"
                required
                placeholder="Min. 6 karakter"
                value={addUserForm.password}
                onChange={e => setAddUserForm(f => ({ ...f, password: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 h-10 text-slate-800"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-sm font-medium text-slate-600 mb-1">NIP (6 digit) *</label>
              <input
                type="text"
                required
                maxLength={6}
                placeholder="cth. 123456"
                value={addUserForm.nip}
                onChange={e => setAddUserForm(f => ({ ...f, nip: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 h-10 text-slate-800"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-sm font-medium text-slate-600 mb-1">Role *</label>
              <select
                value={addUserForm.role}
                onChange={e => setAddUserForm(f => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
              >
                <option value="superadmin">Super Admin</option>
                <option value="spv">SPV</option>
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
                value={addUserForm.shiftId}
                onChange={e => setAddUserForm(f => ({ ...f, shiftId: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
              >
                <option value="">Tanpa Shift (Default)</option>
                {shifts.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3 flex justify-end mt-2">
              <Button
                type="submit"
                disabled={addingUser}
                className="w-full md:w-56 h-10 bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm transition-colors"
              >
                {addingUser ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Menambahkan...
                  </>
                ) : (
                  <>
                    Tambah Karyawan
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* D. TABEL USERS (Daftar Karyawan) */}
        <Card className="lg:col-span-2 shadow-sm overflow-hidden flex flex-col">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
              <CardTitle className="text-base">Daftar Karyawan</CardTitle>
              <div className="flex gap-2 w-full sm:w-auto">
                <select
                  value={filterRole}
                  onChange={e => setFilterRole(e.target.value)}
                  className="w-full sm:w-[150px] px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-9"
                >
                  {roles.map(r => (
                    <option key={r} value={r} className="capitalize">
                      {r === 'all' ? 'Semua Role' : r}
                    </option>
                  ))}
                </select>
                
                <div className="relative flex-1 sm:w-[200px]">
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
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-auto max-h-[500px]">
            <Table className="border-collapse w-full">
              <TableHeader className="sticky top-0 bg-[#F8FAFC] border-b border-slate-200 z-10">
                <TableRow className="hover:bg-transparent border-b border-slate-200">
                  <TableHead className="text-slate-600 font-semibold py-3 pl-4">Nama</TableHead>
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
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j} className="pl-4"><Skeleton className="h-4 w-full max-w-[120px]" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-slate-400">
                      Tidak ada karyawan ditemukan
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map(u => (
                    <TableRow key={u.id} className="bg-white border-b border-slate-100 hover:bg-slate-50/50">
                      <TableCell className="font-semibold text-slate-700 py-3 pl-4">{u.name}</TableCell>
                      <TableCell className="text-slate-500 text-sm py-3">{u.email}</TableCell>
                      <TableCell className="text-slate-600 font-mono text-sm py-3">{u.nip}</TableCell>
                      <TableCell className="py-3">
                        <Badge variant={getRoleVariant(u.role) as any} className="capitalize font-medium">
                          {u.role === 'spv' ? 'Shift Kantor (SPV)' : u.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600 font-medium py-3">
                        {u.current_shift}
                      </TableCell>
                      <TableCell className="py-3 pr-4 text-center">
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
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Shift History */}
        <Card className="shadow-sm flex flex-col">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              📜 Riwayat Perubahan (10 data terakhir)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-auto max-h-[500px]">
            <Table className="border-collapse w-full">
              <TableHeader className="sticky top-0 bg-[#F8FAFC] border-b border-slate-200 z-10">
                <TableRow className="hover:bg-transparent border-b border-slate-200">
                  <TableHead className="text-slate-600 font-semibold py-3 pl-4">Karyawan</TableHead>
                  <TableHead className="text-slate-600 font-semibold py-3 pr-4">Perubahan Shift</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-4"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="pr-4">
                        <Skeleton className="h-4 w-24 mb-1" />
                        <Skeleton className="h-3 w-16" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : history.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center py-8 text-slate-400 pl-4">
                      Belum ada riwayat
                    </TableCell>
                  </TableRow>
                ) : (
                  history.map(h => (
                    <TableRow key={h.id} className="bg-white border-b border-slate-100 hover:bg-slate-50/50">
                      <TableCell className="font-medium text-slate-700 py-3 pl-4">{h.user_name}</TableCell>
                      <TableCell className="py-3 pr-4">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-slate-400 line-through">{h.old_shift}</span>
                          <span className="text-slate-300">→</span>
                          <span className="text-blue-600 font-semibold">{h.new_shift}</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">Efektif: {h.effective_date}</div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* B. FITUR EDIT USER (Modal di Tengah Layar) */}
      <AnimatePresence>
        {editingUser && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-lg w-full overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h3 className="font-bold text-slate-800">Edit Data Karyawan</h3>
                <button 
                  onClick={() => setEditingUser(null)} 
                  className="p-1 hover:bg-slate-200 rounded-full transition-colors text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleUpdateUser} className="p-6 space-y-4">
                <div className="flex flex-col">
                  <label className="text-sm font-medium text-slate-600 mb-1">Nama Lengkap</label>
                  <input
                    type="text"
                    required
                    value={editForm.name}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 h-10 text-slate-800"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="text-sm font-medium text-slate-400 mb-1">Email (tidak dapat diubah)</label>
                  <input
                    type="email"
                    disabled
                    value={editingUser.email}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-100 text-slate-500 cursor-not-allowed h-10"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="text-sm font-medium text-slate-600 mb-1">NIP (6 digit)</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={editForm.nip}
                    onChange={e => setEditForm(f => ({ ...f, nip: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 h-10 text-slate-800"
                  />
                </div>

                <div className="flex flex-col">
                  <label className="text-sm font-medium text-slate-600 mb-1">Role</label>
                  <select
                    value={editForm.role}
                    onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                  >
                    <option value="superadmin">Super Admin</option>
                    <option value="spv">SPV</option>
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
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                  >
                    <option value="">Tanpa Shift (Default)</option>
                    {shifts.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <Button 
                    type="button" 
                    variant="outline" 
                    className="px-4 py-2 border-slate-200 hover:bg-slate-50 text-slate-600"
                    onClick={() => setEditingUser(null)}
                  >
                    Batal
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={updatingUser}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                  >
                    {updatingUser ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Simpan
                  </Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* C. FITUR DELETE USER (Modal Konfirmasi di Tengah Layar) */}
      <AnimatePresence>
        {deletingUserId && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-sm w-full overflow-hidden"
            >
              <div className="p-6 text-center">
                <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <h3 className="font-bold text-slate-800 text-lg mb-2">Hapus Karyawan</h3>
                <p className="text-slate-500 text-sm mb-6">Yakin ingin menghapus user ini? Tindakan ini tidak dapat dibatalkan.</p>
                
                <div className="flex justify-center gap-3">
                  <Button 
                    type="button" 
                    variant="outline" 
                    className="px-4 py-2 border-slate-200 hover:bg-slate-50 text-slate-600"
                    onClick={() => setDeletingUserId(null)}
                    disabled={isDeleting}
                  >
                    Batal
                  </Button>
                  <Button 
                    type="button" 
                    onClick={handleDeleteUser}
                    disabled={isDeleting}
                    className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white shadow-sm"
                  >
                    {isDeleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Ya, Hapus
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

