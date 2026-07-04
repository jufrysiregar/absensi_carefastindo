package com.carefastindo.absensi.ui.employee

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.ProgressBar
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

/**
 * JadwalFragment - Menampilkan jadwal bulanan karyawan beserta rekam kehadiran.
 *
 * Logika:
 * - Tampilkan tanggal 1 s/d akhir bulan
 * - Setiap hari memiliki:
 *   - Informasi shift (dari user_shifts) atau shift default karyawan
 *   - Status off (dari off_schedules)
 *   - Status lembur (dari emergency_assignments dan overtime_assignments)
 *   - Data absensi aktual (dari attendance) untuk hari yang sudah lewat / hari ini
 *   - Hari depan: hanya tampil info jadwal saja (tanpa detail absensi)
 * - Jika karyawan tidak memiliki jadwal sama sekali di bulan itu → "Jadwal bulan ini belum ditentukan."
 */
class JadwalFragment : Fragment() {

    // ── UI refs ────────────────────────────────────────────────
    private lateinit var btnPrevMonth: ImageButton
    private lateinit var btnNextMonth: ImageButton
    private lateinit var txtMonthYear: TextView
    private lateinit var txtShiftInfo: TextView
    private lateinit var txtEmptyJadwal: TextView
    private lateinit var progressJadwal: ProgressBar
    private lateinit var rvJadwal: RecyclerView

    // ── State ──────────────────────────────────────────────────
    private var currentYear = Calendar.getInstance().get(Calendar.YEAR)
    private var currentMonth = Calendar.getInstance().get(Calendar.MONTH) // 0-indexed

    // ── Data ───────────────────────────────────────────────────
    data class DayItem(
        val dateStr: String,             // yyyy-MM-dd
        val dayName: String,             // "Sen", "Sel" …
        val dayNumber: Int,              // 1..31
        val shiftLabel: String,          // "Shift Pagi · 07:00 – 15:00" / "Off" / "-"
        val isOff: Boolean,
        val isFuture: Boolean,           // hari sesudah hari ini
        val isToday: Boolean,
        val attendance: Attendance?,     // null jika belum ada / future
        val lemburInfo: String?,         // "⚡ Lembur · 15:00 – 18:00" jika ada
        val hasSchedule: Boolean         // apakah ada data shift di bulan ini
    )

    private val days = mutableListOf<DayItem>()
    private lateinit var adapter: JadwalAdapter

