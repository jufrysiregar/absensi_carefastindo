package com.carefastindo.absensi.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class EmergencyAssignment(
    @SerialName("id") val id: String? = null,
    @SerialName("assigned_user_id") val assignedUserId: String,
    @SerialName("target_date") val targetDate: String,
    @SerialName("reason") val reason: String, // 'lembur' or 'ganti_off'
    @SerialName("replacing_user_id") val replacingUserId: String? = null,
    @SerialName("shift_id") val shiftId: String? = null,
    @SerialName("assigned_by") val assignedBy: String? = null,
    @SerialName("assigned_from") val assignedFrom: String? = null,
    @SerialName("status") val status: String = "pending", // pending, active, selesai
    @SerialName("created_at") val createdAt: String? = null
)
