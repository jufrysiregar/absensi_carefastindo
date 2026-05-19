package com.carefastindo.absensi.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class SalarySlip(
    @SerialName("id") val id: String? = null,
    @SerialName("user_id") val userId: String,
    @SerialName("month_year") val monthYear: String, // MM-YYYY
    @SerialName("base_salary") val baseSalary: Double,
    @SerialName("deductions") val deductions: Double,
    @SerialName("bonus") val bonus: Double,
    @SerialName("net_salary") val netSalary: Double,
    @SerialName("pdf_url") val pdfUrl: String? = null
)
