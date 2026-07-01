package com.carefastindo.absensi.ui.employee

import android.os.Bundle
import android.view.View
import android.widget.ImageButton
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

    private lateinit var adapter: AnnouncementAdapter
    private var announcementsList = listOf<Announcement>()
    private var readIds = setOf<String>()

    private var userId: String = ""
    private var userRole: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_daftar_pengumuman)

        btnBack = findViewById(R.id.btnBack)
        recyclerView = findViewById(R.id.recyclerViewAnnouncements)
        progressBar = findViewById(R.id.progressBar)
        txtNoData = findViewById(R.id.txtNoData)

        btnBack.setOnClickListener { finish() }

        recyclerView.layoutManager = LinearLayoutManager(this)
        adapter = AnnouncementAdapter(emptyList(), emptySet()) { announcement ->
            markAsRead(announcement.id)
        }
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
        txtNoData.visibility = View.GONE

        lifecycleScope.launch {
            try {
                // Get user's role from users table
                val user = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select {
                            filter {
                                eq("id", userId)
                            }
                        }.decodeSingle<com.carefastindo.absensi.data.model.User>()
                }
                userRole = user.role

                loadAnnouncements()

            } catch (e: Exception) {
                progressBar.visibility = View.GONE
                txtNoData.visibility = View.VISIBLE
                txtNoData.text = "Gagal memuat profil: ${e.localizedMessage}"
            }
        }
    }

    private fun loadAnnouncements() {
        lifecycleScope.launch {
            try {
                // 1. Fetch announcements ordered by created_at DESC
                val all = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("announcements")
                        .select {
                            order("created_at", Order.DESCENDING)
                        }
                        .decodeList<Announcement>()
                }.filter { it.isActive && (it.targetRole.equals("All", ignoreCase = true) || it.targetRole.equals(userRole, ignoreCase = true)) }

                // 2. Fetch read logs for this user
                val reads = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("announcement_reads")
                        .select {
                            filter {
                                eq("user_id", userId)
                            }
                        }
                        .decodeList<AnnouncementRead>()
                }

                announcementsList = all
                readIds = reads.map { it.announcementId }.toSet()

                withContext(Dispatchers.Main) {
                    progressBar.visibility = View.GONE
                    if (announcementsList.isEmpty()) {
                        txtNoData.visibility = View.VISIBLE
                        recyclerView.visibility = View.GONE
                    } else {
                        txtNoData.visibility = View.GONE
                        recyclerView.visibility = View.VISIBLE
                        adapter.updateData(announcementsList, readIds)
                    }
                }

            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    progressBar.visibility = View.GONE
                    txtNoData.visibility = View.VISIBLE
                    txtNoData.text = "Gagal memuat pengumuman: ${e.localizedMessage}"
                }
            }
        }
    }

    private fun markAsRead(announcementId: String) {
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("announcement_reads")
                        .insert(AnnouncementRead(announcementId = announcementId, userId = userId))
                }
                
                // Update local read set and adapter without fully reloading
                readIds = readIds + announcementId
                withContext(Dispatchers.Main) {
                    adapter.updateData(announcementsList, readIds)
                }

            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}
