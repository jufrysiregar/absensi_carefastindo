'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getRoleBadgeClass } from '@/lib/utils'
import { Search, X, Save, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface UserRow { id: string; name: string; email: string; role: string; current_shift: string; shift_id: string }
interface ShiftHistory { id: string; user_name: string; old_shift: string; new_shift: string; effective_date: string; created_at: string }

export default function UsersPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('all')
  const [form, setForm] = useState({ userId: '', shiftId: '', effectiveDate: '' })

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('users-shift-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_shifts' }, () => {
        queryClient.invalidateQueries({ queryKey: ['users'] })
        queryClient.invalidateQueries({ queryKey: ['shiftHistory'] })
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
        .select('id, name, email, role, user_shifts(shift_id, shifts(name))')
        .order('name')

      return (data ?? []).map((u: any) => {
        const us = Array.isArray(u.user_shifts) ? u.user_shifts[0] : u.user_shifts
        return {
          id: u.id, name: u.name, email: u.email, role: u.role,
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
      const { data } = await supabase.from('shifts').select('id, name')
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

  // Mutation for updating shift
  const updateShiftMutation = useMutation({
    mutationFn: async (payload: { userId: string; shiftId: string; effectiveDate: string }) => {
      const { error } = await supabase.from('user_shifts').upsert({
        user_id: payload.userId,
        shift_id: payload.shiftId,
        effective_date: payload.effectiveDate,
      }, { onConflict: 'user_id' })

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Shift berhasil diperbarui!')
      setForm({ userId: '', shiftId: '', effectiveDate: '' })
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['shiftHistory'] })
    },
    onError: (error: any) => {
      toast.error('Gagal mengubah shift: ' + error.message)
    }
  })

  function handleUpdateShift(e: React.FormEvent) {
    e.preventDefault()
    if (!form.userId || !form.shiftId || !form.effectiveDate) {
      toast.error('Isi semua field terlebih dahulu')
      return
    }
    updateShiftMutation.mutate(form)
  }

  const filtered = users.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
    const matchRole = filterRole === 'all' || u.role === filterRole
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
        <p className="text-sm text-slate-500 mt-1">Kelola data karyawan dan perbarui jadwal shift.</p>
      </div>

      {/* Action / Form Section */}
      <Card className="shadow-sm border-blue-100 bg-blue-50/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            ✏️ Ubah Shift Karyawan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpdateShift} className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex flex-col w-full md:w-56">
              <label htmlFor="userId" className="text-sm font-medium text-[#475569] mb-[4px] block">Karyawan</label>
              <select
                id="userId"
                value={form.userId}
                onChange={e => setForm(f => ({ ...f, userId: e.target.value }))}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
              >
                <option value="" disabled>Pilih Karyawan</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            
            <div className="flex flex-col w-full md:w-48">
              <label htmlFor="shiftId" className="text-sm font-medium text-[#475569] mb-[4px] block">Shift Baru</label>
              <select
                id="shiftId"
                value={form.shiftId}
                onChange={e => setForm(f => ({ ...f, shiftId: e.target.value }))}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
              >
                <option value="" disabled>Pilih Shift</option>
                {shifts.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            
            <div className="flex flex-col w-full md:w-48">
              <label htmlFor="effectiveDate" className="text-sm font-medium text-[#475569] mb-[4px] block">Tanggal Efektif</label>
              <input
                id="effectiveDate"
                type="date"
                value={form.effectiveDate}
                onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))}
                className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
              />
            </div>
            
            <Button
              type="submit"
              disabled={updateShiftMutation.isPending}
              className="w-full md:w-auto mt-4 md:mt-0 h-10 px-5"
            >
              {updateShiftMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Update Shift
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Users Table */}
        <Card className="lg:col-span-2 shadow-sm overflow-hidden flex flex-col">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
              <CardTitle className="text-base">Daftar Karyawan</CardTitle>
              <div className="flex gap-2 w-full sm:w-auto">
                <select
                  value={filterRole}
                  onChange={e => setFilterRole(e.target.value)}
                  className="w-full sm:w-[150px] px-3 py-1.5 border border-[#E2E8F0] rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-9"
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
                    placeholder="Cari nama/email..."
                    className="pl-9 pr-3 py-1.5 w-full border border-[#E2E8F0] rounded-lg text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 h-9"
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
              <TableHeader className="sticky top-0 bg-[#F8FAFC] border-b border-[#E2E8F0] z-10">
                <TableRow className="hover:bg-transparent border-b border-[#E2E8F0]">
                  <TableHead className="w-[200px] text-[#475569] font-semibold py-3 border-b border-[#E2E8F0]">Nama</TableHead>
                  <TableHead className="text-[#475569] font-semibold py-3 border-b border-[#E2E8F0]">Email</TableHead>
                  <TableHead className="text-[#475569] font-semibold py-3 border-b border-[#E2E8F0]">Role</TableHead>
                  <TableHead className="text-[#475569] font-semibold py-3 border-b border-[#E2E8F0]">Shift Saat Ini</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usersLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 4 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full max-w-[120px]" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-slate-400">
                      Tidak ada karyawan ditemukan
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map(u => (
                    <TableRow key={u.id} className="bg-white border-b border-[#E2E8F0] hover:bg-slate-50/50">
                      <TableCell className="font-semibold text-slate-700 py-3 border-b border-[#E2E8F0]">{u.name}</TableCell>
                      <TableCell className="text-slate-500 text-sm py-3 border-b border-[#E2E8F0]">{u.email}</TableCell>
                      <TableCell className="py-3 border-b border-[#E2E8F0]">
                        <Badge variant={getRoleVariant(u.role) as any} className="capitalize font-medium">
                          {u.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600 font-medium py-3 border-b border-[#E2E8F0]">
                        {u.current_shift}
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
              📜 Riwayat Perubahan (Last 10)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-auto max-h-[500px]">
            <Table className="border-collapse w-full">
              <TableHeader className="sticky top-0 bg-[#F8FAFC] border-b border-[#E2E8F0] z-10">
                <TableRow className="hover:bg-transparent border-b border-[#E2E8F0]">
                  <TableHead className="text-[#475569] font-semibold py-3 border-b border-[#E2E8F0]">Karyawan</TableHead>
                  <TableHead className="text-[#475569] font-semibold py-3 border-b border-[#E2E8F0]">Perubahan Shift</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-24 mb-1" />
                        <Skeleton className="h-3 w-16" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : history.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center py-8 text-slate-400">
                      Belum ada riwayat
                    </TableCell>
                  </TableRow>
                ) : (
                  history.map(h => (
                    <TableRow key={h.id} className="bg-white border-b border-[#E2E8F0] hover:bg-slate-50/50">
                      <TableCell className="font-medium text-slate-700 py-3 border-b border-[#E2E8F0]">{h.user_name}</TableCell>
                      <TableCell className="py-3 border-b border-[#E2E8F0]">
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
    </motion.div>
  )
}
