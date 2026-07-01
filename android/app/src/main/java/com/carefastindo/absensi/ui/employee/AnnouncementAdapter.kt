package com.carefastindo.absensi.ui.employee

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
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

    private val expandedIds = mutableSetOf<String>()

    fun updateData(newItems: List<Announcement>, newReadIds: Set<String>) {
        items = newItems
        readIds = newReadIds
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_announcement, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val item = items[position]
        holder.bind(item, readIds.contains(item.id), expandedIds.contains(item.id))
    }

    override fun getItemCount(): Int = items.size

    inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val txtTitle: TextView = view.findViewById(R.id.txtTitle)
        private val txtDate: TextView = view.findViewById(R.id.txtDate)
        private val viewUnreadDot: View = view.findViewById(R.id.viewUnreadDot)
        private val imgExpand: ImageView = view.findViewById(R.id.imgExpand)
        private val layoutContentArea: LinearLayout = view.findViewById(R.id.layoutContentArea)
        private val txtContent: TextView = view.findViewById(R.id.txtContent)

        fun bind(item: Announcement, isRead: Boolean, isExpanded: Boolean) {
            txtTitle.text = item.title
            txtContent.text = item.content

            // Format date: "yyyy-MM-dd'T'HH:mm:ss..." -> "dd-MM-yyyy" or "dd MMM yyyy"
            val displayDate = try {
                val inputSdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
                val dateObj = inputSdf.parse(item.createdAt ?: "")
                val outputSdf = SimpleDateFormat("dd-MM-yyyy", Locale.getDefault())
                outputSdf.format(dateObj!!)
            } catch (e: Exception) {
                item.createdAt?.substringBefore("T") ?: ""
            }
            txtDate.text = displayDate

            // Unread dot
            viewUnreadDot.visibility = if (isRead) View.GONE else View.VISIBLE

            // Expand state
            if (isExpanded) {
                layoutContentArea.visibility = View.VISIBLE
                imgExpand.setImageResource(android.R.drawable.arrow_up_float)
            } else {
                layoutContentArea.visibility = View.GONE
                imgExpand.setImageResource(android.R.drawable.arrow_down_float)
            }

            itemView.setOnClickListener {
                if (isExpanded) {
                    expandedIds.remove(item.id)
                } else {
                    expandedIds.add(item.id)
                }
                notifyItemChanged(adapterPosition)

                // Trigger callback to mark as read if not already read
                if (!isRead) {
                    onAnnouncementClicked(item)
                }
            }
        }
    }
}
