package com.carefastindo.absensi

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.view.animation.AnimationUtils
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.carefastindo.absensi.databinding.ActivitySplashBinding
import com.carefastindo.absensi.ui.login.LoginActivity
import com.carefastindo.absensi.ui.employee.EmployeeMainActivity
import com.carefastindo.absensi.ui.admin.AdminMainActivity
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.carefastindo.absensi.data.model.User
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@SuppressLint("CustomSplashScreen")
class SplashActivity : AppCompatActivity() {
    private lateinit var binding: ActivitySplashBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySplashBinding.inflate(layoutInflater)
        setContentView(binding.root)

        lifecycleScope.launch {
            delay(2000)
            checkSession()
        }
    }

    private suspend fun checkSession() {
        val currentSession = try {
            SupabaseClient.auth.currentSessionOrNull()
        } catch (e: Exception) {
            null
        }

        if (currentSession != null) {
            val userId = currentSession.user?.id
            if (userId != null) {
                try {
                    val user = SupabaseClient.db.from("users")
                        .select {
                            filter {
                                eq("id", userId)
                            }
                        }.decodeSingle<User>()

                    if (user.isActive) {
                        // Load shifts configuration dynamically from database
                        com.carefastindo.absensi.utils.ShiftHelper.loadShifts()

                        if (user.role.equals("superadmin", ignoreCase = true) || user.role.equals("SPV", ignoreCase = true)) {
                            startActivity(Intent(this@SplashActivity, AdminMainActivity::class.java))
                        } else {
                            startActivity(Intent(this@SplashActivity, EmployeeMainActivity::class.java))
                        }
                        finish()
                        return
                    }
                } catch (e: Exception) {
                    // Session might be stale or invalid, fallback to Login
                }
            }
        }

        startActivity(Intent(this@SplashActivity, LoginActivity::class.java))
        finish()
    }
}
