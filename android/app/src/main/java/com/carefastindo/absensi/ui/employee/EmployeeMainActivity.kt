package com.carefastindo.absensi.ui.employee

import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.carefastindo.absensi.R
import com.carefastindo.absensi.data.model.Announcement
import com.carefastindo.absensi.data.model.AnnouncementRead
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.carefastindo.absensi.databinding.ActivityEmployeeMainBinding
import com.carefastindo.absensi.ui.login.LoginActivity
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.tabs.TabLayout
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class EmployeeMainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityEmployeeMainBinding
    private val viewModel: EmployeeViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityEmployeeMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupNavigation()
        observeViewModel()

        // Load default fragment
        if (savedInstanceState == null) {
            replaceFragment(EmployeeDashboardFragment())
        }
    }

    override fun onResume() {
        super.onResume()
        fetchUnreadAnnouncementsCount()
    }

    private fun setupNavigation() {
        // Setup TabLayout
        val tabLayout = binding.tabLayoutNavigation
        tabLayout.addTab(tabLayout.newTab().setText("Dashboard"))
        tabLayout.addTab(tabLayout.newTab().setText("Izin"))
        tabLayout.addTab(tabLayout.newTab().setText("Riwayat"))
        tabLayout.addTab(tabLayout.newTab().setText("Profil"))

        tabLayout.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab) {
                when (tab.position) {
                    0 -> replaceFragment(EmployeeDashboardFragment())
                    1 -> replaceFragment(PengajuanIzinFragment())
                    2 -> replaceFragment(RiwayatAbsensiFragment())
                    3 -> replaceFragment(ProfilFragment())
                }
            }
            override fun onTabUnselected(tab: TabLayout.Tab) {}
            override fun onTabReselected(tab: TabLayout.Tab) {}
        })

        // Notification Bell Click handler
        binding.layoutNotificationBell.setOnClickListener {
            val intent = Intent(this, DaftarPengumumanActivity::class.java)
            startActivity(intent)
        }
    }

    private fun replaceFragment(fragment: Fragment) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.employeeFragmentContainer, fragment)
            .commit()
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            viewModel.uiState.collectLatest { state ->
                state.user?.let { user ->
                    loadHeaderAvatar(user.id)
                    fetchUnreadAnnouncementsCount()
                }
                state.errorMessage?.let { msg ->
                    Toast.makeText(this@EmployeeMainActivity, msg, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun loadHeaderAvatar(userId: String) {
        lifecycleScope.launch {
            try {
                val faces = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("user_faces")
                        .select { filter { eq("user_id", userId) } }
                        .decodeList<com.carefastindo.absensi.data.model.UserFace>()
                }
                val face = faces.firstOrNull()
                withContext(Dispatchers.Main) {
                    if (face != null && !face.facePhotoUrl.isNullOrBlank()) {
                        val photoUrl = face.facePhotoUrl
                        if (photoUrl.startsWith("data:image", ignoreCase = true)) {
                            val base64Data = photoUrl.substringAfter(",", "")
                            val imageBytes = Base64.decode(base64Data, Base64.DEFAULT)
                            val bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
                            binding.imgHeaderAvatar.setImageBitmap(bitmap)
                        } else {
                            com.bumptech.glide.Glide.with(this@EmployeeMainActivity)
                                .load(photoUrl)
                                .placeholder(android.R.drawable.sym_def_app_icon)
                                .into(binding.imgHeaderAvatar)
                        }
                    } else {
                        binding.imgHeaderAvatar.setImageResource(android.R.drawable.sym_def_app_icon)
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun fetchUnreadAnnouncementsCount() {
        val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id ?: return
        val userRole = viewModel.uiState.value.user?.role ?: ""
        
        lifecycleScope.launch {
            try {
                // 1. Fetch announcements
                val allAnnouncements = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("announcements")
                        .select()
                        .decodeList<Announcement>()
                }.filter { it.isActive && (it.targetRole.equals("All", ignoreCase = true) || it.targetRole.equals(userRole, ignoreCase = true)) }

                // 2. Fetch reads
                val readAnnouncements = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("announcement_reads")
                        .select { filter { eq("user_id", userId) } }
                        .decodeList<AnnouncementRead>()
                }

                val readIds = readAnnouncements.map { it.announcementId }.toSet()
                val unreadCount = allAnnouncements.count { it.id !in readIds }

                withContext(Dispatchers.Main) {
                    if (unreadCount > 0) {
                        binding.txtNotifBadge.text = unreadCount.toString()
                        binding.txtNotifBadge.visibility = View.VISIBLE
                    } else {
                        binding.txtNotifBadge.visibility = View.GONE
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun showLogoutConfirmationDialog() {
        MaterialAlertDialogBuilder(this)
            .setTitle("Keluar Aplikasi")
            .setMessage("Apakah Anda yakin ingin keluar dari akun Anda?")
            .setPositiveButton("Ya, Keluar") { _, _ ->
                lifecycleScope.launch {
                    try {
                        withContext(Dispatchers.IO) {
                            SupabaseClient.auth.signOut()
                        }
                        
                        // Navigate back to LoginActivity and clear backstack
                        val intent = Intent(this@EmployeeMainActivity, LoginActivity::class.java)
                        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                        startActivity(intent)
                        finish()
                    } catch (e: Exception) {
                        Toast.makeText(this@EmployeeMainActivity, "Gagal logout: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                    }
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }
}
