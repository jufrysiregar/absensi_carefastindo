package com.carefastindo.absensi.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class User(
    @SerialName("id") val id: String,
    @SerialName("email") val email: String,
    @SerialName("name") val name: String,
    @SerialName("role") val role: String, // 'SPV', 'Leader', 'Pegawai', 'superadmin'
    @SerialName("shift_type") val shiftType: String? = null, // 'pagi', 'sore', 'malam', null
    @SerialName("position") val position: String,
    @SerialName("is_active") val isActive: Boolean = true,
    @SerialName("lateness_count") val latenessCount: Int = 0,
    @SerialName("lateness_reset_date") val latenessResetDate: String? = null,
    @SerialName("break_start") val breakStart: String? = null, // HH:mm:ss format
    @SerialName("employee_code") val employeeCode: String? = null
)
