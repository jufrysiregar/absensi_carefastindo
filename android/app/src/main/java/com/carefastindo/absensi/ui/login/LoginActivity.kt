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
            startActivity(Intent(this, ForgotPasswordActivity::class.java))
        }
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
                        lifecycleScope.launch {
                            com.carefastindo.absensi.utils.ShiftHelper.loadShifts()
                            navigateToDashboard(state.role)
                        }
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
