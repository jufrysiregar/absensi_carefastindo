package com.carefastindo.absensi.ui.admin

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.fragment.app.Fragment
import com.carefastindo.absensi.R

open class GenericTabFragment(private val title: String) : Fragment() {
    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_admin_tab_generic, container, false)
        view.findViewById<TextView>(R.id.txtPlaceholder).text = title
        return view
    }
}

class TabRekapFragment : GenericTabFragment("Rekap Absensi Hari Ini")
class TabLeaveRequestsFragment : GenericTabFragment("Daftar Pengajuan Izin/Sakit")
class TabEmployeeCrudFragment : GenericTabFragment("Manajemen Karyawan")
class TabOffSchedulesFragment : GenericTabFragment("Pengaturan Jadwal Off")
class TabEmergencyFragment : GenericTabFragment("Tugas Darurat & Lembur")
class TabSalarySlipFragment : GenericTabFragment("Manajemen Slip Gaji")
class TabSettingsFragment : GenericTabFragment("Pengaturan Lokasi & Jam Kerja")
class TabViolationsFragment : GenericTabFragment("Pelanggaran & Peringatan")
