package com.carefastindo.absensi.ui.admin

import android.app.DatePickerDialog
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.core.content.FileProvider
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.carefastindo.absensi.R
import com.carefastindo.absensi.data.model.*
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.carefastindo.absensi.utils.EmployeeHelper
import com.carefastindo.absensi.utils.ShiftHelper
import com.google.android.material.button.MaterialButton
import com.google.android.material.floatingactionbutton.FloatingActionButton
import com.google.android.material.snackbar.Snackbar
import com.google.android.material.textfield.TextInputEditText
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.storage.storage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.*

// iText 7 imports for pay slip generator
import com.itextpdf.kernel.pdf.PdfDocument
import com.itextpdf.kernel.pdf.PdfWriter
import com.itextpdf.layout.Document
import com.itextpdf.layout.element.Paragraph
import com.itextpdf.layout.element.Table
import com.itextpdf.layout.element.Cell
import com.itextpdf.layout.properties.TextAlignment

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

// ==========================================
// 1. DASHBOARD RINGKASAN FRAGMENT
// ==========================================
class TabDashboardFragment : Fragment() {
    private lateinit var txtWelcome: TextView
    private lateinit var txtDate: TextView
    private lateinit var txtCountHadir: TextView
    private lateinit var txtCountIzin: TextView
    private lateinit var txtCountSakit: TextView
    private lateinit var txtCountOff: TextView
    private lateinit var txtCountLembur: TextView
    private lateinit var txtEmployeeActionsTitle: TextView
    private lateinit var btnUbahJadwalKaryawan: MaterialButton
    private lateinit var btnAssignLemburAdmin: MaterialButton
    private lateinit var swipeRefresh: androidx.swiperefreshlayout.widget.SwipeRefreshLayout
    private lateinit var loadingOverlay: FrameLayout

    @Serializable
    private data class UserShiftPayload(
        @SerialName("user_id") val userId: String,
        @SerialName("shift_id") val shiftId: String? = null,
        @SerialName("shift_type") val shiftType: String? = null,
        @SerialName("reason") val reason: String? = null,
        @SerialName("effective_date") val effectiveDate: String
    )

    @Serializable
    private data class NotificationPayload(
        @SerialName("user_id") val userId: String,
        @SerialName("message") val message: String,
        @SerialName("is_read") val isRead: Boolean = false
    )

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_admin_dashboard, container, false)
        txtWelcome = view.findViewById(R.id.txtWelcome)
        txtDate = view.findViewById(R.id.txtDate)
        txtCountHadir = view.findViewById(R.id.txtCountHadir)
        txtCountIzin = view.findViewById(R.id.txtCountIzin)
        txtCountSakit = view.findViewById(R.id.txtCountSakit)
        txtCountOff = view.findViewById(R.id.txtCountOff)
        txtCountLembur = view.findViewById(R.id.txtCountLembur)
        txtEmployeeActionsTitle = view.findViewById(R.id.txtEmployeeActionsTitle)
        btnUbahJadwalKaryawan = view.findViewById(R.id.btnUbahJadwalKaryawan)
        btnAssignLemburAdmin = view.findViewById(R.id.btnAssignLemburAdmin)
        swipeRefresh = view.findViewById(R.id.swipeRefresh)
        loadingOverlay = view.findViewById(R.id.loadingOverlay)

        val sdf = SimpleDateFormat("EEEE, dd MMMM yyyy", Locale("id", "ID"))
        txtDate.text = sdf.format(Date())

        swipeRefresh.setOnRefreshListener { loadDashboardData() }
        btnAssignLemburAdmin.setOnClickListener {
            startActivity(Intent(requireContext(), AssignLemburActivity::class.java))
        }
        btnUbahJadwalKaryawan.setOnClickListener { showScheduleActionMenu() }

        configureEmployeeActionButtons()
        loadDashboardData()
        return view
    }

    private fun configureEmployeeActionButtons() {
        btnUbahJadwalKaryawan.visibility = View.GONE
        btnAssignLemburAdmin.visibility = View.GONE
        txtEmployeeActionsTitle.visibility = View.GONE

        lifecycleScope.launch {
            val currentUserId = SupabaseClient.auth.currentSessionOrNull()?.user?.id
            val role = try {
                if (currentUserId.isNullOrEmpty()) null else withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select { filter { eq("id", currentUserId) } }
                        .decodeList<User>()
                        .firstOrNull()
                        ?.role
                }
            } catch (_: Exception) {
                null
            }

            when {
                "superadmin".equals(role, ignoreCase = true) -> {
                    txtEmployeeActionsTitle.visibility = View.VISIBLE
                    btnUbahJadwalKaryawan.visibility = View.VISIBLE
                    btnAssignLemburAdmin.visibility = View.GONE
                }
                "leader".equals(role, ignoreCase = true) || "supervisor".equals(role, ignoreCase = true) -> {
                    txtEmployeeActionsTitle.visibility = View.VISIBLE
                    btnUbahJadwalKaryawan.visibility = View.GONE
                    btnAssignLemburAdmin.visibility = View.VISIBLE
                }
            }
        }
    }

    private fun loadDashboardData() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val today = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())

                // 1. Hadir / Terlambat
                val attendanceToday = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("attendance")
                        .select { filter { eq("date", today) } }
                        .decodeList<Attendance>()
                }
                val hadirCount = attendanceToday.count { it.status == "hadir" || it.status == "terlambat" }

                // 2. Izin & Sakit (approved leave overlapping today)
                val leaveToday = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("leave_requests")
                        .select { filter { eq("status", "approved") } }
                        .decodeList<LeaveRequest>()
                }
                val izinCount = leaveToday.count { it.leaveType == "izin" && isDateOverlapping(today, it.startDate, it.endDate) }
                val sakitCount = leaveToday.count { it.leaveType == "sakit" && isDateOverlapping(today, it.startDate, it.endDate) }

                // 3. Off schedules today
                val offToday = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("off_schedules")
                        .select { filter { eq("off_date", today) } }
                        .decodeList<OffSchedule>()
                }

                // 4. Lembur assignments today
                val emergencyToday = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("emergency_assignments")
                        .select {
                            filter {
                                eq("target_date", today)
                                eq("reason", "lembur")
                            }
                        }
                        .decodeList<EmergencyAssignment>()
                }

                txtCountHadir.text = hadirCount.toString()
                txtCountIzin.text = izinCount.toString()
                txtCountSakit.text = sakitCount.toString()
                txtCountOff.text = offToday.size.toString()
                txtCountLembur.text = emergencyToday.size.toString()

            } catch (e: Exception) {
                view?.let { Snackbar.make(it, "Gagal memuat statistik: ${e.localizedMessage}", Snackbar.LENGTH_LONG).show() }
            } finally {
                loadingOverlay.visibility = View.GONE
                swipeRefresh.isRefreshing = false
            }
        }
    }

    private fun showScheduleActionMenu() {
        val actions = arrayOf("Change Shift", "Off Day", "Lembur", "Ganti Off", "Cuti (Segera Hadir)")
        AlertDialog.Builder(requireContext())
            .setTitle("Ubah Jadwal Pegawai")
            .setItems(actions) { _, which ->
                when (which) {
                    0 -> showChangeShiftDialog()
                    1 -> showOffDayDialog()
                    2 -> startActivity(Intent(requireContext(), AssignLemburActivity::class.java))
                    3 -> showGantiOffDialog()
                    4 -> Toast.makeText(context, "Cuti segera hadir.", Toast.LENGTH_SHORT).show()
                }
            }
            .show()
    }

    private fun showChangeShiftDialog() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val employees = fetchActiveEmployees()
                val shifts = fetchActiveShifts()
                loadingOverlay.visibility = View.GONE

                if (employees.isEmpty() || shifts.isEmpty()) {
                    Toast.makeText(context, "Data pegawai atau shift belum tersedia.", Toast.LENGTH_SHORT).show()
                    return@launch
                }

                val form = createScheduleFormLayout()
                val spinEmployee = Spinner(requireContext())
                val spinShift = Spinner(requireContext())
                val btnDate = Button(requireContext())
                var selectedDate = todayIso()

                addFormLabel(form, "Pegawai")
                spinEmployee.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, employees.map { it.name })
                form.addView(spinEmployee)

                addFormLabel(form, "Shift baru")
                spinShift.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, shifts.map { shift -> shift.name })
                form.addView(spinShift)

                addFormLabel(form, "Tanggal efektif")
                btnDate.text = "Pilih Tanggal: $selectedDate"
                btnDate.setOnClickListener { showDatePicker(selectedDate) { date -> selectedDate = date; btnDate.text = "Pilih Tanggal: $date" } }
                form.addView(btnDate)

                AlertDialog.Builder(requireContext())
                    .setTitle("Change Shift")
                    .setView(form)
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Simpan") { _, _ ->
                        val employee = employees.getOrNull(spinEmployee.selectedItemPosition)
                        val shift = shifts.getOrNull(spinShift.selectedItemPosition)
                        if (employee == null || shift == null) {
                            Toast.makeText(context, "Pilih pegawai dan shift terlebih dahulu.", Toast.LENGTH_SHORT).show()
                            return@setPositiveButton
                        }
                        saveChangeShift(employee, shift, selectedDate)
                    }
                    .show()
            } catch (e: Exception) {
                loadingOverlay.visibility = View.GONE
                Toast.makeText(context, "Gagal memuat form: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showOffDayDialog() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val employees = fetchActiveEmployees()
                loadingOverlay.visibility = View.GONE

                if (employees.isEmpty()) {
                    Toast.makeText(context, "Data pegawai belum tersedia.", Toast.LENGTH_SHORT).show()
                    return@launch
                }

                val form = createScheduleFormLayout()
                val spinEmployee = Spinner(requireContext())
                val btnDate = Button(requireContext())
                val edtReason = EditText(requireContext())
                var selectedDate = todayIso()

                addFormLabel(form, "Pegawai")
                spinEmployee.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, employees.map { it.name })
                form.addView(spinEmployee)

                addFormLabel(form, "Tanggal off")
                btnDate.text = "Pilih Tanggal: $selectedDate"
                btnDate.setOnClickListener { showDatePicker(selectedDate) { date -> selectedDate = date; btnDate.text = "Pilih Tanggal: $date" } }
                form.addView(btnDate)

                addFormLabel(form, "Alasan")
                edtReason.setText("libur")
                form.addView(edtReason)

                AlertDialog.Builder(requireContext())
                    .setTitle("Off Day")
                    .setView(form)
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Simpan") { _, _ ->
                        val employee = employees.getOrNull(spinEmployee.selectedItemPosition)
                        val reason = edtReason.text.toString().trim()
                        if (employee == null || reason.isEmpty()) {
                            Toast.makeText(context, "Pegawai dan alasan wajib diisi.", Toast.LENGTH_SHORT).show()
                            return@setPositiveButton
                        }
                        saveOffDay(employee, selectedDate, reason)
                    }
                    .show()
            } catch (e: Exception) {
                loadingOverlay.visibility = View.GONE
                Toast.makeText(context, "Gagal memuat form: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showGantiOffDialog() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val employees = fetchActiveEmployees()
                loadingOverlay.visibility = View.GONE

                if (employees.size < 2) {
                    Toast.makeText(context, "Minimal perlu dua pegawai untuk ganti off.", Toast.LENGTH_SHORT).show()
                    return@launch
                }

                val form = createScheduleFormLayout()
                val spinAssigned = Spinner(requireContext())
                val spinReplacing = Spinner(requireContext())
                val btnDate = Button(requireContext())
                var selectedDate = todayIso()

                addFormLabel(form, "Pegawai yang bertugas")
                spinAssigned.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, employees.map { it.name })
                form.addView(spinAssigned)

                addFormLabel(form, "Menggantikan pegawai")
                spinReplacing.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, employees.map { it.name })
                form.addView(spinReplacing)

                addFormLabel(form, "Tanggal ganti off")
                btnDate.text = "Pilih Tanggal: $selectedDate"
                btnDate.setOnClickListener { showDatePicker(selectedDate) { date -> selectedDate = date; btnDate.text = "Pilih Tanggal: $date" } }
                form.addView(btnDate)

                AlertDialog.Builder(requireContext())
                    .setTitle("Ganti Off")
                    .setView(form)
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Simpan") { _, _ ->
                        val assigned = employees.getOrNull(spinAssigned.selectedItemPosition)
                        val replacing = employees.getOrNull(spinReplacing.selectedItemPosition)
                        if (assigned == null || replacing == null || assigned.id == replacing.id) {
                            Toast.makeText(context, "Pilih dua pegawai yang berbeda.", Toast.LENGTH_SHORT).show()
                            return@setPositiveButton
                        }
                        saveGantiOff(assigned, replacing, selectedDate)
                    }
                    .show()
            } catch (e: Exception) {
                loadingOverlay.visibility = View.GONE
                Toast.makeText(context, "Gagal memuat form: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private suspend fun fetchActiveEmployees(): List<User> = withContext(Dispatchers.IO) {
        SupabaseClient.db.from("users")
            .select { filter { eq("is_active", true) } }
            .decodeList<User>()
            .filter { !it.role.equals("superadmin", ignoreCase = true) }
    }

    private suspend fun fetchActiveShifts(): List<Shift> = withContext(Dispatchers.IO) {
        SupabaseClient.db.from("shifts")
            .select { filter { eq("is_active", true) } }
            .decodeList<Shift>()
    }

    private fun createScheduleFormLayout(): LinearLayout {
        return LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 8, 24, 0)
        }
    }

    private fun addFormLabel(parent: LinearLayout, text: String) {
        parent.addView(TextView(requireContext()).apply {
            this.text = text
            textSize = 14f
            setPadding(0, 16, 0, 6)
        })
    }

    private fun todayIso(): String = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())

    private fun showDatePicker(currentDate: String, onPicked: (String) -> Unit) {
        val cal = Calendar.getInstance()
        try {
            SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).parse(currentDate)?.let { cal.time = it }
        } catch (_: Exception) { }
        DatePickerDialog(requireContext(), { _, year, month, day ->
            val picked = Calendar.getInstance().apply { set(year, month, day) }
            onPicked(SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(picked.time))
        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
    }

    private fun saveChangeShift(employee: User, shift: Shift, effectiveDate: String) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val payload = UserShiftPayload(
                    userId = employee.id,
                    shiftId = shift.id,
                    effectiveDate = effectiveDate
                )
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("user_shifts").insert(payload)
                    SupabaseClient.db.from("notifications").insert(NotificationPayload(
                        userId = employee.id,
                        message = "Admin mengubah jadwal shift kerja kamu, silahkan absen sesuai jam yang ditentukan."
                    ))
                }
                Toast.makeText(context, "Shift pegawai berhasil diperbarui!", Toast.LENGTH_SHORT).show()
                loadDashboardData()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal memperbarui shift: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun saveOffDay(employee: User, date: String, reason: String) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("user_shifts").insert(UserShiftPayload(
                        userId = employee.id,
                        shiftId = null,
                        shiftType = "off",
                        reason = reason,
                        effectiveDate = date
                    ))
                    SupabaseClient.db.from("attendance").update({ set("status", "off") }) {
                        filter {
                            eq("user_id", employee.id)
                            eq("date", date)
                        }
                    }
                    SupabaseClient.db.from("notifications").insert(NotificationPayload(
                        userId = employee.id,
                        message = "Jadwal kamu diperbarui menjadi Off pada tanggal $date."
                    ))
                }
                Toast.makeText(context, "Hari off berhasil diset!", Toast.LENGTH_SHORT).show()
                loadDashboardData()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal menyimpan off day: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun saveGantiOff(assigned: User, replacing: User, date: String) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val currentAdminId = SupabaseClient.auth.currentSessionOrNull()?.user?.id
                val assignment = EmergencyAssignment(
                    assignedUserId = assigned.id,
                    targetDate = date,
                    reason = "ganti_off",
                    replacingUserId = replacing.id,
                    assignedBy = currentAdminId,
                    assignedFrom = "android",
                    status = "pending"
                )
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("emergency_assignments").insert(assignment)
                    SupabaseClient.db.from("off_schedules").insert(OffSchedule(
                        userId = replacing.id,
                        date = date,
                        reason = "Ganti off dengan ${assigned.name}"
                    ))
                    SupabaseClient.db.from("notifications").insert(NotificationPayload(
                        userId = assigned.id,
                        message = "Jadwal ganti off kamu telah diperbarui."
                    ))
                    SupabaseClient.db.from("notifications").insert(NotificationPayload(
                        userId = replacing.id,
                        message = "Jadwal ganti off kamu telah diperbarui."
                    ))
                }
                Toast.makeText(context, "Ganti off berhasil disimpan!", Toast.LENGTH_SHORT).show()
                loadDashboardData()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal menyimpan ganti off: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }
    private fun isDateOverlapping(target: String, start: String, end: String): Boolean {
        return target >= start && target <= end
    }
}

