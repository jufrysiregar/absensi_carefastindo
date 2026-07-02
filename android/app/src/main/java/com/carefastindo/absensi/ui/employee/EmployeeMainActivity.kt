package com.carefastindo.absensi.ui.employee

import android.animation.AnimatorInflater
import android.animation.ObjectAnimator
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
    private var blinkAnimator: ObjectAnimator? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityEmployeeMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupNavigation()
        observeViewModel()

        if (savedInstanceState == null) {
            replaceFragment(EmployeeDashboardFragment())
        }
    }

    override fun onResume() {
        super.onResume()
        // Setiap kali kembali ke dashboard (misal setelah tutup halaman notifikasi),
        // re-cek apakah masih ada unread
        fetchUnreadAnnouncementsCount()
    }

    override fun onDestroy() {
        super.onDestroy()
        blinkAnimator?.cancel()
    }

    private fun setupNavigation() {
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

        // Bell → buka halaman Notifikasi
        binding.layoutNotificationBell.setOnClickListener {
            startActivity(Intent(this, DaftarPengumumanActivity::class.java))
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

    /**
     * Cek notifikasi yang belum dibaca.
     * Jika ada → tampilkan titik kuning berkedip di ikon lonceng.
     * Jika tidak ada → sembunyikan titik.
     */
    fun fetchUnreadAnnouncementsCount() {
        val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id ?: return
        val userRole = viewModel.uiState.value.user?.role ?: ""

        lifecycleScope.launch {
            try {
                val allAnnouncements = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("announcements")
                        .select()
                        .decodeList<Announcement>()
                }.filter {
                    it.isActive && (
                        it.targetRole.equals("All", ignoreCase = true) ||
                        it.targetRole.equals(userRole, ignoreCase = true)
                    )
                }

                val readAnnouncements = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("announcement_reads")
                        .select { filter { eq("user_id", userId) } }
                        .decodeList<AnnouncementRead>()
                }

                val readIds = readAnnouncements.map { it.announcementId }.toSet()
                val hasUnread = allAnnouncements.any { it.id !in readIds }

                withContext(Dispatchers.Main) {
                    showNotifDot(hasUnread)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun showNotifDot(show: Boolean) {
        val dot = binding.viewNotifDot
        if (show) {
            dot.visibility = View.VISIBLE
            // Mulai animasi blink jika belum berjalan
            if (blinkAnimator == null || blinkAnimator?.isRunning == false) {
                blinkAnimator = AnimatorInflater.loadAnimator(this, R.anim.blink) as ObjectAnimator
                blinkAnimator?.target = dot
                blinkAnimator?.start()
            }
        } else {
            dot.visibility = View.GONE
            blinkAnimator?.cancel()
            blinkAnimator = null
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
                        val intent = Intent(this@EmployeeMainActivity, LoginActivity::class.java)
                        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                        startActivity(intent)
                        finish()
                    } catch (e: Exception) {
                        Toast.makeText(
                            this@EmployeeMainActivity,
                            "Gagal logout: ${e.localizedMessage}",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }
            }
            .setNegativeButton("Batal", null)
            .show()
    }
}
