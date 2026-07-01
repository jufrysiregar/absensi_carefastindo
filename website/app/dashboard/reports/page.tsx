'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FileText, Download, Calendar, Users, Briefcase, FileSpreadsheet, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import { formatDate, formatTime } from '@/lib/utils'
import { motion } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// pdfmake imports
import pdfMake from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'
if (typeof window !== 'undefined' && pdfFonts && (pdfFonts as any).pdfMake) {
  (pdfMake as any).vfs = (pdfFonts as any).pdfMake.vfs
}

interface DailyReportRow {
  name: string
  shift: string
  check_in: string
  check_out: string
  status: string
}

interface MonthlyReportRow {
  name: string
  role: string
  hadir: number
  izin: number
  sakit: number
  alfa: number
  persentase: string
}

interface VendorReportRow {
  name: string
  role: string
  shift: string
  work_days: number
  payroll_total: number
}

interface ContractReportRow {
  name: string
  role: string
  contract_number: string
  start_date: string
  end_date: string
  status: string
}

export default function ReportsPage() {
  const supabase = createClient()
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().split('T')[0])
  const [monthlyMonth, setMonthlyMonth] = useState('2026-06')
  const [vendorId, setVendorId] = useState('all')
  const [vendorDate, setVendorDate] = useState(new Date().toISOString().split('T')[0])
  const [contractStatus, setContractStatus] = useState('all')

  const [loading, setLoading] = useState<Record<string, boolean>>({
    daily: false,
    monthly: false,
    vendor: false,
    contract: false
  })

  const [reportsData, setReportsData] = useState<{
    daily: DailyReportRow[] | null
    monthly: MonthlyReportRow[] | null
    vendor: VendorReportRow[] | null
    contract: ContractReportRow[] | null
  }>({
    daily: null,
    monthly: null,
    vendor: null,
    contract: null
  })

  const [vendors, setVendors] = useState<string[]>([])

  useEffect(() => {
    setVendors(['Carefast Indo Jakarta', 'Carefast Indo Surabaya', 'Carefast Indo Medan'])
  }, [])

  // 1. Generate Daily Report
  const generateDailyReport = async () => {
    setLoading(prev => ({ ...prev, daily: true }))
    try {
      const { data, error } = await supabase
        .from('attendance')
        .select('status, check_in_time, check_out_time, users!attendance_user_id_fkey(name, user_shifts(shifts(name)))')
        .eq('date', dailyDate)

      if (error) throw error

      const mapped: DailyReportRow[] = (data || []).map((r: any) => ({
        name: r.users?.name || '—',
        shift: r.users?.user_shifts?.[0]?.shifts?.name || '—',
        check_in: r.check_in_time ? formatTime(r.check_in_time) : '—',
        check_out: r.check_out_time ? formatTime(r.check_out_time) : '—',
        status: r.status || 'alfa'
      }))

      setReportsData(prev => ({ ...prev, daily: mapped }))
      toast.success('Laporan harian berhasil digenerate')
    } catch (err: any) {
      toast.error('Gagal generate laporan harian: ' + err.message)
    } finally {
      setLoading(prev => ({ ...prev, daily: false }))
    }
  }

  // 2. Generate Monthly Report
  const generateMonthlyReport = async () => {
    setLoading(prev => ({ ...prev, monthly: true }))
    try {
      const [year, month] = monthlyMonth.split('-')
      const startDate = `${year}-${month}-01`
      const endDate = `${year}-${month}-31`

      const { data: usersData, error: userError } = await supabase
        .from('users')
        .select('id, name, role')

      if (userError) throw userError

      const { data: attData, error: attError } = await supabase
        .from('attendance')
        .select('user_id, status')
        .gte('date', startDate)
        .lte('date', endDate)

      if (attError) throw attError

      const mapped: MonthlyReportRow[] = (usersData || []).map((u: any) => {
        const userAtt = (attData || []).filter((a: any) => a.user_id === u.id)
        const hadir = userAtt.filter((a: any) => a.status === 'hadir').length
        const izin = userAtt.filter((a: any) => a.status === 'izin').length
        const sakit = userAtt.filter((a: any) => a.status === 'sakit').length
        const totalWorkDays = 26
        const alfa = Math.max(0, totalWorkDays - (hadir + izin + sakit))
        const persentase = totalWorkDays > 0 ? `${((hadir / totalWorkDays) * 100).toFixed(1)}%` : '0%'

        return {
          name: u.name,
          role: u.role,
          hadir,
          izin,
          sakit,
          alfa,
          persentase
        }
      })

      setReportsData(prev => ({ ...prev, monthly: mapped }))
      toast.success('Laporan bulanan berhasil digenerate')
    } catch (err: any) {
      toast.error('Gagal generate laporan bulanan: ' + err.message)
    } finally {
      setLoading(prev => ({ ...prev, monthly: false }))
    }
  }

  // 3. Generate Vendor Report
  const generateVendorReport = async () => {
    setLoading(prev => ({ ...prev, vendor: true }))
    try {
      const { data: payrollData, error: payrollErr } = await supabase
        .from('payrolls')
        .select('amount, status, users(name, role)')

      if (payrollErr) throw payrollErr

      const mapped: VendorReportRow[] = (payrollData || []).map((p: any) => ({
        name: p.users?.name || '—',
        role: p.users?.role || '—',
        shift: 'Shift 1',
        work_days: 22,
        payroll_total: p.amount || 0
      }))

      setReportsData(prev => ({ ...prev, vendor: mapped }))
      toast.success('Laporan vendor berhasil digenerate')
    } catch (err: any) {
      toast.error('Gagal generate laporan vendor: ' + err.message)
    } finally {
      setLoading(prev => ({ ...prev, vendor: false }))
    }
  }

  // 4. Generate Contract Report
  const generateContractReport = async () => {
    setLoading(prev => ({ ...prev, contract: true }))
    try {
      let query = supabase
        .from('contracts')
        .select('contract_number, start_date, end_date, status, users(name, role)')

      if (contractStatus !== 'all') {
        query = query.eq('status', contractStatus)
      }

      const { data, error } = await query

      if (error) throw error

      const mapped: ContractReportRow[] = (data || []).map((c: any) => ({
        name: c.users?.name || '—',
        role: c.users?.role || '—',
        contract_number: c.contract_number || '—',
        start_date: c.start_date ? formatDate(c.start_date) : '—',
        end_date: c.end_date ? formatDate(c.end_date) : '—',
        status: c.status || 'inactive'
      }))

      setReportsData(prev => ({ ...prev, contract: mapped }))
      toast.success('Laporan kontrak berhasil digenerate')
    } catch (err: any) {
      toast.error('Gagal generate laporan kontrak: ' + err.message)
    } finally {
      setLoading(prev => ({ ...prev, contract: false }))
    }
  }

  // Excel export
  const downloadExcel = (data: any[], filename: string) => {
    if (!data || data.length === 0) {
      toast.error('Tidak ada data untuk diekspor')
      return
    }
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Laporan')
    XLSX.writeFile(wb, `${filename}.xlsx`)
    toast.success('Excel berhasil didownload')
  }

  // PDF export using pdfmake
  const downloadPDF = (title: string, headers: string[], body: any[][], filename: string) => {
    if (!body || body.length === 0) {
      toast.error('Tidak ada data untuk diekspor')
      return
    }

    const docDefinition = {
      content: [
        { text: title, style: 'header' },
        { text: `Generated: ${new Date().toLocaleDateString('id-ID')}`, style: 'subheader' },
        {
          style: 'tableExample',
          table: {
            headerRows: 1,
            body: [
              headers.map(h => ({ text: h, style: 'tableHeader' })),
              ...body
            ]
          }
        }
      ],
      styles: {
        header: { fontSize: 16, bold: true, margin: [0, 0, 0, 5] },
        subheader: { fontSize: 9, italics: true, margin: [0, 0, 0, 15] },
        tableExample: { margin: [0, 5, 0, 15] },
        tableHeader: { bold: true, fontSize: 10, color: 'black' }
      }
    }

    // @ts-ignore
    pdfMake.createPdf(docDefinition).download(`${filename}.pdf`)
    toast.success('PDF berhasil didownload')
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Laporan</h1>
        <p className="text-sm text-slate-500 mt-1">Generate dan unduh laporan dalam format Excel atau PDF.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Daily Report */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="border-b border-slate-50 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 text-blue-500 rounded-xl flex items-center justify-center">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg">Laporan Harian</CardTitle>
                <CardDescription className="text-xs">Status kehadiran & jam kerja harian</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dailyDate">Pilih Tanggal</Label>
              <Input
                id="dailyDate"
                type="date"
                value={dailyDate}
                onChange={e => setDailyDate(e.target.value)}
                className="bg-white"
              />
            </div>
            
            <Button
              onClick={generateDailyReport}
              disabled={loading.daily}
              className="w-full"
            >
              {loading.daily ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
              Generate Laporan
            </Button>
            
            {reportsData.daily && (
              <div className="flex gap-3 pt-3 border-t border-slate-100">
                <Button
                  variant="outline"
                  onClick={() => downloadExcel(reportsData.daily!, `Laporan_Harian_${dailyDate}`)}
                  className="flex-1 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:text-emerald-800 border-emerald-200"
                >
                  <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadPDF(
                      `Laporan Harian Kehadiran - ${dailyDate}`,
                      ['Nama', 'Shift', 'Jam Masuk', 'Jam Keluar', 'Status'],
                      reportsData.daily!.map(r => [r.name, r.shift, r.check_in, r.check_out, r.status]),
                      `Laporan_Harian_${dailyDate}`
                    )
                  }
                  className="flex-1 text-rose-700 bg-rose-50 hover:bg-rose-100 hover:text-rose-800 border-rose-200"
                >
                  <Download className="w-4 h-4 mr-2" /> PDF
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monthly Report */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="border-b border-slate-50 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-50 text-purple-500 rounded-xl flex items-center justify-center">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg">Laporan Bulanan</CardTitle>
                <CardDescription className="text-xs">Rekapitulasi kehadiran bulanan</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="monthlyMonth">Pilih Bulan</Label>
              <Input
                id="monthlyMonth"
                type="month"
                value={monthlyMonth}
                onChange={e => setMonthlyMonth(e.target.value)}
                className="bg-white"
              />
            </div>
            
            <Button
              onClick={generateMonthlyReport}
              disabled={loading.monthly}
              className="w-full bg-purple-600 hover:bg-purple-700"
            >
              {loading.monthly ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
              Generate Laporan
            </Button>
            
            {reportsData.monthly && (
              <div className="flex gap-3 pt-3 border-t border-slate-100">
                <Button
                  variant="outline"
                  onClick={() => downloadExcel(reportsData.monthly!, `Laporan_Bulanan_${monthlyMonth}`)}
                  className="flex-1 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:text-emerald-800 border-emerald-200"
                >
                  <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadPDF(
                      `Laporan Bulanan Kehadiran - ${monthlyMonth}`,
                      ['Nama', 'Role', 'Hadir', 'Izin', 'Sakit', 'Alfa', 'Persentase'],
                      reportsData.monthly!.map(r => [r.name, r.role, r.hadir, r.izin, r.sakit, r.alfa, r.persentase]),
                      `Laporan_Bulanan_${monthlyMonth}`
                    )
                  }
                  className="flex-1 text-rose-700 bg-rose-50 hover:bg-rose-100 hover:text-rose-800 border-rose-200"
                >
                  <Download className="w-4 h-4 mr-2" /> PDF
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Vendor Report */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="border-b border-slate-50 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-50 text-emerald-500 rounded-xl flex items-center justify-center">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg">Laporan Vendor</CardTitle>
                <CardDescription className="text-xs">Rekap kehadiran vendor & durasi kerja</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vendorId">Pilih Vendor</Label>
                <Select value={vendorId} onValueChange={(v) => setVendorId(v as string)}>
                  <SelectTrigger id="vendorId" className="bg-white">
                    <SelectValue placeholder="Semua Vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Vendor</SelectItem>
                    {vendors.map((v, idx) => <SelectItem key={idx} value={v}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendorDate">Periode</Label>
                <Input
                  id="vendorDate"
                  type="date"
                  value={vendorDate}
                  onChange={e => setVendorDate(e.target.value)}
                  className="bg-white"
                />
              </div>
            </div>
            
            <Button
              onClick={generateVendorReport}
              disabled={loading.vendor}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {loading.vendor ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
              Generate Laporan
            </Button>
            
            {reportsData.vendor && (
              <div className="flex gap-3 pt-3 border-t border-slate-100">
                <Button
                  variant="outline"
                  onClick={() => downloadExcel(reportsData.vendor!, `Laporan_Vendor_${vendorId}`)}
                  className="flex-1 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:text-emerald-800 border-emerald-200"
                >
                  <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadPDF(
                      `Laporan Kerja Vendor - ${vendorId}`,
                      ['Nama', 'Role', 'Shift', 'Hari Kerja', 'Total Payroll'],
                      reportsData.vendor!.map(r => [r.name, r.role, r.shift, r.work_days, r.payroll_total.toLocaleString('id-ID')]),
                      `Laporan_Vendor_${vendorId}`
                    )
                  }
                  className="flex-1 text-rose-700 bg-rose-50 hover:bg-rose-100 hover:text-rose-800 border-rose-200"
                >
                  <Download className="w-4 h-4 mr-2" /> PDF
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Contract Report */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="border-b border-slate-50 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-50 text-amber-500 rounded-xl flex items-center justify-center">
                <Briefcase className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-lg">Laporan Kontrak</CardTitle>
                <CardDescription className="text-xs">Status kontrak aktif & masa berlaku</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="contractStatus">Status Kontrak</Label>
              <Select value={contractStatus} onValueChange={(v) => setContractStatus(v as string)}>
                <SelectTrigger id="contractStatus" className="bg-white">
                  <SelectValue placeholder="Semua Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="expired">Habis Masa Berlaku</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <Button
              onClick={generateContractReport}
              disabled={loading.contract}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white"
            >
              {loading.contract ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
              Generate Laporan
            </Button>
            
            {reportsData.contract && (
              <div className="flex gap-3 pt-3 border-t border-slate-100">
                <Button
                  variant="outline"
                  onClick={() => downloadExcel(reportsData.contract!, `Laporan_Kontrak`)}
                  className="flex-1 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:text-emerald-800 border-emerald-200"
                >
                  <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadPDF(
                      `Laporan Status Kontrak Karyawan`,
                      ['Nama', 'Role', 'No Kontrak', 'Mulai Kontrak', 'Akhir Kontrak', 'Status'],
                      reportsData.contract!.map(r => [r.name, r.role, r.contract_number, r.start_date, r.end_date, r.status]),
                      `Laporan_Kontrak`
                    )
                  }
                  className="flex-1 text-rose-700 bg-rose-50 hover:bg-rose-100 hover:text-rose-800 border-rose-200"
                >
                  <Download className="w-4 h-4 mr-2" /> PDF
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </motion.div>
  )
}