// ==========================================
// 2. REKAP ABSENSI FRAGMENT
// ==========================================
class TabRekapFragment : Fragment() {
    private lateinit var btnSelectDate: Button
    private lateinit var btnExportCsv: Button
    private lateinit var spinFilterShift: Spinner
    private lateinit var btnHadirkanSemua: Button
    private lateinit var btnSimpanRekapan: Button
    private lateinit var recyclerViewRekap: RecyclerView
    private lateinit var txtNoData: TextView
    private lateinit var loadingOverlay: FrameLayout
    
    private var selectedDate = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
    private var selectedShift = "Semua"
    private var rekapItems = mutableListOf<RekapItem>()
    private var allEmployeesCache = listOf<User>()

    data class RekapItem(
        val user: User,
        var status: String,
        var checkInTime: String?,
        var checkOutTime: String?,
        var note: String? = null,
        var attendanceId: String? = null,
        var isEdited: Boolean = false
    )

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_rekap_absensi, container, false)
        btnSelectDate = view.findViewById(R.id.btnSelectDate)
        btnExportCsv = view.findViewById(R.id.btnExportCsv)
        spinFilterShift = view.findViewById(R.id.spinFilterShift)
        btnHadirkanSemua = view.findViewById(R.id.btnHadirkanSemua)
        btnSimpanRekapan = view.findViewById(R.id.btnSimpanRekapan)
        recyclerViewRekap = view.findViewById(R.id.recyclerViewRekap)
        txtNoData = view.findViewById(R.id.txtNoData)
        loadingOverlay = view.findViewById(R.id.loadingOverlay)

        recyclerViewRekap.layoutManager = LinearLayoutManager(context)

        // Setup Spinner Shift
        val shifts = mutableListOf("Semua")
        if (ShiftHelper.cachedShifts.isEmpty()) {
            lifecycleScope.launch {
                ShiftHelper.loadShifts()
                shifts.addAll(ShiftHelper.cachedShifts.map { it.name })
                if (shifts.size == 1) {
                    shifts.addAll(listOf("Shift 1", "Shift 2", "Shift 3", "Shift Kantor"))
                }
                val adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, shifts)
                spinFilterShift.adapter = adapter
            }
        } else {
            shifts.addAll(ShiftHelper.cachedShifts.map { it.name })
        }
        spinFilterShift.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, shifts)
        spinFilterShift.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, pos: Int, id: Long) {
                selectedShift = spinFilterShift.selectedItem.toString()
                applyFilterAndDisplay()
            }
            override fun onNothingSelected(p0: AdapterView<*>?) {}
        }

        btnSelectDate.setOnClickListener { showDatePicker() }
        btnExportCsv.setOnClickListener { exportToCSV() }
        
        btnHadirkanSemua.setOnClickListener { hadirkanSemuaPegawai() }
        btnSimpanRekapan.setOnClickListener { simpanRekapanKeDatabase() }

        updateDateButtonLabel()
        loadRekapData()
        return view
    }

    private fun showDatePicker() {
        val cal = Calendar.getInstance()
        DatePickerDialog(requireContext(), { _, yr, mn, dy ->
            val c = Calendar.getInstance()
            c.set(yr, mn, dy)
            selectedDate = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(c.time)
            updateDateButtonLabel()
            loadRekapData()
        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
    }

    private fun updateDateButtonLabel() {
        btnSelectDate.text = "Tanggal: $selectedDate"
    }

    private fun loadRekapData() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                // 1. Fetch active employees (excluding superadmin)
                allEmployeesCache = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select { filter { eq("is_active", true) } }
                        .decodeList<User>()
                }.filter { !it.role.equals("superadmin", ignoreCase = true) }

                // 2. Fetch Off schedules
                val offList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("off_schedules")
                        .select { filter { eq("off_date", selectedDate) } }
                        .decodeList<OffSchedule>()
                }

                // 3. Fetch approved leave requests
                val leaveList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("leave_requests")
                        .select { filter { eq("status", "approved") } }
                        .decodeList<LeaveRequest>()
                }

                // 4. Fetch attendance logs
                val attendanceList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("attendance")
                        .select { filter { eq("date", selectedDate) } }
                        .decodeList<Attendance>()
                }

                rekapItems.clear()
                for (emp in allEmployeesCache) {
                    var status = "TIDAK ABSEN"
                    var checkIn: String? = null
                    var checkOut: String? = null
                    var note: String? = null
                    var attendanceId: String? = null

                    // Step A: Check off schedule
                    val offSched = offList.find { it.userId == emp.id }
                    if (offSched != null) {
                        status = "OFF"
                    } else {
                        // Step B: Check leave request
                        val leave = leaveList.find { it.userId == emp.id && selectedDate >= it.startDate && selectedDate <= it.endDate }
                        if (leave != null) {
                            status = leave.leaveType.uppercase()
                        } else {
                            // Step C: Check attendance
                            val att = attendanceList.find { it.userId == emp.id }
                            if (att != null) {
                                checkIn = att.checkInTime
                                checkOut = att.checkOutTime
                                status = att.status.uppercase()
                                note = att.note
                                attendanceId = att.id
                            }
                        }
                    }

                    rekapItems.add(RekapItem(emp, status, checkIn, checkOut, note, attendanceId, false))
                }

                applyFilterAndDisplay()

            } catch (e: Exception) {
                view?.let { Snackbar.make(it, "Gagal memuat rekap: ${e.localizedMessage}", Snackbar.LENGTH_LONG).show() }
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun applyFilterAndDisplay() {
        val filteredList = rekapItems.filter { item ->
            if (selectedShift == "Semua") {
                true
            } else {
                if (selectedShift.contains("Kantor", ignoreCase = true) || selectedShift.contains("Supervisor", ignoreCase = true)) {
                    item.user.role.equals("supervisor", ignoreCase = true) || item.user.shiftType?.lowercase()?.contains("kantor") == true
                } else {
                    val cleanSel = selectedShift.lowercase()
                    val cleanType = item.user.shiftType?.lowercase() ?: ""
                    when {
                        cleanSel.contains("1") || cleanSel.contains("pagi") -> cleanType.contains("pagi") || cleanType.contains("1")
                        cleanSel.contains("2") || cleanSel.contains("sore") -> cleanType.contains("sore") || cleanType.contains("2")
                        cleanSel.contains("3") || cleanSel.contains("malam") -> cleanType.contains("malam") || cleanType.contains("3")
                        else -> cleanType.contains(cleanSel)
                    }
                }
            }
        }

        if (filteredList.isEmpty()) {
            txtNoData.visibility = View.VISIBLE
            recyclerViewRekap.visibility = View.GONE
        } else {
            txtNoData.visibility = View.GONE
            recyclerViewRekap.visibility = View.VISIBLE
            recyclerViewRekap.adapter = RekapAdapter(filteredList)
        }
    }
    
    private fun hadirkanSemuaPegawai() {
        val adapter = recyclerViewRekap.adapter as? RekapAdapter ?: return
        val currentItems = adapter.getItems()
        
        for (item in currentItems) {
            if (item.status != "HADIR" && item.status != "OFF" && item.status != "IZIN" && item.status != "SAKIT") {
                item.status = "HADIR"
                item.isEdited = true
                item.note = "Dihadirkan Massal"
                
                // Set default times based on shift
                if (item.user.role.equals("supervisor", ignoreCase = true)) {
                    item.checkInTime = "08:00:00"
                    item.checkOutTime = "17:00:00"
                } else {
                    when (item.user.shiftType?.lowercase()) {
                        "pagi" -> {
                            item.checkInTime = "07:00:00"
                            item.checkOutTime = "15:00:00"
                        }
                        "sore" -> {
                            item.checkInTime = "15:00:00"
                            item.checkOutTime = "23:00:00"
                        }
                        "malam" -> {
                            item.checkInTime = "23:00:00"
                            item.checkOutTime = "07:00:00"
                        }
                    }
                }
            }
        }
        adapter.notifyDataSetChanged()
    }
    
    private fun showEditDialog(item: RekapItem, position: Int) {
        val dialogView = LayoutInflater.from(context).inflate(R.layout.dialog_koreksi_absensi, null)
        val txtName = dialogView.findViewById<TextView>(R.id.txtKoreksiName)
        val txtDetails = dialogView.findViewById<TextView>(R.id.txtKoreksiDetails)
        val spinStatus = dialogView.findViewById<Spinner>(R.id.spinKoreksiStatus)
        val btnMasuk = dialogView.findViewById<Button>(R.id.btnKoreksiMasuk)
        val btnPulang = dialogView.findViewById<Button>(R.id.btnKoreksiPulang)
        val edtNote = dialogView.findViewById<EditText>(R.id.edtKoreksiNote)

        txtName.text = item.user.name
        txtDetails.text = "Shift: ${item.user.shiftType?.uppercase() ?: "NON-SHIFT"} | Posisi: ${item.user.role}"
        
        val statusList = arrayOf("HADIR", "TERLAMBAT", "TIDAK ABSEN", "IZIN", "SAKIT", "OFF")
        spinStatus.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, statusList)
        val currentStatusIdx = statusList.indexOf(item.status.uppercase())
        if (currentStatusIdx >= 0) spinStatus.setSelection(currentStatusIdx)

        var tempMasuk = item.checkInTime
        var tempPulang = item.checkOutTime
        btnMasuk.text = tempMasuk ?: "--:--:--"
        btnPulang.text = tempPulang ?: "--:--:--"
        edtNote.setText(item.note ?: "")

        val timeFormatter = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
        
        btnMasuk.setOnClickListener {
            val cal = Calendar.getInstance()
            android.app.TimePickerDialog(requireContext(), { _, h, m ->
                cal.set(Calendar.HOUR_OF_DAY, h)
                cal.set(Calendar.MINUTE, m)
                cal.set(Calendar.SECOND, 0)
                tempMasuk = timeFormatter.format(cal.time)
                btnMasuk.text = tempMasuk
            }, cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE), true).show()
        }

        btnPulang.setOnClickListener {
            val cal = Calendar.getInstance()
            android.app.TimePickerDialog(requireContext(), { _, h, m ->
                cal.set(Calendar.HOUR_OF_DAY, h)
                cal.set(Calendar.MINUTE, m)
                cal.set(Calendar.SECOND, 0)
                tempPulang = timeFormatter.format(cal.time)
                btnPulang.text = tempPulang
            }, cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE), true).show()
        }

        AlertDialog.Builder(requireContext())
            .setTitle("Koreksi Absensi")
            .setView(dialogView)
            .setNegativeButton("Batal", null)
            .setPositiveButton("Simpan Lokal") { _, _ ->
                item.status = spinStatus.selectedItem.toString()
                item.checkInTime = tempMasuk
                item.checkOutTime = tempPulang
                item.note = edtNote.text.toString().trim().ifEmpty { null }
                item.isEdited = true
                recyclerViewRekap.adapter?.notifyItemChanged(position)
            }
            .show()
    }
    
    private fun simpanRekapanKeDatabase() {
        val editedItems = rekapItems.filter { it.isEdited }
        if (editedItems.isEmpty()) {
            Toast.makeText(requireContext(), "Tidak ada perubahan yang perlu disimpan.", Toast.LENGTH_SHORT).show()
            return
        }

        AlertDialog.Builder(requireContext())
            .setTitle("Konfirmasi Simpan")
            .setMessage("Apakah kamu sudah yakin untuk menyimpannya?")
            .setCancelable(false)
            .setNegativeButton("Batal", null)
            .setPositiveButton("Simpan") { _, _ ->
                eksekusiSimpanKeSupabase(editedItems)
            }
            .show()
    }
    
    private fun eksekusiSimpanKeSupabase(editedItems: List<RekapItem>) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    for (item in editedItems) {
                        if (item.status == "OFF" || item.status == "IZIN" || item.status == "SAKIT") {
                            // Generally handled by other tables, skip inserting attendance or handle logic accordingly
                            continue
                        }
                        
                        val attendanceRecord = Attendance(
                            id = item.attendanceId,
                            userId = item.user.id,
                            date = selectedDate,
                            checkInTime = item.checkInTime,
                            checkOutTime = item.checkOutTime,
                            status = item.status.lowercase(),
                            note = item.note
                        )
                        
                        if (item.attendanceId != null) {
                            SupabaseClient.db.from("attendance").update(attendanceRecord) {
                                filter { eq("id", item.attendanceId!!) }
                            }
                        } else {
                            SupabaseClient.db.from("attendance").insert(attendanceRecord)
                        }
                    }
                }
                Toast.makeText(requireContext(), "Rekapan berhasil disimpan ke database!", Toast.LENGTH_LONG).show()
                loadRekapData() // Reload everything
            } catch (e: Exception) {
                Toast.makeText(requireContext(), "Gagal menyimpan: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun exportToCSV() {
        if (rekapItems.isEmpty()) {
            Toast.makeText(context, "Tidak ada data untuk diekspor", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            val csvHeader = "Nama,Kode Pegawai,Shift,Status,Check In,Check Out\n"
            val csvBody = rekapItems.joinToString("\n") {
                "${it.user.name},${it.user.employeeCode ?: "-"},${it.user.shiftType ?: "-"},${it.status},${it.checkInTime ?: "-"},${it.checkOutTime ?: "-"}"
            }
            val fileName = "rekap_absensi_$selectedDate.csv"
            val file = File(context?.cacheDir, fileName)
            FileOutputStream(file).use {
                it.write((csvHeader + csvBody).toByteArray())
            }

            val fileUri: Uri = FileProvider.getUriForFile(
                requireContext(),
                "${requireContext().packageName}.fileprovider",
                file
            )

            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "text/csv"
                putExtra(Intent.EXTRA_SUBJECT, "Rekap Absensi $selectedDate")
                putExtra(Intent.EXTRA_STREAM, fileUri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(intent, "Kirim Rekap CSV"))
        } catch (e: Exception) {
            Toast.makeText(context, "Gagal mengekspor CSV: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
        }
    }

    // RecyclerView Adapter
    inner class RekapAdapter(private val items: List<RekapItem>) : RecyclerView.Adapter<RekapAdapter.ViewHolder>() {
        
        fun getItems(): List<RekapItem> = items
        
        inner class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val txtName: TextView = v.findViewById(R.id.txtEmployeeName)
            val txtDetails: TextView = v.findViewById(R.id.txtEmployeeDetails)
            val txtStatus: TextView = v.findViewById(R.id.txtStatus)
            val cardStatus: androidx.cardview.widget.CardView = v.findViewById(R.id.cardStatus)
            val txtUnsavedIndicator: TextView? = v.findViewById(R.id.txtUnsavedIndicator)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_rekap_absensi, parent, false)
            return ViewHolder(v)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val item = items[position]
            holder.txtName.text = item.user.name
            holder.txtDetails.text = "Shift: ${item.user.shiftType?.uppercase() ?: "-"} | Kode: ${item.user.employeeCode ?: "-"} \nMasuk: ${item.checkInTime ?: "-"} | Pulang: ${item.checkOutTime ?: "-"}"
            holder.txtStatus.text = item.status
            
            if (item.isEdited) {
                holder.txtUnsavedIndicator?.visibility = View.VISIBLE
            } else {
                holder.txtUnsavedIndicator?.visibility = View.GONE
            }

            // Background color status badges
            when (item.status) {
                "HADIR" -> {
                    holder.cardStatus.setCardBackgroundColor(android.graphics.Color.parseColor("#E8F5E9"))
                    holder.txtStatus.setTextColor(android.graphics.Color.parseColor("#2E7D32"))
                }
                "TERLAMBAT" -> {
                    holder.cardStatus.setCardBackgroundColor(android.graphics.Color.parseColor("#FFF3E0"))
                    holder.txtStatus.setTextColor(android.graphics.Color.parseColor("#E65100"))
                }
                "IZIN", "SAKIT" -> {
                    holder.cardStatus.setCardBackgroundColor(android.graphics.Color.parseColor("#FFFDE7"))
                    holder.txtStatus.setTextColor(android.graphics.Color.parseColor("#F57F17"))
                }
                "OFF" -> {
                    holder.cardStatus.setCardBackgroundColor(android.graphics.Color.parseColor("#F1F5F9"))
                    holder.txtStatus.setTextColor(android.graphics.Color.parseColor("#475569"))
                }
                else -> { // TIDAK ABSEN
                    holder.cardStatus.setCardBackgroundColor(android.graphics.Color.parseColor("#FFEBEE"))
                    holder.txtStatus.setTextColor(android.graphics.Color.parseColor("#C62828"))
                }
            }
            
            holder.itemView.setOnClickListener {
                showEditDialog(item, position)
            }
        }

        override fun getItemCount() = items.size
    }
}

