import { NextRequest, NextResponse } from 'next/server'
import sgMail from '@sendgrid/mail'

export async function POST(req: NextRequest) {
  try {
    const { email, otpCode, resetLink } = await req.json()

    // Validasi input
    if (!email || !otpCode || !resetLink) {
      return NextResponse.json(
        { error: 'Parameter tidak lengkap (email, otpCode, resetLink wajib diisi).' },
        { status: 400 }
      )
    }

    const apiKey = process.env.SENDGRID_API_KEY
    if (!apiKey) {
      console.error('❌ SENDGRID_API_KEY tidak dikonfigurasi')
      return NextResponse.json(
        { error: 'Konfigurasi email server belum lengkap.' },
        { status: 500 }
      )
    }

    sgMail.setApiKey(apiKey)
    console.log('📧 Server: Mengirim OTP ke:', email)

    const msg = {
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@carefastindo.com',
      templateId: process.env.SENDGRID_TEMPLATE_ID!,
      dynamicTemplateData: {
        email: email,
        otp_code: otpCode,
        reset_link: resetLink,
      },
    }

    await sgMail.send(msg)
    console.log('✅ Server: OTP berhasil dikirim ke', email)

    return NextResponse.json({ success: true })

  } catch (error) {
    // ✅ PERBAIKAN: Cek error dengan aman, tanpa 'as any'
    console.error('❌ SendGrid Error:', error)

    let errorMessage = 'Gagal kirim email'

    if (error && typeof error === 'object') {
      // Cek apakah error punya property 'response'
      const err = error as { 
        response?: { 
          body?: { 
            errors?: Array<{ message: string }> 
          } 
        } 
      }
      
      if (err.response?.body?.errors?.[0]?.message) {
        errorMessage = err.response.body.errors[0].message
      } else if (error instanceof Error) {
        errorMessage = error.message
      }
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}