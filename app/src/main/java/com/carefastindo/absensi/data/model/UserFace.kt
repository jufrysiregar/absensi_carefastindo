package com.carefastindo.absensi.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class UserFace(
    @SerialName("user_id") val userId: String,
    @SerialName("face_vector") val faceVector: String, // JSON array string of floats
    @SerialName("face_photo_url") val facePhotoUrl: String? = null
)
