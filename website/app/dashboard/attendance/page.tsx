'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDebounce } from '@/hooks/useDebounce'
import { formatDate, formatTime } from '@/lib/utils'
import { Download, Search, X, ChevronLeft, ChevronRight, Eye } from 'lucide-react'
import * as XLSX from 'xlsx'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

import pdfMake from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'
if (typeof window !== 'undefined' && pdfFonts && (pdfFonts as any).pdfMake) {
  (pdfMake as any).vfs = (pdfFonts as any).pdfMake.vfs
}

interface AttendanceRow {
  id: string; user_name: string; shift_name: string
  date: string; check_in: string | null; check_out: string | null
  status: string; selfie_url: string | null; location: string | null; notes: string | null
}

const PAGE_SIZE = 10

export default function AttendancePage() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [filterShift, setFilterShift] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [selected, setSelected] = useState<AttendanceRow | null>(null)

  const debouncedSearch = useDebounce(search, 500)

  useEffect(() => {
    const channel = supabase
      .channel('attendance-table-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => {
        queryClient.invalidateQueries({ queryKey: ['attendance'] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, queryClient])

  const { data: shifts = [] } = useQuery({
    queryKey: ['shifts'],
    queryFn: async () => {
      const { data } = await supabase.from('shifts').select('id, name')
      return data ?? []
    }
  })

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', page, debouncedSearch, filterDate, filterShift, filterStatus],
    queryFn: async () => {
      let query = supabase
        .from('attendance')
        .select('id, status, check_in, check_out, date, selfie_url, location, notes, users(name), user_shifts(shifts(id, name))', { count: 'exact' })
        .order('date', { ascending: false })
        .order('check_in', { ascending: false })

      if (filterDate) query = query.eq('date', filterDate)
      if (filterStatus !== 'all') query = query.eq('status', filterStatus)

      const from = (page - 1) * PAGE_SIZE
      const { data, count } = await query.range(from, from + PAGE_SIZE - 1)

      let mapped = (data ?? []).map((r: any) => ({
        id: r.id,
        user_name: r.users?.name ?? '—',
        shift_name: r.user_shifts?.shifts?.name ?? '—',
        date: r.date,
        check_in: r.check_in,
        check_out: r.check_out,
        status: r.status,
        selfie_url: r.selfie_url,
        location: r.location,
        notes: r.notes,
      }))

      if (debouncedSearch) {
        mapped = mapped.filter(r => r.user_name.toLowerCase().includes(debouncedSearch.toLowerCase()))
      }
      if (filterShift !== 'all') {
        mapped = mapped.filter(r => r.shift_name === filterShift)
      }

      return { rows: mapped, total: count ?? 0 }
    },
    placeholderData: (previousData) => previousData,
  })

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  function exportExcel() {
    if (rows.length === 0) {
      toast.custom((t) => (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg text-sm flex items-center shadow-sm">
          📭 Tidak ada data untuk diekspor
        </div>
      ))
      return
    }
    const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
      Nama: r.user_name, Shift: r.shift_name, Tanggal: r.date,
      'Check-in': r.check_in ? formatTime(r.check_in) : '-',
      'Check-out': r.check_out ? formatTime(r.check_out) : '-',
      Status: r.status,
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
    XLSX.writeFile(wb, `attendance_${filterDate || 'all'}.xlsx`)
    toast.success('Excel berhasil diekspor!')
  }

  function exportPDF() {
    if (rows.length === 0) {
      toast.custom((t) => (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg text-sm flex items-center shadow-sm">
          📭 Tidak ada data untuk diekspor
        </div>
      ))
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
            widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
            body: [
              [
                { text: 'Nama', style: 'tableHeader' },
                { text: 'Shift', style: 'tableHeader' },
                { text: 'Tanggal', style: 'tableHeader' },
                { text: 'Check-in', style: 'tableHeader' },
                { text: 'Check-out', style: 'tableHeader' },
                { text: 'Status', style: 'tableHeader' }
              ],
              ...rows.map(r => [
                r.user_name,
                r.shift_name,
                r.date,
                r.check_in ? formatTime(r.check_in) : '-',
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
    pdfMake.createPdf(docDefinition).download(`attendance_${filterDate || 'all'}.pdf`)
    toast.success('PDF berhasil diekspor!')
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Data Kehadiran</h1>
          <p className="text-sm text-slate-500 mt-1">Kelola dan pantau data absensi karyawan</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportExcel} className="bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100 hover:text-emerald-700">
            <Download className="w-4 h-4 mr-2" /> Excel
          </Button>
          <Button variant="outline" onClick={exportPDF} className="bg-red-50 text-red-600 border-red-200 hover:bg-red-100 hover:text-red-700">
            <Download className="w-4 h-4 mr-2" /> PDF
          </Button>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex flex-wrap sm:flex-nowrap gap-3 flex-1">
              <Input
                type="date"
                value={filterDate}
                onChange={e => { setFilterDate(e.target.value); setPage(1) }}
                className="w-full sm:w-[160px] bg-slate-50"
              />
              <Select value={filterShift} onValueChange={v => { setFilterShift(v as string); setPage(1) }}>
                <SelectTrigger className="w-full sm:w-[160px] bg-slate-50">
                  <SelectValue placeholder="Semua Shift" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Shift</SelectItem>
                  {shifts.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={v => { setFilterStatus(v as string); setPage(1) }}>
                <SelectTrigger className="w-full sm:w-[160px] bg-slate-50">
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
              <div className="relative flex-1 md:w-[250px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1) }}
                  placeholder="Cari nama karyawan..."
                  className="pl-9 bg-slate-50 w-full"
                />
              </div>
              {(filterDate || filterStatus !== 'all' || filterShift !== 'all' || search) && (
                <Button
                  variant="ghost"
                  onClick={() => { setFilterDate(''); setFilterShift('all'); setFilterStatus('all'); setSearch(''); setPage(1) }}
                  className="px-3"
                  title="Reset Filter"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow className="hover:bg-transparent border-slate-100">
                <TableHead className="w-[50px]">No</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Check-in</TableHead>
                <TableHead>Check-out</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full max-w-[100px]" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-slate-400">
                    Tidak ada data ditemukan
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r, i) => (
                  <TableRow key={r.id} className="cursor-pointer group" onClick={() => setSelected(r)}>
                    <TableCell className="font-mono text-xs text-slate-400">{(page - 1) * PAGE_SIZE + i + 1}</TableCell>
                    <TableCell className="font-medium text-slate-700">{r.user_name}</TableCell>
                    <TableCell className="text-slate-500">{r.shift_name}</TableCell>
                    <TableCell className="text-slate-500">{formatDate(r.date)}</TableCell>
                    <TableCell className="text-slate-500">{r.check_in ? formatTime(r.check_in) : '—'}</TableCell>
                    <TableCell className="text-slate-500">{r.check_out ? formatTime(r.check_out) : '—'}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'hadir' ? 'success' : r.status === 'izin' ? 'warning' : r.status === 'sakit' ? 'destructive' : 'default'}>
                        {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-500 hover:text-blue-700 hover:bg-blue-50">
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
            Menampilkan {Math.min((page - 1) * PAGE_SIZE + 1, total || 0)} - {Math.min(page * PAGE_SIZE, total || 0)} dari {total || 0} entri
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: Math.min(5, totalPages || 1) }, (_, i) => {
              const p = i + 1
              return (
                <Button key={p} variant={page === p ? 'default' : 'outline'} size="sm" className={`h-8 w-8 ${page === p ? 'bg-blue-500' : ''}`} onClick={() => setPage(p)}>
                  {p}
                </Button>
              )
            })}
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <h3 className="font-semibold text-slate-800 text-lg">Detail Absensi</h3>
                <Button variant="ghost" size="icon" onClick={() => setSelected(null)} className="h-8 w-8 rounded-full">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="p-5 space-y-4 text-sm">
                <div className="grid grid-cols-[100px_1fr] gap-2">
                  <span className="text-slate-500">Nama</span>
                  <span className="font-medium text-slate-800">{selected.user_name}</span>
                  
                  <span className="text-slate-500">Shift</span>
                  <span className="font-medium text-slate-800">{selected.shift_name}</span>
                  
                  <span className="text-slate-500">Tanggal</span>
                  <span className="font-medium text-slate-800">{formatDate(selected.date)}</span>
                  
                  <span className="text-slate-500">Waktu</span>
                  <span className="font-medium text-slate-800">
                    {selected.check_in ? formatTime(selected.check_in) : '--:--'} s/d {selected.check_out ? formatTime(selected.check_out) : '--:--'}
                  </span>
                  
                  <span className="text-slate-500">Status</span>
                  <div>
                    <Badge variant={selected.status === 'hadir' ? 'success' : selected.status === 'izin' ? 'warning' : selected.status === 'sakit' ? 'destructive' : 'default'}>
                      {selected.status.charAt(0).toUpperCase() + selected.status.slice(1)}
                    </Badge>
                  </div>
                  
                  <span className="text-slate-500">Lokasi</span>
                  <span className="font-medium text-slate-800">{selected.location || 'Tidak ada data lokasi'}</span>
                  
                  <span className="text-slate-500">Catatan</span>
                  <span className="font-medium text-slate-800">{selected.notes || '—'}</span>
                </div>

                {selected.selfie_url && (
                  <div className="pt-2">
                    <p className="text-slate-500 mb-2">Foto Bukti / Selfie</p>
                    <div className="rounded-xl overflow-hidden border border-slate-100 bg-slate-50">
                      <img src={selected.selfie_url} alt="Selfie" className="w-full h-auto object-cover max-h-64" />
                    </div>
                  </div>
                )}
              </div>
              <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end">
                <Button onClick={() => setSelected(null)}>Tutup</Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
