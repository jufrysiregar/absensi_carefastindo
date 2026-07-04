package com.carefastindo.absensi.ui.employee

import android.os.Bundle
import android.view.View
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.carefastindo.absensi.R
import com.carefastindo.absensi.data.model.Announcement
import com.carefastindo.absensi.data.model.AnnouncementRead
import com.carefastindo.absensi.data.remote.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.UUID

class DaftarPengumumanActivity : AppCompatActivity() {

    private lateinit var btnBack: ImageButton
    private lateinit var recyclerView: RecyclerView
    private lateinit var progressBar: ProgressBar
    private lateinit var txtNoData: TextView
    private lateinit var layoutEmptyState: LinearLayout
    private lateinit var swipeRefreshLayout: SwipeRefreshLayout

    private lateinit var adapter: AnnouncementAdapter
    private var announcementsList = listOf<Announcement>()
    private var readIds = mutableSetOf<String>()

    private var userId: String = ""
    private var userRole: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_daftar_pengumuman)

        btnBack = findViewById(R.id.btnBack)
        recyclerView = findViewById(R.id.recyclerViewAnnouncements)
        progressBar = findViewById(R.id.progressBar)
        txtNoData = findViewById(R.id.txtNoData)
        layoutEmptyState = findViewById(R.id.layoutEmptyState)
        swipeRefreshLayout = findViewById(R.id.swipeRefreshLayout)

        btnBack.setOnClickListener { finish() }

        // Warna indikator refresh hitam
        swipeRefreshLayout.setColorSchemeResources(android.R.color.black)
        swipeRefreshLayout.setOnRefreshListener {
            loadAnnouncements(isRefresh = true)
        }

        recyclerView.layoutManager = LinearLayoutManager(this)
        adapter = AnnouncementAdapter(emptyList(), emptySet()) { /* semua langsung terbaca saat halaman dibuka */ }
        recyclerView.adapter = adapter

        userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id ?: ""
        loadUserDataAndAnnouncements()
    }

    private fun loadUserDataAndAnnouncements() {
        if (userId.isEmpty()) {
            Toast.makeText(this, "Sesi tidak valid", Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        progressBar.visibility = View.VISIBLE
        recyclerView.visibility = View.GONE
        layoutEmptyState.visibility = View.GONE

        lifecycleScope.launch {
            try {
                // Fetch user role
                val user = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select { filter { eq("id", userId) } }
                        .decodeSingle<com.carefastindo.absensi.data.model.User>()
                }
                userRole = user.role

                // Reset notifikasi bulan lalu
                deleteLastMonthNotifications()

                loadAnnouncements(isRefresh = false)
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    progressBar.visibility = View.GONE
                    showEmptyState("Gagal memuat data pengguna")
                }
            }
        }
    }

    /**
     * Hapus semua notifikasi bulan lalu milik user ini.
     * Tidak akan crash walau gagal — cukup log error.
     */
    private suspend fun deleteLastMonthNotifications() {
        try {
            val cal = Calendar.getInstance()
            cal.set(Calendar.DAY_OF_MONTH, 1)
            cal.set(Calendar.HOUR_OF_DAY, 0)
            cal.set(Calendar.MINUTE, 0)
            cal.set(Calendar.SECOND, 0)
            cal.set(Calendar.MILLISECOND, 0)
            val firstDayOfCurrentMonth = SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault()
            ).format(cal.time)

            withContext(Dispatchers.IO) {
                SupabaseClient.db.from("notifications").delete {
                    filter {
                        eq("user_id", userId)
                        lt("created_at", firstDayOfCurrentMonth)
                    }
                }
            }
        } catch (e: Exception) {
            // Tidak fatal — lanjut saja
            e.printStackTrace()
        }
    }

    private fun loadAnnouncements(isRefresh: Boolean = false) {
        if (!isRefresh) {
            progressBar.visibility = View.VISIBLE
            recyclerView.visibility = View.GONE
            layoutEmptyState.visibility = View.GONE
        }

        lifecycleScope.launch {
            try {
                // 1. Fetch notifikasi personal dari admin actions (shift, lembur, ganti off, password)
                val adminNotifs = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("notifications")
                        .select {
                            filter { eq("user_id", userId) }
                            order("created_at", Order.DESCENDING)
                        }
                        .decodeList<com.carefastindo.absensi.data.model.Notification>()
                }

                // 2. Konversi Notification → Announcement (pakai UUID baru kalau id null)
                val notifAsAnnouncements = adminNotifs.map { notif ->
                    Announcement(
                        id = notif.id ?: UUID.randomUUID().toString(),
                        title = "Super Admin",
                        content = notif.message,
                        targetRole = "All",
                        isActive = true,
                        createdAt = notif.createdAt
                    )
                }

                // 3. Fetch pengumuman umum perusahaan
                val announcements = try {
                    withContext(Dispatchers.IO) {
                        SupabaseClient.db.from("announcements")
                            .select { order("created_at", Order.DESCENDING) }
                            .decodeList<Announcement>()
                    }.filter {
                        it.isActive && (
                            it.targetRole.equals("All", ignoreCase = true) ||
                            it.targetRole.equals(userRole, ignoreCase = true)
                        )
                    }
                } catch (e: Exception) {
                    // Jika tabel announcements error, jangan hentikan seluruhnya
                    e.printStackTrace()
                    emptyList()
                }

                // 4. Gabungkan: notif admin di atas, pengumuman di bawah
                val combined = notifAsAnnouncements + announcements

                // 5. Fetch existing reads untuk dot unread
                val reads = try {
                    withContext(Dispatchers.IO) {
                        SupabaseClient.db.from("announcement_reads")
                            .select { filter { eq("user_id", userId) } }
                            .decodeList<AnnouncementRead>()
                    }
                } catch (e: Exception) {
                    emptyList()
                }
                readIds = reads.map { it.announcementId }.toMutableSet()
                announcementsList = combined

                // 6. Mark pengumuman sebagai read
                markAllAsRead(announcements)

                // 7. Mark notif admin sebagai is_read = true
                markAdminNotifsAsRead(adminNotifs)

                withContext(Dispatchers.Main) {
                    progressBar.visibility = View.GONE
                    swipeRefreshLayout.isRefreshing = false
                    if (combined.isEmpty()) {
                        showEmptyState("Belum ada notifikasi saat ini")
                    } else {
                        layoutEmptyState.visibility = View.GONE
                        recyclerView.visibility = View.VISIBLE
                        // Semua item ditampilkan sebagai "read" karena pesan sudah terlihat
                        adapter.updateData(combined, combined.map { it.id }.toSet())
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    progressBar.visibility = View.GONE
                    swipeRefreshLayout.isRefreshing = false
                    showEmptyState("Gagal memuat notifikasi")
                    Toast.makeText(
                        this@DaftarPengumumanActivity,
                        "Error: ${e.message ?: "Unknown error"}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    private fun showEmptyState(message: String) {
        txtNoData.text = message
        layoutEmptyState.visibility = View.VISIBLE
        recyclerView.visibility = View.GONE
    }

    private fun markAllAsRead(announcements: List<Announcement>) {
        lifecycleScope.launch {
            val unreadIds = announcements.map { it.id }.filter { it !in readIds }
            if (unreadIds.isEmpty()) return@launch
            try {
                withContext(Dispatchers.IO) {
                    for (id in unreadIds) {
                        try {
                            SupabaseClient.db.from("announcement_reads")
                                .insert(AnnouncementRead(announcementId = id, userId = userId))
                        } catch (_: Exception) {
                            // Abaikan duplicate key
                        }
                    }
                }
                readIds.addAll(unreadIds)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun markAdminNotifsAsRead(notifs: List<com.carefastindo.absensi.data.model.Notification>) {
        val hasUnread = notifs.any { !it.isRead }
        if (!hasUnread) return
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("notifications").update({
                        set("is_read", true)
                    }) {
                        filter {
                            eq("user_id", userId)
                            eq("is_read", false)
                        }
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}
