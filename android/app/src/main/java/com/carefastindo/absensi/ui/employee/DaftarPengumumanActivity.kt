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
        adapter = AnnouncementAdapter(emptyList(), emptySet()) { /* no-op, all read on open */ }
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
                loadAnnouncements()
            } catch (e: Exception) {
                progressBar.visibility = View.GONE
                layoutEmptyState.visibility = View.VISIBLE
                txtNoData.text = "Gagal memuat data"
            }
        }
    }

    private fun loadAnnouncements() {
        lifecycleScope.launch {
            try {
                // 1. Fetch announcements ordered newest first
                val all = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("announcements")
                        .select { order("created_at", Order.DESCENDING) }
                        .decodeList<Announcement>()
                }.filter {
                    it.isActive && (
                        it.targetRole.equals("All", ignoreCase = true) ||
                        it.targetRole.equals(userRole, ignoreCase = true)
                    )
                }

                // 2. Fetch existing reads for this user
                val reads = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("announcement_reads")
                        .select { filter { eq("user_id", userId) } }
                        .decodeList<AnnouncementRead>()
                }
                readIds = reads.map { it.announcementId }.toMutableSet()

                announcementsList = all

                // 3. Mark all unread as read (opening = semuanya dibaca)
                markAllAsRead(all)

                withContext(Dispatchers.Main) {
                    progressBar.visibility = View.GONE
                    if (announcementsList.isEmpty()) {
                        layoutEmptyState.visibility = View.VISIBLE
                        recyclerView.visibility = View.GONE
                    } else {
                        layoutEmptyState.visibility = View.GONE
                        recyclerView.visibility = View.VISIBLE
                        adapter.updateData(announcementsList, readIds)
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
     * Saat halaman dibuka, semua notifikasi yang belum dibaca langsung di-mark read.
     * Ini juga membuat titik kuning di lonceng hilang saat user kembali ke dashboard.
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
                            // Ignore duplicate key errors (already read)
                        }
                    }
                }
                // Update local set so adapter shows all as read
                readIds.addAll(unreadIds)
                withContext(Dispatchers.Main) {
                    adapter.updateData(announcementsList, readIds)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}
