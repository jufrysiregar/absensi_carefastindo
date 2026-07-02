'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FileText, Download, Calendar, Briefcase,
  Plus, Edit2, Trash2, X, Loader2, Eye, Upload, BarChart3,
  Image as ImageIcon, ChevronLeft, ChevronRight, Send, Printer
} from 'lucide-react'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

import pdfMake from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'

if (typeof window !== 'undefined' && pdfFonts && (pdfFonts as any).pdfMake) {
  (pdfMake as any).vfs = (pdfFonts as any).pdfMake.vfs
}

// ============================================================
// TYPES
// ============================================================
interface DailyReport {
  id: string
  report_date: string
  shift: string // Shift 1, 2, 3, Kantor
  title: string
  area: string
  officer_name: string
  job_description: string
  photos: string[]
  status: string // draft, transferred
  created_at: string
}

interface Contract {
  id: string
  title: string
  vendor_name: string
  start_date: string
  end_date: string
  file_url: string | null
  created_at: string
}

const SHIFTS = ['Shift 1', 'Shift 2', 'Shift 3', 'Kantor']

const MONTHS = [
  { value: '01', label: 'Januari' }, { value: '02', label: 'Februari' },
  { value: '03', label: 'Maret' },   { value: '04', label: 'April' },
  { value: '05', label: 'Mei' },     { value: '06', label: 'Juni' },
  { value: '07', label: 'Juli' },    { value: '08', label: 'Agustus' },
  { value: '09', label: 'September' },{ value: '10', label: 'Oktober' },
  { value: '11', label: 'November' },{ value: '12', label: 'Desember' },
]
const YEARS = ['2024', '2025', '2026', '2027']

const todayStr = new Date().toISOString().split('T')[0]
const currentYear = new Date().getFullYear().toString()
const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0')

// ============================================================
// SHARED BUTTON HELPERS
// ============================================================
const btnBase = 'flex items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed'

function OrangeBtn({ children, onClick, disabled, type = 'button', px = 'px-4 py-2', className = '' }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit'; px?: string; className?: string
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`${btnBase} ${px} ${className}`} style={{ background: '#F97316' }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = '#EA580C' }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = '#F97316' }}>
      {children}
    </button>
  )
}

function BlueBtn({ children, onClick, disabled, type = 'button', px = 'px-4 py-2', className = '' }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit'; px?: string; className?: string
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`${btnBase} ${px} ${className}`} style={{ background: '#3B82F6' }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = '#2563EB' }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = '#3B82F6' }}>
      {children}
    </button>
  )
}

function NeutralBtn({ children, onClick, type = 'button' }: {
  children: React.ReactNode; onClick?: () => void; type?: 'button' | 'submit'
}) {
  return (
    <button type={type} onClick={onClick}
      className={`${btnBase} px-4 py-2`} style={{ background: '#94A3B8' }}
      onMouseEnter={e => (e.currentTarget.style.background = '#64748B')}
      onMouseLeave={e => (e.currentTarget.style.background = '#94A3B8')}>
      {children}
    </button>
  )
}

function EditIconBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} title="Edit" disabled={disabled}
      className="w-8 h-8 flex items-center justify-center rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      style={{ color: '#3B82F6' }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = '#EFF6FF' }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = 'transparent' }}>
      <Edit2 className="w-4 h-4" />
    </button>
  )
}

function DeleteIconBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} title="Hapus" disabled={disabled}
      className="w-8 h-8 flex items-center justify-center rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      style={{ color: '#EF4444' }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = '#FEF2F2' }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = 'transparent' }}>
      <Trash2 className="w-4 h-4" />
    </button>
  )
}

