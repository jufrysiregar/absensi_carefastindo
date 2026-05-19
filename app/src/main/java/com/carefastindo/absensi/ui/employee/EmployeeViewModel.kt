package com.carefastindo.absensi.ui.employee

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carefastindo.absensi.data.model.Attendance
import com.carefastindo.absensi.data.model.User
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.carefastindo.absensi.utils.ShiftHelper
import io.github.jan.tennert.supabase.postgrest.from
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class EmployeeUiState(
    val isLoading: Boolean = false,
    val user: User? = null,
    val history: List<Attendance> = emptyList(),
    val checkInEnabled: Boolean = false,
    val breakEnabled: Boolean = false,
    val checkOutEnabled: Boolean = false,
    val showLatenessWarning: Boolean = false,
    val liveTime: String = "",
    val liveDate: String = "",
    val errorMessage: String? = null
)

class EmployeeViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(EmployeeUiState())
    val uiState: StateFlow<EmployeeUiState> = _uiState

    init {
        startClock()
        loadUserData()
    }

    private fun startClock() {
        val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
        val dateFormat = SimpleDateFormat("EEEE, dd MMM yyyy", Locale("id", "ID"))

        viewModelScope.launch {
            while (true) {
                val now = Date()
                _uiState.value = _uiState.value.copy(
                    liveTime = timeFormat.format(now),
                    liveDate = dateFormat.format(now)
                )
                
                // Update button states dynamically
                _uiState.value.user?.let { user ->
                    updateButtonStates(user)
                }
                
                delay(1000)
            }
        }
    }

    fun loadUserData() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, errorMessage = null)
            try {
                val session = SupabaseClient.auth.currentSessionOrNull()
                val userId = session?.user?.id ?: throw Exception("Sesi tidak valid")

                val user = SupabaseClient.db.from("users")
                    .select { filter { eq("id", userId) } }
                    .decodeSingle<User>()

                val history = SupabaseClient.db.from("attendance")
                    .select { 
                        filter { eq("user_id", userId) }
                        order("date", io.github.jan.tennert.supabase.postgrest.query.Order.DESCENDING)
                    }
                    .decodeList<Attendance>()

                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    user = user,
                    history = history,
                    showLatenessWarning = user.latenessCount >= 3
                )
                updateButtonStates(user)
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    errorMessage = e.localizedMessage
                )
            }
        }
    }

    private fun updateButtonStates(user: User) {
        val shiftType = user.shiftType
        val role = user.role
        
        // TODO: In a real app, we also need to check if user has already checked in today based on history
        val isCheckInActive = ShiftHelper.isCheckInWindowActive(role, shiftType)
        val isBreakActive = ShiftHelper.isBreakWindowActive(role, user.breakStart)
        val isCheckOutActive = ShiftHelper.isCheckOutWindowActive(role, shiftType)

        _uiState.value = _uiState.value.copy(
            checkInEnabled = isCheckInActive,
            breakEnabled = isBreakActive,
            checkOutEnabled = isCheckOutActive
        )
    }

    fun logout() {
        viewModelScope.launch {
            try {
                SupabaseClient.auth.signOut()
            } catch (e: Exception) {}
        }
    }
}
