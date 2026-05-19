package com.carefastindo.absensi.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carefastindo.absensi.data.model.User
import com.carefastindo.absensi.data.remote.SupabaseClient
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

sealed class LoginState {
    object Idle : LoginState()
    object Loading : LoginState()
    data class Success(val role: String) : LoginState()
    data class Error(val message: String) : LoginState()
}

class LoginViewModel : ViewModel() {

    private val _loginState = MutableStateFlow<LoginState>(LoginState.Idle)
    val loginState: StateFlow<LoginState> = _loginState

    fun login(email: String, password: String) {
        if (email.isBlank() || password.isBlank()) {
            _loginState.value = LoginState.Error("Email dan password tidak boleh kosong")
            return
        }

        viewModelScope.launch {
            _loginState.value = LoginState.Loading
            try {
                // 1. Authenticate with Supabase GoTrue
                SupabaseClient.auth.signInWith(Email) {
                    this.email = email
                    this.password = password
                }

                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id
                if (userId == null) {
                    _loginState.value = LoginState.Error("Gagal mendapatkan data sesi pengguna")
                    return@launch
                }

                // 2. Fetch User metadata from users table
                val user = SupabaseClient.db.from("users")
                    .select {
                        filter {
                            eq("id", userId)
                        }
                    }.decodeSingle<User>()

                if (!user.isActive) {
                    SupabaseClient.auth.signOut()
                    _loginState.value = LoginState.Error("Akun Anda dinonaktifkan oleh administrator")
                    return@launch
                }

                // 3. Handle Monthly Lateness Reset
                handleMonthlyLatenessReset(user)

                _loginState.value = LoginState.Success(user.role)

            } catch (e: Exception) {
                _loginState.value = LoginState.Error(e.localizedMessage ?: "Terjadi kesalahan saat masuk")
            }
        }
    }

    fun resetPassword(email: String, onSuccess: () -> Unit, onError: (String) -> Unit) {
        if (email.isBlank()) {
            onError("Email tidak boleh kosong")
            return
        }
        viewModelScope.launch {
            try {
                SupabaseClient.auth.resetPasswordForEmail(email = email)
                onSuccess()
            } catch (e: Exception) {
                onError(e.localizedMessage ?: "Gagal mengirim email reset password")
            }
        }
    }

    private suspend fun handleMonthlyLatenessReset(user: User) {
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        val todayStr = sdf.format(Date())
        
        val needsReset = if (user.latenessResetDate.isNullOrBlank()) {
            true
        } else {
            try {
                val resetDate = sdf.parse(user.latenessResetDate)
                val calReset = Calendar.getInstance().apply { time = resetDate }
                val calToday = Calendar.getInstance().apply { time = Date() }
                
                // Compare Month and Year
                calReset.get(Calendar.MONTH) != calToday.get(Calendar.MONTH) ||
                        calReset.get(Calendar.YEAR) != calToday.get(Calendar.YEAR)
            } catch (e: Exception) {
                true
            }
        }

        if (needsReset) {
            try {
                // Update counter and reset date in database
                SupabaseClient.db.from("users").update({
                    set("lateness_count", 0 as Int)
                    set("lateness_reset_date", todayStr)
                }) {
                    filter {
                        eq("id", user.id)
                    }
                }
            } catch (e: Exception) {
                // Log or handle silently
            }
        }
    }
}