// ============================================================
// MODAL WRAPPER
// ============================================================
function Modal({ open, onClose, title, icon, children }: {
  open: boolean; onClose: () => void; title: string; icon?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="bg-white rounded-3xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto relative z-10 p-6 space-y-5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {icon}
                <h3 className="font-bold text-[#1E293B] text-lg">{title}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

// ============================================================
// PHOTO LIGHTBOX MODAL
// ============================================================
function PhotoLightbox({ photos, initialIndex, onClose }: {
  photos: string[]; initialIndex: number; onClose: () => void
}) {
  const [idx, setIdx] = useState(initialIndex)
  if (!photos.length) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div className="relative flex items-center gap-4" onClick={e => e.stopPropagation()}>
        {photos.length > 1 && (
          <button onClick={() => setIdx(i => Math.max(0, i - 1))}
            className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center text-white transition-all disabled:opacity-20"
            disabled={idx === 0}>
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        <div className="flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[idx]} alt={`Foto ${idx + 1}`}
            className="max-w-[80vw] max-h-[75vh] object-contain rounded-xl shadow-2xl" />
          {photos.length > 1 && (
            <span className="text-white/70 text-sm">{idx + 1} / {photos.length}</span>
          )}
        </div>
        {photos.length > 1 && (
          <button onClick={() => setIdx(i => Math.min(photos.length - 1, i + 1))}
            className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center text-white transition-all disabled:opacity-20"
            disabled={idx === photos.length - 1}>
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
        <button onClick={onClose}
          className="absolute -top-4 -right-4 w-8 h-8 rounded-full bg-white/20 hover:bg-red-500 flex items-center justify-center text-white transition-all">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ============================================================
// PDF GENERATION FUNCTIONS
// ============================================================
function generateSingleReportPDF(report: DailyReport, action: 'open' | 'print') {
  const docDefinition: any = {
    content: [
      { text: 'LAPORAN DETAIL PEKERJAAN', style: 'header' },
      { text: `Digenerate: ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}`, style: 'sub' },
      { text: '\n' },
      {
        table: {
          widths: ['30%', '70%'],
          body: [
            [{ text: 'Judul Laporan', bold: true }, report.title],
            [{ text: 'Shift', bold: true }, report.shift],
            [{ text: 'Area', bold: true }, report.area],
            [{ text: 'Nama Petugas', bold: true }, report.officer_name],
            [{ text: 'Tanggal', bold: true }, new Date(report.report_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })],
            [{ text: 'Keterangan Pekerjaan', bold: true }, report.job_description],
          ]
        },
        layout: {
          hLineWidth: () => 0.5, vLineWidth: () => 0.5,
          hLineColor: () => '#E2E8F0', vLineColor: () => '#E2E8F0',
        }
      },
      { text: '\n\nFoto Bukti Pekerjaan:', style: 'sectionHeader' },
      report.photos && report.photos.length > 0
        ? { text: `${report.photos.length} foto terlampir di sistem online.`, style: 'info' }
        : { text: 'Tidak ada foto terlampir.', style: 'info' }
    ],
    styles: {
      header: { fontSize: 16, bold: true, color: '#0F172A' },
      sub: { fontSize: 9, italics: true, color: '#475569' },
      sectionHeader: { fontSize: 12, bold: true, color: '#0F172A', margin: [0, 10, 0, 5] },
      info: { fontSize: 10, color: '#334155' }
    },
    defaultStyle: { fontSize: 10, color: '#334155' }
  }

  const pdfDoc = pdfMake.createPdf(docDefinition)
  if (action === 'open') {
    pdfDoc.open()
  } else {
    pdfDoc.print()
  }
}

function generateRekapPDF(reports: DailyReport[], title: string, filename: string) {
  if (!reports.length) { toast.error('Tidak ada data untuk dicetak'); return }
  const docDefinition: any = {
    pageOrientation: 'landscape',
    content: [
      { text: title, style: 'header' },
      { text: `Digenerate: ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}`, style: 'sub' },
      {
        style: 'tbl',
        table: {
          headerRows: 1,
          widths: ['*', 'auto', 'auto', 'auto', 'auto', '*'],
          body: [
            ['Judul', 'Shift', 'Area', 'Petugas', 'Tanggal', 'Keterangan'].map(h => ({
              text: h, style: 'th', fillColor: '#F97316', color: 'white'
            })),
            ...reports.map(r => [
              r.title, r.shift, r.area, r.officer_name,
              new Date(r.report_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
              r.job_description
            ])
          ]
        },
        layout: {
          hLineWidth: () => 0.5, vLineWidth: () => 0.5,
          hLineColor: () => '#E2E8F0', vLineColor: () => '#E2E8F0',
          paddingLeft: () => 8, paddingRight: () => 8,
          paddingTop: () => 6, paddingBottom: () => 6,
        }
      }
    ],
    styles: {
      header: { fontSize: 16, bold: true, color: '#0F172A' },
      sub: { fontSize: 9, italics: true, color: '#475569' },
      tbl: { margin: [0, 5, 0, 15] },
      th: { bold: true, fontSize: 10 }
    },
    defaultStyle: { fontSize: 9, color: '#334155' }
  }
  pdfMake.createPdf(docDefinition).download(`${filename}.pdf`)
  toast.success('Rekap PDF berhasil diunduh!')
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function ReportsPage() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const photoInputRef = useRef<HTMLInputElement>(null)
  const contractFileRef = useRef<HTMLInputElement>(null)

  const [activeTab, setActiveTab] = useState<'harian' | 'vendor' | 'kontrak'>('harian')

  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmText?: string;
    confirmBg?: string;
    onConfirm: () => void;
  }>({
    open: false,
    title: '',
    description: '',
    confirmText: 'Konfirmasi',
    confirmBg: '#F97316',
    onConfirm: () => {},
  })

  // ---- Tab 1: Daily Report State ----
  const [dailyFilterType, setDailyFilterType] = useState<'harian' | 'bulanan' | 'tahunan'>('harian')
  const [dailyFilterDate, setDailyFilterDate] = useState(todayStr)
  const [dailyFilterMonth, setDailyFilterMonth] = useState(`${currentYear}-${currentMonth}`)
  const [dailyFilterYear, setDailyFilterYear] = useState(currentYear)
  const [dailyFilterShift, setDailyFilterShift] = useState<string>('all')

  const [showDailyForm, setShowDailyForm] = useState(false)
  const [editingDaily, setEditingDaily] = useState<DailyReport | null>(null)
  const [dailyForm, setDailyForm] = useState({
    title: '', area: '', officer_name: '', job_description: '', report_date: todayStr, shift: 'Shift 1',
  })
  const [tempPhotos, setTempPhotos] = useState<{ file?: File; url: string }[]>([])
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [lightboxPhotos, setLightboxPhotos] = useState<string[] | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  // ---- Tab 2: Vendor Report State ----
  const [vendorFilterType, setVendorFilterType] = useState<'harian' | 'bulanan' | 'tahunan'>('bulanan')
  const [vendorFilterDate, setVendorFilterDate] = useState(todayStr)
  const [vendorFilterMonth, setVendorFilterMonth] = useState(`${currentYear}-${currentMonth}`)
  const [vendorFilterYear, setVendorFilterYear] = useState(currentYear)
  const [vendorFilterShift, setVendorFilterShift] = useState<string>('all')

  // ---- Tab 3: Contract State ----
  const [showContractModal, setShowContractModal] = useState(false)
  const [editingContract, setEditingContract] = useState<Contract | null>(null)
  const [contractForm, setContractForm] = useState({
    title: '', vendor_name: '', start_date: '', end_date: '',
  })
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [uploadingContract, setUploadingContract] = useState(false)

  // ============================================================
  // DATA FETCHING
  // ============================================================
  const { data: dailyReports = [], isLoading: dailyLoading } = useQuery<DailyReport[]>({
    queryKey: ['daily_reports', dailyFilterType, dailyFilterDate, dailyFilterMonth, dailyFilterYear, dailyFilterShift],
    queryFn: async () => {
      let q = supabase.from('daily_reports').select('*')

      if (dailyFilterType === 'harian') {
        if (dailyFilterDate) q = q.eq('report_date', dailyFilterDate)
      } else if (dailyFilterType === 'bulanan') {
        const [year, month] = dailyFilterMonth.split('-')
        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
        q = q.gte('report_date', `${year}-${month}-01`).lte('report_date', `${year}-${month}-${String(lastDay).padStart(2, '0')}`)
      } else if (dailyFilterType === 'tahunan') {
        q = q.gte('report_date', `${dailyFilterYear}-01-01`).lte('report_date', `${dailyFilterYear}-12-31`)
      }

      if (dailyFilterShift !== 'all') {
        q = q.eq('shift', dailyFilterShift)
      }

      const { data, error } = await q.order('report_date', { ascending: false })
      if (error) throw error
      return data || []
    }
  })

  const { data: vendorData = [], isLoading: vendorLoading } = useQuery<DailyReport[]>({
    queryKey: ['vendor_report', vendorFilterType, vendorFilterDate, vendorFilterMonth, vendorFilterYear, vendorFilterShift],
    queryFn: async () => {
      let q = supabase.from('daily_reports').select('*').eq('status', 'transferred')

      if (vendorFilterType === 'harian') {
        if (vendorFilterDate) q = q.eq('report_date', vendorFilterDate)
      } else if (vendorFilterType === 'bulanan') {
        const [year, month] = vendorFilterMonth.split('-')
        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
        q = q.gte('report_date', `${year}-${month}-01`).lte('report_date', `${year}-${month}-${String(lastDay).padStart(2, '0')}`)
      } else if (vendorFilterType === 'tahunan') {
        q = q.gte('report_date', `${vendorFilterYear}-01-01`).lte('report_date', `${vendorFilterYear}-12-31`)
      }

      if (vendorFilterShift !== 'all') {
        q = q.eq('shift', vendorFilterShift)
      }

      const { data, error } = await q.order('report_date', { ascending: false })
      if (error) throw error
      return data || []
    }
  })

  const { data: contracts = [], isLoading: contractsLoading } = useQuery<Contract[]>({
    queryKey: ['contracts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contracts').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    }
  })

  // ============================================================
  // MUTATIONS
  // ============================================================
  const saveDailyMutation = useMutation({
    mutationFn: async (payload: typeof dailyForm & { id?: string; photos?: string[] }) => {
      const body = {
        title: payload.title, area: payload.area, shift: payload.shift,
        officer_name: payload.officer_name, job_description: payload.job_description,
        report_date: payload.report_date,
        ...(payload.photos !== undefined ? { photos: payload.photos } : {}),
        updated_at: new Date().toISOString(),
      }
      if (payload.id) {
        const { error } = await supabase.from('daily_reports').update(body).eq('id', payload.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('daily_reports').insert({ ...body, status: 'draft', photos: payload.photos || [] })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editingDaily ? 'Laporan berhasil diupdate!' : 'Laporan berhasil disimpan!')
      queryClient.invalidateQueries({ queryKey: ['daily_reports'] })
      resetDailyForm()
    },
    onError: (e: any) => toast.error('Gagal menyimpan: ' + e.message)
  })

  const transferDailyMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('daily_reports').update({ status: 'transferred' }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Laporan berhasil ditransfer ke Vendor!')
      queryClient.invalidateQueries({ queryKey: ['daily_reports'] })
      queryClient.invalidateQueries({ queryKey: ['vendor_report'] })
    },
    onError: (e: any) => toast.error('Gagal mentransfer: ' + e.message)
  })

  const deleteDailyMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('daily_reports').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Laporan dihapus')
      queryClient.invalidateQueries({ queryKey: ['daily_reports'] })
      queryClient.invalidateQueries({ queryKey: ['vendor_report'] })
    },
    onError: (e: any) => toast.error('Gagal menghapus: ' + e.message)
  })

  const saveContractMutation = useMutation({
    mutationFn: async (payload: typeof contractForm & { id?: string; file_url?: string | null }) => {
      const body: any = {
        title: payload.title, vendor_name: payload.vendor_name,
        start_date: payload.start_date, end_date: payload.end_date,
        updated_at: new Date().toISOString(),
      }
      if (payload.file_url !== undefined) body.file_url = payload.file_url
      if (payload.id) {
        const { error } = await supabase.from('contracts').update(body).eq('id', payload.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('contracts').insert({ ...body, file_url: payload.file_url || null })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(editingContract ? 'Kontrak berhasil diupdate!' : 'Kontrak berhasil disimpan!')
      queryClient.invalidateQueries({ queryKey: ['contracts'] })
      resetContractForm()
    },
    onError: (e: any) => toast.error('Gagal menyimpan: ' + e.message)
  })

  const deleteContractMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contracts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Kontrak dihapus')
      queryClient.invalidateQueries({ queryKey: ['contracts'] })
    },
    onError: (e: any) => toast.error('Gagal menghapus: ' + e.message)
  })

  // ============================================================
  // EVENT HANDLERS
  // ============================================================
  function askConfirmation({ title, description, confirmText = 'Konfirmasi', confirmBg = '#F97316', onConfirm }: {
    title: string; description: string; confirmText?: string; confirmBg?: string; onConfirm: () => void
  }) {
    setConfirmModal({
      open: true,
      title,
      description,
      confirmText,
      confirmBg,
      onConfirm: () => {
        onConfirm()
        setConfirmModal(prev => ({ ...prev, open: false }))
      }
    })
  }

  function resetDailyForm() {
    setDailyForm({ title: '', area: '', officer_name: '', job_description: '', report_date: todayStr, shift: 'Shift 1' })
    setEditingDaily(null)
    setTempPhotos([])
    setShowDailyForm(false)
  }

  function resetContractForm() {
    setContractForm({ title: '', vendor_name: '', start_date: '', end_date: '' })
    setEditingContract(null)
    setContractFile(null)
    setShowContractModal(false)
  }

  function openAddDaily() {
    setEditingDaily(null)
    setDailyForm({
      title: '', area: '', officer_name: '', job_description: '',
      report_date: dailyFilterType === 'harian' ? dailyFilterDate : todayStr,
      shift: dailyFilterShift !== 'all' ? dailyFilterShift : 'Shift 1'
    })
    setTempPhotos([])
    setShowDailyForm(true)
  }

  function openEditDaily(report: DailyReport) {
    setEditingDaily(report)
    setDailyForm({
      title: report.title, area: report.area, shift: report.shift,
      officer_name: report.officer_name, job_description: report.job_description,
      report_date: report.report_date,
    })
    setTempPhotos((report.photos || []).map(url => ({ url })))
    setShowDailyForm(true)
  }

  function openEditContract(contract: Contract) {
    setEditingContract(contract)
    setContractForm({
      title: contract.title,
      vendor_name: contract.vendor_name,
      start_date: contract.start_date,
      end_date: contract.end_date,
    })
    setContractFile(null)
    setShowContractModal(true)
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    const newItems = files.map(file => ({
      file,
      url: URL.createObjectURL(file)
    }))
    setTempPhotos(prev => [...prev, ...newItems])
  }

  function handleRemovePhoto(index: number) {
    setTempPhotos(prev => {
      const copy = [...prev]
      const removed = copy.splice(index, 1)[0]
      if (removed.file) {
        URL.revokeObjectURL(removed.url)
      }
      return copy
    })
  }

  async function handleDailySubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dailyForm.title || !dailyForm.area || !dailyForm.officer_name || !dailyForm.job_description || !dailyForm.shift) {
      toast.error('Semua field wajib diisi'); return
    }

    setUploadingPhotos(true)
    let finalUrls: string[] = []

    try {
      for (const item of tempPhotos) {
        if (item.file) {
          const ext = item.file.name.split('.').pop()
          const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
          const { error } = await supabase.storage.from('report-photos').upload(filename, item.file, { upsert: true })
          if (error) throw error
          const { data: urlData } = supabase.storage.from('report-photos').getPublicUrl(filename)
          finalUrls.push(urlData.publicUrl)
        } else {
          finalUrls.push(item.url)
        }
      }
    } catch (err: any) {
      toast.error('Gagal upload foto: ' + err.message)
      setUploadingPhotos(false)
      return
    }

    setUploadingPhotos(false)
    saveDailyMutation.mutate({ ...dailyForm, id: editingDaily?.id, photos: finalUrls })
  }

  async function handleContractSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!contractForm.title || !contractForm.vendor_name || !contractForm.start_date || !contractForm.end_date) {
      toast.error('Semua field wajib diisi'); return
    }
    if (!editingContract && !contractFile) {
      toast.error('Wajib mengunggah file kontrak PDF'); return
    }

    setUploadingContract(true)
    let file_url: string | null | undefined = editingContract?.file_url

    if (contractFile) {
      try {
        const ext = contractFile.name.split('.').pop()
        const filename = `${Date.now()}_${contractForm.title.replace(/\s+/g, '_')}.${ext}`
        const { error: uploadErr } = await supabase.storage.from('contracts').upload(filename, contractFile, { upsert: true })
        if (uploadErr) throw uploadErr
        const { data: urlData } = supabase.storage.from('contracts').getPublicUrl(filename)
        file_url = urlData.publicUrl
      } catch (err: any) {
        toast.error('Gagal upload file: ' + err.message)
        setUploadingContract(false)
        return
      }
    }

    setUploadingContract(false)
    saveContractMutation.mutate({ ...contractForm, id: editingContract?.id, file_url })
  }

  const isSavingDaily = saveDailyMutation.isPending || uploadingPhotos
  const isSavingContract = saveContractMutation.isPending || uploadingContract

  const tabConfig = [
    { key: 'harian' as const, label: 'Laporan Harian', icon: Calendar },
    { key: 'vendor' as const, label: 'Laporan Vendor', icon: BarChart3 },
    { key: 'kontrak' as const, label: 'Kontrak Kerja', icon: Briefcase },
  ]

  return (
    <>
      {/* ===================== LIGHTBOX ===================== */}
      {lightboxPhotos && (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxPhotos(null)}
        />
      )}

      {/* ===================== CUSTOM CONFIRMATION MODAL ===================== */}
      <Modal
        open={confirmModal.open}
        onClose={() => setConfirmModal(prev => ({ ...prev, open: false }))}
        title={confirmModal.title}
        icon={<span className="text-xl">⚠️</span>}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed">{confirmModal.description}</p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={confirmModal.onConfirm}
              className="flex-1 py-2.5 rounded-xl text-white font-semibold transition-all shadow-sm"
              style={{ background: confirmModal.confirmBg }}
              onMouseEnter={e => {
                e.currentTarget.style.filter = 'brightness(0.9)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.filter = 'none'
              }}
            >
              {confirmModal.confirmText}
            </button>
            <button
              onClick={() => setConfirmModal(prev => ({ ...prev, open: false }))}
              className="flex-1 py-2.5 rounded-xl text-white font-semibold transition-all bg-[#94A3B8] hover:bg-slate-500 shadow-sm"
            >
              Batal
            </button>
          </div>
        </div>
      </Modal>



      {/* ===================== MODAL: KONTRAK KERJA ===================== */}
      <Modal
        open={showContractModal}
        onClose={resetContractForm}
        title={editingContract ? 'Edit Kontrak Kerja' : 'Upload Kontrak Kerja'}
        icon={editingContract ? <span className="text-xl">✏️</span> : <span className="text-xl">📤</span>}
      >
        <form onSubmit={handleContractSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ct-title" className="text-xs font-semibold text-slate-600">Judul Kontrak <span className="text-red-500">*</span></Label>
            <Input id="ct-title" value={contractForm.title} onChange={e => setContractForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Contoh: Kontrak Kerja 2026" className="bg-slate-50 h-9" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-vendor" className="text-xs font-semibold text-slate-600">Nama Vendor <span className="text-red-500">*</span></Label>
            <Input id="ct-vendor" value={contractForm.vendor_name} onChange={e => setContractForm(f => ({ ...f, vendor_name: e.target.value }))} className="bg-slate-50 h-9" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ct-start" className="text-xs font-semibold text-slate-600">Tanggal Mulai <span className="text-red-500">*</span></Label>
              <Input id="ct-start" type="date" value={contractForm.start_date}
                onChange={e => setContractForm(f => ({ ...f, start_date: e.target.value }))} className="bg-slate-50 h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-end" className="text-xs font-semibold text-slate-600">Tanggal Berakhir <span className="text-red-500">*</span></Label>
              <Input id="ct-end" type="date" value={contractForm.end_date}
                onChange={e => setContractForm(f => ({ ...f, end_date: e.target.value }))} className="bg-slate-50 h-9" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-600">
              Upload File PDF {!editingContract && <span className="text-red-500">*</span>}
              {editingContract && <span className="text-xs text-slate-400 ml-1">(kosongkan jika tidak diganti)</span>}
            </Label>
            <div className="border-2 border-dashed border-blue-200 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/10 transition-all"
              onClick={() => contractFileRef.current?.click()}>
              {contractFile ? (
                <div className="flex items-center justify-center gap-2 text-sm font-medium" style={{ color: '#3B82F6' }}>
                  <FileText className="w-4 h-4" /> {contractFile.name}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5">
                  <Upload className="w-5 h-5 text-slate-300" />
                  <span className="text-sm text-slate-400">
                    {editingContract?.file_url ? 'Sudah ada file. Klik untuk ganti.' : 'Klik untuk pilih file PDF'}
                  </span>
                </div>
              )}
            </div>
            <input ref={contractFileRef} type="file" accept=".pdf" className="hidden"
              onChange={e => setContractFile(e.target.files?.[0] || null)} />
          </div>
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSavingContract}
              className="w-full py-2.5 rounded-xl text-white font-semibold transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#3B82F6' }}
              onMouseEnter={e => { if (!isSavingContract) e.currentTarget.style.background = '#2563EB' }}
              onMouseLeave={e => { if (!isSavingContract) e.currentTarget.style.background = '#3B82F6' }}
            >
              {isSavingContract && <Loader2 className="w-4 h-4 animate-spin" />}
              Simpan
            </button>
          </div>
        </form>
      </Modal>

      {/* ===================== MAIN PAGE ===================== */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Laporan</h1>
          <p className="text-sm text-[#475569] mt-1">Kelola laporan harian, vendor, dan kontrak kerja.</p>
        </div>

        {/* Tabs */}
        <div className="border-b border-slate-200">
          <div className="flex">
            {tabConfig.map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => setActiveTab(key)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all duration-150 ${
                  activeTab === key
                    ? 'border-[#F97316] text-[#F97316]'
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
                }`}>
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>
        </div>

        {/* ============ TAB 1: LAPORAN HARIAN ============ */}
        {activeTab === 'harian' && (
          <div className="space-y-6">
            <AnimatePresence>
              {showDailyForm && (
                <motion.div
                  key="daily-form"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <Card className="shadow-sm border border-slate-100 rounded-xl overflow-hidden bg-white">
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                      <h3 className="font-bold text-[#0F172A] text-base">
                        {editingDaily ? 'Edit Laporan Harian' : 'Tambah Laporan Harian'}
                      </h3>
                      <button onClick={resetDailyForm} className="text-slate-400 hover:text-slate-600">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <CardContent className="p-6">
                      <form onSubmit={handleDailySubmit} className="space-y-4">
                        {/* Row 1: Tanggal & Shift */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="dr-date">Tanggal <span className="text-red-500">*</span></Label>
                            <Input
                              id="dr-date"
                              type="date"
                              value={dailyForm.report_date}
                              onChange={e => setDailyForm(f => ({ ...f, report_date: e.target.value }))}
                              className="bg-white h-9"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="dr-shift">Shift <span className="text-red-500">*</span></Label>
                            <Select
                              value={dailyForm.shift}
                              onValueChange={v => v && setDailyForm(f => ({ ...f, shift: v }))}
                            >
                              <SelectTrigger id="dr-shift" className="bg-white h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SHIFTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {/* Row 2: Judul & Area */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <Label htmlFor="dr-title">Judul <span className="text-red-500">*</span></Label>
                            <Input
                              id="dr-title"
                              value={dailyForm.title}
                              onChange={e => setDailyForm(f => ({ ...f, title: e.target.value }))}
                              placeholder="Contoh: Pembersihan Lobi Utama"
                              className="bg-white h-9"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="dr-area">Area <span className="text-red-500">*</span></Label>
                            <Input
                              id="dr-area"
                              value={dailyForm.area}
                              onChange={e => setDailyForm(f => ({ ...f, area: e.target.value }))}
                              placeholder="Contoh: Gedung A, Lantai 1"
                              className="bg-white h-9"
                            />
                          </div>
                        </div>

                        {/* Nama Petugas */}
                        <div className="space-y-1.5">
                          <Label htmlFor="dr-officer">Nama Petugas <span className="text-red-500">*</span></Label>
                          <Input
                            id="dr-officer"
                            value={dailyForm.officer_name}
                            onChange={e => setDailyForm(f => ({ ...f, officer_name: e.target.value }))}
                            placeholder="Nama lengkap petugas"
                            className="bg-white h-9 w-full"
                          />
                        </div>

                        {/* Keterangan Pekerjaan */}
                        <div className="space-y-1.5">
                          <Label htmlFor="dr-job">Keterangan Pekerjaan <span className="text-red-500">*</span></Label>
                          <Textarea
                            id="dr-job"
                            value={dailyForm.job_description}
                            onChange={e => setDailyForm(f => ({ ...f, job_description: e.target.value }))}
                            placeholder="Deskripsi pekerjaan yang dilakukan..."
                            rows={4}
                            className="bg-white resize-none"
                          />
                        </div>

                        {/* Upload Foto & Preview */}
                        <div className="space-y-2">
                          <Label>Upload Foto (opsional, bisa banyak)</Label>
                          <div
                            className="border-2 border-dashed border-slate-200 rounded-lg p-5 text-center cursor-pointer hover:border-orange-300 hover:bg-orange-50/10 transition-all"
                            onClick={() => photoInputRef.current?.click()}
                          >
                            <div className="flex flex-col items-center gap-1.5">
                              <Upload className="w-5 h-5 text-slate-400" />
                              <span className="text-sm text-slate-500">Klik untuk pilih foto</span>
                            </div>
                          </div>
                          <input
                            ref={photoInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={handlePhotoChange}
                          />

                          {/* Thumbnail preview area */}
                          <div className="mt-3 p-4 border border-slate-100 rounded-lg bg-slate-50/40">
                            {tempPhotos.length === 0 ? (
                              <span className="text-xs text-slate-400">Belum ada foto yang dipilih</span>
                            ) : (
                              <div className="flex flex-wrap gap-3">
                                {tempPhotos.map((photo, i) => (
                                  <div key={i} className="relative w-20 h-20">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={photo.url}
                                      alt={`preview-${i}`}
                                      className="w-20 h-20 object-cover rounded-lg border border-slate-200 shadow-sm"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleRemovePhoto(i)}
                                      className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold shadow hover:bg-red-600 transition-all"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3 pt-3 border-t border-slate-100 mt-2">
                          <OrangeBtn type="submit" disabled={isSavingDaily}>
                            {isSavingDaily ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                            Simpan Laporan
                          </OrangeBtn>
                          <NeutralBtn onClick={resetDailyForm}>
                            Batal
                          </NeutralBtn>
                        </div>
                      </form>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            <Card className="shadow-sm border border-slate-100 rounded-xl overflow-hidden bg-white">
            {/* Header + Filters */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-[#0F172A] text-base">Daftar Laporan Harian</h3>
                  <OrangeBtn onClick={openAddDaily} px="px-3 py-1.5">
                    <Plus className="w-3.5 h-3.5" /> <span className="text-xs">Tambah Laporan</span>
                  </OrangeBtn>
                </div>

                <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-slate-100/60">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400 font-medium">Tipe Filter</Label>
                    <Select value={dailyFilterType} onValueChange={v => v && setDailyFilterType(v as any)}>
                      <SelectTrigger className="w-[120px] bg-white h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="harian">Harian</SelectItem>
                        <SelectItem value="bulanan">Bulanan</SelectItem>
                        <SelectItem value="tahunan">Tahunan</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {dailyFilterType === 'harian' && (
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-400 font-medium">Tanggal</Label>
                      <Input type="date" value={dailyFilterDate} onChange={e => setDailyFilterDate(e.target.value)} className="w-[150px] h-9 bg-white text-xs" />
                    </div>
                  )}

                  {dailyFilterType === 'bulanan' && (
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-400 font-medium">Bulan</Label>
                      <Input type="month" value={dailyFilterMonth} onChange={e => setDailyFilterMonth(e.target.value)} className="w-[160px] h-9 bg-white text-xs" />
                    </div>
                  )}

                  {dailyFilterType === 'tahunan' && (
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-400 font-medium">Tahun</Label>
                      <Select value={dailyFilterYear} onValueChange={v => v && setDailyFilterYear(v)}>
                        <SelectTrigger className="w-[110px] bg-white h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{YEARS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400 font-medium">Shift</Label>
                    <Select value={dailyFilterShift} onValueChange={v => v && setDailyFilterShift(v)}>
                      <SelectTrigger className="w-[120px] bg-white h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Semua Shift</SelectItem>
                        {SHIFTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex-1" />

                  {/* Print PDF Rekap - OREN */}
                  <OrangeBtn onClick={() => generateRekapPDF(dailyReports, 'REKAP LAPORAN HARIAN', `Rekap_Harian_${todayStr}`)} px="px-3 py-1.5" className="h-9">
                    <Printer className="w-3.5 h-3.5" /> <span className="text-xs">Print PDF</span>
                  </OrangeBtn>
                </div>
              </div>
            </div>

            <CardContent className="p-0">
              <div className="overflow-hidden">
                <Table>
                  <TableHeader style={{ background: '#F8FAFC' }}>
                    <TableRow className="hover:bg-transparent border-b border-slate-100">
                      <TableHead className="font-semibold pl-6" style={{ color: '#475569', padding: '12px 16px' }}>Judul</TableHead>
                      <TableHead className="font-semibold text-center" style={{ color: '#475569', padding: '12px 16px' }}>Shift</TableHead>
                      <TableHead className="font-semibold text-center" style={{ color: '#475569', padding: '12px 16px' }}>Area</TableHead>
                      <TableHead className="font-semibold text-center" style={{ color: '#475569', padding: '12px 16px' }}>Petugas</TableHead>
                      <TableHead className="font-semibold text-center" style={{ color: '#475569', padding: '12px 16px' }}>Tanggal</TableHead>
                      <TableHead className="font-semibold text-center" style={{ color: '#475569', padding: '12px 16px' }}>Foto</TableHead>
                      <TableHead className="font-semibold text-center pr-6" style={{ color: '#475569', padding: '12px 16px' }}>Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailyLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 7 }).map((_, j) => (
                            <TableCell key={j} style={{ padding: '12px 16px' }}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : dailyReports.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-14" style={{ color: '#94A3B8' }}>
                          <div className="flex flex-col items-center gap-2">
                            <FileText className="w-9 h-9 text-slate-200" />
                            <span className="text-sm font-medium">Belum ada laporan harian</span>
                            <span className="text-xs text-slate-400">Silakan sesuaikan filter atau klik "+ Tambah Laporan"</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      dailyReports.map(report => {
                        const isTransferred = report.status === 'transferred'
                        return (
                          <TableRow key={report.id} className="border-b border-slate-50 hover:bg-slate-50/40">
                            <TableCell className="pl-6" style={{ padding: '12px 16px' }}>
                              <div className="font-medium text-[#0F172A]">{report.title}</div>
                              <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{report.job_description}</div>
                            </TableCell>
                            <TableCell className="text-center" style={{ color: '#334155', padding: '12px 16px' }}>
                              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-semibold">
                                {report.shift}
                              </span>
                            </TableCell>
                            <TableCell className="text-center" style={{ color: '#334155', padding: '12px 16px' }}>{report.area}</TableCell>
                            <TableCell className="text-center" style={{ color: '#334155', padding: '12px 16px' }}>{report.officer_name}</TableCell>
                            <TableCell className="text-center whitespace-nowrap" style={{ color: '#334155', padding: '12px 16px' }}>
                              {new Date(report.report_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </TableCell>
                            <TableCell className="text-center" style={{ padding: '12px 16px' }}>
                              {report.photos && report.photos.length > 0 ? (
                                <div className="flex items-center justify-center gap-1">
                                  {report.photos.slice(0, 2).map((url, i) => (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img key={i} src={url} alt={`foto ${i + 1}`}
                                      className="w-8 h-8 rounded object-cover cursor-pointer hover:opacity-80 transition-opacity ring-1 ring-slate-200"
                                      onClick={() => { setLightboxPhotos(report.photos); setLightboxIndex(i) }} />
                                  ))}
                                  {report.photos.length > 2 && (
                                    <button className="w-8 h-8 rounded bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center hover:bg-slate-200 transition-all"
                                      onClick={() => { setLightboxPhotos(report.photos); setLightboxIndex(2) }}>
                                      +{report.photos.length - 2}
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-slate-300">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center pr-6" style={{ padding: '12px 16px' }}>
                              <div className="flex items-center justify-center gap-1">
                                {isTransferred ? (
                                  <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded-full font-semibold">
                                    Transferred
                                  </span>
                                ) : (
                                  <>
                                    <EditIconBtn onClick={() => openEditDaily(report)} />
                                    <DeleteIconBtn onClick={() => askConfirmation({
                                      title: 'Hapus Laporan Harian',
                                      description: 'Apakah Anda yakin ingin menghapus laporan harian ini? Tindakan ini tidak dapat dibatalkan.',
                                      confirmText: 'Hapus',
                                      confirmBg: '#EF4444',
                                      onConfirm: () => deleteDailyMutation.mutate(report.id)
                                    })} />
                                    <OrangeBtn onClick={() => askConfirmation({
                                      title: 'Transfer ke Vendor',
                                      description: 'Kirim laporan ini ke Vendor? Setelah dikirim, laporan tidak bisa diubah atau dihapus lagi.',
                                      confirmText: 'Transfer',
                                      confirmBg: '#F97316',
                                      onConfirm: () => transferDailyMutation.mutate(report.id)
                                    })}
                                      px="px-2.5 py-1" className="h-8 text-xs">
                                      <Send className="w-3 h-3" /> Transfer
                                    </OrangeBtn>
                                  </>
                                )}
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
        </div>
      )}

        {/* ============ TAB 2: LAPORAN VENDOR ============ */}
        {activeTab === 'vendor' && (
          <Card className="shadow-sm border border-slate-100 rounded-xl overflow-hidden bg-white">
            {/* Header + Filters */}
            <div className="px-6 pt-5 pb-4 border-b border-slate-100 bg-slate-50/50">
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="font-semibold text-[#0F172A] text-base">Laporan Vendor</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Menerima rekap laporan yang sudah ditransfer dari Laporan Harian</p>
                </div>

                <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-slate-100/60">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400 font-medium">Tipe Filter</Label>
                    <Select value={vendorFilterType} onValueChange={v => v && setVendorFilterType(v as any)}>
                      <SelectTrigger className="w-[120px] bg-white h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="harian">Harian</SelectItem>
                        <SelectItem value="bulanan">Bulanan</SelectItem>
                        <SelectItem value="tahunan">Tahunan</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {vendorFilterType === 'harian' && (
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-400 font-medium">Tanggal</Label>
                      <Input type="date" value={vendorFilterDate} onChange={e => setVendorFilterDate(e.target.value)} className="w-[150px] h-9 bg-white text-xs" />
                    </div>
                  )}

                  {vendorFilterType === 'bulanan' && (
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-400 font-medium">Bulan</Label>
                      <Input type="month" value={vendorFilterMonth} onChange={e => setVendorFilterMonth(e.target.value)} className="w-[160px] h-9 bg-white text-xs" />
                    </div>
                  )}

                  {vendorFilterType === 'tahunan' && (
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-400 font-medium">Tahun</Label>
                      <Select value={vendorFilterYear} onValueChange={v => v && setVendorFilterYear(v)}>
                        <SelectTrigger className="w-[110px] bg-white h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{YEARS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400 font-medium">Shift</Label>
                    <Select value={vendorFilterShift} onValueChange={v => v && setVendorFilterShift(v)}>
                      <SelectTrigger className="w-[120px] bg-white h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Semua Shift</SelectItem>
                        {SHIFTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex-1" />

                  {/* Print PDF Rekap - OREN */}
                  <OrangeBtn onClick={() => generateRekapPDF(vendorData, 'REKAP LAPORAN VENDOR', `Rekap_Vendor_${todayStr}`)} px="px-3 py-1.5" className="h-9">
                    <Printer className="w-3.5 h-3.5" /> <span className="text-xs">Print PDF</span>
                  </OrangeBtn>
                </div>
              </div>
            </div>

            <CardContent className="p-0">
              <div className="overflow-hidden">
                <Table>
                  <TableHeader style={{ background: '#F8FAFC' }}>
                    <TableRow className="hover:bg-transparent border-b border-slate-100">
                      <TableHead className="font-semibold pl-6" style={{ color: '#475569', padding: '12px 16px' }}>Judul Laporan</TableHead>
                      <TableHead className="font-semibold text-center" style={{ color: '#475569', padding: '12px 16px' }}>Shift</TableHead>
                      <TableHead className="font-semibold text-center" style={{ color: '#475569', padding: '12px 16px' }}>Area</TableHead>
                      <TableHead className="font-semibold text-center" style={{ color: '#475569', padding: '12px 16px' }}>Petugas</TableHead>
                      <TableHead className="font-semibold text-center" style={{ color: '#475569', padding: '12px 16px' }}>Tanggal</TableHead>
                      <TableHead className="font-semibold text-center" style={{ color: '#475569', padding: '12px 16px' }}>Foto</TableHead>
                      <TableHead className="font-semibold text-center pr-6" style={{ color: '#475569', padding: '12px 16px' }}>Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendorLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 7 }).map((_, j) => (
                            <TableCell key={j} style={{ padding: '12px 16px' }}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : vendorData.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-14" style={{ color: '#94A3B8' }}>
                          <div className="flex flex-col items-center gap-2">
                            <BarChart3 className="w-9 h-9 text-slate-200" />
                            <span className="text-sm font-medium">Belum ada laporan yang ditransfer</span>
                            <span className="text-xs text-slate-400">Laporan yang sudah ditransfer dari Laporan Harian akan muncul di sini.</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      vendorData.map(report => (
                        <TableRow key={report.id} className="border-b border-slate-50 hover:bg-slate-50/40">
                          <TableCell className="pl-6" style={{ padding: '12px 16px' }}>
                            <div className="font-medium text-[#0F172A]">{report.title}</div>
                            <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{report.job_description}</div>
                          </TableCell>
                          <TableCell className="text-center" style={{ color: '#334155', padding: '12px 16px' }}>
                            <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-semibold">
                              {report.shift}
                            </span>
                          </TableCell>
                          <TableCell className="text-center" style={{ color: '#334155', padding: '12px 16px' }}>{report.area}</TableCell>
                          <TableCell className="text-center" style={{ color: '#334155', padding: '12px 16px' }}>{report.officer_name}</TableCell>
                          <TableCell className="text-center whitespace-nowrap" style={{ color: '#334155', padding: '12px 16px' }}>
                            {new Date(report.report_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </TableCell>
                          <TableCell className="text-center" style={{ padding: '12px 16px' }}>
                            {report.photos && report.photos.length > 0 ? (
                              <div className="flex items-center justify-center gap-1">
                                {report.photos.slice(0, 2).map((url, i) => (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img key={i} src={url} alt={`foto ${i + 1}`}
                                    className="w-8 h-8 rounded object-cover cursor-pointer hover:opacity-80 transition-opacity ring-1 ring-slate-200"
                                    onClick={() => { setLightboxPhotos(report.photos); setLightboxIndex(i) }} />
                                ))}
                                {report.photos.length > 2 && (
                                  <button className="w-8 h-8 rounded bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center hover:bg-slate-200 transition-all"
                                    onClick={() => { setLightboxPhotos(report.photos); setLightboxIndex(2) }}>
                                    +{report.photos.length - 2}
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center pr-6" style={{ padding: '12px 16px' }}>
                            <div className="flex items-center justify-center gap-2">
                              {/* Preview PDF - BIRU */}
                              <BlueBtn onClick={() => generateSingleReportPDF(report, 'open')} px="px-2.5 py-1.5" className="text-xs h-8">
                                <Eye className="w-3 h-3" /> Preview PDF
                              </BlueBtn>
                              {/* Print PDF - OREN */}
                              <OrangeBtn onClick={() => generateSingleReportPDF(report, 'print')} px="px-2.5 py-1.5" className="text-xs h-8">
                                <Printer className="w-3.5 h-3.5" /> Print PDF
                              </OrangeBtn>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ============ TAB 3: KONTRAK KERJA ============ */}
        {activeTab === 'kontrak' && (
          <Card className="shadow-sm border border-slate-100 rounded-xl overflow-hidden bg-white">
            <div className="px-6 pt-5 pb-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
              <div>
                <h3 className="font-semibold text-[#0F172A] text-base">Daftar Kontrak Kerja</h3>
                <p className="text-xs text-slate-400 mt-0.5">Riwayat kontrak kerja vendor</p>
              </div>
              <OrangeBtn onClick={() => setShowContractModal(true)}>
                <Plus className="w-4 h-4" /> Upload Kontrak
              </OrangeBtn>
            </div>
            <CardContent className="p-0">
              <div className="overflow-hidden">
                <Table>
                  <TableHeader style={{ background: '#F8FAFC' }}>
                    <TableRow className="hover:bg-transparent border-b border-slate-100">
                      <TableHead className="font-semibold pl-6" style={{ color: '#475569', padding: '12px 16px' }}>Judul</TableHead>
                      <TableHead className="font-semibold text-center" style={{ color: '#475569', padding: '12px 16px' }}>Vendor</TableHead>
                      <TableHead className="font-semibold text-center" style={{ color: '#475569', padding: '12px 16px' }}>Periode</TableHead>
                      <TableHead className="font-semibold text-center" style={{ color: '#475569', padding: '12px 16px' }}>File</TableHead>
                      <TableHead className="font-semibold text-center pr-6" style={{ color: '#475569', padding: '12px 16px' }}>Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contractsLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 5 }).map((_, j) => (
                            <TableCell key={j} style={{ padding: '12px 16px' }}><Skeleton className="h-4 w-full" /></TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : contracts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-14" style={{ color: '#94A3B8' }}>
                          <div className="flex flex-col items-center gap-2">
                            <Briefcase className="w-9 h-9 text-slate-200" />
                            <span className="text-sm font-medium">Belum ada kontrak kerja</span>
                            <span className="text-xs text-slate-400">Klik "Upload Kontrak" untuk menambahkan</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      contracts.map(contract => {
                        const isExpired = new Date(contract.end_date) < new Date()
                        return (
                          <TableRow key={contract.id} className="border-b border-slate-50 hover:bg-slate-50/40">
                            <TableCell className="pl-6 font-medium" style={{ color: '#0F172A', padding: '12px 16px' }}>
                              {contract.title}
                            </TableCell>
                            <TableCell className="text-center text-sm" style={{ color: '#334155', padding: '12px 16px' }}>
                              {contract.vendor_name}
                            </TableCell>
                            <TableCell className="text-center" style={{ padding: '12px 16px' }}>
                              <div className="text-xs" style={{ color: '#334155' }}>
                                {new Date(contract.start_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                                {' – '}
                                {new Date(contract.end_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </div>
                              <div className="flex justify-center mt-1">
                                <span style={{
                                  background: isExpired ? '#FEE2E2' : '#DCFCE7',
                                  color: isExpired ? '#991B1B' : '#166534',
                                  padding: '2px 8px', borderRadius: '9999px',
                                  fontSize: '11px', fontWeight: 600,
                                }}>
                                  {isExpired ? 'Expired' : 'Aktif'}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center" style={{ padding: '12px 16px' }}>
                              {contract.file_url ? (
                                <a href={contract.file_url} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                                  style={{ background: '#EFF6FF', color: '#3B82F6' }}
                                  onMouseEnter={e => (e.currentTarget.style.background = '#DBEAFE')}
                                  onMouseLeave={e => (e.currentTarget.style.background = '#EFF6FF')}>
                                  <Eye className="w-3 h-3" /> Preview
                                </a>
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center pr-6" style={{ padding: '12px 16px' }}>
                              <div className="flex items-center justify-center gap-0.5">
                                <EditIconBtn onClick={() => openEditContract(contract)} />
                                <DeleteIconBtn onClick={() => askConfirmation({
                                  title: 'Hapus Kontrak Kerja',
                                  description: 'Apakah Anda yakin ingin menghapus kontrak kerja ini? Tindakan ini tidak dapat dibatalkan.',
                                  confirmText: 'Hapus',
                                  confirmBg: '#EF4444',
                                  onConfirm: () => deleteContractMutation.mutate(contract.id)
                                })} />
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
        )}

      </motion.div>
    </>
  )
}
