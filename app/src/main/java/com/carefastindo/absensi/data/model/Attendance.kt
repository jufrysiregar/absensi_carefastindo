package com.carefastindo.absensi.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Attendance(
    @SerialName("id") val id: String? = null,
    @SerialName("user_id") val userId: String,
    @SerialName("date") val date: String, // YYYY-MM-DD
    @SerialName("check_in_time") val checkInTime: String? = null,
    @SerialName("break_time") val breakTime: String? = null,
    @SerialName("check_out_time") val checkOutTime: String? = null,
    @SerialName("location_lat") val locationLat: Double? = null,
    @SerialName("location_lng") val locationLng: Double? = null,
    @SerialName("status") val status: String, // 'hadir', 'terlambat', 'tidak_absen'
    @SerialName("note") val note: String? = null,
    @SerialName("selfie_url") val selfieUrl: String? = null
)
