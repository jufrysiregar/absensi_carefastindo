package com.carefastindo.absensi.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CompanyConfig(
    @SerialName("id") val id: String = "companyConfig",
    @SerialName("office_lat") val officeLat: Double,
    @SerialName("office_lng") val officeLng: Double,
    @SerialName("radius") val radius: Int, // radius in meters
    @SerialName("default_start_time") val defaultStartTime: String? = "08:00:00",
    @SerialName("default_end_time") val defaultEndTime: String? = "17:00:00",
    @SerialName("qr_secret") val qrSecret: String? = "CARE_OFFICE_MAIN"
)