// ==========================================
// 3. PENGAJUAN IZIN FRAGMENT
// ==========================================
class TabLeaveRequestsFragment : Fragment() {
    private lateinit var recyclerViewLeave: RecyclerView
    private lateinit var txtNoData: TextView
    private lateinit var loadingOverlay: View
    private var requestsList = mutableListOf<LeaveRequestWithUser>()

    data class LeaveRequestWithUser(
        val leave: LeaveRequest,
        val employeeName: String
    )

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_admin_leave_requests, container, false)
        recyclerViewLeave = view.findViewById(R.id.rvLeaveHistory)
        txtNoData = view.findViewById(R.id.txtEmptyHistory)
        loadingOverlay = view.findViewById(R.id.loadingOverlay)

        recyclerViewLeave.layoutManager = LinearLayoutManager(context)

        loadPendingRequests()
        return view
    }

    private fun loadPendingRequests() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                // Fetch pending leaves
                val pendingLeaves = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("leave_requests")
                        .select { filter { eq("status", "pending") } }
                        .decodeList<LeaveRequest>()
                }

                // Fetch users to resolve names
                val users = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select()
                        .decodeList<User>()
                }

                requestsList.clear()
                for (leave in pendingLeaves) {
                    val empName = users.find { it.id == leave.userId }?.name ?: "Unknown"
                    requestsList.add(LeaveRequestWithUser(leave, empName))
                }

                if (requestsList.isEmpty()) {
                    txtNoData.visibility = View.VISIBLE
                    recyclerViewLeave.visibility = View.GONE
                } else {
                    txtNoData.visibility = View.GONE
                    recyclerViewLeave.visibility = View.VISIBLE
                    recyclerViewLeave.adapter = LeaveAdapter(requestsList)
                }

            } catch (e: Exception) {
                view?.let { Snackbar.make(it, "Gagal memuat permohonan: ${e.localizedMessage}", Snackbar.LENGTH_LONG).show() }
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    inner class LeaveAdapter(private val items: List<LeaveRequestWithUser>) : RecyclerView.Adapter<LeaveAdapter.ViewHolder>() {
        inner class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val txtName: TextView = v.findViewById(R.id.txtEmployeeName)
            val txtType: TextView = v.findViewById(R.id.txtLeaveType)
            val txtDates: TextView = v.findViewById(R.id.txtLeaveDates)
            val txtReason: TextView = v.findViewById(R.id.txtLeaveReason)
            val imgAttachment: ImageView = v.findViewById(R.id.imgAttachment)
            val btnApprove: Button = v.findViewById(R.id.btnApprove)
            val btnReject: Button = v.findViewById(R.id.btnReject)
            val cardType: androidx.cardview.widget.CardView = v.findViewById(R.id.cardType)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_leave_request, parent, false)
            return ViewHolder(v)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val item = items[position]
            holder.txtName.text = item.employeeName
            holder.txtType.text = item.leave.leaveType.uppercase()
            holder.txtDates.text = "Mulai: ${item.leave.startDate} s/d ${item.leave.endDate}"
            holder.txtReason.text = "Alasan: ${item.leave.reason}"

            if (item.leave.leaveType == "sakit") {
                holder.cardType.setCardBackgroundColor(android.graphics.Color.parseColor("#FFEBEE"))
                holder.txtType.setTextColor(android.graphics.Color.parseColor("#C62828"))

                // Attachment preview
                if (!item.leave.attachmentUrl.isNullOrEmpty()) {
                    holder.imgAttachment.visibility = View.VISIBLE
                    Glide.with(this@TabLeaveRequestsFragment)
                        .load(item.leave.attachmentUrl)
                        .into(holder.imgAttachment)
                } else {
                    holder.imgAttachment.visibility = View.GONE
                }
            } else {
                holder.cardType.setCardBackgroundColor(android.graphics.Color.parseColor("#FFFDE7"))
                holder.txtType.setTextColor(android.graphics.Color.parseColor("#F57F17"))
                holder.imgAttachment.visibility = View.GONE
            }

            holder.btnApprove.setOnClickListener { updateRequestStatus(item.leave, "approved") }
            holder.btnReject.setOnClickListener { updateRequestStatus(item.leave, "rejected") }
        }

        override fun getItemCount() = items.size
    }

    private fun updateRequestStatus(leave: LeaveRequest, newStatus: String) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val adminId = SupabaseClient.auth.currentSessionOrNull()?.user?.id ?: ""
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("leave_requests")
                        .update(
                            {
                                set("status", newStatus)
                            }
                        ) {
                            filter { eq("id", leave.id ?: "") }
                        }
                }
                Toast.makeText(context, if (newStatus == "approved") "Permohonan disetujui!" else "Permohonan ditolak!", Toast.LENGTH_SHORT).show()
                loadPendingRequests()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal memperbarui status: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }
}

