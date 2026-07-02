package com.carefastindo.absensi.ui.employee

import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.cardview.widget.CardView
import androidx.recyclerview.widget.RecyclerView
import com.carefastindo.absensi.R
import com.carefastindo.absensi.data.model.Announcement
import java.text.SimpleDateFormat
import java.util.Locale

class AnnouncementAdapter(
    private var items: List<Announcement>,
    private var readIds: Set<String>,
    private val onAnnouncementClicked: (Announcement) -> Unit
) : RecyclerView.Adapter<AnnouncementAdapter.ViewHolder>() {

    fun updateData(newItems: List<Announcement>, newReadIds: Set<String>) {
        items = newItems
        readIds = newReadIds
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_announcement, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val item = items[position]
        holder.bind(item, readIds.contains(item.id))
    }

    override fun getItemCount(): Int = items.size

    inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val cardItem: CardView = view.findViewById(R.id.cardItem)
        private val txtTitle: TextView = view.findViewById(R.id.txtTitle)
        private val txtContent: TextView = view.findViewById(R.id.txtContent)
        private val txtDate: TextView = view.findViewById(R.id.txtDate)
        private val viewUnreadDot: View = view.findViewById(R.id.viewUnreadDot)

        fun bind(item: Announcement, isRead: Boolean) {
            txtTitle.text = item.title
            txtContent.text = item.content

            // Format datetime: "yyyy-MM-dd'T'HH:mm:ss..." → "dd MMM yyyy, HH:mm"
            val displayDate = try {
                val inputSdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
                val dateObj = inputSdf.parse(item.createdAt ?: "")
                val outputSdf = SimpleDateFormat("dd MMM yyyy, HH:mm", Locale("id", "ID"))
                outputSdf.format(dateObj!!)
            } catch (e: Exception) {
                item.createdAt?.substringBefore("T") ?: ""
            }
            txtDate.text = displayDate

            // Unread → background kuning soft, dot visible; Read → putih
            if (isRead) {
                cardItem.setCardBackgroundColor(Color.WHITE)
                viewUnreadDot.visibility = View.GONE
            } else {
                cardItem.setCardBackgroundColor(Color.parseColor("#FEF9E7"))
                viewUnreadDot.visibility = View.VISIBLE
            }
        }
    }
}
