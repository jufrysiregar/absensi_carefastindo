package com.carefastindo.absensi.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class OvertimeAssignment(
    @SerialName("id") val id: String? = null,
    @SerialName("user_id") val userId: String,
    @SerialName("shift_id") val shiftId: String,
    @SerialName("assignment_date") val assignmentDate: String, // yyyy-MM-dd
    @SerialName("assigned_by") val assignedBy: String? = null,
    @SerialName("assigned_from") val assignedFrom: String = "android",
    @SerialName("shift_type") val shiftType: String = "lembur",
    @SerialName("status") val status: String = "pending", // pending, active, completed
    @SerialName("overtime_in") val overtimeIn: String? = null, // timestamp
    @SerialName("overtime_out") val overtimeOut: String? = null, // timestamp
    @SerialName("duration") val duration: Double? = null,
    @SerialName("keterangan") val keterangan: String? = null,
    @SerialName("created_at") val createdAt: String? = null
)
