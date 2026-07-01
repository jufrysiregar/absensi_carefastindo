package com.carefastindo.absensi.utils

import java.security.MessageDigest

object QRHelper {

    /**
     * Hashes a string using SHA-256.
     */
    fun sha256(input: String): String {
        val bytes = input.toByteArray()
        val md = MessageDigest.getInstance("SHA-256")
        val digest = md.digest(bytes)
        return digest.fold("") { str, it -> str + "%02x".format(it) }
    }

    /**
     * Generates expected security QR hash based on office details and date.
     */
    fun generateQRHash(
        officeLat: Double,
        officeLng: Double,
        date: String,
        shiftCode: String
    ): String {
        val rawString = "$officeLat|$officeLng|$date|$shiftCode"
        return sha256(rawString)
    }

    /**
     * Verifies if scanned hash matches generated office QR token for security validation.
     */
    fun verifyQRHash(
        scannedHash: String,
        officeLat: Double,
        officeLng: Double,
        date: String,
        shiftCode: String
    ): Boolean {
        val expectedHash = generateQRHash(officeLat, officeLng, date, shiftCode)
        return scannedHash.equals(expectedHash, ignoreCase = true)
    }
}
