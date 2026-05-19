package com.carefastindo.absensi.ui.employee

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import com.carefastindo.absensi.databinding.BottomSheetLeaveRequestBinding
import com.google.android.material.bottomsheet.BottomSheetDialogFragment

class BottomSheetLeaveRequest : BottomSheetDialogFragment() {

    private var _binding: BottomSheetLeaveRequestBinding? = null
    private val binding get() = _binding!!

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = BottomSheetLeaveRequestBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        binding.rgLeaveType.setOnCheckedChangeListener { _, checkedId ->
            if (checkedId == binding.rbSakit.id) {
                binding.attachmentContainer.visibility = View.VISIBLE
            } else {
                binding.attachmentContainer.visibility = View.GONE
            }
        }

        binding.btnSubmitLeave.setOnClickListener {
            val isSakit = binding.rbSakit.isChecked
            val reason = binding.edtReason.text.toString()

            if (isSakit && reason.isBlank()) {
                Toast.makeText(context, "Alasan sakit dan lampiran wajib diisi!", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            // TODO: Execute submission via ViewModel
            Toast.makeText(context, "Pengajuan Berhasil Dikirim", Toast.LENGTH_SHORT).show()
            dismiss()
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
