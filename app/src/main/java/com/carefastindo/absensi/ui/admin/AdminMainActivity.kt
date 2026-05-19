package com.carefastindo.absensi.ui.admin

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import androidx.viewpager2.adapter.FragmentStateAdapter
import com.carefastindo.absensi.R
import com.carefastindo.absensi.databinding.ActivityAdminMainBinding
import com.carefastindo.absensi.ui.login.LoginActivity
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.google.android.material.tabs.TabLayoutMediator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class AdminMainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAdminMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAdminMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupViewPager()
        setupListeners()
    }

    private fun setupViewPager() {
        val fragments = listOf(
            TabRekapFragment(),
            TabLeaveRequestsFragment(),
            TabEmployeeCrudFragment(),
            TabOffSchedulesFragment(),
            TabEmergencyFragment(),
            TabSalarySlipFragment(),
            TabSettingsFragment(),
            TabViolationsFragment()
        )

        val tabTitles = listOf(
            getString(R.string.tab_rekap),
            getString(R.string.tab_leave_requests),
            getString(R.string.tab_employee_crud),
            getString(R.string.tab_off_schedules),
            getString(R.string.tab_emergency),
            getString(R.string.tab_salary_slip),
            getString(R.string.tab_settings),
            getString(R.string.tab_violations)
        )

        binding.adminViewPager.adapter = AdminPagerAdapter(this, fragments)

        TabLayoutMediator(binding.adminTabLayout, binding.adminViewPager) { tab, position ->
            tab.text = tabTitles[position]
        }.attach()
    }

    private fun setupListeners() {
        binding.btnAdminLogout.setOnClickListener {
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    SupabaseClient.auth.signOut()
                } catch (e: Exception) {}
            }
            startActivity(Intent(this, LoginActivity::class.java))
            finish()
        }
    }

    inner class AdminPagerAdapter(
        activity: FragmentActivity,
        private val fragments: List<Fragment>
    ) : FragmentStateAdapter(activity) {
        override fun getItemCount(): Int = fragments.size
        override fun createFragment(position: Int): Fragment = fragments[position]
    }
}