// ==========================================
// 4. MANAJEMEN PEGAWAI FRAGMENT
// ==========================================
class TabEmployeeCrudFragment : Fragment() {
    private lateinit var recyclerViewEmployee: RecyclerView
    private lateinit var txtNoData: TextView
    private lateinit var btnAddEmployee: FloatingActionButton
    private lateinit var loadingOverlay: FrameLayout
    private var employeesList = mutableListOf<User>()

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_manajemen_karyawan, container, false)
        recyclerViewEmployee = view.findViewById(R.id.recyclerViewEmployee)
        txtNoData = view.findViewById(R.id.txtNoData)
        btnAddEmployee = view.findViewById(R.id.btnAddEmployee)
        loadingOverlay = view.findViewById(R.id.loadingOverlay)

        recyclerViewEmployee.layoutManager = LinearLayoutManager(context)

        btnAddEmployee.setOnClickListener { showAddEmployeeDialog() }

        loadEmployees()
        return view
    }

    private fun loadEmployees() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val users = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select()
                        .decodeList<User>()
                }.filter { !it.role.equals("superadmin", ignoreCase = true) }

                employeesList.clear()
                employeesList.addAll(users)

                if (employeesList.isEmpty()) {
                    txtNoData.visibility = View.VISIBLE
                    recyclerViewEmployee.visibility = View.GONE
                } else {
                    txtNoData.visibility = View.GONE
                    recyclerViewEmployee.visibility = View.VISIBLE
                    recyclerViewEmployee.adapter = EmployeeAdapter(employeesList)
                }

            } catch (e: Exception) {
                view?.let { Snackbar.make(it, "Gagal memuat pegawai: ${e.localizedMessage}", Snackbar.LENGTH_LONG).show() }
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun showAddEmployeeDialog() {
        val dialogView = LayoutInflater.from(context).inflate(R.layout.dialog_add_employee, null)
        val edtEmployeeCode = dialogView.findViewById<EditText>(R.id.edtEmployeeCode)
        val edtName = dialogView.findViewById<EditText>(R.id.edtName)
        val edtEmail = dialogView.findViewById<EditText>(R.id.edtEmail)
        val edtPassword = dialogView.findViewById<EditText>(R.id.edtPassword)
        val spinRole = dialogView.findViewById<Spinner>(R.id.spinRole)
        val txtShiftLabel = dialogView.findViewById<TextView>(R.id.txtShiftLabel)
        val spinShift = dialogView.findViewById<Spinner>(R.id.spinShift)

        // Dropdown setup
        val roles = arrayOf("Cleaner", "Housekeeping", "Gardener", "Gondola", "Leader", "Supervisor")
        spinRole.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, roles)

        val shifts = if (ShiftHelper.cachedShifts.isNotEmpty()) {
            ShiftHelper.cachedShifts.map { it.name }.toTypedArray()
        } else {
            arrayOf("Shift 1", "Shift 2", "Shift 3", "Shift Kantor")
        }
        spinShift.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, shifts)

        spinRole.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, pos: Int, id: Long) {
                if (roles[pos] == "Supervisor") {
                    txtShiftLabel.visibility = View.GONE
                    spinShift.visibility = View.GONE
                } else {
                    txtShiftLabel.visibility = View.VISIBLE
                    spinShift.visibility = View.VISIBLE
                }
            }
            override fun onNothingSelected(p0: AdapterView<*>?) {}
        }

        AlertDialog.Builder(requireContext())
            .setTitle("Tambah Pegawai Baru")
            .setView(dialogView)
            .setNegativeButton("Batal", null)
            .setPositiveButton("Simpan") { _, _ ->
                val employeeCode = edtEmployeeCode.text.toString().trim()
                val name = edtName.text.toString().trim()
                val email = edtEmail.text.toString().trim()
                val password = edtPassword.text.toString().trim()
                val role = spinRole.selectedItem.toString()
                val shift = if (role == "Supervisor") "Shift Kantor" else spinShift.selectedItem.toString()

                if (employeeCode.isEmpty() || name.isEmpty() || email.isEmpty() || password.isEmpty()) {
                    Toast.makeText(context, "Mohon lengkapi semua bidang!", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                
                if (employeeCode.length > 6) {
                    Toast.makeText(context, "ID Pegawai maksimal 6 angka!", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                saveNewEmployee(employeeCode, name, email, password, role, shift)
            }.show()
    }

    private fun saveNewEmployee(employeeCode: String, name: String, email: String, password: String, role: String, shift: String?) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                // 1. Supabase Auth signUp
                val response = withContext(Dispatchers.IO) {
                    SupabaseClient.auth.signUpWith(io.github.jan.supabase.auth.providers.builtin.Email) {
                        this.email = email
                        this.password = password
                    }
                }
                val userId = response?.id ?: throw Exception("Gagal mendapatkan User ID dari Auth")

                // 3. Create entry in users table
                val newUser = User(
                    id = userId,
                    email = email,
                    name = name,
                    role = role,
                    shiftType = shift,
                    position = role, // Posisi Jabatan otomatis diambil dari Role yang dipilih
                    isActive = true,
                    employeeCode = employeeCode
                )

                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users").insert(newUser)
                }

                Toast.makeText(context, "Pegawai berhasil didaftarkan!", Toast.LENGTH_SHORT).show()
                loadEmployees()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal membuat pegawai: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun showEditEmployeeDialog(user: User) {
        val dialogView = LayoutInflater.from(context).inflate(R.layout.dialog_add_employee, null)
        val edtEmployeeCode = dialogView.findViewById<EditText>(R.id.edtEmployeeCode)
        val edtName = dialogView.findViewById<EditText>(R.id.edtName)
        val edtEmail = dialogView.findViewById<EditText>(R.id.edtEmail)
        val layoutPassword = dialogView.findViewById<View>(R.id.layoutPassword)
        val txtShiftLabel = dialogView.findViewById<TextView>(R.id.txtShiftLabel)
        val spinRole = dialogView.findViewById<Spinner>(R.id.spinRole)
        val spinShift = dialogView.findViewById<Spinner>(R.id.spinShift)
        edtName.setText(user.name)
        edtEmail.setText(user.email)
        edtEmail.isEnabled = false
        edtEmployeeCode.setText(user.employeeCode ?: "")
        layoutPassword.visibility = View.GONE
        txtShiftLabel.visibility = View.GONE
        spinShift.visibility = View.GONE

        val roles = arrayOf("Cleaner", "Housekeeping", "Gardener", "Gondola", "Leader", "Supervisor")
        spinRole.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, roles)
        val roleIndex = roles.indexOfFirst { it.equals(user.role, ignoreCase = true) }
        if (roleIndex >= 0) spinRole.setSelection(roleIndex)

        AlertDialog.Builder(requireContext())
            .setTitle("Edit Pegawai")
            .setView(dialogView)
            .setNegativeButton("Batal", null)
            .setPositiveButton("Simpan") { _, _ ->
                val name = edtName.text.toString().trim()
                val email = edtEmail.text.toString().trim()
                val employeeCode = edtEmployeeCode.text.toString().trim()
                val role = spinRole.selectedItem.toString()

                if (name.isEmpty() || email.isEmpty() || employeeCode.isEmpty()) {
                    Toast.makeText(context, "Nama, email, dan ID Pegawai wajib diisi!", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                if (employeeCode.length > 6) {
                    Toast.makeText(context, "ID Pegawai maksimal 6 angka!", Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                updateEmployeeProfile(user.id, employeeCode, name, role)
            }.show()
    }

    private fun updateEmployeeProfile(userId: String, employeeCode: String, name: String, role: String) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .update(
                            {
                                set("employee_code", employeeCode)
                                set("name", name)
                                set("role", role)
                                set("position", role) // Sinkronkan posisi jabatan dengan role yang dipilih
                            }
                        ) {
                            filter { eq("id", userId) }
                        }
                }
                Toast.makeText(context, "Profil pegawai berhasil diperbarui!", Toast.LENGTH_SHORT).show()
                loadEmployees()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal memperbarui profil: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun resetPasswordEmail(email: String) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.auth.resetPasswordForEmail(email)
                }
                Toast.makeText(context, "Tautan reset sandi telah dikirim ke email pegawai!", Toast.LENGTH_LONG).show()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal mengirim tautan: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun toggleEmployeeStatus(user: User) {
        val newStatus = !user.isActive
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .update(
                            {
                                set("is_active", newStatus)
                            }
                        ) {
                            filter { eq("id", user.id) }
                        }
                }
                Toast.makeText(context, if (newStatus) "Pegawai diaktifkan kembali!" else "Pegawai berhasil dinonaktifkan!", Toast.LENGTH_SHORT).show()
                loadEmployees()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal memperbarui status keaktifan: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    inner class EmployeeAdapter(private val items: List<User>) : RecyclerView.Adapter<EmployeeAdapter.ViewHolder>() {
        inner class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val txtName: TextView = v.findViewById(R.id.txtEmployeeName)
            val txtEmail: TextView = v.findViewById(R.id.txtEmployeeEmail)
            val txtMeta: TextView = v.findViewById(R.id.txtEmployeeMeta)
            val txtStatus: TextView = v.findViewById(R.id.txtStatusActive)
            val btnEdit: Button = v.findViewById(R.id.btnEdit)
            val btnResetPw: Button = v.findViewById(R.id.btnResetPw)
            val btnDeactivate: Button = v.findViewById(R.id.btnDeactivate)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_employee, parent, false)
            return ViewHolder(v)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val item = items[position]
            holder.txtName.text = item.name
            holder.txtEmail.text = item.email
            holder.txtMeta.text = "Role: ${item.role} | Shift: ${item.shiftType?.uppercase() ?: "-"} | Kode: ${item.employeeCode ?: "-"}"

            if (item.isActive) {
                holder.txtStatus.text = "AKTIF"
                holder.txtStatus.setTextColor(android.graphics.Color.parseColor("#2E7D32"))
                holder.btnDeactivate.text = "Nonaktifkan"
                holder.btnDeactivate.setBackgroundTintList(android.content.res.ColorStateList.valueOf(android.graphics.Color.parseColor("#C62828")))
            } else {
                holder.txtStatus.text = "NONAKTIF"
                holder.txtStatus.setTextColor(android.graphics.Color.parseColor("#C62828"))
                holder.btnDeactivate.text = "Aktifkan"
                holder.btnDeactivate.setBackgroundTintList(android.content.res.ColorStateList.valueOf(android.graphics.Color.parseColor("#2E7D32")))
            }

            holder.btnEdit.setOnClickListener { showEditEmployeeDialog(item) }
            holder.btnResetPw.visibility = View.GONE
            holder.btnDeactivate.setOnClickListener { toggleEmployeeStatus(item) }
        }

        override fun getItemCount() = items.size
    }
}

