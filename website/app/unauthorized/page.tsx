import Link from 'next/link'
import { ShieldX } from 'lucide-react'

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-red-50 flex flex-col items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/80 border border-slate-100 p-10 max-w-md w-full text-center animate-fade-in">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <ShieldX className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">Akses Ditolak</h1>
        <p className="text-sm text-slate-500 mb-6">
          Anda tidak memiliki hak akses untuk masuk ke halaman ini.
          Halaman ini hanya dapat diakses oleh <strong className="text-slate-700">Superadmin</strong>.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-all hover:-translate-y-0.5 shadow-md shadow-blue-200"
        >
          Kembali ke Login
        </Link>
      </div>
      <p className="text-xs text-slate-400 mt-6">© 2026 Carefastindo. All rights reserved.</p>
    </div>
  )
}
