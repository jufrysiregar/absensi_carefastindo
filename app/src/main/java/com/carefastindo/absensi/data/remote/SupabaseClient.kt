package com.carefastindo.absensi.data.remote

import io.github.jan.tennert.supabase.createSupabaseClient
import io.github.jan.tennert.supabase.auth.Auth
import io.github.jan.tennert.supabase.postgrest.Postgrest
import io.github.jan.tennert.supabase.storage.Storage

object SupabaseClient {
    private const val SUPABASE_URL = "https://rbhloslxavnlhnruzewo.supabase.co"
    private const val SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJiaGxvc2x4YXZubGhucnV6ZXdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNjU5MDAsImV4cCI6MjA5NDc0MTkwMH0.Skisq_2ltA3oiFtInr9Qt59RbU-6VYIlnWMAA3hKvUo"

    val client = createSupabaseClient(
        supabaseUrl = SUPABASE_URL,
        supabaseKey = SUPABASE_KEY
    ) {
        install(Auth)
        install(Postgrest)
        install(Storage)
    }

    val auth: Auth
        get() = client.pluginManager.getPlugin(Auth)

    val db: Postgrest
        get() = client.pluginManager.getPlugin(Postgrest)

    val storage: Storage
        get() = client.pluginManager.getPlugin(Storage)
}
