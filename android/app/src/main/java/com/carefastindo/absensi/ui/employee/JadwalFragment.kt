package com.carefastindo.absensi.ui.employee

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.ProgressBar
import android.widget.Spinner
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.carefastindo.absensi.R
import com.carefastindo.absensi.data.model.Attendance
import com.carefastindo.absensi.data.model.EmergencyAssignment
import com.carefastindo.absensi.data.model.LeaveRequest
import com.carefastindo.absensi.data.model.OffSchedule
import com.carefastindo.absensi.data.model.OvertimeAssignment
import com.carefastindo.absensi.data.model.Shift
import com.carefastindo.absensi.data.model.User
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.carefastindo.absensi.utils.ShiftHelper
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

class JadwalFragment : Fragment() {

    private lateinit var spinMonth: Spinner
    private lateinit var spinYear: Spinner
    private lateinit var txtShiftInfo: TextView
    private lateinit var progressJadwal: ProgressBar
    private lateinit var txtEmptyJadwal: TextView
    private lateinit var rvJadwal: RecyclerView

    private var selectedYear = Calendar.getInstance().get(Calendar.YEAR)
    private var selectedMonth = Calendar.getInstance().get(Calendar.MONTH)
    private var isSpinnerReady = false
    private val currentYear = Calendar.getInstance().get(Calendar.YEAR)
    private val years: Array<String> by lazy {
        (2023..currentYear + 2).map { it.toString() }.toTypedArray()
    }

    private val idLocale = Locale("id", "ID")
    private val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    private val cardDateFmt = SimpleDateFormat("dd/MM/yyyy", Locale.US)

    private val monthNames = arrayOf(
        "Januari", "Februari", "Maret", "April", "Mei", "Juni",
        "Juli", "Agustus", "September", "Oktober", "November", "Desember"
    )

    data class ScheduleEntry(val effectiveDate: String, val shiftId: String)

    data class DayItem(
        val dateStr: String,
        val dateLabel: String,
        val scheduleLabel: String,
        val statusLabel: String,
        val changeLabel: String,
        val isToday: Boolean
    )

