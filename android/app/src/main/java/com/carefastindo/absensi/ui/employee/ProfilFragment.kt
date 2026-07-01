package com.carefastindo.absensi.ui.employee

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.BitmapFactory
import android.os.Bundle
import android.util.Base64
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import com.carefastindo.absensi.R
import com.carefastindo.absensi.data.model.UserFace
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.bumptech.glide.Glide
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ProfilFragment : Fragment() {

    private val viewModel: EmployeeViewModel by activityViewModels()

    private lateinit var imgAvatar: ImageView
    private lateinit var txtName: TextView
    private lateinit var txtEmail: TextView
    private lateinit var txtEmployeeCode: TextView

    private lateinit var txtShift: TextView
    private lateinit var txtPosition: TextView
    private lateinit var txtLatenessCount: TextView
    private lateinit var txtFaceStatus: TextView

    private lateinit var btnRegisterFace: MaterialButton
    private lateinit var btnChangePassword: MaterialButton

    private lateinit var loadingOverlay: View

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View? {
        val view = inflater.inflate(R.layout.fragment_profil, container, false)

        imgAvatar = view.findViewById(R.id.imgAvatar)
        txtName = view.findViewById(R.id.txtName)
        txtEmail = view.findViewById(R.id.txtEmail)
        txtEmployeeCode = view.findViewById(R.id.txtEmployeeCode)

        txtShift = view.findViewById(R.id.txtShift)
        txtPosition = view.findViewById(R.id.txtPosition)
        txtLatenessCount = view.findViewById(R.id.txtLatenessCount)
        txtFaceStatus = view.findViewById(R.id.txtFaceStatus)

        btnRegisterFace = view.findViewById(R.id.btnRegisterFace)
        btnChangePassword = view.findViewById(R.id.btnChangePassword)

        loadingOverlay = view.findViewById(R.id.loadingOverlay)

        setupListeners()
        observeUserData()

        return view
    }

    override fun onResume() {
        super.onResume()
        checkFaceRegistrationStatus()
    }

    private fun checkFaceRegistrationStatus() {
        lifecycleScope.launch {
            try {
                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id ?: return@launch
                val faces = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("user_faces")
                        .select { filter { eq("user_id", userId) } }
                        .decodeList<UserFace>()
                }
                
                withContext(Dispatchers.Main) {
                    val face = faces.firstOrNull()
                    if (face != null) {
                        txtFaceStatus.text = "Sudah Terdaftar"
                        txtFaceStatus.setTextColor(resources.getColor(R.color.primary, null))
                        btnRegisterFace.text = "Perbarui Wajah"
                        showRegisteredFace(face.facePhotoUrl)
                    } else {
                        txtFaceStatus.text = "Belum Terdaftar"
                        txtFaceStatus.setTextColor(resources.getColor(R.color.error, null))
                        btnRegisterFace.text = "Registrasi Wajah"
                        showDefaultAvatar()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    txtFaceStatus.text = "Gagal memuat status"
                    showDefaultAvatar()
                }
            }
        }
    }

    private fun showRegisteredFace(photoUrl: String?) {
        if (photoUrl.isNullOrBlank()) {
            showDefaultAvatar()
            return
        }

        imgAvatar.imageTintList = null
        imgAvatar.scaleType = ImageView.ScaleType.CENTER_CROP

        if (photoUrl.startsWith("data:image", ignoreCase = true)) {
            val base64Data = photoUrl.substringAfter(",", missingDelimiterValue = "")
            val imageBytes = runCatching { Base64.decode(base64Data, Base64.DEFAULT) }.getOrNull()
            val bitmap = imageBytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
            if (bitmap != null) {
                Glide.with(this).clear(imgAvatar)
                imgAvatar.setImageBitmap(bitmap)
            } else {
                showDefaultAvatar()
            }
            return
        }

        Glide.with(this)
            .load(photoUrl)
            .placeholder(android.R.drawable.sym_def_app_icon)
            .error(android.R.drawable.sym_def_app_icon)
            .into(imgAvatar)
    }

    private fun showDefaultAvatar() {
        Glide.with(this).clear(imgAvatar)
        imgAvatar.setImageResource(android.R.drawable.sym_def_app_icon)
        imgAvatar.imageTintList = ColorStateList.valueOf(resources.getColor(R.color.primary, null))
        imgAvatar.scaleType = ImageView.ScaleType.FIT_CENTER
    }

    private fun setupListeners() {
        btnRegisterFace.setOnClickListener {
            startActivity(Intent(requireContext(), FaceRegistrationActivity::class.java))
        }

        btnChangePassword.setOnClickListener {
            showChangePasswordDialog()
        }


    }

    private fun observeUserData() {
        lifecycleScope.launch {
            viewModel.uiState.collectLatest { state ->
                val u = state.user ?: return@collectLatest
                txtName.text = u.name
                txtEmail.text = u.email
                txtEmployeeCode.text = u.employeeCode ?: "--"

                txtShift.text = u.shiftType?.capitalize() ?: "Default"
                txtPosition.text = u.position ?: u.role?.capitalize() ?: "--"
                txtLatenessCount.text = "${u.latenessCount} Kali"
            }
        }
    }

    private fun showChangePasswordDialog() {
        val dialogView = LayoutInflater.from(requireContext()).inflate(R.layout.dialog_change_password, null)
        val edtNewPassword = dialogView.findViewById<TextInputEditText>(R.id.edtNewPassword)
        val edtConfirmPassword = dialogView.findViewById<TextInputEditText>(R.id.edtConfirmPassword)

        MaterialAlertDialogBuilder(requireContext())
            .setTitle("Ganti Kata Sandi")
            .setView(dialogView)
            .setPositiveButton("Simpan") { dialog, _ ->
                val newPass = edtNewPassword.text.toString().trim()
                val confirmPass = edtConfirmPassword.text.toString().trim()

                if (newPass.isEmpty() || confirmPass.isEmpty()) {
                    Toast.makeText(requireContext(), "Semua kolom sandi harus diisi", Toast.LENGTH_LONG).show()
                    return@setPositiveButton
                }

                if (newPass != confirmPass) {
                    Toast.makeText(requireContext(), "Sandi baru dan konfirmasi tidak cocok", Toast.LENGTH_LONG).show()
                    return@setPositiveButton
                }

                if (newPass.length < 6) {
                    Toast.makeText(requireContext(), "Sandi minimal terdiri dari 6 karakter", Toast.LENGTH_LONG).show()
                    return@setPositiveButton
                }

                loadingOverlay.visibility = View.VISIBLE
                lifecycleScope.launch {
                    try {
                        withContext(Dispatchers.IO) {
                            SupabaseClient.auth.updateUser {
                                password = newPass
                            }
                        }
                        Toast.makeText(requireContext(), "Kata sandi berhasil diperbarui!", Toast.LENGTH_LONG).show()
                    } catch (e: Exception) {
                        Toast.makeText(requireContext(), "Gagal mengubah sandi: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
                    } finally {
                        loadingOverlay.visibility = View.GONE
                    }
                }
                dialog.dismiss()
            }
            .setNegativeButton("Batal", null)
            .show()
    }


}
