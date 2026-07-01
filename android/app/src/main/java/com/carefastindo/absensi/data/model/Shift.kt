package com.carefastindo.absensi.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Shift(
    @SerialName("id") val id: String,
    @SerialName("name") val name: String,
    @SerialName("start_time") val startTime: String,
    @SerialName("end_time") val endTime: String,
    @SerialName("break_start") val breakStart: String? = null,
    @SerialName("break_end") val breakEnd: String? = null,
    @SerialName("is_active") val isActive: Boolean = true
)
