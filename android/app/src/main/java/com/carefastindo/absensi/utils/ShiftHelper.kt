package com.carefastindo.absensi.utils

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import com.carefastindo.absensi.data.model.Shift
import com.carefastindo.absensi.data.remote.SupabaseClient
import io.github.jan.supabase.postgrest.postgrest

object ShiftHelper {

    // Cache list
    var cachedShifts = listOf<Shift>()

    suspend fun loadShifts() {
        try {
            cachedShifts = SupabaseClient.db.from("shifts")
                .select()
                .decodeList<Shift>()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // Roles
    const val ROLE_SPV = "supervisor"
    const val ROLE_LEADER = "Leader"
    const val ROLE_CLEANER = "Cleaner"
    const val ROLE_HOUSEKEEPING = "Housekeeping"
    const val ROLE_GARDENER = "Gardener"
    const val ROLE_GONDOLA = "Gondola"

    val shiftRoles = listOf(ROLE_LEADER, ROLE_CLEANER, ROLE_HOUSEKEEPING, ROLE_GARDENER, ROLE_GONDOLA)

    // Shifts
    const val SHIFT_PAGI = "pagi"
    const val SHIFT_SORE = "sore"
    const val SHIFT_MALAM = "malam"

    // Shift Times (in HH:mm format)
    val shiftTimes = mapOf(
        SHIFT_PAGI to Pair("07:00", "15:00"),
        SHIFT_SORE to Pair("15:00", "23:00"),
        SHIFT_MALAM to Pair("23:00", "07:00")
    )

    fun getShiftTimes(role: String, shiftType: String?): Pair<String, String> {
        val found = cachedShifts.find { it.name.equals(shiftType, ignoreCase = true) }
        if (found != null) {
            val start = found.startTime.substring(0, 5)
            val end = found.endTime.substring(0, 5)
            return Pair(start, end)
        }
        val clean = shiftType?.lowercase()
        return when {
            // Nama baru: Shift I / II / III
            clean == "shift i" || clean == "i"   -> Pair("07:00", "15:00")
            clean == "shift ii" || clean == "ii"  -> Pair("15:00", "23:00")
            clean == "shift iii" || clean == "iii" -> Pair("23:00", "07:00")
            clean == "shift kantor" || clean == "kantor" -> Pair("08:00", "17:00")
            // Nama lama (legacy fallback): pagi/sore/malam
            clean == "pagi" || clean == "shift 1" -> Pair("07:00", "15:00")
            clean == "sore" || clean == "shift 2" -> Pair("15:00", "23:00")
            clean == "malam" || clean == "shift 3" -> Pair("23:00", "07:00")
            role == ROLE_SPV || role.equals("supervisor", ignoreCase = true) || role.equals("Kantor", ignoreCase = true) -> Pair("08:00", "17:00")
            else -> Pair("08:00", "17:00")
        }
    }

    fun getDefaultBreakStart(shiftType: String?): String {
        val clean = shiftType?.lowercase()
        return when {
            clean == "shift i"   || clean == "i"   || clean == "pagi"  || clean == "shift 1" -> "11:00"
            clean == "shift ii"  || clean == "ii"  || clean == "sore"  || clean == "shift 2" -> "18:00"
            clean == "shift iii" || clean == "iii" || clean == "malam" || clean == "shift 3" -> "02:00"
            else -> "12:00"
        }
    }

    /**
     * Night Shift Date Helper:
     * For night shifts (23:00 - 07:00), the attendance date registered is the starting day.
     * If user logs in/out in the morning after midnight (between 00:00 and 09:00), 
     * they belong to the shift that started yesterday.
     */
    fun getAttendanceDate(role: String, shiftType: String?): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        val cal = Calendar.getInstance()
        val clean = shiftType?.lowercase()
        
        val isNightShift = clean == "shift iii" || clean == "iii" || clean == "malam" || clean == "shift 3"
        val isSpvOrOffice = role == ROLE_SPV || role.equals("supervisor", ignoreCase = true) || role.equals("Kantor", ignoreCase = true)
        
        if (!isSpvOrOffice && isNightShift) {
            val hour = cal.get(Calendar.HOUR_OF_DAY)
            // If it's between midnight and 09:00 AM, the shift started yesterday
            if (hour in 0..8) {
                cal.add(Calendar.DAY_OF_YEAR, -1)
            }
        }
        return sdf.format(cal.time)
    }

    private fun parseTimeToMinutes(timeStr: String): Int {
        val cleanTime = timeStr.substring(0, 5) // Get "HH:mm"
        val parts = cleanTime.split(":")
        return if (parts.size >= 2) {
            parts[0].toInt() * 60 + parts[1].toInt()
        } else 0
    }

    private fun getCurrentTimeInMinutes(): Int {
        val cal = Calendar.getInstance()
        return cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
    }

    /**
     * Check-in active: 30 minutes before up to 2 hours after jam masuk.
     */
    fun isCheckInWindowActive(role: String, shiftType: String?): Boolean {
        val (masuk, _) = getShiftTimes(role, shiftType)
        val masukMin = parseTimeToMinutes(masuk)
        val currentMin = getCurrentTimeInMinutes()

        val start = masukMin - 30
        val end = masukMin + 120

        // Handle midnight boundaries for night shifts
        return if (start < 0) {
            // e.g. masuk is 23:00 -> start is 22:30. end is 25:00 (01:00 AM next day).
            currentMin >= (start + 1440) || currentMin <= (end - 1440) || currentMin in 0..end
        } else {
            currentMin in start..end
        }
    }

    /**
     * Check-in Status:
     * - (Masuk - 30 min) to (Masuk + 30 min) -> 'hadir'
     * - (Masuk + 30 min) to (Masuk + 2 hr) -> 'terlambat'
     */
    fun calculateCheckInStatus(role: String, shiftType: String?): String {
        val (masuk, _) = getShiftTimes(role, shiftType)
        val masukMin = parseTimeToMinutes(masuk)
        val currentMin = getCurrentTimeInMinutes()

        val limitHadir = masukMin + 30

        return if (currentMin <= limitHadir) {
            "hadir"
        } else {
            "terlambat"
        }
    }

    /**
     * Check-out active: 30 minutes before up to 2 hours after jam pulang.
     */
    fun isCheckOutWindowActive(role: String, shiftType: String?): Boolean {
        val (_, pulang) = getShiftTimes(role, shiftType)
        val pulangMin = parseTimeToMinutes(pulang)
        val currentMin = getCurrentTimeInMinutes()

        val start = pulangMin - 30
        val end = pulangMin + 120

        return if (pulangMin == 420) { // Night shift pulang 07:00 is 420 mins
            currentMin in (start)..(end)
        } else {
            if (start < 0) {
                currentMin >= (start + 1440) || currentMin <= end
            } else if (end >= 1440) {
                currentMin >= start || currentMin <= (end - 1440)
            } else {
                currentMin in start..end
            }
        }
    }

    /**
     * Break active: 5 minutes before to 10 minutes after breakStart.
     * Supervisor is manual and can be done anytime.
     */
    fun isBreakWindowActive(role: String, breakStartStr: String?): Boolean {
        if (role == ROLE_SPV) return true

        val breakStart = breakStartStr ?: "12:00"
        val startMin = parseTimeToMinutes(breakStart)
        val currentMin = getCurrentTimeInMinutes()

        val start = startMin - 5
        val end = startMin + 10

        return if (start < 0) {
            currentMin >= (start + 1440) || currentMin <= end
        } else if (end >= 1440) {
            currentMin >= start || currentMin <= (end - 1440)
        } else {
            currentMin in start..end
        }
    }
}