// ==========================================
// 5. JADWAL OFF KARYAWAN FRAGMENT
// ==========================================
class TabOffSchedulesFragment : Fragment() {
    private lateinit var recyclerViewOff: RecyclerView
    private lateinit var txtNoData: TextView
    private lateinit var btnAddOff: FloatingActionButton
    private lateinit var loadingOverlay: FrameLayout
    private var offList = mutableListOf<OffWithUser>()

    data class OffWithUser(
        val off: OffSchedule,
        val employeeName: String
    )

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_jadwal_off, container, false)
        recyclerViewOff = view.findViewById(R.id.recyclerViewOff)
        txtNoData = view.findViewById(R.id.txtNoData)
        btnAddOff = view.findViewById(R.id.btnAddOff)
        loadingOverlay = view.findViewById(R.id.loadingOverlay)

        recyclerViewOff.layoutManager = LinearLayoutManager(context)

        btnAddOff.setOnClickListener { showAddOffDialog() }

        loadOffSchedules()
        return view
    }

    private fun loadOffSchedules() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                // Fetch off schedules
                val list = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("off_schedules")
                        .select()
                        .decodeList<OffSchedule>()
                }

                // Fetch active employees
                val users = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select()
                        .decodeList<User>()
                }

                offList.clear()
                for (off in list) {
                    val name = users.find { it.id == off.userId }?.name ?: "Unknown"
                    offList.add(OffWithUser(off, name))
                }

                if (offList.isEmpty()) {
                    txtNoData.visibility = View.VISIBLE
                    recyclerViewOff.visibility = View.GONE
                } else {
                    txtNoData.visibility = View.GONE
                    recyclerViewOff.visibility = View.VISIBLE
                    recyclerViewOff.adapter = OffAdapter(offList)
                }

            } catch (e: Exception) {
                view?.let { Snackbar.make(it, "Gagal memuat jadwal off: ${e.localizedMessage}", Snackbar.LENGTH_LONG).show() }
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun showAddOffDialog() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                // Fetch active employees dropdown
                val employees = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select { filter { eq("is_active", true) } }
                        .decodeList<User>()
                }.filter { !it.role.equals("superadmin", ignoreCase = true) }

                loadingOverlay.visibility = View.GONE

                val dialogView = LayoutInflater.from(context).inflate(R.layout.dialog_add_off_day, null)
                val spinEmployee = dialogView.findViewById<Spinner>(R.id.spinEmployee)
                val btnDatePicker = dialogView.findViewById<Button>(R.id.btnPickDate)
                val edtReason = dialogView.findViewById<EditText>(R.id.edtReason)
                val chkEmergency = dialogView.findViewById<CheckBox>(R.id.chkEmergency)

                val empNames = employees.map { it.name }.toTypedArray()
                spinEmployee.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, empNames)

                var selectedDateStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
                btnDatePicker.text = "Pilih Tanggal: $selectedDateStr"

                btnDatePicker.setOnClickListener {
                    val cal = Calendar.getInstance()
                    DatePickerDialog(requireContext(), { _, yr, mn, dy ->
                        val c = Calendar.getInstance()
                        c.set(yr, mn, dy)
                        selectedDateStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(c.time)
                        btnDatePicker.text = "Pilih Tanggal: $selectedDateStr"
                    }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
                }

                AlertDialog.Builder(requireContext())
                    .setTitle("Tambah Hari Off Pegawai")
                    .setView(dialogView)
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Simpan") { _, _ ->
                        val pos = spinEmployee.selectedItemPosition
                        if (pos == AdapterView.INVALID_POSITION) return@setPositiveButton
                        val selectedEmp = employees[pos]
                        val reason = edtReason.text.toString().trim()
                        val isEmergency = chkEmergency.isChecked

                        if (reason.isEmpty()) {
                            Toast.makeText(context, "Alasan wajib diisi!", Toast.LENGTH_SHORT).show()
                            return@setPositiveButton
                        }

                        saveOffSchedule(selectedEmp.id, selectedDateStr, reason, isEmergency)
                    }.show()

            } catch (e: Exception) {
                loadingOverlay.visibility = View.GONE
                Toast.makeText(context, "Gagal memuat form: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun saveOffSchedule(userId: String, dateStr: String, reason: String, isEmergency: Boolean) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                // Validation: prevent duplicate off scheduling on same date
                val duplicates = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("off_schedules")
                        .select {
                            filter {
                                eq("user_id", userId)
                                eq("off_date", dateStr)
                            }
                        }.decodeList<OffSchedule>()
                }

                if (duplicates.isNotEmpty()) {
                    Toast.makeText(context, "Pegawai sudah terjadwal libur (Off) pada tanggal tersebut!", Toast.LENGTH_LONG).show()
                    return@launch
                }

                val offSched = OffSchedule(
                    userId = userId,
                    date = dateStr,
                    reason = reason,
                    isEmergencyReplaceable = isEmergency
                )

                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("off_schedules").insert(offSched)
                }

                Toast.makeText(context, "Jadwal libur berhasil disimpan!", Toast.LENGTH_SHORT).show()
                loadOffSchedules()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal menyimpan jadwal off: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun deleteOffSchedule(id: String) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("off_schedules")
                        .delete { filter { eq("id", id) } }
                }
                Toast.makeText(context, "Jadwal libur berhasil dihapus!", Toast.LENGTH_SHORT).show()
                loadOffSchedules()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal menghapus jadwal: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    inner class OffAdapter(private val items: List<OffWithUser>) : RecyclerView.Adapter<OffAdapter.ViewHolder>() {
        inner class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val txtName: TextView = v.findViewById(R.id.txtEmployeeName)
            val txtDate: TextView = v.findViewById(R.id.txtOffDate)
            val txtReason: TextView = v.findViewById(R.id.txtOffReason)
            val txtEmergencyBadge: TextView = v.findViewById(R.id.txtEmergencyBadge)
            val btnDelete: Button = v.findViewById(R.id.btnDelete)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_off_schedule, parent, false)
            return ViewHolder(v)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val item = items[position]
            holder.txtName.text = item.employeeName
            holder.txtDate.text = "Tanggal Libur: ${item.off.date}"
            holder.txtReason.text = "Alasan: ${item.off.reason}"

            if (item.off.isEmergencyReplaceable) {
                holder.txtEmergencyBadge.visibility = View.VISIBLE
            } else {
                holder.txtEmergencyBadge.visibility = View.GONE
            }

            holder.btnDelete.setOnClickListener {
                AlertDialog.Builder(requireContext())
                    .setTitle("Konfirmasi Hapus")
                    .setMessage("Yakin ingin menghapus jadwal libur ini?")
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Hapus") { _, _ -> deleteOffSchedule(item.off.id ?: "") }
                    .show()
            }
        }

        override fun getItemCount() = items.size
    }
}

// ==========================================
// 6. DARURAT & LEMBUR FRAGMENT
// ==========================================
class TabEmergencyFragment : Fragment() {
    private lateinit var recyclerViewEmergency: RecyclerView
    private lateinit var txtNoData: TextView
    private lateinit var btnAddEmergency: FloatingActionButton
    private lateinit var loadingOverlay: FrameLayout
    private var assignmentsList = mutableListOf<EmergencyWithUsers>()

