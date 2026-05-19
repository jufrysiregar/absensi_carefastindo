package com.carefastindo.absensi.ui.employee

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.carefastindo.absensi.R
import com.carefastindo.absensi.data.model.Attendance
import com.carefastindo.absensi.databinding.ItemAttendanceHistoryBinding

class AttendanceHistoryAdapter : RecyclerView.Adapter<AttendanceHistoryAdapter.ViewHolder>() {

    private val items = mutableListOf<Attendance>()

    fun submitList(list: List<Attendance>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemAttendanceHistoryBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(items[position])
    }

    override fun getItemCount(): Int = items.size

    inner class ViewHolder(private val binding: ItemAttendanceHistoryBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(item: Attendance) {
            binding.txtDate.text = item.date
            binding.txtInTime.text = item.checkInTime?.substring(0, 5) ?: "-"
            binding.txtBreakTime.text = item.breakTime?.substring(0, 5) ?: "-"
            binding.txtOutTime.text = item.checkOutTime?.substring(0, 5) ?: "-"
            binding.txtStatusBadge.text = item.status.uppercase()

            val context = binding.root.context
            when (item.status.lowercase()) {
                "hadir" -> binding.txtStatusBadge.background =
                    ContextCompat.getDrawable(context, R.drawable.bg_status_hadir)
                "terlambat" -> binding.txtStatusBadge.background =
                    ContextCompat.getDrawable(context, R.drawable.bg_status_terlambat)
                else -> binding.txtStatusBadge.background =
                    ContextCompat.getDrawable(context, R.drawable.bg_status_tidak_absen)
            }
        }
    }
}
