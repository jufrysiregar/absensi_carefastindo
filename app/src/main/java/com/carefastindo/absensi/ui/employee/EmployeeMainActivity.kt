package com.carefastindo.absensi.ui.employee

import android.content.Intent
import android.os.Bundle
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
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.carefastindo.absensi.databinding.ActivityEmployeeMainBinding
import com.carefastindo.absensi.ui.login.LoginActivity
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import io.github.jan.supabase.auth.auth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class EmployeeMainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityEmployeeMainBinding
    private val viewModel: EmployeeViewModel by viewModels()

    private lateinit var headerName: TextView
    private lateinit var headerEmail: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityEmployeeMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupDrawer()
        observeViewModel()

        // Load default fragment
        if (savedInstanceState == null) {
            replaceFragment(EmployeeDashboardFragment(), "Dashboard Absensi")
            binding.navView.setCheckedItem(R.id.nav_home)
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

        // Get header views
        val headerView = binding.navView.getHeaderView(0)
        headerName = headerView.findViewById(R.id.navHeaderName)
        headerEmail = headerView.findViewById(R.id.navHeaderEmail)

        binding.navView.setNavigationItemSelectedListener { menuItem ->
            when (menuItem.itemId) {
                R.id.nav_home -> {
                    replaceFragment(EmployeeDashboardFragment(), "Dashboard Absensi")
                }
                R.id.nav_leave -> {
                    replaceFragment(PengajuanIzinFragment(), "Pengajuan Izin/Sakit")
                }
                R.id.nav_history -> {
                    replaceFragment(RiwayatAbsensiFragment(), "Riwayat Absensi")
                }
                R.id.nav_profile -> {
                    replaceFragment(ProfilFragment(), "Profil Pengguna")
                }
                R.id.nav_tentang -> {
                    replaceFragment(TentangAplikasiFragment(), "Tentang Aplikasi")
                }
                R.id.nav_logout -> {
                    showLogoutConfirmationDialog()
                }
            }
            binding.drawerLayout.closeDrawer(GravityCompat.START)
            true
        }
    }

    private fun replaceFragment(fragment: Fragment, title: String) {
        binding.txtToolbarTitle.text = title
        supportFragmentManager.beginTransaction()
            .replace(R.id.employeeFragmentContainer, fragment)
            .commit()
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            viewModel.uiState.collectLatest { state ->
                state.user?.let { user ->
                    headerName.text = user.name
                    headerEmail.text = user.email
                }
                state.errorMessage?.let { msg ->
                    Toast.makeText(this@EmployeeMainActivity, msg, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun showLogoutConfirmationDialog() {
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

    override fun onBackPressed() {
        if (binding.drawerLayout.isDrawerOpen(GravityCompat.START)) {
            binding.drawerLayout.closeDrawer(GravityCompat.START)
        } else {
            super.onBackPressed()
        }
    }
}