    data class EmergencyWithUsers(
        val assignment: EmergencyAssignment,
        val assignedName: String,
        val replacingName: String?
    )

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_darurat_lembur, container, false)
        recyclerViewEmergency = view.findViewById(R.id.recyclerViewEmergency)
        txtNoData = view.findViewById(R.id.txtNoData)
        btnAddEmergency = view.findViewById(R.id.btnAddEmergency)
        loadingOverlay = view.findViewById(R.id.loadingOverlay)

        recyclerViewEmergency.layoutManager = LinearLayoutManager(context)

        btnAddEmergency.setOnClickListener { showAddEmergencyDialog() }

        loadAssignments()
        return view
    }

    private fun loadAssignments() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                // Fetch emergency assignments
                val list = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("emergency_assignments")
                        .select()
                        .decodeList<EmergencyAssignment>()
                }

                // Fetch active employees
                val users = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select()
                        .decodeList<User>()
                }

                assignmentsList.clear()
                for (item in list) {
                    val assignedName = users.find { it.id == item.assignedUserId }?.name ?: "Unknown"
                    val replacingName = if (!item.replacingUserId.isNullOrEmpty()) {
                        users.find { it.id == item.replacingUserId }?.name
                    } else null

                    assignmentsList.add(EmergencyWithUsers(item, assignedName, replacingName))
                }

                if (assignmentsList.isEmpty()) {
                    txtNoData.visibility = View.VISIBLE
                    recyclerViewEmergency.visibility = View.GONE
                } else {
                    txtNoData.visibility = View.GONE
                    recyclerViewEmergency.visibility = View.VISIBLE
                    recyclerViewEmergency.adapter = EmergencyAdapter(assignmentsList)
                }

            } catch (e: Exception) {
                view?.let { Snackbar.make(it, "Gagal memuat tugas darurat: ${e.localizedMessage}", Snackbar.LENGTH_LONG).show() }
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun showAddEmergencyDialog() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val employees = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select { filter { eq("is_active", true) } }
                        .decodeList<User>()
                }.filter { !it.role.equals("superadmin", ignoreCase = true) }

                loadingOverlay.visibility = View.GONE

                val dialogView = LayoutInflater.from(context).inflate(R.layout.dialog_add_emergency, null)
                val spinAssigned = dialogView.findViewById<Spinner>(R.id.spinAssigned)
                val btnDatePicker = dialogView.findViewById<Button>(R.id.btnPickDate)
                val spinReason = dialogView.findViewById<Spinner>(R.id.spinReason)
                val spinReplacing = dialogView.findViewById<Spinner>(R.id.spinReplacing)
                val containerReplacing = dialogView.findViewById<LinearLayout>(R.id.containerReplacing)

                val empNames = employees.map { it.name }.toTypedArray()
                spinAssigned.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, empNames)
                spinReplacing.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, empNames)

                val reasons = arrayOf("lembur", "ganti_off")
                spinReason.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, reasons)

                spinReason.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                    override fun onItemSelected(parent: AdapterView<*>?, view: View?, pos: Int, id: Long) {
                        if (reasons[pos] == "ganti_off") {
                            containerReplacing.visibility = View.VISIBLE
                        } else {
                            containerReplacing.visibility = View.GONE
                        }
                    }
                    override fun onNothingSelected(p0: AdapterView<*>?) {}
                }

                var selectedDateStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
                btnDatePicker.text = "Pilih Tanggal: $selectedDateStr"

                btnDatePicker.setOnClickListener {
                    val cal = Calendar.getInstance()
                    DatePickerDialog(requireContext(), { _, yr, mn, dy ->
                        val c = Calendar.getInstance()
                        c.set(yr, mn, dy)
                        selectedDateStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(c.time)
                        btnDatePicker.text = "Pilih Tanggal: $selectedDateStr"
                    }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
                }

                AlertDialog.Builder(requireContext())
                    .setTitle("Tambah Penugasan Darurat")
                    .setView(dialogView)
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Simpan") { _, _ ->
                        val posAssigned = spinAssigned.selectedItemPosition
                        if (posAssigned == AdapterView.INVALID_POSITION) return@setPositiveButton
                        val assignedEmp = employees[posAssigned]

                        val reason = spinReason.selectedItem.toString()
                        var replacingEmpId: String? = null

                        if (reason == "ganti_off") {
                            val posReplacing = spinReplacing.selectedItemPosition
                            if (posReplacing != AdapterView.INVALID_POSITION) {
                                replacingEmpId = employees[posReplacing].id
                            }
                        }

                        saveEmergencyAssignment(assignedEmp.id, selectedDateStr, reason, replacingEmpId)
                    }.show()

            } catch (e: Exception) {
                loadingOverlay.visibility = View.GONE
                Toast.makeText(context, "Gagal memuat formulir: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun saveEmergencyAssignment(assignedId: String, dateStr: String, reason: String, replacingId: String?) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val assignment = EmergencyAssignment(
                    assignedUserId = assignedId,
                    targetDate = dateStr,
                    reason = reason,
                    replacingUserId = replacingId
                )

                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("emergency_assignments").insert(assignment)
                }

                Toast.makeText(context, "Penugasan berhasil disimpan!", Toast.LENGTH_SHORT).show()
                loadAssignments()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal menyimpan penugasan: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun deleteAssignment(id: String) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("emergency_assignments")
                        .delete { filter { eq("id", id) } }
                }
                Toast.makeText(context, "Penugasan berhasil dihapus!", Toast.LENGTH_SHORT).show()
                loadAssignments()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal menghapus penugasan: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    inner class EmergencyAdapter(private val items: List<EmergencyWithUsers>) : RecyclerView.Adapter<EmergencyAdapter.ViewHolder>() {
        inner class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val txtName: TextView = v.findViewById(R.id.txtEmployeeName)
            val txtType: TextView = v.findViewById(R.id.txtReasonType)
            val txtDate: TextView = v.findViewById(R.id.txtTargetDate)
            val txtReplacing: TextView = v.findViewById(R.id.txtReplacingEmployee)
            val btnDelete: Button = v.findViewById(R.id.btnDelete)
            val cardReason: androidx.cardview.widget.CardView = v.findViewById(R.id.cardReason)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_emergency, parent, false)
            return ViewHolder(v)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val item = items[position]
            holder.txtName.text = item.assignedName
            holder.txtType.text = item.assignment.reason.uppercase()
            holder.txtDate.text = "Tanggal Penugasan: ${item.assignment.targetDate}"

            if (item.assignment.reason == "ganti_off") {
                holder.cardReason.setCardBackgroundColor(android.graphics.Color.parseColor("#FFFDE7"))
                holder.txtType.setTextColor(android.graphics.Color.parseColor("#F57F17"))
                holder.txtReplacing.visibility = View.VISIBLE
                holder.txtReplacing.text = "Menggantikan: ${item.replacingName ?: "Unknown"}"
            } else {
                holder.cardReason.setCardBackgroundColor(android.graphics.Color.parseColor("#E3F2FD"))
                holder.txtType.setTextColor(android.graphics.Color.parseColor("#0D47A1"))
                holder.txtReplacing.visibility = View.GONE
            }

            holder.btnDelete.setOnClickListener {
                AlertDialog.Builder(requireContext())
                    .setTitle("Konfirmasi Hapus")
                    .setMessage("Batalkan penugasan darurat ini?")
                    .setNegativeButton("Kembali", null)
                    .setPositiveButton("Batalkan") { _, _ -> deleteAssignment(item.assignment.id ?: "") }
                    .show()
            }
        }

        override fun getItemCount() = items.size
    }
}

// ==========================================
// 7. SLIP GAJI GENERATOR FRAGMENT
// ==========================================
class TabSalarySlipFragment : Fragment() {
    private lateinit var btnSelectMonth: Button
    private lateinit var btnGenerateAll: Button
    private lateinit var recyclerViewSalary: RecyclerView
    private lateinit var txtNoData: TextView
    private lateinit var loadingOverlay: FrameLayout

    private var selectedMonthYear = "" // format: "MM-YYYY"
    private var salaryItems = mutableListOf<SalaryRecapItem>()

