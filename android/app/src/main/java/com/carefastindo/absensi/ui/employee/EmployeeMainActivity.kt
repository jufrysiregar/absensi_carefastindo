package com.carefastindo.absensi.ui.employee

import android.animation.AnimatorInflater
import android.animation.ObjectAnimator
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Bundle
import android.util.Base64
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.ActionBarDrawerToggle
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.GravityCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.carefastindo.absensi.R
import com.carefastindo.absensi.data.model.Announcement
import com.carefastindo.absensi.data.model.AnnouncementRead
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.carefastindo.absensi.databinding.ActivityEmployeeMainBinding
import com.carefastindo.absensi.ui.about.TentangAplikasiActivity
import com.carefastindo.absensi.ui.login.LoginActivity
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.navigation.NavigationView
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

        setupDrawer()
        observeViewModel()

        if (savedInstanceState == null) {
            replaceFragment(EmployeeDashboardFragment(), "Dashboard")
            binding.navView.setCheckedItem(R.id.nav_emp_dashboard)
        }
    }

    override fun onResume() {
        super.onResume()
        fetchUnreadAnnouncementsCount()
    }

    override fun onDestroy() {
        super.onDestroy()
        blinkAnimator?.cancel()
    }

    override fun onBackPressed() {
        if (binding.drawerLayout.isDrawerOpen(GravityCompat.START)) {
            binding.drawerLayout.closeDrawer(GravityCompat.START)
        } else {
            super.onBackPressed()
        }
    }

    private fun setupDrawer() {
        // Hamburger button buka drawer
        binding.btnMenu.setOnClickListener {
            binding.drawerLayout.openDrawer(GravityCompat.START)
        }

        // Bell → buka halaman Notifikasi
        binding.layoutNotificationBell.setOnClickListener {
            startActivity(Intent(this, DaftarPengumumanActivity::class.java))
        }

        // Navigation item listener
        binding.navView.setNavigationItemSelectedListener { menuItem ->
            when (menuItem.itemId) {
                R.id.nav_emp_dashboard -> replaceFragment(EmployeeDashboardFragment(), "Dashboard")
                R.id.nav_emp_izin      -> replaceFragment(PengajuanIzinFragment(), "Pengajuan Cuti")
                R.id.nav_emp_riwayat   -> replaceFragment(RiwayatAbsensiFragment(), "Riwayat Absensi")
                R.id.nav_emp_profil    -> replaceFragment(ProfilFragment(), "Profil")
                R.id.nav_emp_tentang   -> startActivity(Intent(this, TentangAplikasiActivity::class.java))
                R.id.nav_emp_logout    -> showLogoutConfirmationDialog()
            }
            binding.drawerLayout.closeDrawer(GravityCompat.START)
            true
        }
    }

    private fun replaceFragment(fragment: Fragment, title: String = "") {
        supportFragmentManager.beginTransaction()
            .replace(R.id.employeeFragmentContainer, fragment)
            .commit()
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            viewModel.uiState.collectLatest { state ->
                state.user?.let { user ->
                    // Update nav header nama & role
                    val headerView = binding.navView.getHeaderView(0)
                    headerView?.findViewById<TextView>(R.id.navHeaderEmpName)?.text = user.name
                    headerView?.findViewById<TextView>(R.id.navHeaderEmpRole)?.text =
                        "${user.position ?: user.role} – ${user.shiftType ?: "-"}"

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
