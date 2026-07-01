package com.carefastindo.absensi.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LeaveRequest(
    @SerialName("id") val id: String? = null,
    @SerialName("user_id") val userId: String,
    @SerialName("leave_type") val leaveType: String, // 'izin' or 'sakit'
    @SerialName("start_date") val startDate: String, // YYYY-MM-DD
    @SerialName("end_date") val endDate: String, // YYYY-MM-DD
    @SerialName("reason") val reason: String,
    @SerialName("attachment_url") val attachmentUrl: String? = null,
    @SerialName("status") val status: String = "pending" // 'pending', 'approved', 'rejected'
)
