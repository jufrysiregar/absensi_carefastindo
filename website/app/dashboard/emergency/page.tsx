'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { Plus, Edit2, Trash2, X, Loader2, AlertTriangle, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

// ─── Types ────────────────────────────────────────────────
interface UserOption { id: string; name: string }
interface ShiftOption { id: string; name: string }

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

// ─── Badge helpers ─────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    active: 'bg-green-100 text-green-800',
    selesai: 'bg-slate-100 text-slate-600',
    completed: 'bg-slate-100 text-slate-600',
  }
  const cls = map[status.toLowerCase()] ?? 'bg-slate-100 text-slate-600'
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${cls}`}>
      {status}
    </span>
  )
}

function ReasonBadge({ reason }: { reason: string }) {
  return reason === 'lembur' ? (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Lembur</span>
  ) : (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Ganti Off</span>
  )
}

// ─── Modal wrapper ─────────────────────────────────────────
function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode
}) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ duration: 0.15 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto relative z-10 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-lg">{title}</h3>
              <button onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

// ─── Main Page ─────────────────────────────────────────────
export default function EmergencyPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const today = new Date().toISOString().split('T')[0]

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editRow, setEditRow] = useState<EmergencyRow | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const [form, setForm] = useState({
    assigned_user_id: '',
    target_date: today,
    reason: 'lembur' as 'lembur' | 'ganti_off',
    replacing_user_id: '',
    shift_id: '',
    status: 'pending',
  })

  // ── Queries ──────────────────────────────────────────────
  const { data: users = [] } = useQuery<UserOption[]>({
    queryKey: ['emp-users'],
    queryFn: async () => {
      const { data } = await supabase.from('users').select('id, name')
        .eq('is_active', true).neq('role', 'superadmin').order('name')
      return data ?? []
    }
  })

  const { data: shifts = [] } = useQuery<ShiftOption[]>({
    queryKey: ['emp-shifts'],
    queryFn: async () => {
      const { data } = await supabase.from('shifts').select('id, name').eq('is_active', true)
      return data ?? []
    }
  })

  const { data: rows = [], isLoading } = useQuery<EmergencyRow[]>({
    queryKey: ['emergency'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('emergency_assignments')
        .select('id, assigned_user_id, replacing_user_id, shift_id, target_date, reason, status, created_at, assigned_user:users!emergency_assignments_assigned_user_id_fkey(name), replacing_user:users!emergency_assignments_replacing_user_id_fkey(name), shift:shifts(name)')
        .order('created_at', { ascending: false })
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

  // Stats for today
  const todayLembur = rows.filter(r => r.target_date === today && r.reason === 'lembur').length
  const todayGantiOff = rows.filter(r => r.target_date === today && r.reason === 'ganti_off').length

  // ── Mutations ─────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (payload: typeof form & { id?: string }) => {
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
      toast.success(editRow ? 'Penugasan berhasil diupdate!' : 'Penugasan berhasil disimpan!')
      queryClient.invalidateQueries({ queryKey: ['emergency'] })
      resetForm()
    },
    onError: (e: any) => toast.error('Gagal: ' + e.message)
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('emergency_assignments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Penugasan berhasil dihapus!')
      queryClient.invalidateQueries({ queryKey: ['emergency'] })
      setDeleteId(null)
    },
    onError: (e: any) => toast.error('Gagal menghapus: ' + e.message)
  })

  // ── Helpers ───────────────────────────────────────────────
  function resetForm() {
    setForm({ assigned_user_id: '', target_date: today, reason: 'lembur', replacing_user_id: '', shift_id: '', status: 'pending' })
    setEditRow(null)
    setShowForm(false)
  }

  function openEdit(row: EmergencyRow) {
    setEditRow(row)
    setForm({
      assigned_user_id: row.assigned_user_id,
      target_date: row.target_date,
      reason: row.reason,
      replacing_user_id: row.replacing_user_id ?? '',
      shift_id: row.shift_id ?? '',
      status: row.status,
    })
    setShowForm(true)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.assigned_user_id || !form.target_date) {
      toast.error('Karyawan dan tanggal wajib diisi!'); return
    }
    if (form.reason === 'ganti_off' && !form.replacing_user_id) {
      toast.error('Karyawan yang digantikan wajib diisi!'); return
    }
    saveMutation.mutate({ ...form, id: editRow?.id })
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Darurat &amp; Lembur</h1>
          <p className="text-sm text-slate-500 mt-1">Kelola penugasan lembur dan ganti off karyawan.</p>
        </div>
        <button onClick={() => { setEditRow(null); setForm({ assigned_user_id: '', target_date: today, reason: 'lembur', replacing_user_id: '', shift_id: '', status: 'pending' }); setShowForm(true) }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-all self-start sm:self-auto">
          <Plus className="w-4 h-4" /> Tambah Penugasan
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Lembur Hari Ini</CardTitle>
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
              <Clock className="w-4 h-4 text-blue-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-800">{todayLembur}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Ganti Off Hari Ini</CardTitle>
            <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-800">{todayGantiOff}</div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card className="shadow-sm">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100">
          <CardTitle className="text-base">Daftar Penugasan</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="pl-4">No</TableHead>
                  <TableHead>Karyawan Ditugaskan</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Tipe</TableHead>
                  <TableHead>Karyawan Digantikan / Shift</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center pr-4">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-slate-400">
                      Belum ada penugasan
                    </TableCell>
                  </TableRow>
                ) : rows.map((row, idx) => (
                  <TableRow key={row.id} className="hover:bg-slate-50/50">
                    <TableCell className="pl-4 text-slate-500">{idx + 1}</TableCell>
                    <TableCell className="font-medium text-slate-800">{row.assigned_user_name}</TableCell>
                    <TableCell className="text-slate-600">{row.target_date}</TableCell>
                    <TableCell><ReasonBadge reason={row.reason} /></TableCell>
                    <TableCell className="text-slate-600 text-sm">
                      {row.reason === 'ganti_off'
                        ? (row.replacing_user_name ?? '—')
                        : (row.shift_name ?? '—')}
                    </TableCell>
                    <TableCell><StatusBadge status={row.status} /></TableCell>
                    <TableCell className="text-center pr-4">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(row)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-blue-500 hover:bg-blue-50 transition-all">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteId(row.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 transition-all">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Form Modal */}
      <Modal open={showForm} onClose={resetForm} title={editRow ? 'Edit Penugasan' : 'Tambah Penugasan'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Karyawan Ditugaskan */}
          <div>
            <label className="text-sm font-semibold text-slate-700 mb-1 block">Karyawan Ditugaskan *</label>
            <select value={form.assigned_user_id} onChange={e => setForm(f => ({ ...f, assigned_user_id: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">-- Pilih Karyawan --</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          {/* Tanggal */}
          <div>
            <label className="text-sm font-semibold text-slate-700 mb-1 block">Tanggal *</label>
            <input type="date" value={form.target_date} onChange={e => setForm(f => ({ ...f, target_date: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Tipe */}
          <div>
            <label className="text-sm font-semibold text-slate-700 mb-2 block">Tipe Perubahan *</label>
            <div className="flex gap-4">
              {(['lembur', 'ganti_off'] as const).map(r => (
                <label key={r} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" value={r} checked={form.reason === r}
                    onChange={() => setForm(f => ({ ...f, reason: r, replacing_user_id: '', shift_id: '' }))}
                    className="accent-blue-600" />
                  <span className="text-sm font-medium capitalize">{r === 'ganti_off' ? 'Ganti Off' : 'Lembur'}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Conditional: Ganti Off → pilih karyawan digantikan */}
          {form.reason === 'ganti_off' && (
            <div>
              <label className="text-sm font-semibold text-slate-700 mb-1 block">Karyawan Digantikan *</label>
              <select value={form.replacing_user_id} onChange={e => setForm(f => ({ ...f, replacing_user_id: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">-- Pilih Karyawan --</option>
                {users.filter(u => u.id !== form.assigned_user_id).map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Conditional: Lembur → pilih shift */}
          {form.reason === 'lembur' && (
            <div>
              <label className="text-sm font-semibold text-slate-700 mb-1 block">Shift Lembur</label>
              <select value={form.shift_id} onChange={e => setForm(f => ({ ...f, shift_id: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">-- Pilih Shift --</option>
                {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          {/* Status (hanya saat edit) */}
          {editRow && (
            <div>
              <label className="text-sm font-semibold text-slate-700 mb-1 block">Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="pending">Pending</option>
                <option value="active">Aktif</option>
                <option value="selesai">Selesai</option>
              </select>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saveMutation.isPending}
              className="flex-1 py-2.5 rounded-xl text-white font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {editRow ? 'Simpan Perubahan' : 'Tambah Penugasan'}
            </button>
            <button type="button" onClick={resetForm}
              className="flex-1 py-2.5 rounded-xl text-white font-semibold bg-slate-400 hover:bg-slate-500 transition-all">
              Batal
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Konfirmasi Hapus">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Yakin ingin menghapus penugasan ini? Tindakan tidak dapat dibatalkan.</p>
          <div className="flex gap-3">
            <button onClick={() => deleteMutation.mutate(deleteId!)} disabled={deleteMutation.isPending}
              className="flex-1 py-2.5 rounded-xl text-white font-semibold bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Hapus
            </button>
            <button onClick={() => setDeleteId(null)}
              className="flex-1 py-2.5 rounded-xl text-white font-semibold bg-slate-400 hover:bg-slate-500 transition-all">
              Batal
            </button>
          </div>
        </div>
      </Modal>

    </motion.div>
  )
}