    private val days = mutableListOf<DayItem>()
    private lateinit var adapter: JadwalAdapter

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_jadwal, container, false)

        spinMonth = view.findViewById(R.id.spinMonth)
        spinYear = view.findViewById(R.id.spinYear)
        txtShiftInfo = view.findViewById(R.id.txtShiftInfo)
        progressJadwal = view.findViewById(R.id.progressJadwal)
        txtEmptyJadwal = view.findViewById(R.id.txtEmptyJadwal)
        rvJadwal = view.findViewById(R.id.rvJadwal)

        setupRecycler()
        setupSpinners()

        return view
    }

    private fun setupRecycler() {
        rvJadwal.layoutManager = LinearLayoutManager(requireContext())
        adapter = JadwalAdapter(days)
        rvJadwal.adapter = adapter
    }

    private fun setupSpinners() {
        val monthAdapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_item, monthNames)
        monthAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinMonth.adapter = monthAdapter

        val yearAdapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_item, years)
        yearAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinYear.adapter = yearAdapter

        val listener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (!isSpinnerReady) return
                selectedMonth = spinMonth.selectedItemPosition
                selectedYear = years[spinYear.selectedItemPosition].toInt()
                loadJadwal()
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        spinMonth.onItemSelectedListener = listener
        spinYear.onItemSelectedListener = listener

        spinMonth.setSelection(selectedMonth)
        spinYear.setSelection(years.indexOf(currentYear.toString()).takeIf { it >= 0 } ?: 1)

        isSpinnerReady = true
        loadJadwal()
    }

    private fun loadJadwal() {
        showLoading()

        lifecycleScope.launch {
            try {
                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id ?: return@launch

                val firstDayStr = String.format("%04d-%02d-01", selectedYear, selectedMonth + 1)
                val cal = Calendar.getInstance()
                cal.set(selectedYear, selectedMonth, 1)
                val lastDay = cal.getActualMaximum(Calendar.DAY_OF_MONTH)
                val lastDayStr = String.format("%04d-%02d-%02d", selectedYear, selectedMonth + 1, lastDay)
                val todayStr = dateFmt.format(Calendar.getInstance().time)
                val selectedMonthStr = String.format("%04d-%02d", selectedYear, selectedMonth + 1)
                val todayMonthStr = todayStr.substring(0, 7)
                val isFutureMonth = selectedMonthStr > todayMonthStr

                if (isFutureMonth) {
                    withContext(Dispatchers.Main) {
                        txtShiftInfo.text = ""
                        days.clear()
                        adapter.notifyDataSetChanged()
                        showEmpty()
                    }
                    return@launch
                }

                if (ShiftHelper.cachedShifts.isEmpty()) {
                    ShiftHelper.loadShifts()
                }
                val shiftById = ShiftHelper.cachedShifts.associateBy { it.id }
                val userShiftRows = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("user_shifts")
                        .select {
                            filter {
                                eq("user_id", userId)
                                lte("effective_date", lastDayStr)
                            }
                            order("effective_date", Order.ASCENDING)
                        }
                        .decodeList<Map<String, kotlinx.serialization.json.JsonElement>>()
                }

                val normalShiftEntries = userShiftRows.mapNotNull { row ->
                    val type = cleanJson(row["shift_type"])
                    if (type == "off" || type == "profile_edit") return@mapNotNull null
                    val date = cleanJson(row["effective_date"]) ?: return@mapNotNull null
                    val shiftId = cleanJson(row["shift_id"]) ?: return@mapNotNull null
                    ScheduleEntry(date, shiftId)
                }.sortedBy { it.effectiveDate }

                val monthShiftEntries = normalShiftEntries.filter { it.effectiveDate in firstDayStr..lastDayStr }

                fun shiftForDate(dateStr: String): Shift? {
                    val entry = normalShiftEntries
                        .filter { it.effectiveDate <= dateStr }
                        .lastOrNull() ?: return null
                    return shiftById[entry.shiftId]
                }

                fun previousShiftBefore(dateStr: String): Shift? {
                    val entry = normalShiftEntries
                        .filter { it.effectiveDate < dateStr }
                        .lastOrNull() ?: return null
                    return shiftById[entry.shiftId]
                }

                val attendanceList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("attendance")
                        .select {
                            filter {
                                eq("user_id", userId)
                                gte("date", firstDayStr)
                                lte("date", lastDayStr)
                            }
                        }.decodeList<Attendance>()
                }
                val attByDate = attendanceList.associateBy { it.date }

                val offList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("off_schedules")
                        .select {
                            filter {
                                eq("user_id", userId)
                                gte("off_date", firstDayStr)
                                lte("off_date", lastDayStr)
                            }
                        }.decodeList<OffSchedule>()
                }
                val offDates = offList.map { it.date }.toMutableSet()
                offDates.addAll(userShiftRows.mapNotNull { row ->
                    if (cleanJson(row["shift_type"]) == "off") cleanJson(row["effective_date"]) else null
                }.filter { it in firstDayStr..lastDayStr })

                val leaveList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("leave_requests")
                        .select {
                            filter { eq("user_id", userId) }
                        }.decodeList<LeaveRequest>()
                }.filter { leave ->
                    !leave.status.equals("rejected", ignoreCase = true) &&
                        leave.startDate <= lastDayStr && leave.endDate >= firstDayStr
                }

                val emergencyList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("emergency_assignments")
                        .select {
                            filter {
                                eq("assigned_user_id", userId)
                                gte("target_date", firstDayStr)
                                lte("target_date", lastDayStr)
                            }
                        }.decodeList<EmergencyAssignment>()
                }
                val emergenciesByDate = emergencyList.groupBy { it.targetDate }

                val overtimeList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("overtime_assignments")
                        .select {
                            filter {
                                eq("user_id", userId)
                                gte("assignment_date", firstDayStr)
                                lte("assignment_date", lastDayStr)
                            }
                        }.decodeList<OvertimeAssignment>()
                }
                val overtimeDates = overtimeList.map { it.assignmentDate }.toSet()

                val usersById = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users").select().decodeList<User>().associateBy { it.id }
                }


                withContext(Dispatchers.Main) {
                    val todayShift = if (todayStr in firstDayStr..lastDayStr && todayStr !in offDates) shiftForDate(todayStr) else null
                    txtShiftInfo.text = todayShift?.let { scheduleText(it).removePrefix("Shift ") } ?: ""
                }

                val newDays = mutableListOf<DayItem>()
                val iterCal = Calendar.getInstance()

                for (day in 1..lastDay) {
                    iterCal.set(selectedYear, selectedMonth, day)
                    val dateStr = dateFmt.format(iterCal.time)
                    val isToday = dateStr == todayStr
                    val isFuture = dateStr > todayStr
                    val att = attByDate[dateStr]
                    val leave = leaveList.firstOrNull { dateStr in it.startDate..it.endDate }
                    val isOff = dateStr in offDates || att?.status.equals("off", ignoreCase = true)
                    val shift = if (isOff) null else shiftForDate(dateStr)

                    val scheduleLabel = when {
                        isOff -> "Off"
                        shift != null -> scheduleText(shift)
                        else -> "-"
                    }

                    val statusLabel = statusText(dateStr, isToday, isFuture, isOff, att, leave)
                    val changeLabel = changeText(
                        dateStr = dateStr,
                        firstDayStr = firstDayStr,
                        monthShiftEntries = monthShiftEntries,
                        previousShift = previousShiftBefore(dateStr),
                        currentShift = shift,
                        leave = leave,
                        emergencies = emergenciesByDate[dateStr].orEmpty(),
                        overtimeExists = dateStr in overtimeDates,
                        usersById = usersById
                    )

                    newDays.add(
                        DayItem(
                            dateStr = dateStr,
                            dateLabel = cardDateFmt.format(iterCal.time),
                            scheduleLabel = scheduleLabel,
                            statusLabel = statusLabel,
                            changeLabel = changeLabel,
                            isToday = isToday
                        )
                    )
                }

                withContext(Dispatchers.Main) {
                    days.clear()
                    days.addAll(newDays)
                    adapter.notifyDataSetChanged()
                    showList()
                    val todayIdx = newDays.indexOfFirst { it.dateStr == todayStr }
                    if (todayIdx >= 0) {
                        (rvJadwal.layoutManager as LinearLayoutManager).scrollToPositionWithOffset(todayIdx, 0)
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) { showEmpty() }
            }
        }
    }

    private fun cleanJson(value: kotlinx.serialization.json.JsonElement?): String? {
        return value?.toString()?.trim('"')?.takeIf { it.isNotBlank() && it != "null" }
    }

    private fun scheduleText(shift: Shift): String {
        return "Shift ${shiftDisplayName(shift.name)} (${shift.startTime.take(5)} s/d ${shift.endTime.take(5)})"
    }

    private fun statusText(
        dateStr: String,
        isToday: Boolean,
        isFuture: Boolean,
        isOff: Boolean,
        attendance: Attendance?,
        leave: LeaveRequest?
    ): String {
        if (isOff) return "Off"
        if (leave != null) return leaveStatusText(leave.leaveType)
        if (isFuture) return "-"

        if (attendance != null) {
            return when {
                attendance.status.equals("off", ignoreCase = true) -> "Off"
                attendance.status.equals("izin", ignoreCase = true) -> "Izin"
                attendance.status.equals("sakit", ignoreCase = true) -> "Sakit"
                attendance.status.equals("cuti", ignoreCase = true) -> "Cuti"
                attendance.status.equals("alfa", ignoreCase = true) || attendance.status.equals("absen", ignoreCase = true) -> "Alfa"
                attendance.checkOutTime != null -> "Sudah Absensi"
                attendance.checkInTime != null -> "Berlangsung"
                else -> attendance.status.replaceFirstChar { it.uppercase(idLocale) }
            }
        }

        return if (isToday) "Belum Absen" else "Alfa"
    }

    private fun leaveStatusText(type: String): String {
        return when (type.lowercase(idLocale)) {
            "izin" -> "Izin"
            "sakit" -> "Sakit"
            "cuti" -> "Cuti"
            else -> type.replaceFirstChar { it.uppercase(idLocale) }
        }
    }

    private fun changeText(
        dateStr: String,
        firstDayStr: String,
        monthShiftEntries: List<ScheduleEntry>,
        previousShift: Shift?,
        currentShift: Shift?,
        leave: LeaveRequest?,
        emergencies: List<EmergencyAssignment>,
        overtimeExists: Boolean,
        usersById: Map<String, User>
    ): String {
        val changes = mutableListOf<String>()

        val entryToday = monthShiftEntries.lastOrNull { it.effectiveDate == dateStr }
        if (entryToday != null && dateStr != firstDayStr && previousShift != null && currentShift != null && previousShift.id != currentShift.id) {
            changes.add("Change Shift dari ${shiftDisplayName(previousShift.name)} ke ${shiftDisplayName(currentShift.name)}")
        }

        emergencies.forEach { emergency ->
            when (emergency.reason.lowercase(idLocale)) {
                "ganti_off" -> {
                    val name = emergency.replacingUserId?.let { usersById[it]?.name }
                    changes.add(if (name != null) "Ganti Off dengan $name" else "Ganti Off")
                }
                "lembur" -> changes.add("Lembur")
            }
        }

        if (overtimeExists && changes.none { it.equals("Lembur", ignoreCase = true) }) {
            changes.add("Lembur")
        }

        if (leave != null) {
            changes.add(leaveStatusText(leave.leaveType))
        }

        return if (changes.isEmpty()) "-" else "Ada (${changes.joinToString("; ")})."
    }

    private fun shiftDisplayName(shiftName: String): String {
        return when {
            shiftName.contains("Kantor", ignoreCase = true) -> "Kantor"
            shiftName.contains("III", ignoreCase = true) || shiftName.contains("3") -> "Malam"
            shiftName.contains("II", ignoreCase = true) || shiftName.contains("2") -> "Sore"
            shiftName.contains("I", ignoreCase = true) || shiftName.contains("1") -> "Pagi"
            else -> shiftName
        }
    }

    private fun showLoading() {
        progressJadwal.visibility = View.VISIBLE
        rvJadwal.visibility = View.GONE
        txtEmptyJadwal.visibility = View.GONE
    }

    private fun showEmpty() {
        progressJadwal.visibility = View.GONE
        rvJadwal.visibility = View.GONE
        txtEmptyJadwal.visibility = View.VISIBLE
    }

    private fun showList() {
        progressJadwal.visibility = View.GONE
        rvJadwal.visibility = View.VISIBLE
        txtEmptyJadwal.visibility = View.GONE
    }

    inner class JadwalAdapter(private val items: List<DayItem>) : RecyclerView.Adapter<JadwalAdapter.ViewHolder>() {

        inner class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val txtDateFull: TextView = v.findViewById(R.id.txtDateFull)
            val txtScheduleValue: TextView = v.findViewById(R.id.txtScheduleValue)
            val txtStatusValue: TextView = v.findViewById(R.id.txtStatusValue)
            val txtChangeValue: TextView = v.findViewById(R.id.txtChangeValue)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_jadwal_day, parent, false)
            return ViewHolder(v)
        }

        override fun getItemCount() = items.size

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val item = items[position]
            holder.txtDateFull.text = item.dateLabel
            holder.txtScheduleValue.text = "Jadwal Kamu : ${item.scheduleLabel}"
            holder.txtStatusValue.text = "Status : ${item.statusLabel}"
            holder.txtChangeValue.text = "Perubahan Jadwal : ${item.changeLabel}"
        }
    }
}