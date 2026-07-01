package com.carefastindo.absensi.ui.admin

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.ActionBarDrawerToggle
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.GravityCompat
import androidx.fragment.app.Fragment
import com.carefastindo.absensi.R
import com.carefastindo.absensi.databinding.ActivityAdminMainBinding
import com.carefastindo.absensi.ui.about.TentangAplikasiActivity
import com.carefastindo.absensi.ui.login.LoginActivity
import com.carefastindo.absensi.data.remote.SupabaseClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class AdminMainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAdminMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAdminMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupDrawer()
        
        // Load default fragment on startup
        if (savedInstanceState == null) {
            replaceFragment(TabDashboardFragment(), "Dashboard Admin")
            binding.navView.setCheckedItem(R.id.nav_admin_dashboard)
        }
    }

    private fun setupDrawer() {
        val toggle = ActionBarDrawerToggle(
            this, binding.drawerLayout, R.string.menu_home, R.string.menu_home
        )
        binding.drawerLayout.addDrawerListener(toggle)
        toggle.syncState()

        binding.btnMenu.setOnClickListener {
            binding.drawerLayout.openDrawer(GravityCompat.START)
        }

        binding.navView.setNavigationItemSelectedListener { menuItem ->
            when (menuItem.itemId) {
                R.id.nav_admin_dashboard -> {
                    replaceFragment(TabDashboardFragment(), "Dashboard Admin")
                }
                R.id.nav_admin_rekap -> {
                    replaceFragment(TabRekapFragment(), "Rekap Absensi")
                }
                R.id.nav_admin_leave -> {
                    replaceFragment(TabLeaveRequestsFragment(), "Pengajuan Izin")
                }
                R.id.nav_admin_employee -> {
                    replaceFragment(TabEmployeeCrudFragment(), "Manajemen Pegawai")
                }
                R.id.nav_admin_off -> {
                    replaceFragment(TabOffSchedulesFragment(), "Jadwal Off Pegawai")
                }
                R.id.nav_admin_emergency -> {
                    replaceFragment(TabEmergencyFragment(), "Darurat & Lembur")
                }
                R.id.nav_admin_salary -> {
                    replaceFragment(TabSalarySlipFragment(), "Slip Gaji Generator")
                }
                R.id.nav_admin_settings -> {
                    replaceFragment(TabSettingsFragment(), "Pengaturan Kantor")
                }
                R.id.nav_admin_tentang -> {
                    startActivity(Intent(this, TentangAplikasiActivity::class.java))
                }
                R.id.nav_admin_logout -> {
                    logoutAdmin()
                }
            }
            binding.drawerLayout.closeDrawer(GravityCompat.START)
            true
        }
    }

    private fun replaceFragment(fragment: Fragment, title: String) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.adminFragmentContainer, fragment)
            .commit()
        binding.txtToolbarTitle.text = title
    }

    private fun logoutAdmin() {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                SupabaseClient.auth.signOut()
            } catch (e: Exception) {}
        }
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    override fun onBackPressed() {
        if (binding.drawerLayout.isDrawerOpen(GravityCompat.START)) {
            binding.drawerLayout.closeDrawer(GravityCompat.START)
        } else {
            super.onBackPressed()
        }
    }
}
