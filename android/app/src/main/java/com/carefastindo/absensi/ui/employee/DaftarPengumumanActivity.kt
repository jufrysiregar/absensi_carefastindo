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

class DaftarPengumumanActivity : AppCompatActivity() {

    private lateinit var btnBack: ImageButton
    private lateinit var recyclerView: RecyclerView
    private lateinit var progressBar: ProgressBar
    private lateinit var txtNoData: TextView
    private lateinit var layoutEmptyState: LinearLayout

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

        btnBack.setOnClickListener { finish() }

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
                val user = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select { filter { eq("id", userId) } }
                        .decodeSingle<com.carefastindo.absensi.data.model.User>()
                }
                userRole = user.role

                // Reset notifikasi bulan lalu secara otomatis
                deleteLastMonthNotifications()

                loadAnnouncements()
            } catch (e: Exception) {
                progressBar.visibility = View.GONE
                layoutEmptyState.visibility = View.VISIBLE
                txtNoData.text = "Gagal memuat data"
            }
        }
    }

    /**
     * Hapus semua notifikasi dari tabel `notifications` milik user ini
     * yang created_at-nya berada di bulan sebelumnya atau lebih lama.
     * Ini membuat notifikasi ter-reset otomatis setiap ganti bulan.
     */
    private suspend fun deleteLastMonthNotifications() {
        try {
            val cal = Calendar.getInstance()
            cal.set(Calendar.DAY_OF_MONTH, 1)
            cal.set(Calendar.HOUR_OF_DAY, 0)
            cal.set(Calendar.MINUTE, 0)
            cal.set(Calendar.SECOND, 0)
            cal.set(Calendar.MILLISECOND, 0)
            val firstDayOfCurrentMonth = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
                .format(cal.time)

            withContext(Dispatchers.IO) {
                SupabaseClient.db.from("notifications").delete {
                    filter {
                        eq("user_id", userId)
                        lt("created_at", firstDayOfCurrentMonth)
                    }
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun loadAnnouncements() {
        lifecycleScope.launch {
            try {
                // 1. Fetch announcements (pengumuman umum) ordered newest first
                val announcements = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("announcements")
                        .select { order("created_at", Order.DESCENDING) }
                        .decodeList<Announcement>()
                }.filter {
                    it.isActive && (
                        it.targetRole.equals("All", ignoreCase = true) ||
                        it.targetRole.equals(userRole, ignoreCase = true)
                    )
                }

                // 2. Fetch notifications dari admin actions (shift, lembur, ganti off, password)
                //    Hanya bulan ini (setelah deleteLastMonthNotifications)
                val adminNotifs = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("notifications")
                        .select {
                            filter { eq("user_id", userId) }
                            order("created_at", Order.DESCENDING)
                        }
                        .decodeList<com.carefastindo.absensi.data.model.Notification>()
                }

                // 3. Konversi Notification → Announcement agar bisa dipakai adapter yang sama
                val notifAsAnnouncements = adminNotifs.map { notif ->
                    Announcement(
                        id = notif.id ?: "",
                        title = "Super Admin",
                        content = notif.message,
                        targetRole = "All",
                        isActive = true,
                        createdAt = notif.createdAt
                    )
                }

                // 4. Gabungkan: notifikasi admin di atas, pengumuman umum di bawah
                val combined = notifAsAnnouncements + announcements

                // 5. Fetch existing announcement_reads untuk dot unread
                val reads = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("announcement_reads")
                        .select { filter { eq("user_id", userId) } }
                        .decodeList<AnnouncementRead>()
                }
                readIds = reads.map { it.announcementId }.toMutableSet()

                announcementsList = combined

                // 6. Mark semua announcement (bukan notif) sebagai read saat halaman dibuka
                //    Notifikasi admin otomatis dianggap terbaca karena pesan langsung kelihatan
                markAllAsRead(announcements)

                // 7. Mark semua notif admin sebagai is_read = true sekaligus
                markAdminNotifsAsRead(adminNotifs)

                withContext(Dispatchers.Main) {
                    progressBar.visibility = View.GONE
                    if (announcementsList.isEmpty()) {
                        layoutEmptyState.visibility = View.VISIBLE
                        recyclerView.visibility = View.GONE
                    } else {
                        layoutEmptyState.visibility = View.GONE
                        recyclerView.visibility = View.VISIBLE
                        // Semua item dianggap "read" di tampilan karena sudah terbuka
                        adapter.updateData(announcementsList, announcementsList.map { it.id }.toSet())
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    progressBar.visibility = View.GONE
                    layoutEmptyState.visibility = View.VISIBLE
                    txtNoData.text = "Gagal memuat notifikasi"
                }
            }
        }
    }

    /**
     * Mark semua announcement_reads saat halaman dibuka.
     */
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
                        } catch (e: Exception) {
                            // Ignore duplicate key errors
                        }
                    }
                }
                readIds.addAll(unreadIds)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    /**
     * Mark semua notifikasi admin sebagai is_read = true saat halaman notifikasi dibuka.
     */
    private fun markAdminNotifsAsRead(notifs: List<com.carefastindo.absensi.data.model.Notification>) {
        val unreadNotifs = notifs.filter { !it.isRead }
        if (unreadNotifs.isEmpty()) return
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
