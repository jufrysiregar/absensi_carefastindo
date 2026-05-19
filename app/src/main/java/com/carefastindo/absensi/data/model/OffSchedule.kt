package com.carefastindo.absensi.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class OffSchedule(
    @SerialName("id") val id: String? = null,
    @SerialName("user_id") val userId: String,
    @SerialName("off_date") val date: String, // YYYY-MM-DD
    @SerialName("reason") val reason: String,
    @SerialName("is_emergency_replaceable") val isEmergencyReplaceable: Boolean = false
)
