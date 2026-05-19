package com.carefastindo.absensi.ui.employee

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.ActionBarDrawerToggle
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.GravityCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.carefastindo.absensi.R
import com.carefastindo.absensi.databinding.ActivityEmployeeMainBinding
import com.carefastindo.absensi.ui.login.LoginActivity
import com.carefastindo.absensi.ui.about.TentangAplikasiActivity

class EmployeeMainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityEmployeeMainBinding
    private val viewModel: EmployeeViewModel by viewModels()
    private val historyAdapter = AttendanceHistoryAdapter()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityEmployeeMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupDrawer()
        setupRecyclerView()
        setupListeners()
        observeViewModel()
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
                R.id.nav_leave -> {
                    BottomSheetLeaveRequest().show(supportFragmentManager, "LeaveRequest")
                }
                R.id.nav_tentang -> {
                    startActivity(Intent(this, TentangAplikasiActivity::class.java))
                }
                R.id.nav_logout -> {
                    viewModel.logout()
                    startActivity(Intent(this, LoginActivity::class.java))
                    finish()
                }
                // Handle other menu items
            }
            binding.drawerLayout.closeDrawer(GravityCompat.START)
            true
        }
    }

    private fun setupRecyclerView() {
        binding.rvHistory.apply {
            layoutManager = LinearLayoutManager(this@EmployeeMainActivity)
            adapter = historyAdapter
        }
    }

    private fun setupListeners() {
        binding.btnCheckIn.setOnClickListener {
            if (binding.btnCheckIn.isEnabled) {
                // Trigger QR Code Scanner or Location check here
                Toast.makeText(this, "Membuka Scanner...", Toast.LENGTH_SHORT).show()
            }
        }
        binding.btnBreak.setOnClickListener {
            if (binding.btnBreak.isEnabled) {
                Toast.makeText(this, "Istirahat Dimulai", Toast.LENGTH_SHORT).show()
            }
        }
        binding.btnCheckOut.setOnClickListener {
            if (binding.btnCheckOut.isEnabled) {
                Toast.makeText(this, "Membuka Scanner Kepulangan...", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            viewModel.uiState.collectLatest { state ->
                // Update live clock
                binding.txtLiveTime.text = state.liveTime
                binding.txtLiveDate.text = state.liveDate

                // Update user details
                state.user?.let { user ->
                    binding.txtEmployeeName.text = user.name
                    binding.txtEmployeeRole.text = "${user.role} - Shift ${user.shiftType?.capitalize() ?: "Default"}"
                }

                // Update warning card
                binding.latenessWarningCard.visibility = if (state.showLatenessWarning) View.VISIBLE else View.GONE

                // Update buttons state visually
                binding.btnCheckIn.isEnabled = state.checkInEnabled
                binding.btnCheckIn.alpha = if (state.checkInEnabled) 1.0f else 0.5f

                binding.btnBreak.isEnabled = state.breakEnabled
                binding.btnBreak.alpha = if (state.breakEnabled) 1.0f else 0.5f

                binding.btnCheckOut.isEnabled = state.checkOutEnabled
                binding.btnCheckOut.alpha = if (state.checkOutEnabled) 1.0f else 0.5f

                // Update history
                historyAdapter.submitList(state.history)

                state.errorMessage?.let { msg ->
                    Toast.makeText(this@EmployeeMainActivity, msg, Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    override fun onBackPressed() {
        if (binding.drawerLayout.isDrawerOpen(GravityCompat.START)) {
            binding.drawerLayout.closeDrawer(GravityCompat.START)
        } else {
            super.onBackPressed()
        }
    }
}