    // ── Locale ─────────────────────────────────────────────────
    private val idLocale = Locale("id", "ID")
    private val dayShortFmt = SimpleDateFormat("EEE", idLocale)
    private val monthYearFmt = SimpleDateFormat("MMMM yyyy", idLocale)
    private val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)

    // ── Fragment lifecycle ─────────────────────────────────────

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_jadwal, container, false)

        btnPrevMonth    = view.findViewById(R.id.btnPrevMonth)
        btnNextMonth    = view.findViewById(R.id.btnNextMonth)
        txtMonthYear    = view.findViewById(R.id.txtMonthYear)
        txtShiftInfo    = view.findViewById(R.id.txtShiftInfo)
        txtEmptyJadwal  = view.findViewById(R.id.txtEmptyJadwal)
        progressJadwal  = view.findViewById(R.id.progressJadwal)
        rvJadwal        = view.findViewById(R.id.rvJadwal)

        setupRecycler()
        setupNavButtons()
        loadJadwal()

        return view
    }

    // ── Setup ──────────────────────────────────────────────────

    private fun setupRecycler() {
        rvJadwal.layoutManager = LinearLayoutManager(requireContext())
        adapter = JadwalAdapter(days)
        rvJadwal.adapter = adapter
    }

    private fun setupNavButtons() {
        btnPrevMonth.setOnClickListener {
            if (currentMonth == 0) {
                currentMonth = 11
                currentYear--
            } else {
                currentMonth--
            }
            loadJadwal()
        }

        btnNextMonth.setOnClickListener {
            if (currentMonth == 11) {
                currentMonth = 0
                currentYear++
            } else {
                currentMonth++
            }
            loadJadwal()
        }
    }

    // ── Main data loader ───────────────────────────────────────

    private fun loadJadwal() {
        // Update header label
        val cal = Calendar.getInstance()
        cal.set(currentYear, currentMonth, 1)
        txtMonthYear.text = monthYearFmt.format(cal.time)
            .replaceFirstChar { it.uppercase() }

        showLoading()

        lifecycleScope.launch {
            try {
                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id
                    ?: return@launch

                // Range tanggal bulan ini
                val firstDayStr = String.format("%04d-%02d-01", currentYear, currentMonth + 1)
                val lastDay = cal.getActualMaximum(Calendar.DAY_OF_MONTH)
                val lastDayStr = String.format("%04d-%02d-%02d", currentYear, currentMonth + 1, lastDay)

                val todayCal = Calendar.getInstance()
                val todayStr = dateFmt.format(todayCal.time)

                // ── 1. Fetch semua user_shifts s/d akhir bulan ini ──
                // Website insert row baru tiap kali jadwal berubah dengan effective_date = tanggal berlaku.
                // Untuk setiap hari, shift yang berlaku adalah row TERAKHIR yang effective_date <= hari itu.
                val userShiftsRaw = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("user_shifts")
                        .select {
                            filter {
                                eq("user_id", userId)
                                lte("effective_date", lastDayStr)
                                // Ambil semua row — termasuk yang berlaku dari bulan sebelumnya
                            }
                            order("effective_date", Order.ASCENDING)
                        }
                        .decodeList<Map<String, kotlinx.serialization.json.JsonElement>>()
                }

                // Buat list terurut: (effective_date, shift_type) — exclude off & profile_edit
                // yang merupakan override hari khusus, bukan perubahan shift bulanan
                data class ShiftEntry(val effectiveDate: String, val shiftType: String)
                val shiftHistory = userShiftsRaw
                    .mapNotNull { row ->
                        val date   = row["effective_date"]?.toString()?.trim('"') ?: return@mapNotNull null
                        val sType  = row["shift_type"]?.toString()?.trim('"') ?: return@mapNotNull null
                        // skip off dan profile_edit — mereka bukan perubahan shift bulanan
                        if (sType == "off" || sType == "profile_edit") return@mapNotNull null
                        ShiftEntry(date, sType)
                    }
                    .sortedBy { it.effectiveDate }

                // Helper: cari shift yang berlaku untuk suatu tanggal
                // = ShiftEntry dengan effective_date tertinggi yang <= tanggal tsb
                fun shiftForDate(dateStr: String): String? {
                    return shiftHistory
                        .filter { it.effectiveDate <= dateStr }
                        .lastOrNull()
                        ?.shiftType
                }

                // ── 2. Default shift karyawan ───────────────────────
                val userShiftDefault = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("users")
                        .select { filter { eq("id", userId) } }
                        .decodeList<com.carefastindo.absensi.data.model.User>()
                }.firstOrNull()

                val defaultShiftType = userShiftDefault?.shiftType
                val userRole         = userShiftDefault?.role ?: ""

                // Update shift info header — pakai shift yang berlaku hari ini
                withContext(Dispatchers.Main) {
                    val activeShift = shiftForDate(todayStr) ?: defaultShiftType
                    if (activeShift != null) {
                        val (masuk, pulang) = ShiftHelper.getShiftTimes(userRole, activeShift)
                        txtShiftInfo.text = "Shift ${activeShift.replaceFirstChar { it.uppercase() }} · $masuk – $pulang"
                    } else {
                        txtShiftInfo.text = ""
                    }
                }

                // ── 3. Fetch attendance bulan ini ───────────────────
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
                val attendanceByDate = attendanceList.associateBy { it.date }

                // ── 4. Fetch off_schedules bulan ini (off dari Android/DaruratLembur) ──
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

                // 4b. Fetch off dari user_shifts (off yang di-set website, shift_type='off')
                val offFromWebsite = userShiftsRaw
                    .filter { row ->
                        val sType = row["shift_type"]?.toString()?.trim('"') ?: ""
                        sType == "off"
                    }
                    .mapNotNull { row -> row["effective_date"]?.toString()?.trim('"') }
                offDates.addAll(offFromWebsite)

                // ── 5. Fetch emergency_assignments bulan ini ─────────
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
                // Map: tanggal → EmergencyAssignment (lembur / ganti_off)
                val emergencyByDate = emergencyList.associateBy { it.targetDate }

                // ── 6. Fetch overtime_assignments bulan ini ──────────
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

                // ── 7. Tentukan apakah ada jadwal bulan ini ─────────
                // Ada jadwal = ada entri shift history yang berlaku di bulan ini ATAU default shift terdefinisi
                val hasAnySchedule = shiftHistory.isNotEmpty() || defaultShiftType != null

                // ── 8. Build list per hari ───────────────────────────
                val newDays = mutableListOf<DayItem>()
                val iterCal = Calendar.getInstance()
                iterCal.set(currentYear, currentMonth, 1)

                for (d in 1..lastDay) {
                    iterCal.set(currentYear, currentMonth, d)
                    val dateStr = dateFmt.format(iterCal.time)
                    val dayName = dayShortFmt.format(iterCal.time)
                        .replaceFirstChar { it.uppercase() }

                    val isOff    = dateStr in offDates
                    val isFuture = dateStr > todayStr
                    val isToday  = dateStr == todayStr

                    // Shift hari ini: cek user_shifts history (effective_date <= hari ini), fallback ke default
                    val shiftType = shiftForDate(dateStr) ?: defaultShiftType
                    val shiftLabel = buildShiftLabel(userRole, shiftType, isOff)

                    // Attendance hanya relevan jika hari ini atau sudah lewat
                    val att = if (!isFuture) attendanceByDate[dateStr] else null

                    // Lembur info
                    val lemburInfo = buildLemburInfo(dateStr, emergencyByDate, overtimeByDate)

                    newDays.add(
                        DayItem(
                            dateStr     = dateStr,
                            dayName     = dayName,
                            dayNumber   = d,
                            shiftLabel  = shiftLabel,
                            isOff       = isOff,
                            isFuture    = isFuture,
                            isToday     = isToday,
                            attendance  = att,
                            lemburInfo  = lemburInfo,
                            hasSchedule = hasAnySchedule
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
                        // Scroll ke hari ini
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

    // ── Helpers ─────────────────────────────────────────────────

    private fun buildShiftLabel(role: String, shiftType: String?, isOff: Boolean): String {
        if (isOff) return "Off / Libur"
        if (shiftType == null) return "-"
        val (masuk, pulang) = ShiftHelper.getShiftTimes(role, shiftType)
        return "Shift ${shiftType.replaceFirstChar { it.uppercase() }} · $masuk – $pulang"
    }

    private fun buildLemburInfo(
        dateStr: String,
        emergencyByDate: Map<String, EmergencyAssignment>,
        overtimeByDate: Map<String, OvertimeAssignment>
    ): String? {
        val emergency = emergencyByDate[dateStr]
        if (emergency != null && emergency.reason == "lembur") {
            val inTime  = emergency.overtimeIn?.substring(11, 16) ?: "–"
            val outTime = emergency.overtimeOut?.substring(11, 16) ?: "–"
            return if (emergency.overtimeIn != null) "⚡ Lembur · $inTime – $outTime"
            else "⚡ Ditugaskan Lembur"
        }

        val overtime = overtimeByDate[dateStr]
        if (overtime != null) {
            val inTime  = overtime.overtimeIn?.substring(11, 16) ?: "–"
            val outTime = overtime.overtimeOut?.substring(11, 16) ?: "–"
            return if (overtime.overtimeIn != null) "⚡ Lembur · $inTime – $outTime"
            else "⚡ Ditugaskan Lembur"
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

    // ── RecyclerView Adapter ───────────────────────────────────

    inner class JadwalAdapter(private val items: List<DayItem>) :
        RecyclerView.Adapter<JadwalAdapter.ViewHolder>() {

        inner class ViewHolder(v: View) : RecyclerView.ViewHolder(v) {
            val viewIndicator:   View        = v.findViewById(R.id.viewDayIndicator)
            val txtDayName:      TextView    = v.findViewById(R.id.txtDayName)
            val txtDayNumber:    TextView    = v.findViewById(R.id.txtDayNumber)
            val txtShiftLabel:   TextView    = v.findViewById(R.id.txtShiftLabel)
            val layoutAbsenDetail: ViewGroup = v.findViewById(R.id.layoutAbsenDetail)
            val txtCheckIn:      TextView    = v.findViewById(R.id.txtCheckIn)
            val txtBreak:        TextView    = v.findViewById(R.id.txtBreak)
            val txtCheckOut:     TextView    = v.findViewById(R.id.txtCheckOut)
            val txtJadwalSaja:   TextView    = v.findViewById(R.id.txtJadwalSaja)
            val txtLemburInfo:   TextView    = v.findViewById(R.id.txtLemburInfo)
            val txtOffInfo:      TextView    = v.findViewById(R.id.txtOffInfo)
            val cardStatusBadge: CardView    = v.findViewById(R.id.cardStatusBadge)
            val txtStatusBadge:  TextView    = v.findViewById(R.id.txtStatusBadge)
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

            // Tanggal
            holder.txtDayName.text   = item.dayName
            holder.txtDayNumber.text = item.dayNumber.toString().padStart(2, '0')

            // Warna angka hari ini
            if (item.isToday) {
                holder.txtDayNumber.setTextColor(ContextCompat.getColor(ctx, R.color.primary))
            } else {
                holder.txtDayNumber.setTextColor(ContextCompat.getColor(ctx, R.color.text_primary_light))
            }

            // Shift label
            holder.txtShiftLabel.text = item.shiftLabel

            // Sembunyikan semua dulu
            holder.layoutAbsenDetail.visibility = View.GONE
            holder.txtJadwalSaja.visibility     = View.GONE
            holder.txtLemburInfo.visibility     = View.GONE
            holder.txtOffInfo.visibility        = View.GONE
            holder.cardStatusBadge.visibility   = View.GONE

            when {
                // ── Off ──────────────────────────────────────────────
                item.isOff -> {
                    holder.txtOffInfo.visibility = View.VISIBLE
                    holder.txtShiftLabel.text    = "Off / Libur"
                    setIndicatorColor(holder, "#9E9E9E")
                }

                // ── Hari depan: hanya jadwal ─────────────────────────
                item.isFuture -> {
                    holder.txtJadwalSaja.visibility = View.VISIBLE
                    holder.txtJadwalSaja.text       = "Jadwal masuk"
                    setIndicatorColor(holder, "#90CAF9")

                    // Lembur di hari depan yang sudah ditugaskan
                    if (item.lemburInfo != null) {
                        holder.txtLemburInfo.visibility = View.VISIBLE
                        holder.txtLemburInfo.text       = item.lemburInfo
                    }
                }

                // ── Hari sudah lewat / hari ini ─────────────────────
                else -> {
                    val att = item.attendance
                    if (att != null) {
                        // Ada rekam absensi
                        holder.layoutAbsenDetail.visibility = View.VISIBLE
                        holder.txtCheckIn.text  = "Masuk: ${att.checkInTime?.take(5) ?: "--"}"
                        holder.txtBreak.text    = "Ist: ${att.breakStart?.substring(11, 16) ?: att.breakTime?.take(5) ?: "--"}"
                        holder.txtCheckOut.text = "Pulang: ${att.checkOutTime?.take(5) ?: "--"}"

                        // Badge status
                        holder.cardStatusBadge.visibility = View.VISIBLE
                        holder.txtStatusBadge.text = att.status.uppercase(Locale.getDefault())
                        val (badgeBg, indicatorColor) = statusColors(att.status)
                        holder.cardStatusBadge.setCardBackgroundColor(
                            android.graphics.Color.parseColor(badgeBg)
                        )
                        holder.txtStatusBadge.setTextColor(android.graphics.Color.WHITE)
                        setIndicatorColor(holder, indicatorColor)

                        // Lembur info
                        if (item.lemburInfo != null) {
                            holder.txtLemburInfo.visibility = View.VISIBLE
                            holder.txtLemburInfo.text       = item.lemburInfo
                        }
                    } else {
                        // Tidak ada rekam (alfa / belum absen)
                        if (item.isToday) {
                            holder.txtJadwalSaja.visibility = View.VISIBLE
                            holder.txtJadwalSaja.text       = "Belum absen"
                            setIndicatorColor(holder, "#FB923C")
                        } else {
                            // Hari lalu tanpa rekam → alfa
                            holder.cardStatusBadge.visibility = View.VISIBLE
                            holder.txtStatusBadge.text        = "ALFA"
                            holder.cardStatusBadge.setCardBackgroundColor(
                                android.graphics.Color.parseColor("#EF4444")
                            )
                            holder.txtStatusBadge.setTextColor(android.graphics.Color.WHITE)
                            setIndicatorColor(holder, "#EF4444")
                        }
                    }
                }
            }
        }

        private fun setIndicatorColor(holder: ViewHolder, hex: String) {
            holder.viewIndicator.setBackgroundColor(android.graphics.Color.parseColor(hex))
        }

        /** Returns Pair(badgeBackgroundHex, indicatorHex) */
        private fun statusColors(status: String): Pair<String, String> {
            return when (status.lowercase()) {
                "hadir"        -> "#4CAF50" to "#4CAF50"
                "terlambat"    -> "#FF9800" to "#FF9800"
                "izin"         -> "#7C3AED" to "#7C3AED"
                "sakit"        -> "#3B82F6" to "#3B82F6"
                "cuti"         -> "#EC4899" to "#EC4899"
                "off"          -> "#9E9E9E" to "#9E9E9E"
                "tidak_absen",
                "alfa"         -> "#EF4444" to "#EF4444"
                else           -> "#6B7280" to "#6B7280"
            }
        }
    }
}
