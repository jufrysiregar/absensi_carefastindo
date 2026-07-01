'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { QrCode as QrIcon, Download, RefreshCw, Clock, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import QRCode from 'qrcode'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface ShiftCard { id: string; name: string; start_time: string; end_time: string }
interface QRHistory { id: string; shift_name: string; generated_at: string; expires_at: string; qr_code: string }

function getShiftExpiration(startTimeStr: string, endTimeStr: string): string {
  const now = new Date()
  const [sh, sm] = startTimeStr.split(':').map(Number)
  const [eh, em] = endTimeStr.split(':').map(Number)

  const exp = new Date(now)
  exp.setHours(eh, em, 0, 0)

  if (eh < sh) {
    // Overnight shift: e.g. 23:00 - 07:00
    // If generated after 12:00 PM (noon), it expires tomorrow morning at 07:00
    if (now.getHours() >= 12) {
      exp.setDate(exp.getDate() + 1)
    }
  } else {
    // Regular shift: e.g. 07:00 - 15:00
    // If generated after shift ends, it expires tomorrow
    if (now.getHours() >= eh) {
      exp.setDate(exp.getDate() + 1)
    }
  }
  return exp.toISOString()
}

function parseUTC(dateStr: string | Date): Date {
  if (dateStr instanceof Date) return dateStr
  if (!dateStr) return new Date()
  
  let formatted = dateStr.replace(' ', 'T')
  if (!formatted.endsWith('Z') && !formatted.includes('+') && !formatted.slice(10).includes('-')) {
    formatted = formatted + 'Z'
  }
  return new Date(formatted)
}

