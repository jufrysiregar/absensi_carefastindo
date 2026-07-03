package com.carefastindo.absensi.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CompanyConfig(
    @SerialName("id") val id: String = "companyConfig",
    @SerialName("office_lat") val officeLat: Double,
    @SerialName("office_lng") val officeLng: Double,
    @SerialName("radius") val radius: Int,
    @SerialName("qr_secret") val qrSecret: String? = "CARE_OFFICE_MAIN"
)