    data class SalaryRecapItem(
        val user: User,
        val totalHadir: Int,
        val totalTerlambat: Int,
        val totalIzin: Int,
        val totalSakit: Int,
        val totalOff: Int,
        val totalLembur: Int,
        var existingSlip: SalarySlip? = null
    )

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_slip_gaji, container, false)
        btnSelectMonth = view.findViewById(R.id.btnSelectMonth)
        btnGenerateAll = view.findViewById(R.id.btnGenerateAll)
        recyclerViewSalary = view.findViewById(R.id.recyclerViewSalary)
        txtNoData = view.findViewById(R.id.txtNoData)
        loadingOverlay = view.findViewById(R.id.loadingOverlay)

        recyclerViewSalary.layoutManager = LinearLayoutManager(context)

        btnSelectMonth.setOnClickListener { showMonthYearPicker() }

        return view
    }

    private fun showMonthYearPicker() {
        val cal = Calendar.getInstance()
        DatePickerDialog(requireContext(), { _, yr, mn, _ ->
            selectedMonthYear = String.format("%02d-%d", mn + 1, yr)
            btnSelectMonth.text = "Periode: $selectedMonthYear"
            txtNoData.visibility = View.GONE
            recyclerViewSalary.visibility = View.VISIBLE
            loadSalaryData()
        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
    }

    private fun loadSalaryData() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                // 1. Fetch active employees
                val employees = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select { filter { eq("is_active", true) } }
                        .decodeList<User>()
                }.filter { !it.role.equals("superadmin", ignoreCase = true) }

                // Split selectedMonthYear (MM-YYYY)
                val parts = selectedMonthYear.split("-")
                val targetMonth = parts[0]
                val targetYear = parts[1]

                salaryItems.clear()
                for (emp in employees) {
                    // Hitung range: dari 1 bulan target sampai 1 bulan berikutnya
                    val monthInt = targetMonth.toInt()
                    val yearInt = targetYear.toInt()
                    val nextMonth = if (monthInt == 12) 1 else monthInt + 1
                    val nextYear = if (monthInt == 12) yearInt + 1 else yearInt
                    val dateFrom = "$targetYear-${String.format("%02d", monthInt)}-01"
                    val dateTo   = "$nextYear-${String.format("%02d", nextMonth)}-01"

                    // Fetch attendance logs for that employee & month
                    val atts = withContext(Dispatchers.IO) {
                        SupabaseClient.db.from("attendance")
                            .select {
                                filter {
                                    eq("user_id", emp.id)
                                    gte("date", dateFrom)
                                    lt("date", dateTo)
                                }
                            }.decodeList<Attendance>()
                    }
                    val totalHadir = atts.count { !it.checkInTime.isNullOrEmpty() }
                    val totalTerlambat = atts.count { it.status == "terlambat" }

                    // Fetch approved leave requests overlapping target month
                    val leaves = withContext(Dispatchers.IO) {
                        SupabaseClient.db.from("leave_requests")
                            .select {
                                filter {
                                    eq("user_id", emp.id)
                                    eq("status", "approved")
                                    gte("start_date", dateFrom)
                                    lt("start_date", dateTo)
                                }
                            }.decodeList<LeaveRequest>()
                    }
                    val totalIzin = leaves.count { it.leaveType == "izin" }
                    val totalSakit = leaves.count { it.leaveType == "sakit" }

                    // Fetch off schedules in that month
                    val offs = withContext(Dispatchers.IO) {
                        SupabaseClient.db.from("off_schedules")
                            .select {
                                filter {
                                    eq("user_id", emp.id)
                                    gte("off_date", dateFrom)
                                    lt("off_date", dateTo)
                                }
                            }.decodeList<OffSchedule>()
                    }

                    // Fetch lembur emergency assignments in that month
                    val lemburs = withContext(Dispatchers.IO) {
                        SupabaseClient.db.from("emergency_assignments")
                            .select {
                                filter {
                                    eq("assigned_user_id", emp.id)
                                    eq("reason", "lembur")
                                    gte("target_date", dateFrom)
                                    lt("target_date", dateTo)
                                }
                            }.decodeList<EmergencyAssignment>()
                    }

                    // Check if salary slip already generated
                    val slips = withContext(Dispatchers.IO) {
                        SupabaseClient.db.from("salary_slips")
                            .select {
                                filter {
                                    eq("user_id", emp.id)
                                    eq("month_year", selectedMonthYear)
                                }
                            }.decodeList<SalarySlip>()
                    }
                    val existingSlip = slips.firstOrNull()

                    salaryItems.add(SalaryRecapItem(
                        emp,
                        totalHadir,
                        totalTerlambat,
                        totalIzin,
                        totalSakit,
                        offs.size,
                        lemburs.size,
                        existingSlip
                    ))
                }

                recyclerViewSalary.adapter = SalaryAdapter(salaryItems)

            } catch (e: Exception) {
                view?.let { Snackbar.make(it, "Gagal memuat rekap payroll: ${e.localizedMessage}", Snackbar.LENGTH_LONG).show() }
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    inner class SalaryAdapter(private val items: List<SalaryRecapItem>) : RecyclerView.Adapter<SalaryAdapter.ViewHolder>() {
        inner class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val txtName: TextView = v.findViewById(R.id.txtEmployeeName)
            val txtMeta: TextView = v.findViewById(R.id.txtEmployeeMeta)
            val txtRecap: TextView = v.findViewById(R.id.txtAttendanceRecap)
            val edtBase: TextInputEditText = v.findViewById(R.id.edtBaseSalary)
            val edtDeductions: TextInputEditText = v.findViewById(R.id.edtDeductions)
            val edtBonus: TextInputEditText = v.findViewById(R.id.edtBonus)
            val txtNet: TextView = v.findViewById(R.id.txtNetSalary)
            val btnGenerate: Button = v.findViewById(R.id.btnGeneratePdf)
            val btnDownload: Button = v.findViewById(R.id.btnDownloadShare)
            val spaceActions: Space = v.findViewById(R.id.spaceActions)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_salary_slip, parent, false)
            return ViewHolder(v)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val item = items[position]
            holder.txtName.text = item.user.name
            holder.txtMeta.text = "Role: ${item.user.role} | Kode: ${item.user.employeeCode ?: "-"}"
            holder.txtRecap.text = "Rekap: H: ${item.totalHadir} | T: ${item.totalTerlambat} | I: ${item.totalIzin} | S: ${item.totalSakit} | O: ${item.totalOff} | L: ${item.totalLembur}"

            val existing = item.existingSlip
            if (existing != null) {
                holder.edtBase.setText(existing.baseSalary.toInt().toString())
                holder.edtDeductions.setText(existing.deductions.toInt().toString())
                holder.edtBonus.setText(existing.bonus.toInt().toString())
                holder.txtNet.text = "Rp " + String.format("%,d", existing.netSalary.toInt())

                holder.btnGenerate.text = "Regenerate PDF"
                holder.btnDownload.visibility = View.VISIBLE
                holder.spaceActions.visibility = View.VISIBLE

                holder.btnDownload.setOnClickListener { openSalarySlipPdf(existing.pdfUrl ?: "") }
            } else {
                holder.edtBase.setText("4500000")
                holder.edtDeductions.setText("0")
                holder.edtBonus.setText("0")
                holder.txtNet.text = "Rp 4,500,000"

                holder.btnGenerate.text = "Generate PDF"
                holder.btnDownload.visibility = View.GONE
                holder.spaceActions.visibility = View.GONE
            }

            // Realtime wage calculator
            val watcher = object : TextWatcher {
                override fun beforeTextChanged(p0: CharSequence?, p1: Int, p2: Int, p3: Int) {}
                override fun onTextChanged(p0: CharSequence?, p1: Int, p2: Int, p3: Int) {}
                override fun afterTextChanged(p0: Editable?) {
                    val base = holder.edtBase.text.toString().toDoubleOrNull() ?: 0.0
                    val ded = holder.edtDeductions.text.toString().toDoubleOrNull() ?: 0.0
                    val bon = holder.edtBonus.text.toString().toDoubleOrNull() ?: 0.0
                    val net = base - ded + bon
                    holder.txtNet.text = "Rp " + String.format("%,d", net.toInt())
                }
            }
            holder.edtBase.addTextChangedListener(watcher)
            holder.edtDeductions.addTextChangedListener(watcher)
            holder.edtBonus.addTextChangedListener(watcher)

            holder.btnGenerate.setOnClickListener {
                val base = holder.edtBase.text.toString().toDoubleOrNull() ?: 0.0
                val ded = holder.edtDeductions.text.toString().toDoubleOrNull() ?: 0.0
                val bon = holder.edtBonus.text.toString().toDoubleOrNull() ?: 0.0
                generatePaySlipPdf(item, base, ded, bon)
            }
        }

        override fun getItemCount() = items.size
    }

    private fun generatePaySlipPdf(item: SalaryRecapItem, base: Double, deductions: Double, bonus: Double) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val netSalary = base - deductions + bonus
                val fileName = "slip_${item.user.id}_$selectedMonthYear.pdf"
                val pdfFile = File(context?.cacheDir, fileName)

                // 1. Create PDF using iText 7
                withContext(Dispatchers.IO) {
                    val writer = PdfWriter(pdfFile)
                    val pdfDoc = PdfDocument(writer)
                    val document = Document(pdfDoc)

                    document.add(Paragraph("PT CAREFASTINDO").setBold().setFontSize(16f).setTextAlignment(TextAlignment.CENTER))
                    document.add(Paragraph("SLIP GAJI RESMI").setBold().setFontSize(12f).setTextAlignment(TextAlignment.CENTER))
                    document.add(Paragraph("Periode: $selectedMonthYear\n").setFontSize(10f).setTextAlignment(TextAlignment.CENTER))

                    document.add(Paragraph("Nama Pegawai: ${item.user.name}"))
                    document.add(Paragraph("Kode Pegawai: ${item.user.employeeCode ?: "-"}"))
                    document.add(Paragraph("Posisi / Jabatan: ${item.user.position}"))
                    document.add(Paragraph("Departemen: Operations\n"))

                    document.add(Paragraph("REKAPITULASI PRESENSI BULANAN").setBold().setFontSize(11f))
                    val attTable = Table(6).useAllAvailableWidth()
                    attTable.addCell(Cell().add(Paragraph("Hadir (Hari)")))
                    attTable.addCell(Cell().add(Paragraph("Terlambat")))
                    attTable.addCell(Cell().add(Paragraph("Izin")))
                    attTable.addCell(Cell().add(Paragraph("Sakit")))
                    attTable.addCell(Cell().add(Paragraph("Off / Libur")))
                    attTable.addCell(Cell().add(Paragraph("Lembur")))

                    attTable.addCell(Cell().add(Paragraph(item.totalHadir.toString())))
                    attTable.addCell(Cell().add(Paragraph(item.totalTerlambat.toString())))
                    attTable.addCell(Cell().add(Paragraph(item.totalIzin.toString())))
                    attTable.addCell(Cell().add(Paragraph(item.totalSakit.toString())))
                    attTable.addCell(Cell().add(Paragraph(item.totalOff.toString())))
                    attTable.addCell(Cell().add(Paragraph(item.totalLembur.toString())))
                    document.add(attTable)

                    document.add(Paragraph("\nRINCIAN PENGHASILAN & POTONGAN").setBold().setFontSize(11f))
                    val salTable = Table(2).useAllAvailableWidth()
                    salTable.addCell(Cell().add(Paragraph("Deskripsi")))
                    salTable.addCell(Cell().add(Paragraph("Jumlah (Rupiah)")))

                    salTable.addCell(Cell().add(Paragraph("Gaji Pokok")))
                    salTable.addCell(Cell().add(Paragraph(String.format("%,d", base.toInt()))))

                    salTable.addCell(Cell().add(Paragraph("Tunjangan / Bonus")))
                    salTable.addCell(Cell().add(Paragraph(String.format("%,d", bonus.toInt()))))

                    salTable.addCell(Cell().add(Paragraph("Potongan Lateness / Kehadiran")))
                    salTable.addCell(Cell().add(Paragraph("- " + String.format("%,d", deductions.toInt()))))

                    salTable.addCell(Cell().add(Paragraph("TOTAL GAJI BERSIH (NET SALARY)").setBold()))
                    salTable.addCell(Cell().add(Paragraph("Rp " + String.format("%,d", netSalary.toInt())).setBold()))
                    document.add(salTable)

                    document.add(Paragraph("\n\nJakarta, " + SimpleDateFormat("dd MMMM yyyy", Locale("id", "ID")).format(Date())).setTextAlignment(TextAlignment.RIGHT))
                    document.add(Paragraph("\n\nPT Carefastindo Management").setTextAlignment(TextAlignment.RIGHT))

                    document.close()
                }

                // 2. Upload to Supabase Storage secure bucket
                val storagePath = "${item.user.id}/$selectedMonthYear.pdf"
                val fileBytes = pdfFile.readBytes()
                withContext(Dispatchers.IO) {
                    SupabaseClient.storage.from("salary-slips").upload(storagePath, fileBytes) {
                        upsert = true
                    }
                }

                // 3. Get Public URL
                val publicUrl = withContext(Dispatchers.IO) {
                    SupabaseClient.storage.from("salary-slips").publicUrl(storagePath)
                }

                // 4. Save to database table
                val slip = SalarySlip(
                    id = item.existingSlip?.id,
                    userId = item.user.id,
                    monthYear = selectedMonthYear,
                    baseSalary = base,
                    deductions = deductions,
                    bonus = bonus,
                    netSalary = netSalary,
                    pdfUrl = publicUrl
                )

                withContext(Dispatchers.IO) {
                    if (item.existingSlip != null) {
                        SupabaseClient.db.from("salary_slips").update(slip) {
                            filter { eq("id", item.existingSlip?.id ?: "") }
                        }
                    } else {
                        SupabaseClient.db.from("salary_slips").insert(slip)
                    }
                }

                Toast.makeText(context, "Slip Gaji PDF berhasil dibuat & diunggah!", Toast.LENGTH_SHORT).show()
                loadSalaryData()

            } catch (e: Exception) {
                Toast.makeText(context, "Gagal membuat slip PDF: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun openSalarySlipPdf(url: String) {
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(context, "Gagal membuka PDF: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
        }
    }
}

// ==========================================
// 8. PENGATURAN KANTOR FRAGMENT
// ==========================================
class TabSettingsFragment : Fragment() {
    private lateinit var edtLatitude: TextInputEditText
    private lateinit var edtLongitude: TextInputEditText
    private lateinit var edtRadius: TextInputEditText
    private lateinit var btnSaveSettings: Button
    private lateinit var loadingOverlay: FrameLayout

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_pengaturan, container, false)
        edtLatitude = view.findViewById(R.id.edtLatitude)
        edtLongitude = view.findViewById(R.id.edtLongitude)
        edtRadius = view.findViewById(R.id.edtRadius)
        btnSaveSettings = view.findViewById(R.id.btnSaveSettings)
        loadingOverlay = view.findViewById(R.id.loadingOverlay)

        btnSaveSettings.setOnClickListener { saveOfficeSettings() }

        loadOfficeSettings()
        return view
    }

    private fun loadOfficeSettings() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val configs = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("settings")
                        .select { filter { eq("id", "companyConfig") } }
                        .decodeList<CompanyConfig>()
                }
                val config = configs.firstOrNull()
                if (config != null) {
                    edtLatitude.setText(config.officeLat.toString())
                    edtLongitude.setText(config.officeLng.toString())
                    edtRadius.setText(config.radius.toInt().toString())
                }
            } catch (e: Exception) {
                view?.let { Snackbar.make(it, "Gagal memuat konfigurasi: ${e.localizedMessage}", Snackbar.LENGTH_LONG).show() }
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun saveOfficeSettings() {
        val lat = edtLatitude.text.toString().toDoubleOrNull()
        val lng = edtLongitude.text.toString().toDoubleOrNull()
        val radius = edtRadius.text.toString().toIntOrNull()

        if (lat == null || lng == null || radius == null) {
            Toast.makeText(context, "Mohon isi semua bidang dengan benar!", Toast.LENGTH_SHORT).show()
            return
        }

        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val newConfig = CompanyConfig(
                    id = "companyConfig",
                    officeLat = lat,
                    officeLng = lng,
                    radius = radius
                )

                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("settings").update(newConfig) {
                        filter { eq("id", "companyConfig") }
                    }
                }
                Toast.makeText(context, "Konfigurasi kantor berhasil diperbarui!", Toast.LENGTH_SHORT).show()
                loadOfficeSettings()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal menyimpan konfigurasi: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }
}

