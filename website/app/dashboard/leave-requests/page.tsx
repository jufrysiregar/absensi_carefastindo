'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getStatusBadgeClass, formatDate } from '@/lib/utils'
import { Check, X, Search, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

interface LeaveRequestRow {
  id: string
  user_name: string
  type: string
  start_date: string
  end_date: string
  reason: string
  status: string
}

export default function LeaveRequestsPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterStatus, setFilterStatus] = useState('pending')
  const [showConfirm, setShowConfirm] = useState<{ type: 'approve_all' | 'reject_all' } | null>(null)

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('leave-requests-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => {
        queryClient.invalidateQueries({ queryKey: ['leaveRequests'] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, queryClient])

  // Get leave requests
  const { data: requests = [], isLoading } = useQuery<LeaveRequestRow[]>({
    queryKey: ['leaveRequests', filterType, filterStatus, search],
    queryFn: async () => {
      let query = supabase
        .from('leave_requests')
        .select('id, type, start_date, end_date, reason, status, users(name)')
        .order('created_at', { ascending: false })

      if (filterType !== 'all') {
        query = query.eq('type', filterType.toLowerCase())
      }
      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus.toLowerCase())
      }

      const { data, error } = await query
      if (error) throw error

      let mapped: LeaveRequestRow[] = (data || []).map((r: any) => ({
        id: r.id,
        user_name: r.users?.name || '—',
        type: r.type,
        start_date: r.start_date,
        end_date: r.end_date,
        reason: r.reason || '—',
        status: r.status
      }))

      if (search) {
        mapped = mapped.filter(r => r.user_name.toLowerCase().includes(search.toLowerCase()))
      }

      return mapped
    }
  })

  // Mutation for updating status (Approve / Reject)
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => {
      const { error } = await supabase
        .from('leave_requests')
        .update({ status })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: (_, variables) => {
      toast.success(`Request berhasil di-${variables.status}`)
      queryClient.invalidateQueries({ queryKey: ['leaveRequests'] })
    },
    onError: (error: any) => {
      toast.error('Gagal memproses request: ' + error.message)
    }
  })

  // Mutation for bulk updating status
  const bulkUpdateStatusMutation = useMutation({
    mutationFn: async (status: 'approved' | 'rejected') => {
      const pendingIds = requests.filter(r => r.status.toLowerCase() === 'pending').map(r => r.id)
      if (pendingIds.length === 0) {
        throw new Error('Tidak ada request dengan status pending')
      }

      const { error } = await supabase
        .from('leave_requests')
        .update({ status })
        .in('id', pendingIds)

      if (error) throw error
      return pendingIds.length
    },
    onSuccess: (count, status) => {
      toast.success(`Berhasil memproses bulk ${status} untuk ${count} request`)
      setShowConfirm(null)
      queryClient.invalidateQueries({ queryKey: ['leaveRequests'] })
    },
    onError: (error: any) => {
      toast.error('Gagal memproses bulk action: ' + error.message)
    }
  })

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Leave Requests</h1>
          <p className="text-sm text-slate-500 mt-1">Kelola pengajuan cuti, sakit, dan izin pegawai</p>
        </div>
      </div>

      {/* Filter Bar */}
      <Card className="border-slate-200/60 shadow-sm">
        <CardContent className="p-4 flex flex-wrap gap-3 items-center bg-white/50">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari nama pegawai..."
              className="pl-9 bg-white"
            />
          </div>

          <div className="w-40">
            <Select value={filterType} onValueChange={(v) => setFilterType(v as string)}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Semua Tipe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Tipe</SelectItem>
                <SelectItem value="cuti">Cuti</SelectItem>
                <SelectItem value="sakit">Sakit</SelectItem>
                <SelectItem value="izin">Izin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-40">
            <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as string)}>
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Semua Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(search || filterType !== 'all' || filterStatus !== 'pending') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch('')
                setFilterType('all')
                setFilterStatus('pending')
              }}
              className="text-slate-500 hover:text-slate-700"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Reset
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Requests Table */}
      <Card className="border-slate-200/60 shadow-sm overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50/80">
            <TableRow>
              <TableHead>Nama Pegawai</TableHead>
              <TableHead>Jenis Pengajuan</TableHead>
              <TableHead>Tanggal Mulai</TableHead>
              <TableHead>Tanggal Selesai</TableHead>
              <TableHead>Alasan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-[100px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : requests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-slate-500">
                  Tidak ada pengajuan cuti ditemukan
                </TableCell>
              </TableRow>
            ) : (
              requests.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-slate-700 whitespace-nowrap">{r.user_name}</TableCell>
                  <TableCell className="capitalize">{r.type}</TableCell>
                  <TableCell className="text-slate-500">{r.start_date ? formatDate(r.start_date) : '—'}</TableCell>
                  <TableCell className="text-slate-500">{r.end_date ? formatDate(r.end_date) : '—'}</TableCell>
                  <TableCell className="text-slate-500 max-w-[200px] truncate" title={r.reason}>{r.reason}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`capitalize border ${
                        r.status.toLowerCase() === 'approved'
                          ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                          : r.status.toLowerCase() === 'rejected'
                          ? 'bg-red-50 text-red-600 border-red-200'
                          : 'bg-amber-50 text-amber-600 border-amber-200'
                      }`}
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status.toLowerCase() === 'pending' ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border-emerald-200"
                          onClick={() => updateStatusMutation.mutate({ id: r.id, status: 'approved' })}
                          disabled={updateStatusMutation.isPending && updateStatusMutation.variables?.id === r.id}
                          title="Approve"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                          onClick={() => updateStatusMutation.mutate({ id: r.id, status: 'rejected' })}
                          disabled={updateStatusMutation.isPending && updateStatusMutation.variables?.id === r.id}
                          title="Reject"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-slate-300 pr-4">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Bulk actions */}
      {requests.some(r => r.status.toLowerCase() === 'pending') && (
        <div className="flex gap-3 justify-end pt-2">
          <Button
            variant="outline"
            className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
            onClick={() => setShowConfirm({ type: 'reject_all' })}
          >
            Reject All Pending
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-200"
            onClick={() => setShowConfirm({ type: 'approve_all' })}
          >
            Approve All Pending
          </Button>
        </div>
      )}

      {/* Bulk action confirmation dialog */}
      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
            >
              <div className="flex items-start gap-3 mb-4">
                <div className="p-2 bg-amber-50 rounded-xl text-amber-500 shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-base">Konfirmasi Bulk Action</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Apakah Anda yakin ingin {showConfirm.type === 'approve_all' ? 'menyetujui' : 'menolak'} semua pengajuan cuti berkategori <span className="font-semibold text-slate-700">Pending</span> yang ada di list saat ini?
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2.5">
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(null)}
                >
                  Batal
                </Button>
                <Button
                  className={showConfirm.type === 'approve_all' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}
                  onClick={() => bulkUpdateStatusMutation.mutate(showConfirm.type === 'approve_all' ? 'approved' : 'rejected')}
                  disabled={bulkUpdateStatusMutation.isPending}
                >
                  {bulkUpdateStatusMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Ya, Konfirmasi
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
