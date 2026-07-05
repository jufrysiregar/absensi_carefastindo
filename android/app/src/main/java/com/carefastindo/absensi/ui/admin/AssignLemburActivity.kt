package com.carefastindo.absensi.ui.admin

import android.app.DatePickerDialog
import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.carefastindo.absensi.data.model.OvertimeAssignment
import com.carefastindo.absensi.data.model.Shift
import com.carefastindo.absensi.data.model.User
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.carefastindo.absensi.databinding.ActivityAssignLemburBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

class AssignLemburActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAssignLemburBinding
    private var usersList = listOf<User>()
    private var shiftsList = listOf<Shift>()
    private var selectedDate: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAssignLemburBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnBack.setOnClickListener { finish() }

        binding.btnPickDate.setOnClickListener { showDatePicker() }

        binding.btnSubmit.setOnClickListener { submitLembur() }

        loadData()
    }

    private fun loadData() {
        binding.loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                // Fetch active users (except superadmin)
                usersList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select { filter { eq("is_active", true) } }
                        .decodeList<User>()
                }.filter { !it.role.equals("superadmin", ignoreCase = true) }

                // Fetch active shifts
                shiftsList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("shifts")
                        .select { filter { eq("is_active", true) } }
                        .decodeList<Shift>()
                }

                // Setup Spinners
                val userNames = usersList.map { it.name }.toTypedArray()
                binding.spinEmployee.adapter = ArrayAdapter(
                    this@AssignLemburActivity,
                    android.R.layout.simple_spinner_dropdown_item,
                    userNames
                )

                val shiftNames = shiftsList.map { it.name }.toTypedArray()
                binding.spinShift.adapter = ArrayAdapter(
                    this@AssignLemburActivity,
                    android.R.layout.simple_spinner_dropdown_item,
                    shiftNames
                )

            } catch (e: Exception) {
                Toast.makeText(this@AssignLemburActivity, "Gagal memuat data: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            } finally {
                binding.loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun showDatePicker() {
        val calendar = Calendar.getInstance()
        val dateSetListener = DatePickerDialog.OnDateSetListener { _, year, month, dayOfMonth ->
            calendar.set(Calendar.YEAR, year)
            calendar.set(Calendar.MONTH, month)
            calendar.set(Calendar.DAY_OF_MONTH, dayOfMonth)
            
            val formatStr = "yyyy-MM-dd"
            val sdf = SimpleDateFormat(formatStr, Locale.getDefault())
            selectedDate = sdf.format(calendar.time)
            
            val displayFormat = SimpleDateFormat("EEEE, dd MMM yyyy", Locale("id", "ID"))
            binding.btnPickDate.text = displayFormat.format(calendar.time)
        }

        DatePickerDialog(
            this,
            dateSetListener,
            calendar.get(Calendar.YEAR),
            calendar.get(Calendar.MONTH),
            calendar.get(Calendar.DAY_OF_MONTH)
        ).show()
    }

    private fun submitLembur() {
        val selectedUserIndex = binding.spinEmployee.selectedItemPosition
        val selectedShiftIndex = binding.spinShift.selectedItemPosition

        if (selectedUserIndex < 0 || selectedUserIndex >= usersList.size) {
            Toast.makeText(this, "Silakan pilih pegawai", Toast.LENGTH_SHORT).show()
            return
        }

        if (selectedShiftIndex < 0 || selectedShiftIndex >= shiftsList.size) {
            Toast.makeText(this, "Silakan pilih shift lembur", Toast.LENGTH_SHORT).show()
            return
        }

        if (selectedDate == null) {
            Toast.makeText(this, "Silakan pilih tanggal lembur", Toast.LENGTH_SHORT).show()
            return
        }

        val keterangan = binding.etKeterangan.text.toString().trim()
        if (keterangan.isEmpty()) {
            Toast.makeText(this, "Keterangan wajib diisi", Toast.LENGTH_SHORT).show()
            return
        }

        val user = usersList[selectedUserIndex]
        val shift = shiftsList[selectedShiftIndex]
        val currentAdminId = SupabaseClient.auth.currentSessionOrNull()?.user?.id

        binding.loadingOverlay.visibility = View.VISIBLE
        binding.btnSubmit.isEnabled = false

        lifecycleScope.launch {
            try {
                val newAssignment = OvertimeAssignment(
                    userId = user.id,
                    shiftId = shift.id ?: "",
                    assignmentDate = selectedDate!!,
                    assignedBy = currentAdminId,
                    assignedFrom = "android",
                    shiftType = "lembur",
                    status = "pending",
                    keterangan = keterangan
                )

                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("overtime_assignments").insert(newAssignment)
                }

                Toast.makeText(this@AssignLemburActivity, "Assign Lembur Berhasil!", Toast.LENGTH_SHORT).show()
                finish()
            } catch (e: Exception) {
                Toast.makeText(this@AssignLemburActivity, "Gagal assign lembur: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            } finally {
                binding.loadingOverlay.visibility = View.GONE
                binding.btnSubmit.isEnabled = true
            }
        }
    }
}
