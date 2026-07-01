'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, Lock, Loader2, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [validSession, setValidSession] = useState(false)

  // Check if user has a valid recovery session from email link
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setValidSession(true)
      }
    })
  }, [])

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()

    if (password.length < 6) {
      toast.error('Password minimal 6 karakter.')
      return
    }

    if (password !== confirmPassword) {
      toast.error('Konfirmasi password tidak cocok.')
      return
    }

    setLoading(true)
    const supabase = createClient()

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      toast.error('Gagal mengatur password baru: ' + error.message)
      setLoading(false)
      return
    }

    setDone(true)
    toast.success('Password berhasil diperbarui!')
    setTimeout(() => router.push('/login'), 3000)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-blue-50 flex flex-col items-center justify-center px-4">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-100 rounded-full opacity-30 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-slate-200 rounded-full opacity-40 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/80 border border-slate-100 p-8">
          {/* Logo */}
          <div className="flex flex-col items-center mb-7">
            <div className="w-60 h-20 mb-1 flex items-center justify-center">
              <Image
                src="/logoweb.png"
                alt="Carefastindo"
                width={224}
                height={80}
                className="object-contain"
                priority
              />
            </div>
            <h1 className="text-lg font-bold text-slate-800 text-center">Reset Password</h1>
            <p className="text-sm text-slate-400 mt-1 text-center">
              Masukkan password baru untuk akun Anda
            </p>
          </div>

          {done ? (
            /* Success state */
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-emerald-500" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-slate-700 text-sm">Password berhasil diubah!</p>
                <p className="text-sm text-slate-400 mt-1">
                  Anda akan diarahkan ke halaman login secara otomatis dalam 3 detik...
                </p>
              </div>
              <Link
                href="/login"
                className="w-full text-center text-sm font-semibold text-blue-500 hover:text-blue-600 border border-blue-200 hover:border-blue-300 py-2.5 rounded-xl transition-all hover:bg-blue-50"
              >
                Login Sekarang
              </Link>
            </div>
          ) : (
            /* Reset form */
            <form onSubmit={handleReset} className="space-y-4">
              {/* New Password */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-600">Password Baru</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Minimal 6 karakter"
                    required
                    className="w-full pl-10 pr-10 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent focus:bg-white transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-600">Konfirmasi Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Ulangi password baru"
                    required
                    className="w-full pl-10 pr-10 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent focus:bg-white transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Password match indicator */}
              {confirmPassword && (
                <p className={`text-xs ${password === confirmPassword ? 'text-emerald-500' : 'text-red-400'}`}>
                  {password === confirmPassword ? '✓ Password cocok' : '✗ Password tidak cocok'}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-md shadow-blue-200 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  'Simpan Password Baru'
                )}
              </button>

              <div className="text-center pt-1">
                <Link href="/login" className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
                  Kembali ke Login
                </Link>
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-5">
          © 2026 Carefastindo. All rights reserved.
        </p>
      </div>
    </div>
  )
}
