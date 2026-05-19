package com.carefastindo.absensi.utils

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

object LocationHelper {

    /**
     * Calculates distance in meters between two coordinates using the Haversine formula.
     */
    fun getDistanceInMeters(
        lat1: Double, lon1: Double,
        lat2: Double, lon2: Double
    ): Double {
        val earthRadius = 6371000.0 // in meters
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        
        val a = sin(dLat / 2) * sin(dLat / 2) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
                sin(dLon / 2) * sin(dLon / 2)
        
        val c = 2 * asin(sqrt(a))
        return earthRadius * c
    }

    /**
     * Checks if coordinates are within a specified radius (in meters) of office location.
     */
    fun isWithinRadius(
        officeLat: Double, officeLng: Double,
        userLat: Double, userLng: Double,
        allowedRadius: Double
    ): Boolean {
        val distance = getDistanceInMeters(officeLat, officeLng, userLat, userLng)
        return distance <= allowedRadius
    }
}
