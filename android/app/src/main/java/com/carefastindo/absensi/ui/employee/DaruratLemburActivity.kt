package com.carefastindo.absensi.ui.employee

import android.app.DatePickerDialog
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.carefastindo.absensi.R
import com.carefastindo.absensi.data.model.EmergencyAssignment
import com.carefastindo.absensi.data.model.Shift
import com.carefastindo.absensi.data.model.User
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.google.android.material.button.MaterialButton
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class DaruratLemburActivity : AppCompatActivity() {

    private lateinit var btnBack: ImageButton
    private lateinit var spinEmployee: Spinner
    private lateinit var spinShift: Spinner
    private lateinit var spinReplacing: Spinner
    private lateinit var btnPickDate: Button
    private lateinit var btnPickReplacingDate: Button
    private lateinit var radioGroupReason: RadioGroup
    private lateinit var radioLembur: RadioButton
    private lateinit var radioGantiOff: RadioButton
    private lateinit var layoutShift: LinearLayout
    private lateinit var layoutReplacing: LinearLayout
    private lateinit var btnSubmit: MaterialButton
    private lateinit var recyclerEmergency: RecyclerView
    private lateinit var txtNoData: TextView
    private lateinit var loadingOverlay: FrameLayout

    private var usersList = listOf<User>()
    private var shiftsList = listOf<Shift>()
    private var selectedDate: String = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
    private var selectedReplacingDate: String? = null
    private var currentUserRole: String = ""

    data class EmergencyWithNames(
        val assignment: EmergencyAssignment,
        val assignedName: String,
        val replacingName: String?,
        val shiftName: String?
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_darurat_lembur)

        btnBack = findViewById(R.id.btnBack)
        spinEmployee = findViewById(R.id.spinEmployee)
        spinShift = findViewById(R.id.spinShift)
        spinReplacing = findViewById(R.id.spinReplacing)
        btnPickDate = findViewById(R.id.btnPickDate)
        btnPickReplacingDate = findViewById(R.id.btnPickReplacingDate)
        radioGroupReason = findViewById(R.id.radioGroupReason)
        radioLembur = findViewById(R.id.radioLembur)
        radioGantiOff = findViewById(R.id.radioGantiOff)
        layoutShift = findViewById(R.id.layoutShift)
        layoutReplacing = findViewById(R.id.layoutReplacing)
        btnSubmit = findViewById(R.id.btnSubmit)
        recyclerEmergency = findViewById(R.id.recyclerEmergency)
        txtNoData = findViewById(R.id.txtNoData)
        loadingOverlay = findViewById(R.id.loadingOverlay)

        btnBack.setOnClickListener { finish() }

        recyclerEmergency.layoutManager = LinearLayoutManager(this)

        // Update displayed date
        btnPickDate.text = "Tanggal: $selectedDate"
        btnPickDate.setOnClickListener { showDatePicker() }

        btnPickReplacingDate.setOnClickListener { showReplacingDatePicker() }

        // Radio group listener — show/hide conditional fields
        radioGroupReason.setOnCheckedChangeListener { _, checkedId ->
            when (checkedId) {
                R.id.radioLembur -> {
                    layoutShift.visibility = View.VISIBLE
                    layoutReplacing.visibility = View.GONE
                }
                R.id.radioGantiOff -> {
                    layoutShift.visibility = View.GONE
                    layoutReplacing.visibility = View.VISIBLE
                }
            }
        }

        btnSubmit.setOnClickListener { submitAssignment() }

        loadData()
    }

    private fun loadData() {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                // Get current user role for filtering
                val currentUserId = SupabaseClient.auth.currentSessionOrNull()?.user?.id ?: ""
                val currentUser = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select { filter { eq("id", currentUserId) } }
                        .decodeSingle<User>()
                }
                currentUserRole = currentUser.role

                // Fetch active users — superadmin sees all, Leader/Supervisor see their team
                val allUsers = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select { filter { eq("is_active", true) } }
                        .decodeList<User>()
                }.filter { !it.role.equals("superadmin", ignoreCase = true) }

                usersList = if (currentUserRole.equals("superadmin", ignoreCase = true)) {
                    allUsers
                } else {
                    // Leader/Supervisor hanya bisa lihat user berole bukan supervisor/leader
                    allUsers.filter { !it.role.equals("supervisor", ignoreCase = true) && !it.role.equals("leader", ignoreCase = true) }
                }

                // Fetch shifts
                shiftsList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("shifts")
                        .select { filter { eq("is_active", true) } }
                        .decodeList<Shift>()
                }

                val userNames = usersList.map { it.name }.toTypedArray()
                spinEmployee.adapter = ArrayAdapter(this@DaruratLemburActivity, android.R.layout.simple_spinner_dropdown_item, userNames)
                spinReplacing.adapter = ArrayAdapter(this@DaruratLemburActivity, android.R.layout.simple_spinner_dropdown_item, userNames)
                spinShift.adapter = ArrayAdapter(this@DaruratLemburActivity, android.R.layout.simple_spinner_dropdown_item,
                    shiftsList.map { it.name }.toTypedArray())

                loadAssignments()
            } catch (e: Exception) {
                loadingOverlay.visibility = View.GONE
                Toast.makeText(this@DaruratLemburActivity, "Gagal memuat data: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun loadAssignments() {
        lifecycleScope.launch {
            try {
                val list = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("emergency_assignments")
                        .select {
                            order("created_at", Order.DESCENDING)
                        }
                        .decodeList<EmergencyAssignment>()
                }

                val allUsers = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users").select().decodeList<User>()
                }
                val allShifts = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("shifts").select().decodeList<Shift>()
                }

                val enriched = list.map { em ->
                    EmergencyWithNames(
                        assignment = em,
                        assignedName = allUsers.find { it.id == em.assignedUserId }?.name ?: "—",
                        replacingName = em.replacingUserId?.let { rid -> allUsers.find { it.id == rid }?.name },
                        shiftName = em.shiftId?.let { sid -> allShifts.find { it.id == sid }?.name }
                    )
                }

                withContext(Dispatchers.Main) {
                    loadingOverlay.visibility = View.GONE
                    if (enriched.isEmpty()) {
                        txtNoData.visibility = View.VISIBLE
                        recyclerEmergency.visibility = View.GONE
                    } else {
                        txtNoData.visibility = View.GONE
                        recyclerEmergency.visibility = View.VISIBLE
                        recyclerEmergency.adapter = EmergencyAdapter(enriched)
                    }
                }
            } catch (e: Exception) {
                loadingOverlay.visibility = View.GONE
                Toast.makeText(this@DaruratLemburActivity, "Gagal memuat daftar: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun showDatePicker() {
        val cal = Calendar.getInstance()
        DatePickerDialog(this, { _, yr, mn, dy ->
            val c = Calendar.getInstance()
            c.set(yr, mn, dy)
            selectedDate = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(c.time)
            btnPickDate.text = "Tanggal: $selectedDate"
        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
    }

    private fun showReplacingDatePicker() {
        val cal = Calendar.getInstance()
        DatePickerDialog(this, { _, yr, mn, dy ->
            val c = Calendar.getInstance()
            c.set(yr, mn, dy)
            selectedReplacingDate = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(c.time)
            btnPickReplacingDate.text = "Off digantikan: $selectedReplacingDate"
        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
    }

    private fun submitAssignment() {
        val empIdx = spinEmployee.selectedItemPosition
        if (empIdx < 0 || empIdx >= usersList.size) {
            Toast.makeText(this, "Pilih karyawan terlebih dahulu", Toast.LENGTH_SHORT).show(); return
        }

        val reason = if (radioLembur.isChecked) "lembur" else "ganti_off"
        val assignedUser = usersList[empIdx]
        val currentAdminId = SupabaseClient.auth.currentSessionOrNull()?.user?.id

        var shiftId: String? = null
        var replacingUserId: String? = null
        var replacingDate: String? = null

        if (reason == "lembur") {
            val shiftIdx = spinShift.selectedItemPosition
            if (shiftIdx >= 0 && shiftIdx < shiftsList.size) {
                shiftId = shiftsList[shiftIdx].id
            }
        } else {
            // Ganti Off
            val replIdx = spinReplacing.selectedItemPosition
            if (replIdx < 0 || replIdx >= usersList.size) {
                Toast.makeText(this, "Pilih karyawan yang digantikan", Toast.LENGTH_SHORT).show(); return
            }
            replacingUserId = usersList[replIdx].id
            if (replacingUserId == assignedUser.id) {
                Toast.makeText(this, "Karyawan yang ditugaskan dan digantikan tidak boleh sama", Toast.LENGTH_SHORT).show(); return
            }
            if (selectedReplacingDate == null) {
                Toast.makeText(this, "Pilih tanggal off yang akan digantikan", Toast.LENGTH_SHORT).show(); return
            }
            replacingDate = selectedReplacingDate
        }

        loadingOverlay.visibility = View.VISIBLE
        btnSubmit.isEnabled = false

        lifecycleScope.launch {
            try {
                val assignment = EmergencyAssignment(
                    assignedUserId = assignedUser.id,
                    targetDate = selectedDate,
                    reason = reason,
                    replacingUserId = replacingUserId,
                    replacingDate = replacingDate,
                    shiftId = shiftId,
                    assignedBy = currentAdminId,
                    assignedFrom = "android",
                    status = "pending"
                )

                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("emergency_assignments").insert(assignment)
                }

                // Untuk ganti_off: tambahkan juga off_schedule baru untuk karyawan yang digantikan
                // agar karyawan yang digantikan (replacing_user) mendapat hari off baru di replacing_date
                if (reason == "ganti_off" && replacingUserId != null && replacingDate != null) {
                    try {
                        withContext(Dispatchers.IO) {
                            val offEntry = mapOf(
                                "user_id" to replacingUserId,
                                "off_date" to replacingDate,
                                "reason" to "Ganti off dengan ${assignedUser.name}"
                            )
                            SupabaseClient.db.from("off_schedules").insert(offEntry)
                        }
                    } catch (e: Exception) {
                        // Off schedule creation failed, log but don't fail the whole operation
                        e.printStackTrace()
                    }
                }

                Toast.makeText(this@DaruratLemburActivity, "Penugasan berhasil disimpan!", Toast.LENGTH_SHORT).show()
                // Reset form
                selectedReplacingDate = null
                btnPickReplacingDate.text = "Pilih Tanggal Off yang Digantikan"
                loadAssignments()
            } catch (e: Exception) {
                Toast.makeText(this@DaruratLemburActivity, "Gagal: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                loadingOverlay.visibility = View.GONE
            } finally {
                btnSubmit.isEnabled = true
            }
        }
    }

    inner class EmergencyAdapter(private val items: List<EmergencyWithNames>) :
        RecyclerView.Adapter<EmergencyAdapter.ViewHolder>() {

        inner class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val txtName: TextView = v.findViewById(R.id.txtEmployeeName)
            val txtDate: TextView = v.findViewById(R.id.txtTargetDate)
            val txtDetail: TextView = v.findViewById(R.id.txtReasonDetail)
            val txtStatus: TextView = v.findViewById(R.id.txtStatus)
            val btnDelete: ImageButton = v.findViewById(R.id.btnDelete)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_emergency_assign, parent, false)
            return ViewHolder(v)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val item = items[position]
            val em = item.assignment

            holder.txtName.text = item.assignedName
            holder.txtDate.text = "Tanggal: ${em.targetDate}"

            if (em.reason == "lembur") {
                holder.txtDetail.text = "⚡ Lembur — Shift: ${item.shiftName ?: "-"}"
                holder.txtDetail.setTextColor(android.graphics.Color.parseColor("#1D4ED8"))
            } else {
                holder.txtDetail.text = "🔄 Ganti Off — Menggantikan: ${item.replacingName ?: "-"}"
                holder.txtDetail.setTextColor(android.graphics.Color.parseColor("#D97706"))
            }

            // Status badge color
            val statusText = em.status.replaceFirstChar { it.uppercase() }
            holder.txtStatus.text = statusText
            val bgColor = when (em.status) {
                "pending" -> "#F59E0B"
                "active" -> "#10B981"
                else -> "#64748B"
            }
            holder.txtStatus.backgroundTintList =
                android.content.res.ColorStateList.valueOf(android.graphics.Color.parseColor(bgColor))

            holder.btnDelete.setOnClickListener {
                AlertDialog.Builder(this@DaruratLemburActivity)
                    .setTitle("Hapus Penugasan")
                    .setMessage("Yakin ingin menghapus penugasan ini?")
                    .setPositiveButton("Hapus") { _, _ -> deleteAssignment(em.id ?: "") }
                    .setNegativeButton("Batal", null)
                    .show()
            }
        }

        override fun getItemCount() = items.size
    }

    private fun deleteAssignment(id: String) {
        loadingOverlay.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("emergency_assignments")
                        .delete { filter { eq("id", id) } }
                }
                Toast.makeText(this@DaruratLemburActivity, "Penugasan berhasil dihapus!", Toast.LENGTH_SHORT).show()
                loadAssignments()
            } catch (e: Exception) {
                Toast.makeText(this@DaruratLemburActivity, "Gagal menghapus: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
                loadingOverlay.visibility = View.GONE
            }
        }
    }
}
