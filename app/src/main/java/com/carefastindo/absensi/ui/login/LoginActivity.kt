package com.carefastindo.absensi.ui.login

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.carefastindo.absensi.R
import com.carefastindo.absensi.databinding.ActivityLoginBinding
import com.carefastindo.absensi.ui.admin.AdminMainActivity
import com.carefastindo.absensi.ui.employee.EmployeeMainActivity
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private val viewModel: LoginViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupListeners()
        observeViewModel()
    }

    private fun setupListeners() {
        binding.btnLogin.setOnClickListener {
            val email = binding.edtEmail.text.toString().trim()
            val password = binding.edtPassword.text.toString().trim()
            viewModel.login(email, password)
        }

        binding.btnForgotPassword.setOnClickListener {
            val currentEmail = binding.edtEmail.text.toString().trim()
            showForgotPasswordDialog(currentEmail)
        }
    }

    private fun showForgotPasswordDialog(initialEmail: String) {
        val input = android.widget.EditText(this).apply {
            inputType = android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS or android.text.InputType.TYPE_CLASS_TEXT
            setText(initialEmail)
            hint = "contoh: nama@carefastindo.com"
        }

        val container = android.widget.FrameLayout(this).apply {
            addView(input, android.widget.FrameLayout.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                leftMargin = 64
                rightMargin = 64
                topMargin = 16
                bottomMargin = 16
            })
        }

        MaterialAlertDialogBuilder(this)
            .setTitle("Reset Kata Sandi")
            .setMessage("Masukkan email terdaftar Anda. Kami akan mengirimkan tautan untuk mengatur ulang kata sandi Anda.")
            .setView(container)
            .setPositiveButton("Kirim") { dialog, _ ->
                val email = input.text.toString().trim()
                if (email.isEmpty()) {
                    Toast.makeText(this, "Email tidak boleh kosong", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                
                val loadingToast = Toast.makeText(this, "Mengirim tautan reset...", Toast.LENGTH_LONG)
                loadingToast.show()
                
                viewModel.resetPassword(email, onSuccess = {
                    loadingToast.cancel()
                    MaterialAlertDialogBuilder(this@LoginActivity)
                        .setTitle("Tautan Terkirim")
                        .setMessage("Tautan reset kata sandi telah sukses dikirim ke email: $email\n\nSilakan cek folder Kotak Masuk atau Spam email Anda.")
                        .setPositiveButton("OK") { d, _ -> d.dismiss() }
                        .show()
                }, onError = { errorMsg ->
                    loadingToast.cancel()
                    MaterialAlertDialogBuilder(this@LoginActivity)
                        .setTitle("Gagal")
                        .setMessage(errorMsg)
                        .setPositiveButton("OK") { d, _ -> d.dismiss() }
                        .show()
                })
                dialog.dismiss()
            }
            .setNegativeButton("Batal") { dialog, _ -> dialog.dismiss() }
            .show()
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            viewModel.loginState.collectLatest { state ->
                when (state) {
                    is LoginState.Idle -> {
                        enableInputs(true)
                        binding.btnLogin.text = getString(R.string.btn_login)
                    }
                    is LoginState.Loading -> {
                        enableInputs(false)
                        binding.btnLogin.text = "MENGOTENTIKASI..."
                    }
                    is LoginState.Success -> {
                        enableInputs(true)
                        binding.btnLogin.text = getString(R.string.btn_login)
                        Toast.makeText(this@LoginActivity, "Login Berhasil!", Toast.LENGTH_SHORT).show()
                        navigateToDashboard(state.role)
                    }
                    is LoginState.Error -> {
                        enableInputs(true)
                        binding.btnLogin.text = getString(R.string.btn_login)
                        showErrorDialog(state.message)
                    }
                }
            }
        }
    }

    private fun enableInputs(enable: Boolean) {
        binding.edtEmail.isEnabled = enable
        binding.edtPassword.isEnabled = enable
        binding.btnLogin.isEnabled = enable
    }

    private fun navigateToDashboard(role: String) {
        val intent = if (role.equals("superadmin", ignoreCase = true) || role.equals("SPV", ignoreCase = true)) {
            Intent(this, AdminMainActivity::class.java)
        } else {
            Intent(this, EmployeeMainActivity::class.java)
        }
        startActivity(intent)
        finish()
    }

    private fun showErrorDialog(message: String) {
        MaterialAlertDialogBuilder(this)
            .setTitle("Autentikasi Gagal")
            .setMessage(message)
            .setPositiveButton("OK") { dialog, _ -> dialog.dismiss() }
            .show()
    }
}
