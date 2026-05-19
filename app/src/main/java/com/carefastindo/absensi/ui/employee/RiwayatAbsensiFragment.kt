package com.carefastindo.absensi.ui.employee

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
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
import com.carefastindo.absensi.data.remote.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

class RiwayatAbsensiFragment : Fragment() {

    private lateinit var spinMonth: Spinner
    private lateinit var spinYear: Spinner
    private lateinit var txtEmptyHistory: TextView
    private lateinit var rvHistory: RecyclerView

    private var attendanceList = mutableListOf<Attendance>()
    private lateinit var adapter: AttendanceHistoryAdapter

    private val monthNames = arrayOf(
        "Januari", "Februari", "Maret", "April", "Mei", "Juni",
        "Juli", "Agustus", "September", "Oktober", "November", "Desember"
    )

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_riwayat_absensi, container, false)

        spinMonth = view.findViewById(R.id.spinMonth)
        spinYear = view.findViewById(R.id.spinYear)
        txtEmptyHistory = view.findViewById(R.id.txtEmptyHistory)
        rvHistory = view.findViewById(R.id.rvAttendanceHistory)

        setupSpinners()
        setupRecyclerView()

        return view
    }

    private fun setupSpinners() {
        val context = requireContext()

        // Month Adapter
        val monthAdapter = ArrayAdapter(context, android.R.layout.simple_spinner_item, monthNames)
        monthAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinMonth.adapter = monthAdapter

        // Year List
        val currentYear = Calendar.getInstance().get(Calendar.YEAR)
        val years = arrayOf((currentYear - 2).toString(), (currentYear - 1).toString(), currentYear.toString())
        val yearAdapter = ArrayAdapter(context, android.R.layout.simple_spinner_item, years)
        yearAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spinYear.adapter = yearAdapter

        // Set current month and year as selections
        val currentMonth = Calendar.getInstance().get(Calendar.MONTH)
        spinMonth.setSelection(currentMonth)
        spinYear.setSelection(years.indexOf(currentYear.toString()))

        // Spinner Listeners to automatically query on selection change
        val spinnerListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                loadHistoryData()
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        spinMonth.onItemSelectedListener = spinnerListener
        spinYear.onItemSelectedListener = spinnerListener
    }

    private fun setupRecyclerView() {
        rvHistory.layoutManager = LinearLayoutManager(requireContext())
        adapter = AttendanceHistoryAdapter(attendanceList)
        rvHistory.adapter = adapter
    }

    private fun loadHistoryData() {
        val selectedMonthIndex = spinMonth.selectedItemPosition + 1
        val selectedYear = spinYear.selectedItem.toString()
        
        // Format Month Prefix
        val monthStr = if (selectedMonthIndex < 10) "0$selectedMonthIndex" else selectedMonthIndex.toString()
        val queryPrefix = "$selectedYear-$monthStr-%"

        lifecycleScope.launch {
            try {
                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id ?: return@launch
                
                val list = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("attendance")
                        .select {
                            filter {
                                eq("user_id", userId)
                                like("date", queryPrefix)
                            }
                            order("date", Order.DESCENDING)
                        }.decodeList<Attendance>()
                }

                attendanceList.clear()
                attendanceList.addAll(list)
                adapter.notifyDataSetChanged()

                if (attendanceList.isEmpty()) {
                    txtEmptyHistory.visibility = View.VISIBLE
                    rvHistory.visibility = View.GONE
                } else {
                    txtEmptyHistory.visibility = View.GONE
                    rvHistory.visibility = View.VISIBLE
                }

            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun formatDateDisplay(dateStr: String): String {
        return try {
            val parser = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            val formatter = SimpleDateFormat("EEEE, dd MMMM yyyy", Locale( "id", "ID"))
            parser.parse(dateStr)?.let { formatter.format(it) } ?: dateStr
        } catch (e: Exception) {
            dateStr
        }
    }

    // Daily Recycler View Adapter
    private inner class AttendanceHistoryAdapter(private val items: List<Attendance>) :
        RecyclerView.Adapter<AttendanceHistoryAdapter.ViewHolder>() {

        inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
            val txtDate: TextView = view.findViewById(R.id.txtDate)
            val txtStatus: TextView = view.findViewById(R.id.txtStatus)
            val cardStatus: CardView = view.findViewById(R.id.cardStatus)
            val txtCheckIn: TextView = view.findViewById(R.id.txtCheckIn)
            val txtBreak: TextView = view.findViewById(R.id.txtBreak)
            val txtCheckOut: TextView = view.findViewById(R.id.txtCheckOut)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.item_attendance_employee, parent, false)
            return ViewHolder(view)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val item = items[position]

            holder.txtDate.text = formatDateDisplay(item.date)

            // Times
            holder.txtCheckIn.text = item.checkInTime?.substring(0, 5) ?: "--"
            holder.txtBreak.text = item.breakTime?.substring(0, 5) ?: "--"
            holder.txtCheckOut.text = item.checkOutTime?.substring(0, 5) ?: "--"

            // Status Badge Colors & Strings
            holder.txtStatus.text = item.status.toUpperCase(Locale.getDefault())
            when (item.status) {
                "hadir" -> {
                    holder.cardStatus.setCardBackgroundColor(ContextCompat.getColor(requireContext(), R.color.success))
                    holder.txtStatus.setTextColor(ContextCompat.getColor(requireContext(), R.color.white))
                }
                "terlambat" -> {
                    holder.cardStatus.setCardBackgroundColor(ContextCompat.getColor(requireContext(), R.color.error))
                    holder.txtStatus.setTextColor(ContextCompat.getColor(requireContext(), R.color.white))
                }
                else -> {
                    holder.cardStatus.setCardBackgroundColor(ContextCompat.getColor(requireContext(), R.color.accent))
                    holder.txtStatus.setTextColor(ContextCompat.getColor(requireContext(), R.color.white))
                }
            }
        }

        override fun getItemCount(): Int = items.size
    }
}
