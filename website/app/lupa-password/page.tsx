'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Mail, Loader2, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react'

export default function LupaPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [alertMessage, setAlertMessage] = useState('')
  const [alertType, setAlertType] = useState<'error' | 'success' | ''>('')

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setAlertMessage('')
    setAlertType('')

    if (!email.trim()) {
      setAlertMessage('Masukkan alamat email Anda terlebih dahulu.')
      setAlertType('error')
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()

      // ✅ CEK SUPERADMIN DI DATABASE
      console.log('[DEBUG] Mengecek email di database:', email.trim())

      const { data: user, error: userError } = await supabase
        .from('users')
        .select('email, role')
        .eq('email', email.trim())
        .single()

      console.log('[DEBUG] Hasil query users:', { user, userError })

      if (userError || !user || user.role !== 'superadmin') {
        console.log('[DEBUG] Email tidak ditemukan atau bukan superadmin')
        setAlertMessage('Email tidak terdaftar sebagai Super Admin')
        setAlertType('error')
        setLoading(false)
        return
      }

      console.log('[DEBUG] Email valid sebagai superadmin. Membuat OTP...')

      // ✅ GENERATE OTP 6 DIGIT
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString()
      const resetLink = `${window.location.origin}/reset-password?email=${encodeURIComponent(email.trim())}`

      console.log('[DEBUG] OTP dibuat:', otpCode)
      console.log('[DEBUG] Reset link:', resetLink)

      // ✅ PANGGIL API ROUTE (SERVER) — KIRIM VIA SENDGRID
      const response = await fetch('/api/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          otpCode,
          resetLink,
        }),
      })

      const result = await response.json()
      console.log('[DEBUG] Response API send-otp:', { ok: response.ok, status: response.status, result })

      if (!response.ok) {
        throw new Error(result.error || 'Gagal kirim OTP')
      }

      setAlertMessage('✅ Kode OTP telah dikirim ke email Anda. Cek inbox atau folder spam.')
      setAlertType('success')
      setSent(true)

    } catch (error: any) {
      console.error('[DEBUG] Error:', error)
      setAlertMessage(error.message)
      setAlertType('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-blue-50 flex flex-col items-center justify-center px-4">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-100 rounded-full opacity-30 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-slate-200 rounded-full opacity-40 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in">
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/80 border border-slate-100 p-8">
          {/* Logo */}
          <div className={`flex flex-col items-center ${sent ? 'mb-2' : 'mb-5'}`}>
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
            {!sent && (
              <>
                <h1 className="text-xl font-bold text-slate-800 text-center">Lupa Password</h1>
                <p className="text-sm text-slate-400 mt-1 text-center">
                  Masukkan email Anda yang terdaftar di sistem
                </p>
              </>
            )}
          </div>

          {/* Alert — muncul di tengah halaman, di atas form */}
          {alertMessage && !sent && (
            <div className={`flex items-start gap-2.5 p-3.5 rounded-xl mb-4 text-sm border ${
              alertType === 'error'
                ? 'bg-red-50 text-red-700 border-red-300'
                : 'bg-green-50 text-green-700 border-green-300'
            }`}>
              <span>{alertMessage}</span>
            </div>
          )}

          {sent ? (
            /* Success state */
            <div className="flex flex-col items-center gap-4 py-2">
              <style dangerouslySetInnerHTML={{ __html: `
                @keyframes checkmark {
                  to {
                    stroke-dashoffset: 0;
                  }
                }
                @keyframes scaleIn {
                  0% { transform: scale(0); opacity: 0; }
                  100% { transform: scale(1); opacity: 1; }
                }
              `}} />
              <div 
                className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center shadow-inner"
                style={{ animation: 'scaleIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards' }}
              >
                <svg className="w-10 h-10 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline
                    points="20 6 9 17 4 12"
                    style={{
                      strokeDasharray: 50,
                      strokeDashoffset: 50,
                      animation: 'checkmark 0.5s 0.2s ease-in-out forwards'
                    }}
                  />
                </svg>
              </div>
              <div className="text-center">
                <p className="font-semibold text-slate-700 text-sm">Email OTP berhasil dikirim!</p>
                <p className="text-sm text-slate-400 mt-1">
                  Silakan cek inbox atau folder spam pada email{' '}
                  <span className="font-medium text-slate-600">{email}</span>.
                </p>
              </div>
              <Link
                href="/login"
                className="w-full text-center text-sm font-semibold text-blue-500 hover:text-blue-600 border border-blue-200 hover:border-blue-300 py-2.5 rounded-xl transition-all hover:bg-blue-50 mt-2 flex items-center justify-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                Kembali ke Login
              </Link>
            </div>
          ) : (
            /* Form state */
            <form onSubmit={handleSendOTP} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-600">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                  <input
                    type="email"
                    value={email}
                    onFocus={() => {
                      setAlertMessage('')
                      setAlertType('')
                    }}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="admin@carefastindo.com"
                    required
                    className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent focus:bg-white transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-md shadow-blue-200 hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Mengirim OTP...
                  </>
                ) : (
                  'Kirim Kode OTP'
                )}
              </button>

              <Link
                href="/login"
                className="flex items-center justify-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors mt-2"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Kembali ke Login
              </Link>
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