function formatDate(dateStr: string): string {
  const date = parseUTC(dateStr)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}-${month}-${year}`
}

function formatTime(dateStr: string): string {
  const date = parseUTC(dateStr)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function formatCountdown(expiresAt: string, currentNow: number) {
  if (!currentNow) return '...'
  const diff = parseUTC(expiresAt).getTime() - currentNow
  if (diff <= 0) return 'Expired'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  const hStr = h > 0 ? `${h}j ` : ''
  return `${hStr}${m}m ${s}s`
}

export default function QRCodePage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  
  // State per shift
  const [activeQRs, setActiveQRs] = useState<Record<string, { dataUrl: string; expiresAt: string; qrCode: string }>>({})
  const [now, setNow] = useState<number>(0)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Real-time ticking for countdowns
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('qr-logs-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qr_code_logs' }, () => {
        queryClient.invalidateQueries({ queryKey: ['qrHistory'] })
        queryClient.invalidateQueries({ queryKey: ['activeQRs'] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, queryClient])

  // Get shifts
  const { data: shifts = [] } = useQuery<ShiftCard[]>({
    queryKey: ['qr-shifts'],
    queryFn: async () => {
      const { data } = await supabase.from('shifts').select('id, name, start_time, end_time').order('name')
      return data ?? []
    }
  })

  // Get active QR codes from database on load/refetch
  const { data: dbActiveQRs } = useQuery({
    queryKey: ['activeQRs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('qr_code_logs')
        .select('id, shift_id, qr_code, expires_at')
        .gt('expires_at', new Date().toISOString())
        .eq('is_active', true)
        .order('generated_at', { ascending: false })

      if (error) throw error

      // Keep only latest per shift_id
      const latest: Record<string, { qr_code: string; expires_at: string }> = {}
      for (const item of (data || [])) {
        if (!latest[item.shift_id]) {
          latest[item.shift_id] = { qr_code: item.qr_code, expires_at: item.expires_at }
        }
      }
      return latest
    }
  })

  // Render QR image data URLs when active QR codes change
  useEffect(() => {
    if (dbActiveQRs) {
      const generateURLs = async () => {
        const newQRs: Record<string, { dataUrl: string; expiresAt: string; qrCode: string }> = {}
        for (const [shiftId, item] of Object.entries(dbActiveQRs)) {
          try {
            const dataUrl = await QRCode.toDataURL(item.qr_code, {
              width: 256,
              margin: 2,
              color: { dark: '#1e293b', light: '#ffffff' }
            })
            newQRs[shiftId] = { dataUrl, expiresAt: item.expires_at, qrCode: item.qr_code }
          } catch (err) {
            console.error(err)
          }
        }
        setActiveQRs(newQRs)
      }
      generateURLs()
    } else {
      setActiveQRs({})
    }
  }, [dbActiveQRs])

  // Get QR logs
  const { data: history = [], isLoading: historyLoading } = useQuery<QRHistory[]>({
    queryKey: ['qrHistory'],
    queryFn: async () => {
      const { data } = await supabase
        .from('qr_code_logs')
        .select('id, generated_at, expires_at, qr_code, shifts(name)')
        .order('generated_at', { ascending: false })
        .limit(10)

      return (data ?? []).map((h: any) => ({
        id: h.id,
        shift_name: h.shifts?.name ?? '—',
        generated_at: h.generated_at,
        expires_at: h.expires_at,
        qr_code: h.qr_code,
      }))
    }
  })

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

      // Generate QR image
      const dataUrl = await QRCode.toDataURL(payload, {
        width: 256,
        margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' }
      })

      return { shiftId: shift.id, dataUrl, expiresAt, name: shift.name, qrCode: payload }
    },
    onSuccess: (data) => {
      // Optimistically update state
      setActiveQRs(prev => ({
        ...prev,
        [data.shiftId]: { dataUrl: data.dataUrl, expiresAt: data.expiresAt, qrCode: data.qrCode }
      }))
      toast.success('QR Code berhasil digenerate')
      queryClient.invalidateQueries({ queryKey: ['qrHistory'] })
      queryClient.invalidateQueries({ queryKey: ['activeQRs'] })
    },
    onError: (error: any) => {
      toast.error('Gagal generate QR Code')
    }
  })

  // Mutation for deleting history
  const deleteQRMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('qr_code_logs').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Riwayat berhasil dihapus')
      queryClient.invalidateQueries({ queryKey: ['qrHistory'] })
      queryClient.invalidateQueries({ queryKey: ['activeQRs'] })
    },
    onError: (error: any) => {
      toast.error('Gagal menghapus riwayat')
    }
  })

  function handleConfirmDelete(id: string) {
    setDeleteTargetId(id)
  }

  function downloadQR(dataUrl: string, shiftName: string) {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `QR_${shiftName.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.png`
    a.click()
    toast.success('QR Code berhasil didownload!')
  }

  async function downloadHistory(qrCode: string, shiftName: string) {
    const dataUrl = await QRCode.toDataURL(qrCode, { width: 256, margin: 2 })
    downloadQR(dataUrl, shiftName)
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">QR Code Generator</h1>
        <p className="text-sm text-slate-500 mt-1">Generate kode QR unik untuk absensi karyawan per shift.</p>
      </div>

      {/* Shift cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {shifts.map(shift => {
          const activeQR = activeQRs[shift.id]
          const isExpired = activeQR ? parseUTC(activeQR.expiresAt).getTime() <= now : true
          const hasQR = !!activeQR
          const isPending = generateQRMutation.isPending && generateQRMutation.variables?.id === shift.id

          return (
            <motion.div layout key={shift.id}>
              <Card className={`h-full transition-shadow hover:shadow-md ${hasQR && !isExpired ? 'border-blue-200 ring-1 ring-blue-100' : ''}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <QrIcon className={`w-4 h-4 ${hasQR && !isExpired ? 'text-blue-500' : 'text-slate-400'}`} />
                        <h3 className="font-semibold text-slate-800 text-lg">{shift.name}</h3>
                      </div>
                      <p className="text-sm text-slate-500">{shift.start_time} — {shift.end_time}</p>
                      
                      {hasQR && (
                        <div className="flex items-center gap-1.5 mt-3 text-xs bg-amber-50 text-amber-700 px-2.5 py-1 rounded-md w-fit border border-amber-100">
                          <Clock className="w-3.5 h-3.5 text-amber-500" />
                          <span>Berakhir dalam: </span>
                          <span className={isExpired ? 'text-destructive font-semibold' : 'text-amber-600 font-semibold'}>
                            {formatCountdown(activeQR.expiresAt, now)}
                          </span>
                        </div>
                      )}
                    </div>
                    <Button
                      onClick={() => generateQRMutation.mutate(shift)}
                      disabled={generateQRMutation.isPending}
                      variant={hasQR && !isExpired ? 'outline' : 'default'}
                      size="sm"
                      className="shrink-0"
                    >
                      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                      {hasQR && !isExpired ? 'Perbarui' : 'Generate'}
                    </Button>
                  </div>

                  {/* QR Preview */}
                  <AnimatePresence>
                    {hasQR && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-5 flex flex-col items-center gap-4 pt-5 border-t border-slate-100 overflow-hidden"
                      >
                        <div className="p-2 bg-white rounded-xl border border-slate-200 shadow-sm">
                          <img src={activeQR.dataUrl} alt="QR Code" className="w-48 h-48" />
                        </div>
                        <Button
                          onClick={() => downloadQR(activeQR.dataUrl, shift.name)}
                          disabled={isExpired}
                          className="w-full font-medium bg-[#3B82F6] hover:bg-[#2563EB] text-white border-0 disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <Download className="w-4 h-4 mr-2" /> Download PNG
                        </Button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </div>

      {/* History */}
      <Card className="shadow-sm overflow-hidden">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4 text-center">
          <CardTitle className="text-base flex items-center justify-center gap-2">
            Riwayat Generate QR Code (10 data terakhir)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="border-collapse w-full">
              <TableHeader className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                <TableRow className="hover:bg-transparent border-b border-[#E2E8F0]">
                  <TableHead className="text-[#475569] font-semibold py-3 border-b border-[#E2E8F0] text-center">Jenis Shift</TableHead>
                  <TableHead className="text-[#475569] font-semibold py-3 border-b border-[#E2E8F0] text-center">Tanggal Generate</TableHead>
                  <TableHead className="text-[#475569] font-semibold py-3 border-b border-[#E2E8F0] text-center">Waktu Generate</TableHead>
                  <TableHead className="text-[#475569] font-semibold py-3 border-b border-[#E2E8F0] text-center">Kadaluarsa</TableHead>
                  <TableHead className="text-[#475569] font-semibold py-3 border-b border-[#E2E8F0] text-center">Status</TableHead>
                  <TableHead className="text-[#475569] font-semibold py-3 border-b border-[#E2E8F0] text-center">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full max-w-[120px]" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : history.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-slate-400">
                      Belum ada QR code yang di-generate
                    </TableCell>
                  </TableRow>
                ) : (
                  history.map(qr => {
                    const isExpired = parseUTC(qr.expires_at) < new Date()
                    console.log('QR:', qr)
                    console.log('expires_at:', qr.expires_at)
                    console.log('isExpired:', isExpired)
                    const isRowActive = !isExpired
                    return (
                      <TableRow key={qr.id} className="bg-white border-b border-[#E2E8F0] hover:bg-slate-50/50">
                        <TableCell className="font-semibold text-slate-700 py-3 border-b border-[#E2E8F0] text-center">{qr.shift_name}</TableCell>
                        <TableCell className="text-slate-500 py-3 border-b border-[#E2E8F0] text-center">
                          {formatDate(qr.generated_at)}
                        </TableCell>
                        <TableCell className="text-slate-500 py-3 border-b border-[#E2E8F0] text-center">
                          {formatTime(qr.generated_at)}
                        </TableCell>
                        <TableCell className="text-slate-500 py-3 border-b border-[#E2E8F0] text-center">
                          {formatTime(qr.expires_at)}
                        </TableCell>
                        <TableCell className="py-3 border-b border-[#E2E8F0] text-center">
                          <div className="flex justify-center">
                            <Badge 
                              className={isRowActive 
                                ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-50" 
                                : "bg-red-50 text-red-700 border-red-200 hover:bg-red-50"
                              } 
                              variant="outline"
                            >
                              {isRowActive ? 'Active' : 'Expired'}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="py-3 border-b border-[#E2E8F0] text-center">
                          <div className="flex justify-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleConfirmDelete(qr.id)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8"
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-1" /> Hapus
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <canvas ref={canvasRef} className="hidden" />

      {/* Confirmation Modal */}
      <AnimatePresence>
        {deleteTargetId && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 border border-slate-100"
            >
              <h3 className="font-semibold text-slate-900 text-lg mb-2">Konfirmasi Hapus</h3>
              <p className="text-sm text-slate-500 mb-6">Yakin ingin menghapus riwayat QR ini?</p>
              <div className="flex justify-end gap-3">
                <Button 
                  variant="ghost" 
                  onClick={() => setDeleteTargetId(null)}
                  className="h-9 px-4 text-slate-500 hover:bg-slate-50"
                >
                  Batal
                </Button>
                <Button 
                  variant="destructive" 
                  onClick={() => {
                    deleteQRMutation.mutate(deleteTargetId)
                    setDeleteTargetId(null)
                  }}
                  className="h-9 px-4 bg-red-600 hover:bg-red-700 text-white"
                >
                  Hapus
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