class TabViolationsFragment : GenericTabFragment("Pelanggaran & Peringatan")
class TabScheduleChangeFragment : Fragment() {
    private lateinit var loadingOverlay: FrameLayout

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val root = FrameLayout(requireContext())
        val content = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }
        content.addView(TextView(requireContext()).apply {
            text = "Tindakan untuk Pegawai"
            textSize = 18f
            setTextColor(android.graphics.Color.parseColor("#1F2937"))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, 0, 0, 18)
        })
        listOf(
            "Change Shift" to View.OnClickListener { showChangeShiftDialog() },
            "Off Day" to View.OnClickListener { showOffDayDialog() },
            "Lembur" to View.OnClickListener { startActivity(Intent(requireContext(), AssignLemburActivity::class.java)) },
            "Ganti Off" to View.OnClickListener { showGantiOffDialog() },
            "Cuti (Segera Hadir)" to View.OnClickListener { Toast.makeText(context, "Cuti segera hadir.", Toast.LENGTH_SHORT).show() }
        ).forEach { (label, listener) ->
            content.addView(MaterialButton(requireContext()).apply {
                text = label
                setOnClickListener(listener)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = 18 }
            })
        }
        loadingOverlay = FrameLayout(requireContext()).apply {
            setBackgroundColor(android.graphics.Color.parseColor("#80FFFFFF"))
            visibility = View.GONE
            addView(ProgressBar(requireContext()), FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                android.view.Gravity.CENTER
            ))
        }
        root.addView(content)
        root.addView(loadingOverlay, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        return root
    }

    private fun showChangeShiftDialog() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val employees = fetchActiveEmployees()
                val shifts = fetchActiveShifts()
                loadingOverlay.visibility = View.GONE
                if (employees.isEmpty() || shifts.isEmpty()) {
                    Toast.makeText(context, "Data pegawai atau shift belum tersedia.", Toast.LENGTH_SHORT).show()
                    return@launch
                }
                val form = createScheduleFormLayout()
                val spinEmployee = Spinner(requireContext())
                val spinShift = Spinner(requireContext())
                val btnDate = Button(requireContext())
                var selectedDate = todayIso()
                addFormLabel(form, "Pegawai")
                spinEmployee.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, employees.map { it.name })
                form.addView(spinEmployee)
                addFormLabel(form, "Shift baru")
                spinShift.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, shifts.map { it.name })
                form.addView(spinShift)
                addFormLabel(form, "Tanggal efektif")
                btnDate.text = "Pilih Tanggal: $selectedDate"
                btnDate.setOnClickListener { showDatePicker(selectedDate) { date -> selectedDate = date; btnDate.text = "Pilih Tanggal: $date" } }
                form.addView(btnDate)
                AlertDialog.Builder(requireContext())
                    .setTitle("Change Shift")
                    .setView(form)
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Simpan") { _, _ ->
                        val employee = employees.getOrNull(spinEmployee.selectedItemPosition)
                        val shift = shifts.getOrNull(spinShift.selectedItemPosition)
                        if (employee == null || shift == null) {
                            Toast.makeText(context, "Pilih pegawai dan shift terlebih dahulu.", Toast.LENGTH_SHORT).show()
                            return@setPositiveButton
                        }
                        saveChangeShift(employee, shift, selectedDate)
                    }
                    .show()
            } catch (e: Exception) {
                loadingOverlay.visibility = View.GONE
                Toast.makeText(context, "Gagal memuat form: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showOffDayDialog() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val employees = fetchActiveEmployees()
                loadingOverlay.visibility = View.GONE
                if (employees.isEmpty()) {
                    Toast.makeText(context, "Data pegawai belum tersedia.", Toast.LENGTH_SHORT).show()
                    return@launch
                }
                val form = createScheduleFormLayout()
                val spinEmployee = Spinner(requireContext())
                val btnDate = Button(requireContext())
                val edtReason = EditText(requireContext())
                var selectedDate = todayIso()
                addFormLabel(form, "Pegawai")
                spinEmployee.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, employees.map { it.name })
                form.addView(spinEmployee)
                addFormLabel(form, "Tanggal off")
                btnDate.text = "Pilih Tanggal: $selectedDate"
                btnDate.setOnClickListener { showDatePicker(selectedDate) { date -> selectedDate = date; btnDate.text = "Pilih Tanggal: $date" } }
                form.addView(btnDate)
                addFormLabel(form, "Alasan")
                edtReason.setText("libur")
                form.addView(edtReason)
                AlertDialog.Builder(requireContext())
                    .setTitle("Off Day")
                    .setView(form)
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Simpan") { _, _ ->
                        val employee = employees.getOrNull(spinEmployee.selectedItemPosition)
                        val reason = edtReason.text.toString().trim()
                        if (employee == null || reason.isEmpty()) {
                            Toast.makeText(context, "Pegawai dan alasan wajib diisi.", Toast.LENGTH_SHORT).show()
                            return@setPositiveButton
                        }
                        saveOffDay(employee, selectedDate, reason)
                    }
                    .show()
            } catch (e: Exception) {
                loadingOverlay.visibility = View.GONE
                Toast.makeText(context, "Gagal memuat form: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showGantiOffDialog() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val employees = fetchActiveEmployees()
                loadingOverlay.visibility = View.GONE
                if (employees.size < 2) {
                    Toast.makeText(context, "Minimal perlu dua pegawai untuk ganti off.", Toast.LENGTH_SHORT).show()
                    return@launch
                }
                val form = createScheduleFormLayout()
                val spinAssigned = Spinner(requireContext())
                val spinReplacing = Spinner(requireContext())
                val btnDate = Button(requireContext())
                var selectedDate = todayIso()
                addFormLabel(form, "Pegawai yang bertugas")
                spinAssigned.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, employees.map { it.name })
                form.addView(spinAssigned)
                addFormLabel(form, "Menggantikan pegawai")
                spinReplacing.adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, employees.map { it.name })
                form.addView(spinReplacing)
                addFormLabel(form, "Tanggal ganti off")
                btnDate.text = "Pilih Tanggal: $selectedDate"
                btnDate.setOnClickListener { showDatePicker(selectedDate) { date -> selectedDate = date; btnDate.text = "Pilih Tanggal: $date" } }
                form.addView(btnDate)
                AlertDialog.Builder(requireContext())
                    .setTitle("Ganti Off")
                    .setView(form)
                    .setNegativeButton("Batal", null)
                    .setPositiveButton("Simpan") { _, _ ->
                        val assigned = employees.getOrNull(spinAssigned.selectedItemPosition)
                        val replacing = employees.getOrNull(spinReplacing.selectedItemPosition)
                        if (assigned == null || replacing == null || assigned.id == replacing.id) {
                            Toast.makeText(context, "Pilih dua pegawai yang berbeda.", Toast.LENGTH_SHORT).show()
                            return@setPositiveButton
                        }
                        saveGantiOff(assigned, replacing, selectedDate)
                    }
                    .show()
            } catch (e: Exception) {
                loadingOverlay.visibility = View.GONE
                Toast.makeText(context, "Gagal memuat form: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private suspend fun fetchActiveEmployees(): List<User> = withContext(Dispatchers.IO) {
        SupabaseClient.db.from("users").select { filter { eq("is_active", true) } }.decodeList<User>()
            .filter { !it.role.equals("superadmin", ignoreCase = true) }
    }

    private suspend fun fetchActiveShifts(): List<Shift> = withContext(Dispatchers.IO) {
        SupabaseClient.db.from("shifts").select { filter { eq("is_active", true) } }.decodeList<Shift>()
    }

    private fun createScheduleFormLayout(): LinearLayout = LinearLayout(requireContext()).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(24, 8, 24, 0)
    }

    private fun addFormLabel(parent: LinearLayout, text: String) {
        parent.addView(TextView(requireContext()).apply { this.text = text; textSize = 14f; setPadding(0, 16, 0, 6) })
    }

    private fun todayIso(): String = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())

    private fun showDatePicker(currentDate: String, onPicked: (String) -> Unit) {
        val cal = Calendar.getInstance()
        try { SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).parse(currentDate)?.let { cal.time = it } } catch (_: Exception) { }
        DatePickerDialog(requireContext(), { _, year, month, day ->
            val picked = Calendar.getInstance().apply { set(year, month, day) }
            onPicked(SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(picked.time))
        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
    }

    @Serializable
    private data class UserShiftPayload(
        @SerialName("user_id") val userId: String,
        @SerialName("shift_id") val shiftId: String? = null,
        @SerialName("shift_type") val shiftType: String? = null,
        @SerialName("reason") val reason: String? = null,
        @SerialName("effective_date") val effectiveDate: String
    )

    @Serializable
    private data class NotificationPayload(
        @SerialName("user_id") val userId: String,
        @SerialName("message") val message: String,
        @SerialName("is_read") val isRead: Boolean = false
    )

    private fun saveChangeShift(employee: User, shift: Shift, effectiveDate: String) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("user_shifts").insert(UserShiftPayload(employee.id, shift.id, effectiveDate = effectiveDate))
                    SupabaseClient.db.from("notifications").insert(NotificationPayload(employee.id, "Admin mengubah jadwal shift kerja kamu, silahkan absen sesuai jam yang ditentukan."))
                }
                Toast.makeText(context, "Shift pegawai berhasil diperbarui!", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal memperbarui shift: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun saveOffDay(employee: User, date: String, reason: String) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("user_shifts").insert(UserShiftPayload(employee.id, null, "off", reason, date))
                    SupabaseClient.db.from("attendance").update({ set("status", "off") }) { filter { eq("user_id", employee.id); eq("date", date) } }
                    SupabaseClient.db.from("notifications").insert(NotificationPayload(employee.id, "Jadwal kamu diperbarui menjadi Off pada tanggal $date."))
                }
                Toast.makeText(context, "Hari off berhasil diset!", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal menyimpan off day: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun saveGantiOff(assigned: User, replacing: User, date: String) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                val currentAdminId = SupabaseClient.auth.currentSessionOrNull()?.user?.id
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("emergency_assignments").insert(EmergencyAssignment(
                        assignedUserId = assigned.id,
                        targetDate = date,
                        reason = "ganti_off",
                        replacingUserId = replacing.id,
                        assignedBy = currentAdminId,
                        assignedFrom = "android",
                        status = "pending"
                    ))
                    SupabaseClient.db.from("off_schedules").insert(OffSchedule(userId = replacing.id, date = date, reason = "Ganti off dengan ${assigned.name}"))
                }
                Toast.makeText(context, "Ganti off berhasil disimpan!", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(context, "Gagal menyimpan ganti off: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }
}

class TabScheduleHistoryFragment : Fragment() {
    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val root = FrameLayout(requireContext())
        val scroll = ScrollView(requireContext())
        val content = LinearLayout(requireContext()).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 24, 24, 24) }
        val loading = ProgressBar(requireContext())
        scroll.addView(content)
        root.addView(scroll)
        root.addView(loading, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, android.view.Gravity.CENTER))
        lifecycleScope.launch {
            try {
                val rows = loadScheduleHistoryRows()
                content.removeAllViews()
                if (rows.isEmpty()) {
                    content.addView(TextView(requireContext()).apply { text = "Belum ada riwayat perubahan jadwal."; textSize = 16f })
                } else {
                    rows.forEach { content.addView(createHistoryItem(it)) }
                }
            } catch (e: Exception) {
                content.removeAllViews()
                content.addView(TextView(requireContext()).apply { text = "Gagal memuat riwayat: ${e.localizedMessage}"; textSize = 14f })
            } finally {
                loading.visibility = View.GONE
            }
        }
        return root
    }

    private suspend fun loadScheduleHistoryRows(): List<String> = withContext(Dispatchers.IO) {
        val users = SupabaseClient.db.from("users").select().decodeList<User>().associateBy { it.id }
        val shifts = SupabaseClient.db.from("shifts").select().decodeList<Shift>().associateBy { it.id }
        val result = mutableListOf<String>()
        SupabaseClient.db.from("user_shifts").select().decodeList<Map<String, kotlinx.serialization.json.JsonElement>>().forEach { row ->
            val userId = cleanJson(row["user_id"])
            val date = cleanJson(row["effective_date"]) ?: "-"
            val type = cleanJson(row["shift_type"])
            val reason = cleanJson(row["reason"])
            val shiftId = cleanJson(row["shift_id"])
            val name = users[userId]?.name ?: "Pegawai"
            val title = if (type == "off") "Off Day" else "Change Shift"
            val detail = if (type == "off") reason ?: "libur" else shifts[shiftId]?.name ?: "-"
            result.add("$date\n$title - $name\n$detail")
        }
        SupabaseClient.db.from("emergency_assignments").select().decodeList<EmergencyAssignment>().forEach { item ->
            val assigned = users[item.assignedUserId]?.name ?: "Pegawai"
            val replacing = item.replacingUserId?.let { users[it]?.name } ?: "-"
            val title = if (item.reason == "ganti_off") "Ganti Off" else "Lembur"
            val detail = if (item.reason == "ganti_off") "Ganti off dengan $replacing" else "Lembur"
            result.add("${item.targetDate}\n$title - $assigned\n$detail")
        }
        SupabaseClient.db.from("overtime_assignments").select().decodeList<OvertimeAssignment>().forEach { item ->
            val user = users[item.userId]?.name ?: "Pegawai"
            val shift = shifts[item.shiftId]?.name ?: "-"
            result.add("${item.assignmentDate}\nLembur - $user\n$shift")
        }
        result.sortedDescending()
    }

    private fun cleanJson(value: kotlinx.serialization.json.JsonElement?): String? {
        val raw = value?.toString()?.trim('"') ?: return null
        return if (raw == "null") null else raw
    }

    private fun createHistoryItem(textValue: String): View = TextView(requireContext()).apply {
        text = textValue
        textSize = 14f
        setTextColor(android.graphics.Color.parseColor("#1F2937"))
        setPadding(24, 18, 24, 18)
        background = android.graphics.drawable.GradientDrawable().apply {
            setColor(android.graphics.Color.WHITE)
            setStroke(1, android.graphics.Color.parseColor("#E5E7EB"))
            cornerRadius = 14f
        }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = 14 }
    }
}
