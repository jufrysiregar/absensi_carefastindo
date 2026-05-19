package com.carefastindo.absensi.ui.employee

import android.app.DatePickerDialog
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.ImageView
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.cardview.widget.CardView
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.carefastindo.absensi.R
import com.carefastindo.absensi.data.model.LeaveRequest
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.storage.storage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class PengajuanIzinFragment : Fragment() {

    private lateinit var rgLeaveType: RadioGroup
    private lateinit var rbIzin: RadioButton
    private lateinit var rbSakit: RadioButton
    private lateinit var cardStartDate: CardView
    private lateinit var txtStartDate: TextView
    private lateinit var cardEndDate: CardView
    private lateinit var txtEndDate: TextView
    private lateinit var etReason: EditText
    private lateinit var uploadSection: View
    private lateinit var btnSelectFile: MaterialButton
    private lateinit var imgPreview: ImageView
    private lateinit var btnSubmitLeave: MaterialButton
    
    private lateinit var rvHistory: RecyclerView
    private lateinit var swipeRefresh: androidx.swiperefreshlayout.widget.SwipeRefreshLayout
    private lateinit var txtEmptyHistory: TextView
    private lateinit var loadingOverlay: View

    private var selectedStartDate: String = ""
    private var selectedEndDate: String = ""
    private var selectedFileUri: Uri? = null
    private var historyList = mutableListOf<LeaveRequest>()
    private lateinit var adapter: LeaveHistoryAdapter

    private val selectImageLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) {
            selectedFileUri = uri
            imgPreview.visibility = View.VISIBLE
            Glide.with(this).load(uri).into(imgPreview)
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_pengajuan_izin, container, false)

        // Bind form views
        rgLeaveType = view.findViewById(R.id.rgLeaveType)
        rbIzin = view.findViewById(R.id.rbIzin)
        rbSakit = view.findViewById(R.id.rbSakit)
        cardStartDate = view.findViewById(R.id.cardStartDate)
        txtStartDate = view.findViewById(R.id.txtStartDate)
        cardEndDate = view.findViewById(R.id.cardEndDate)
        txtEndDate = view.findViewById(R.id.txtEndDate)
        etReason = view.findViewById(R.id.etReason)
        uploadSection = view.findViewById(R.id.uploadSection)
        btnSelectFile = view.findViewById(R.id.btnSelectFile)
        imgPreview = view.findViewById(R.id.imgPreview)
        btnSubmitLeave = view.findViewById(R.id.btnSubmitLeave)

        // Bind list and swipe views
        rvHistory = view.findViewById(R.id.rvHistory)
        swipeRefresh = view.findViewById(R.id.swipeRefresh)
        txtEmptyHistory = view.findViewById(R.id.txtEmptyHistory)
        loadingOverlay = view.findViewById(R.id.loadingOverlay)

        setupFormListeners()
        setupRecyclerView()
        loadLeaveHistory()

        return view
    }

    private fun setupFormListeners() {
        // Toggle photo attachment container based on type
        rgLeaveType.setOnCheckedChangeListener { _, checkedId ->
            if (checkedId == R.id.rbSakit) {
                uploadSection.visibility = View.VISIBLE
            } else {
                uploadSection.visibility = View.GONE
                selectedFileUri = null
                imgPreview.visibility = View.GONE
            }
        }

        // Date selection tools
        cardStartDate.setOnClickListener { showDatePicker { dateStr ->
            selectedStartDate = dateStr
            txtStartDate.text = formatDateDisplay(dateStr)
        }}

        cardEndDate.setOnClickListener { showDatePicker { dateStr ->
            selectedEndDate = dateStr
            txtEndDate.text = formatDateDisplay(dateStr)
        }}

        // File selection tool
        btnSelectFile.setOnClickListener {
            selectImageLauncher.launch("image/*")
        }

        // Form Submission
        btnSubmitLeave.setOnClickListener {
            submitLeaveRequest()
        }

        // List swipe to refresh
        swipeRefresh.setOnRefreshListener {
            loadLeaveHistory {
                swipeRefresh.isRefreshing = false
            }
        }
    }

    private fun showDatePicker(onDateSelected: (String) -> Unit) {
        val calendar = Calendar.getInstance()
        DatePickerDialog(
            requireContext(),
            { _, year, month, dayOfMonth ->
                val calendarSelected = Calendar.getInstance()
                calendarSelected.set(year, month, dayOfMonth)
                val format = SimpleDateFormat("yyyy-MM-dd", Locale.US)
                onDateSelected(format.format(calendarSelected.time))
            },
            calendar.get(Calendar.YEAR),
            calendar.get(Calendar.MONTH),
            calendar.get(Calendar.DAY_OF_MONTH)
        ).show()
    }

    private fun formatDateDisplay(dateStr: String): String {
        return try {
            val parser = SimpleDateFormat("yyyy-MM-dd", Locale.US)
            val formatter = SimpleDateFormat("dd MMM yyyy", Locale.getDefault())
            parser.parse(dateStr)?.let { formatter.format(it) } ?: dateStr
        } catch (e: Exception) {
            dateStr
        }
    }

    private fun submitLeaveRequest() {
        val isSakit = rbSakit.isChecked
        val type = if (isSakit) "sakit" else "izin"
        val reason = etReason.text.toString().trim()

        if (selectedStartDate.isEmpty() || selectedEndDate.isEmpty()) {
            Toast.makeText(requireContext(), "Harap pilih tanggal mulai dan selesai", Toast.LENGTH_LONG).show()
            return
        }

        if (reason.isEmpty()) {
            Toast.makeText(requireContext(), "Harap isi alasan pengajuan", Toast.LENGTH_LONG).show()
            return
        }

        if (isSakit && selectedFileUri == null) {
            Toast.makeText(requireContext(), "Surat keterangan sakit (foto) wajib diunggah", Toast.LENGTH_LONG).show()
            return
        }

        loadingOverlay.visibility = View.VISIBLE

        lifecycleScope.launch {
            try {
                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id ?: throw Exception("Sesi login berakhir")
                var attachmentUrl: String? = null

                // Upload image if present
                selectedFileUri?.let { uri ->
                    val fileBytes = withContext(Dispatchers.IO) {
                        requireContext().contentResolver.openInputStream(uri)?.readBytes()
                    } ?: throw Exception("Gagal membaca file gambar")

                    val filename = "${System.currentTimeMillis()}_sakit.jpg"
                    val path = "$userId/$filename"

                    withContext(Dispatchers.IO) {
                        // Upload physical bytes directly to leave-attachments bucket
                        SupabaseClient.storage.from("leave-attachments").upload(path, fileBytes, overwrite = true)
                    }

                    // Retrieve dynamic signed/public url
                    attachmentUrl = SupabaseClient.storage.from("leave-attachments").publicUrl(path)
                }

                // Insert into leave_requests table
                val newRequest = LeaveRequest(
                    userId = userId,
                    leaveType = type,
                    startDate = selectedStartDate,
                    endDate = selectedEndDate,
                    reason = reason,
                    attachmentUrl = attachmentUrl,
                    status = "pending"
                )

                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("leave_requests").insert(newRequest)
                }

                // Reset form values
                resetForm()
                loadLeaveHistory()

                MaterialAlertDialogBuilder(requireContext())
                    .setTitle("Berhasil")
                    .setMessage("Pengajuan $type Anda berhasil dikirim dan menunggu persetujuan.")
                    .setPositiveButton("OK", null)
                    .show()

            } catch (e: Exception) {
                Toast.makeText(requireContext(), "Gagal mengirim pengajuan: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            } finally {
                loadingOverlay.visibility = View.GONE
            }
        }
    }

    private fun resetForm() {
        rgLeaveType.check(R.id.rbIzin)
        selectedStartDate = ""
        selectedEndDate = ""
        txtStartDate.text = "Pilih Tanggal Mulai"
        txtEndDate.text = "Pilih Tanggal Selesai"
        etReason.setText("")
        selectedFileUri = null
        imgPreview.visibility = View.GONE
    }

    private fun setupRecyclerView() {
        rvHistory.layoutManager = LinearLayoutManager(requireContext())
        adapter = LeaveHistoryAdapter(historyList)
        rvHistory.adapter = adapter
    }

    private fun loadLeaveHistory(onComplete: (() -> Unit)? = null) {
        lifecycleScope.launch {
            try {
                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id ?: return@launch
                val list = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("leave_requests")
                        .select {
                            filter {
                                eq("user_id", userId)
                            }
                            order("start_date", Order.DESCENDING)
                        }.decodeList<LeaveRequest>()
                }

                historyList.clear()
                historyList.addAll(list)
                adapter.notifyDataSetChanged()

                if (historyList.isEmpty()) {
                    txtEmptyHistory.visibility = View.VISIBLE
                    rvHistory.visibility = View.GONE
                } else {
                    txtEmptyHistory.visibility = View.GONE
                    rvHistory.visibility = View.VISIBLE
                }

            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                onComplete?.invoke()
            }
        }
    }

    // Inner Recycler Adapter for history items
    private inner class LeaveHistoryAdapter(private val items: List<LeaveRequest>) :
        RecyclerView.Adapter<LeaveHistoryAdapter.ViewHolder>() {

        inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
            val txtDateRange: TextView = view.findViewById(R.id.txtDateRange)
            val txtLeaveType: TextView = view.findViewById(R.id.txtLeaveType)
            val cardLeaveType: CardView = view.findViewById(R.id.cardLeaveType)
            val txtReason: TextView = view.findViewById(R.id.txtReason)
            val txtStatus: TextView = view.findViewById(R.id.txtStatus)
            val cardStatus: CardView = view.findViewById(R.id.cardStatus)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.item_leave_request_employee, parent, false)
            return ViewHolder(view)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            val item = items[position]

            // Format range e.g. 19 Mei 2026 s/d 21 Mei 2026
            val start = formatDateDisplay(item.startDate)
            val end = formatDateDisplay(item.endDate)
            holder.txtDateRange.text = "$start s/d $end"

            holder.txtReason.text = item.reason

            // Type
            holder.txtLeaveType.text = item.leaveType.toUpperCase(Locale.getDefault())
            if (item.leaveType == "sakit") {
                holder.cardLeaveType.setCardBackgroundColor(ContextCompat.getColor(requireContext(), R.color.accent)) // Gold/Orange
                holder.txtLeaveType.setTextColor(ContextCompat.getColor(requireContext(), R.color.white))
            } else {
                holder.cardLeaveType.setCardBackgroundColor(ContextCompat.getColor(requireContext(), R.color.primary)) // Dark Blue
                holder.txtLeaveType.setTextColor(ContextCompat.getColor(requireContext(), R.color.white))
            }

            // Status Badge
            holder.txtStatus.text = item.status.toUpperCase(Locale.getDefault())
            when (item.status) {
                "approved" -> {
                    holder.cardStatus.setCardBackgroundColor(ContextCompat.getColor(requireContext(), R.color.success))
                    holder.txtStatus.setTextColor(ContextCompat.getColor(requireContext(), R.color.white))
                }
                "rejected" -> {
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
