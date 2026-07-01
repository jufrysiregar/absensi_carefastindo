package com.carefastindo.absensi.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class AnnouncementRead(
    @SerialName("id") val id: String? = null,
    @SerialName("announcement_id") val announcementId: String,
    @SerialName("user_id") val userId: String,
    @SerialName("read_at") val readAt: String? = null
)
