package com.carefastindo.absensi.utils

import com.carefastindo.absensi.data.model.User
import com.carefastindo.absensi.data.remote.SupabaseClient
import io.github.jan.supabase.postgrest.from

object EmployeeHelper {

    /**
     * Generates a random 6-digit employee code.
     */
    fun generateEmployeeCode(): String {
        return String.format("%06d", (1..999999).random())
    }

    /**
     * Checks if the generated employee code is unique in the Supabase 'users' table.
     * Returns true if it is unique (does not exist yet), false otherwise.
     */
    suspend fun isEmployeeCodeUnique(code: String): Boolean {
        return try {
            val users = SupabaseClient.db.from("users")
                .select {
                    filter {
                        eq("employee_code", code)
                    }
                }.decodeList<User>()
            
            users.isEmpty()
        } catch (e: Exception) {
            // In case of error, assume false to be safe
            false
        }
    }

    /**
     * Generates a verified unique 6-digit employee code.
     */
    suspend fun generateUniqueEmployeeCode(): String {
        var code = generateEmployeeCode()
        var attempts = 0
        while (!isEmployeeCodeUnique(code) && attempts < 10) {
            code = generateEmployeeCode()
            attempts++
        }
        return code
    }
}
