package com.carefastindo.absensi.ui.login

import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.carefastindo.absensi.R
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.OTP
import io.github.jan.supabase.auth.OtpType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ForgotPasswordActivity : AppCompatActivity() {

    private lateinit var edtEmail: TextInputEditText
    private lateinit var btnRequestOtp: MaterialButton
    private lateinit var layoutStep1: View
    
    private lateinit var edtOtp: TextInputEditText
    private lateinit var edtNewPassword: TextInputEditText
    private lateinit var btnResetPassword: MaterialButton
    private lateinit var layoutStep2: View
    
    private lateinit var loadingOverlay: View
    
    private var requestedEmail: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_forgot_password)
        
        // Step 1 UI
        edtEmail = findViewById(R.id.edtEmail)
        btnRequestOtp = findViewById(R.id.btnRequestOtp)
        layoutStep1 = findViewById(R.id.layoutStep1)
        
        // Step 2 UI
        edtOtp = findViewById(R.id.edtOtp)
        edtNewPassword = findViewById(R.id.edtNewPassword)
        btnResetPassword = findViewById(R.id.btnResetPassword)
        layoutStep2 = findViewById(R.id.layoutStep2)
        
        loadingOverlay = findViewById(R.id.loadingOverlay)

        findViewById<View>(R.id.btnBack).setOnClickListener {
            onBackPressedDispatcher.onBackPressed()
        }

        btnRequestOtp.setOnClickListener {
            val email = edtEmail.text.toString().trim()
            if (email.isEmpty()) {
                Toast.makeText(this, "Silakan isi email terlebih dahulu", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            requestOtpCode(email)
        }

        btnResetPassword.setOnClickListener {
            val otpCode = edtOtp.text.toString().trim()
            val newPass = edtNewPassword.text.toString().trim()
            
            if (otpCode.length != 6) {
                Toast.makeText(this, "Kode OTP harus 6 digit", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (newPass.length < 6) {
                Toast.makeText(this, "Kata sandi baru minimal 6 karakter", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            verifyOtpAndReset(otpCode, newPass)
        }
    }

    private fun requestOtpCode(email: String) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    // 1. Cek apakah email terdaftar di tabel users
                    val checkUser = SupabaseClient.db.from("users")
                        .select { filter { eq("email", email) } }
                        .data

                    if (checkUser == "[]" || checkUser.isBlank()) {
                        throw Exception("Email tidak terdaftar di sistem kami.")
                    }

                    // 2. Kirim 6-digit OTP ke email (atau Magic Link)
                    SupabaseClient.auth.signInWith(OTP) {
                        this.email = email
                        // Gunakan deep link agar tidak redirect ke localhost:3000 jika user mengklik link di email
                        // (Pastikan carefastindo://reset di-whitelist di Supabase Dashboard)
                        // this.redirectUrl = "carefastindo://reset" 
                    }
                }
                requestedEmail = email
                
                // Tampilkan Step 2 input OTP
                layoutStep1.visibility = View.GONE
                layoutStep2.visibility = View.VISIBLE
                
                Toast.makeText(
                    this@ForgotPasswordActivity,
                    "Kode OTP 6 digit telah dikirim ke $email",
                    Toast.LENGTH_LONG
                ).show()
            } catch (e: Exception) {
                MaterialAlertDialogBuilder(this@ForgotPasswordActivity)
                    .setTitle("Gagal Mengirim Kode")
                    .setMessage(e.localizedMessage ?: "Terjadi kesalahan. Pastikan email terdaftar.")
                    .setPositiveButton("OK", null)
                    .show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun verifyOtpAndReset(otpCode: String, newPass: String) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                // 1. Verifikasi kode OTP untuk membuat sesi sementara
                withContext(Dispatchers.IO) {
                    SupabaseClient.auth.verifyEmailOtp(
                        type = OtpType.Email.EMAIL,
                        email = requestedEmail,
                        token = otpCode
                    )
                }
                
                // 2. Update user password
                withContext(Dispatchers.IO) {
                    SupabaseClient.auth.updateUser {
                        password = newPass
                    }
                }
                
                // Success!
                MaterialAlertDialogBuilder(this@ForgotPasswordActivity)
                    .setTitle("Berhasil!")
                    .setMessage("Kata sandi Anda telah berhasil diperbarui. Silakan login menggunakan kata sandi baru Anda.")
                    .setCancelable(false)
                    .setPositiveButton("Kembali ke Login") { _, _ ->
                        // Sign out the temporary recovery session so they login cleanly
                        lifecycleScope.launch(Dispatchers.IO) {
                            try { SupabaseClient.auth.signOut() } catch (e: Exception) {}
                        }
                        finish()
                    }
                    .show()
                
            } catch (e: Exception) {
                MaterialAlertDialogBuilder(this@ForgotPasswordActivity)
                    .setTitle("Gagal")
                    .setMessage("Kode OTP salah, kedaluwarsa, atau koneksi terputus.\n\nDetail: ${e.localizedMessage}")
                    .setPositiveButton("OK", null)
                    .show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }
}
