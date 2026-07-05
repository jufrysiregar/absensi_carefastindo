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
import androidx.cardview.widget.CardView
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.carefastindo.absensi.R
import com.carefastindo.absensi.data.model.Attendance
import com.carefastindo.absensi.data.model.EmergencyAssignment
import com.carefastindo.absensi.data.model.OffSchedule
import com.carefastindo.absensi.data.model.OvertimeAssignment
import com.carefastindo.absensi.data.model.Shift
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

    // ── UI ──────────────────────────────────────────────────────
    private lateinit var spinMonth: Spinner
    private lateinit var spinYear: Spinner
    private lateinit var txtShiftInfo: TextView
    private lateinit var progressJadwal: ProgressBar
    private lateinit var txtEmptyJadwal: TextView
    private lateinit var rvJadwal: RecyclerView

    // ── State ───────────────────────────────────────────────────
    private var selectedYear = Calendar.getInstance().get(Calendar.YEAR)
    private var selectedMonth = Calendar.getInstance().get(Calendar.MONTH) // 0-indexed
    private var isSpinnerReady = false
    private val currentYear = Calendar.getInstance().get(Calendar.YEAR)
    private val years: Array<String> by lazy {
        // Dari 2023 sampai 2 tahun ke depan
        val start = 2023
        val end   = currentYear + 2
        (start..end).map { it.toString() }.toTypedArray()
    }

    // ── Locale ──────────────────────────────────────────────────
    private val idLocale = Locale("id", "ID")
    private val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    private val dayShortFmt = SimpleDateFormat("EEE", idLocale)

    private val monthNames = arrayOf(
        "Januari", "Februari", "Maret", "April", "Mei", "Juni",
        "Juli", "Agustus", "September", "Oktober", "November", "Desember"
    )

    // ── Data ────────────────────────────────────────────────────
    data class DayItem(
        val dateStr: String,
        val dayName: String,
        val dayNumber: Int,
        val shift: Shift?,            // null = tidak ada jadwal / off
        val isOff: Boolean,
        val isFuture: Boolean,
        val isToday: Boolean,
        val attendance: Attendance?,
        val lemburInfo: String?
    )

    private val days = mutableListOf<DayItem>()
    private lateinit var adapter: JadwalAdapter

    // ── Lifecycle ────────────────────────────────────────────────

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_jadwal, container, false)

        spinMonth    = view.findViewById(R.id.spinMonth)
        spinYear     = view.findViewById(R.id.spinYear)
        txtShiftInfo = view.findViewById(R.id.txtShiftInfo)
        progressJadwal = view.findViewById(R.id.progressJadwal)
        txtEmptyJadwal = view.findViewById(R.id.txtEmptyJadwal)
        rvJadwal     = view.findViewById(R.id.rvJadwal)

        setupRecycler()
        setupSpinners()

        return view
    }

    // ── Setup ────────────────────────────────────────────────────

    private fun setupRecycler() {
        rvJadwal.layoutManager = LinearLayoutManager(requireContext())
        adapter = JadwalAdapter(days)
        rvJadwal.adapter = adapter
    }

    private fun setupSpinners() {
        // Bulan
        val monthAdapter = ArrayAdapter(
            requireContext(),
            android.R.layout.simple_spinner_item,
            monthNames
        )
        monthAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinMonth.adapter = monthAdapter

        // Tahun: pakai field years yang sudah didefinisikan di class
        val yearAdapter = ArrayAdapter(
            requireContext(),
            android.R.layout.simple_spinner_item,
            years
        )
        yearAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinYear.adapter = yearAdapter

        // Pasang listener SEBELUM setSelection agar tidak salah trigger
        val listener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (!isSpinnerReady) return
                selectedMonth = spinMonth.selectedItemPosition
                selectedYear  = years[spinYear.selectedItemPosition].toInt()
                loadJadwal()
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        spinMonth.onItemSelectedListener = listener
        spinYear.onItemSelectedListener  = listener

        // Set default ke bulan & tahun sekarang
        spinMonth.setSelection(selectedMonth)
        spinYear.setSelection(years.indexOf(currentYear.toString()).takeIf { it >= 0 } ?: 1)

        isSpinnerReady = true

        // Load awal manual (karena setSelection di atas tidak trigger listener saat isSpinnerReady=false)
        loadJadwal()
    }

    // ── Main loader ──────────────────────────────────────────────

    private fun loadJadwal() {
        showLoading()

        lifecycleScope.launch {
            try {
                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id
                    ?: return@launch

                val firstDayStr = String.format("%04d-%02d-01", selectedYear, selectedMonth + 1)
                val cal = Calendar.getInstance()
                cal.set(selectedYear, selectedMonth, 1)
                val lastDay = cal.getActualMaximum(Calendar.DAY_OF_MONTH)
                val lastDayStr = String.format("%04d-%02d-%02d", selectedYear, selectedMonth + 1, lastDay)
                val todayStr = dateFmt.format(Calendar.getInstance().time)

                // Pastikan shifts sudah ter-cache
                if (ShiftHelper.cachedShifts.isEmpty()) {
                    ShiftHelper.loadShifts()
                }

                // ── 1. user_shifts history ────────────────────────────
                // Ambil SEMUA row s/d akhir bulan ini, exclude off & profile_edit
                // PENTING: filter neq tidak include NULL rows, jadi kita ambil semua
                // lalu filter di sisi Kotlin
                val userShiftsRaw = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("user_shifts")
                        .select {
                            filter {
                                eq("user_id", userId)
                                lte("effective_date", lastDayStr)
                            }
                            order("effective_date", Order.ASCENDING)
                        }
                        .decodeList<Map<String, kotlinx.serialization.json.JsonElement>>()
                }.filter { row ->
                    // Exclude row yang shift_type = 'off' atau 'profile_edit'
                    // NULL shift_type = perubahan jadwal normal (shift_id valid) → INCLUDE
                    val st = row["shift_type"]?.toString()?.trim('"')
                        ?.takeIf { it != "null" }
                    st != "off" && st != "profile_edit"
                }

                // Buat history: (effective_date → shift_id)
                data class ShiftEntry(val effectiveDate: String, val shiftId: String)
                val shiftHistory = userShiftsRaw.mapNotNull { row ->
                    val date    = row["effective_date"]?.toString()?.trim('"') ?: return@mapNotNull null
                    val shiftId = row["shift_id"]?.toString()?.trim('"')
                        ?.takeIf { it != "null" && it.isNotBlank() } ?: return@mapNotNull null
                    ShiftEntry(date, shiftId)
                }.sortedBy { it.effectiveDate }

                // Helper: shift yang berlaku di suatu tanggal
                fun shiftForDate(dateStr: String): Shift? {
                    val entry = shiftHistory
                        .filter { it.effectiveDate <= dateStr }
                        .lastOrNull() ?: return null
                    return ShiftHelper.cachedShifts.find { it.id == entry.shiftId }
                }

                // ── 2. Default shift user (dari tabel users) ──────────
                val userRecord = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select { filter { eq("id", userId) } }
                        .decodeList<com.carefastindo.absensi.data.model.User>()
                }.firstOrNull()

                val userRole = userRecord?.role ?: ""
                // defaultShift: cari di cachedShifts berdasarkan nama yang mirip shiftType
                val defaultShift: Shift? = userRecord?.shiftType?.let { st ->
                    ShiftHelper.cachedShifts.find { it.name.equals(st, ignoreCase = true) }
                        ?: ShiftHelper.cachedShifts.find {
                            it.name.contains(st, ignoreCase = true)
                                    || st.contains(it.name, ignoreCase = true)
                        }
                }

                // Update header info shift aktif hari ini
                val activeShiftToday = shiftForDate(todayStr) ?: defaultShift
                withContext(Dispatchers.Main) {
                    if (activeShiftToday != null) {
                        val start   = activeShiftToday.startTime.take(5)
                        val end     = activeShiftToday.endTime.take(5)
                        val label   = shiftDisplayName(activeShiftToday.name)
                        txtShiftInfo.text = "$label · $start – $end"
                    } else {
                        txtShiftInfo.text = ""
                    }
                }

                // ── 3. Attendance bulan ini ───────────────────────────
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

                // ── 4. Off schedules (Android) ────────────────────────
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

                // Off dari website (user_shifts shift_type='off')
                val offFromWeb = userShiftsRaw.filter { row ->
                    row["shift_type"]?.toString()?.trim('"') == "off"
                }.mapNotNull { row ->
                    row["effective_date"]?.toString()?.trim('"')
                }
                offDates.addAll(offFromWeb)

                // ── 5. Emergency assignments ──────────────────────────
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
                val emergByDate = emergencyList.associateBy { it.targetDate }

                // ── 6. Overtime assignments ───────────────────────────
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
                val overtimeByDate = overtimeList.associateBy { it.assignmentDate }

                // ── 7. Tentukan apakah ada jadwal bulan ini ───────────
                // Logika:
                // - Bulan ini dan sebelumnya: ada jadwal jika ada shift history,
                //   defaultShift, ATAU ada data attendance di bulan itu
                // - Bulan depan ke atas: tidak ada jadwal (belum ditentukan)
                val selectedMonthStr = String.format("%04d-%02d", selectedYear, selectedMonth + 1)
                val todayMonthStr    = dateFmt.format(Calendar.getInstance().time).substring(0, 7)
                val isFutureMonth    = selectedMonthStr > todayMonthStr

                val hasAttendanceData = attByDate.isNotEmpty()
                val hasAnySchedule = if (isFutureMonth) {
                    false // Bulan depan → selalu "belum ditentukan"
                } else {
                    shiftHistory.isNotEmpty() || defaultShift != null || hasAttendanceData
                }

                // ── 8. Build list per hari ────────────────────────────
                val iterCal = Calendar.getInstance()
                iterCal.set(selectedYear, selectedMonth, 1)
                val newDays = mutableListOf<DayItem>()

                for (d in 1..lastDay) {
                    iterCal.set(selectedYear, selectedMonth, d)
                    val dateStr = dateFmt.format(iterCal.time)
                    val dayName = dayShortFmt.format(iterCal.time)
                        .replaceFirstChar { it.uppercase() }

                    val isOff    = dateStr in offDates
                    val isFuture = dateStr > todayStr
                    val isToday  = dateStr == todayStr

                    // Shift berlaku untuk hari ini
                    val shift = if (!isOff) shiftForDate(dateStr) ?: defaultShift else null

                    // Attendance hanya untuk hari ini atau sudah lewat
                    val att = if (!isFuture) attByDate[dateStr] else null

                    // Lembur info
                    val lemburInfo = buildLemburInfo(dateStr, emergByDate, overtimeByDate)

                    newDays.add(
                        DayItem(
                            dateStr   = dateStr,
                            dayName   = dayName,
                            dayNumber = d,
                            shift     = shift,
                            isOff     = isOff,
                            isFuture  = isFuture,
                            isToday   = isToday,
                            attendance = att,
                            lemburInfo = lemburInfo
                        )
                    )
                }

                withContext(Dispatchers.Main) {
                    days.clear()
                    days.addAll(newDays)
                    adapter.notifyDataSetChanged()

                    if (!hasAnySchedule) {
                        showEmpty()
                    } else {
                        showList()
                        // Scroll ke hari ini jika bulan aktif
                        val todayIdx = newDays.indexOfFirst { it.dateStr == todayStr }
                        if (todayIdx >= 0) {
                            (rvJadwal.layoutManager as LinearLayoutManager)
                                .scrollToPositionWithOffset(todayIdx, 0)
                        }
                    }
                }

            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) { showEmpty() }
            }
        }
    }

    // Helper: konversi nama shift database → label tampilan yang friendly
    private fun shiftDisplayName(shiftName: String): String {
        return when {
            shiftName.contains("I", ignoreCase = false) && !shiftName.contains("II") && !shiftName.contains("III") 
                -> "Pagi"
            shiftName.contains("III") -> "Malam"
            shiftName.contains("II")  -> "Sore"
            shiftName.contains("Kantor", ignoreCase = true) -> "Kantor"
            shiftName.contains("1")   -> "Pagi"
            shiftName.contains("2")   -> "Sore"
            shiftName.contains("3")   -> "Malam"
            else -> shiftName
        }
    }

    private fun buildLemburInfo(
        dateStr: String,
        emergByDate: Map<String, EmergencyAssignment>,
        overtimeByDate: Map<String, OvertimeAssignment>
    ): String? {
        val emergency = emergByDate[dateStr]
        if (emergency != null && emergency.reason == "lembur") {
            return if (emergency.overtimeIn != null) {
                val inT  = emergency.overtimeIn.substring(11, 16)
                val outT = emergency.overtimeOut?.substring(11, 16) ?: "–"
                "⚡ Lembur · $inT – $outT"
            } else "⚡ Ditugaskan Lembur"
        }
        val overtime = overtimeByDate[dateStr]
        if (overtime != null) {
            return if (overtime.overtimeIn != null) {
                val inT  = overtime.overtimeIn.substring(11, 16)
                val outT = overtime.overtimeOut?.substring(11, 16) ?: "–"
                "⚡ Lembur · $inT – $outT"
            } else "⚡ Ditugaskan Lembur"
        }
        return null
    }

    private fun showLoading() {
        progressJadwal.visibility = View.VISIBLE
        rvJadwal.visibility       = View.GONE
        txtEmptyJadwal.visibility = View.GONE
    }

    private fun showEmpty() {
        progressJadwal.visibility = View.GONE
        rvJadwal.visibility       = View.GONE
        txtEmptyJadwal.visibility = View.VISIBLE
    }

    private fun showList() {
        progressJadwal.visibility = View.GONE
        rvJadwal.visibility       = View.VISIBLE
        txtEmptyJadwal.visibility = View.GONE
    }

    // ── RecyclerView Adapter ─────────────────────────────────────

    inner class JadwalAdapter(private val items: List<DayItem>) :
        RecyclerView.Adapter<JadwalAdapter.ViewHolder>() {

        inner class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val viewIndicator:    View        = v.findViewById(R.id.viewDayIndicator)
            val txtDayNumber:     TextView    = v.findViewById(R.id.txtDayNumber)
            val txtDayName:       TextView    = v.findViewById(R.id.txtDayName)
            val txtShiftLabel:    TextView    = v.findViewById(R.id.txtShiftLabel)
            val layoutAbsenDetail: ViewGroup  = v.findViewById(R.id.layoutAbsenDetail)
            val txtCheckIn:       TextView    = v.findViewById(R.id.txtCheckIn)
            val txtBreak:         TextView    = v.findViewById(R.id.txtBreak)
            val txtCheckOut:      TextView    = v.findViewById(R.id.txtCheckOut)
            val txtSubLabel:      TextView    = v.findViewById(R.id.txtSubLabel)
            val txtLemburInfo:    TextView    = v.findViewById(R.id.txtLemburInfo)
            val cardStatusBadge:  CardView    = v.findViewById(R.id.cardStatusBadge)
            val txtStatusBadge:   TextView    = v.findViewById(R.id.txtStatusBadge)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val v = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_jadwal_day, parent, false)
            return ViewHolder(v)
        }

        override fun getItemCount() = items.size

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val item = items[position]
            val ctx  = holder.itemView.context

            // Tanggal & nama hari
            holder.txtDayNumber.text = item.dayNumber.toString().padStart(2, '0')
            holder.txtDayName.text   = item.dayName

            // Warna angka tanggal: biru untuk hari ini
            holder.txtDayNumber.setTextColor(
                if (item.isToday) ContextCompat.getColor(ctx, R.color.primary)
                else ContextCompat.getColor(ctx, R.color.text_primary_light)
            )

            // Sembunyikan semua dulu
            holder.layoutAbsenDetail.visibility = View.GONE
            holder.txtSubLabel.visibility       = View.GONE
            holder.txtLemburInfo.visibility     = View.GONE
            holder.cardStatusBadge.visibility   = View.GONE

            when {
                // ── Off ──────────────────────────────────────────────
                item.isOff -> {
                    holder.txtShiftLabel.text = "Off / Libur"
                    holder.txtShiftLabel.setTextColor(ContextCompat.getColor(ctx, R.color.text_secondary_light))
                    setIndicator(holder, "#9E9E9E")
                }

                // ── Hari depan ────────────────────────────────────────
                item.isFuture -> {
                    val shiftLabel = item.shift?.let {
                        "${shiftDisplayName(it.name)} · ${it.startTime.take(5)} – ${it.endTime.take(5)}"
                    } ?: "Jadwal masuk"
                    holder.txtShiftLabel.text = shiftLabel
                    holder.txtShiftLabel.setTextColor(ContextCompat.getColor(ctx, R.color.text_primary_light))
                    setIndicator(holder, "#90CAF9")

                    if (item.lemburInfo != null) {
                        holder.txtLemburInfo.visibility = View.VISIBLE
                        holder.txtLemburInfo.text       = item.lemburInfo
                    }
                }

                // ── Hari lalu / hari ini ──────────────────────────────
                else -> {
                    val shiftLabel = item.shift?.let {
                        "${shiftDisplayName(it.name)} · ${it.startTime.take(5)} – ${it.endTime.take(5)}"
                    } ?: "-"
                    holder.txtShiftLabel.text = shiftLabel
                    holder.txtShiftLabel.setTextColor(ContextCompat.getColor(ctx, R.color.text_primary_light))

                    val att = item.attendance
                    when {
                        att != null -> {
                            // Ada rekam absensi
                            holder.layoutAbsenDetail.visibility = View.VISIBLE
                            holder.txtCheckIn.text  = "Masuk: ${att.checkInTime?.take(5) ?: "--"}"
                            holder.txtBreak.text    = "Ist: ${att.breakStart?.substring(11, 16) ?: att.breakTime?.take(5) ?: "--"}"
                            holder.txtCheckOut.text = "Pulang: ${att.checkOutTime?.take(5) ?: "--"}"

                            holder.cardStatusBadge.visibility = View.VISIBLE
                            holder.txtStatusBadge.text = att.status.uppercase(Locale.getDefault())
                            val (badgeBg, indicatorHex) = statusColors(att.status)
                            holder.cardStatusBadge.setCardBackgroundColor(
                                android.graphics.Color.parseColor(badgeBg)
                            )
                            holder.txtStatusBadge.setTextColor(android.graphics.Color.WHITE)
                            setIndicator(holder, indicatorHex)
                        }
                        item.isToday -> {
                            holder.txtSubLabel.visibility = View.VISIBLE
                            holder.txtSubLabel.text       = "Belum absen"
                            setIndicator(holder, "#FB923C")
                        }
                        else -> {
                            // Hari lalu tanpa rekam = alfa
                            holder.cardStatusBadge.visibility = View.VISIBLE
                            holder.txtStatusBadge.text        = "ALFA"
                            holder.cardStatusBadge.setCardBackgroundColor(
                                android.graphics.Color.parseColor("#EF4444")
                            )
                            holder.txtStatusBadge.setTextColor(android.graphics.Color.WHITE)
                            setIndicator(holder, "#EF4444")
                        }
                    }

                    if (item.lemburInfo != null) {
                        holder.txtLemburInfo.visibility = View.VISIBLE
                        holder.txtLemburInfo.text       = item.lemburInfo
                    }
                }
            }
        }

        private fun setIndicator(holder: ViewHolder, hex: String) {
            holder.viewIndicator.setBackgroundColor(android.graphics.Color.parseColor(hex))
        }

        private fun statusColors(status: String): Pair<String, String> {
            return when (status.lowercase()) {
                "hadir"                  -> "#4CAF50" to "#4CAF50"
                "terlambat"              -> "#FF9800" to "#FF9800"
                "izin"                   -> "#7C3AED" to "#7C3AED"
                "sakit"                  -> "#3B82F6" to "#3B82F6"
                "cuti"                   -> "#EC4899" to "#EC4899"
                "off"                    -> "#9E9E9E" to "#9E9E9E"
                "tidak_absen", "alfa"    -> "#EF4444" to "#EF4444"
                else                     -> "#6B7280" to "#6B7280"
            }
        }
    }
}
