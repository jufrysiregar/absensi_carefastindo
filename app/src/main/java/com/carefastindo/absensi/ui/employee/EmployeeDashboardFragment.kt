package com.carefastindo.absensi.ui.employee

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Bundle
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.core.app.ActivityCompat
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import com.carefastindo.absensi.R
import com.carefastindo.absensi.data.model.Attendance
import com.carefastindo.absensi.data.model.CompanyConfig
import com.carefastindo.absensi.data.model.EmergencyAssignment
import com.carefastindo.absensi.data.model.Notification
import com.carefastindo.absensi.data.model.OffSchedule
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.carefastindo.absensi.utils.ShiftHelper
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import androidx.activity.result.contract.ActivityResultContracts
import android.app.Activity

class EmployeeDashboardFragment : Fragment() {

    // Fix typical binding package issues manually
    private var _binding: View? = null
    private val binding get() = _binding!!
    
    private val viewModel: EmployeeViewModel by activityViewModels()
    private lateinit var fusedLocationClient: FusedLocationProviderClient

    // Cache parameters to avoid duplicate queries
    private var todayAttendance: Attendance? = null
    private var isOffToday = false
    private var hasEmergencyAssignmentToday = false
    private var companyConfig: CompanyConfig? = null
    private var activeAdminNotification: Notification? = null

    // Temp variables for face verification
    private var pendingAttendanceType: String = ""
    private var pendingLat: Double = 0.0
    private var pendingLng: Double = 0.0

    private val faceVerificationLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val selfieUrl = result.data?.getStringExtra("selfie_url")
            if (selfieUrl != null) {
                saveAttendanceToDatabase(pendingAttendanceType, pendingLat, pendingLng, selfieUrl)
            } else {
                Toast.makeText(requireContext(), "Gagal mendapatkan URL selfie", Toast.LENGTH_SHORT).show()
            }
        } else {
            Toast.makeText(requireContext(), "Verifikasi wajah dibatalkan / gagal", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        val root = inflater.inflate(R.layout.fragment_employee_dashboard, container, false)
        _binding = root
        return root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(requireActivity())

        setupListeners()
        observeViewModel()
        refreshDashboardData()
    }

    private fun setupListeners() {
        // Swipe Refresh
        val refreshLayout = view?.findViewById<androidx.swiperefreshlayout.widget.SwipeRefreshLayout>(R.id.swipeRefresh)
        refreshLayout?.setOnRefreshListener {
            refreshDashboardData {
                refreshLayout.isRefreshing = false
            }
        }

        val btnCheckIn = view?.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnCheckIn)
        val btnBreak = view?.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnBreak)
        val btnCheckOut = view?.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnCheckOut)
        val btnInfoJadwal = view?.findViewById<android.widget.ImageView>(R.id.btnInfoJadwal)

        btnInfoJadwal?.setOnClickListener {
            val user = viewModel.uiState.value.user ?: return@setOnClickListener
            val (jamMasuk, jamPulang) = ShiftHelper.getShiftTimes(user.role, user.shiftType)
            val jamIstirahat = ShiftHelper.getDefaultBreakStart(user.shiftType)
            val shiftTypeStr = user.shiftType?.capitalize() ?: "Default"
            
            val infoText = """
                Jabatan: ${user.role}
                Shift: $shiftTypeStr
                Jam Kerja: $jamMasuk - $jamPulang
                Jam Istirahat: Kondisional (Sesuai arahan Team Leader)
            """.trimIndent()

            MaterialAlertDialogBuilder(requireContext())
                .setTitle("Informasi Jadwal")
                .setMessage(infoText)
                .setCancelable(false)
                .setPositiveButton("TUTUP", null)
                .show()
        }

        btnCheckIn?.setOnClickListener {
            if (isOffToday && !hasEmergencyAssignmentToday) {
                Toast.makeText(requireContext(), "Anda off hari ini", Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            startPresensiFlow("check_in")
        }

        btnBreak?.setOnClickListener {
            startPresensiFlow("break")
        }

        btnCheckOut?.setOnClickListener {
            startPresensiFlow("check_out")
        }
    }

    private fun refreshDashboardData(onComplete: (() -> Unit)? = null) {
        viewModel.loadUserData()
        lifecycleScope.launch {
            try {
                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id ?: return@launch
                val role = viewModel.uiState.value.user?.role ?: "Pegawai"
                val shiftType = viewModel.uiState.value.user?.shiftType
                val todayStr = ShiftHelper.getAttendanceDate(role, shiftType)

                // 1. Fetch today's attendance
                val attendanceList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("attendance")
                        .select {
                            filter {
                                eq("user_id", userId)
                                eq("date", todayStr)
                            }
                        }.decodeList<Attendance>()
                }
                todayAttendance = attendanceList.firstOrNull()

                // 2. Fetch off schedules
                val offList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("off_schedules")
                        .select {
                            filter {
                                eq("user_id", userId)
                                eq("off_date", todayStr)
                            }
                        }.decodeList<OffSchedule>()
                }
                isOffToday = offList.isNotEmpty()

                // 3. Fetch emergency assignment
                val emergencyList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("emergency_assignments")
                        .select {
                            filter {
                                eq("assigned_user_id", userId)
                                eq("target_date", todayStr)
                            }
                        }.decodeList<EmergencyAssignment>()
                }
                hasEmergencyAssignmentToday = emergencyList.isNotEmpty()

                // 4. Fetch company config
                val configList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("settings")
                        .select { filter { eq("id", "companyConfig") } }
                        .decodeList<CompanyConfig>()
                }
                companyConfig = configList.firstOrNull()

                // 5. Fetch recent unread admin notifications for this user
                val notifList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("notifications")
                        .select {
                            filter {
                                eq("user_id", userId)
                                eq("is_read", false)
                            }
                            order("created_at", Order.DESCENDING)
                        }.decodeList<Notification>()
                }
                activeAdminNotification = notifList.firstOrNull()

                updateUI()
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                onComplete?.invoke()
            }
        }
    }

    private fun updateUI() {
        val view = view ?: return
        val txtTodayStatus = view.findViewById<android.widget.TextView>(R.id.txtTodayStatus)
        val txtCheckInTime = view.findViewById<android.widget.TextView>(R.id.txtCheckInTime)
        val txtBreakTime = view.findViewById<android.widget.TextView>(R.id.txtBreakTime)
        val txtCheckOutTime = view.findViewById<android.widget.TextView>(R.id.txtCheckOutTime)
        
        val btnCheckIn = view.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnCheckIn)
        val btnBreak = view.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnBreak)
        val btnCheckOut = view.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnCheckOut)

        val latenessWarningCard = view.findViewById<androidx.cardview.widget.CardView>(R.id.latenessWarningCard)
        val adminNotificationCard = view.findViewById<androidx.cardview.widget.CardView>(R.id.adminNotificationCard)
        val txtAdminNotificationContent = view.findViewById<android.widget.TextView>(R.id.txtAdminNotificationContent)

        // 1. Update Status Cards
        val att = todayAttendance
        if (att == null) {
            txtTodayStatus.text = "Status hari ini: Belum absen masuk"
            txtCheckInTime.text = "--"
            txtBreakTime.text = "--"
            txtCheckOutTime.text = "--"
        } else {
            txtCheckInTime.text = att.checkInTime?.substring(0, 5) ?: "--"
            txtBreakTime.text = att.breakTime?.substring(0, 5) ?: "--"
            txtCheckOutTime.text = att.checkOutTime?.substring(0, 5) ?: "--"

            when {
                att.checkOutTime != null -> txtTodayStatus.text = "Status hari ini: Sudah pulang (${att.checkOutTime.substring(0, 5)})"
                att.breakTime != null -> txtTodayStatus.text = "Status hari ini: Sedang istirahat (${att.breakTime.substring(0, 5)})"
                else -> txtTodayStatus.text = "Status hari ini: Sudah absen masuk (${att.checkInTime?.substring(0, 5)})"
            }
        }

        // 2. Button Enablement Logic based on shift and database records
        val user = viewModel.uiState.value.user
        if (user != null) {
            val role = user.role
            val shiftType = user.shiftType
            val breakStart = user.breakStart

            // Check In Button
            val hasCheckedIn = att?.checkInTime != null
            val isCheckInWindow = ShiftHelper.isCheckInWindowActive(role, shiftType)
            val allowedCheckIn = !hasCheckedIn && isCheckInWindow && (!isOffToday || hasEmergencyAssignmentToday)
            
            btnCheckIn.isEnabled = allowedCheckIn
            btnCheckIn.alpha = if (allowedCheckIn) 1.0f else 0.5f

            // Break Button (Conditional based on field situation/TL, so it can be clicked anytime after check in)
            val hasCheckedInButNotBreak = hasCheckedIn && att?.breakTime == null
            val allowedBreak = hasCheckedInButNotBreak
            
            btnBreak.isEnabled = allowedBreak
            btnBreak.alpha = if (allowedBreak) 1.0f else 0.5f

            // Check Out Button
            val hasCheckedInButNotCheckOut = hasCheckedIn && att?.checkOutTime == null
            // pulangs are allowed anytime after check in
            val allowedCheckOut = hasCheckedInButNotCheckOut
            
            btnCheckOut.isEnabled = allowedCheckOut
            btnCheckOut.alpha = if (allowedCheckOut) 1.0f else 0.5f

            // 3. Show lateness warning if >= 3
            if (user.latenessCount >= 3) {
                latenessWarningCard.visibility = View.VISIBLE
            } else {
                latenessWarningCard.visibility = View.GONE
            }
        }

        // 4. Show admin notification if any
        val notif = activeAdminNotification
        if (notif != null) {
            adminNotificationCard.visibility = View.VISIBLE
            txtAdminNotificationContent.text = notif.message
        } else {
            adminNotificationCard.visibility = View.GONE
        }
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            viewModel.uiState.collectLatest { state ->
                val view = view ?: return@collectLatest
                
                // Update header text views
                val txtEmployeeName = view.findViewById<android.widget.TextView>(R.id.txtEmployeeName)
                val txtEmployeeRole = view.findViewById<android.widget.TextView>(R.id.txtEmployeeRole)
                val txtLiveTime = view.findViewById<android.widget.TextView>(R.id.txtLiveTime)
                val txtLiveDate = view.findViewById<android.widget.TextView>(R.id.txtLiveDate)

                state.user?.let { u ->
                    txtEmployeeName?.text = u.name
                    txtEmployeeRole?.text = "${u.role} - Shift ${u.shiftType?.capitalize() ?: "Default"}"
                }

                txtLiveTime?.text = state.liveTime
                txtLiveDate?.text = state.liveDate
            }
        }
    }

    private fun startPresensiFlow(type: String) {
        // Step 1: Scan QR Code
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(com.google.mlkit.vision.barcode.common.Barcode.FORMAT_QR_CODE)
            .build()
        val scanner = GmsBarcodeScanning.getClient(requireContext(), options)
        
        scanner.startScan()
            .addOnSuccessListener { barcode: com.google.mlkit.vision.barcode.common.Barcode ->
                val scannedValue = barcode.rawValue
                val expectedSecret = companyConfig?.qrSecret ?: "CARE_OFFICE_MAIN"

                if (scannedValue == expectedSecret) {
                    // Step 2: Verify Location (GPS)
                    checkLocationAndExecute(type)
                } else {
                    MaterialAlertDialogBuilder(requireContext())
                        .setTitle("QR Code Salah")
                        .setMessage("QR Code yang Anda scan tidak valid untuk absensi kantor ini.")
                        .setPositiveButton("OK", null)
                        .show()
                }
            }
            .addOnFailureListener { e: Exception ->
                Toast.makeText(requireContext(), "Gagal scan QR: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            }
    }

    private fun checkLocationAndExecute(type: String) {
        // GPS checks
        val locationManager = requireContext().getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val isGpsEnabled = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)

        if (!isGpsEnabled) {
            MaterialAlertDialogBuilder(requireContext())
                .setTitle("GPS Mati")
                .setMessage("Harap aktifkan GPS perangkat Anda untuk melanjutkan absensi.")
                .setPositiveButton("Buka Pengaturan") { _, _ ->
                    startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                }
                .setNegativeButton("Batal", null)
                .show()
            return
        }

        if (ActivityCompat.checkSelfPermission(
                requireContext(), Manifest.permission.ACCESS_FINE_LOCATION
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION), 999
            )
            return
        }

        Toast.makeText(requireContext(), "Mendapatkan lokasi presisi...", Toast.LENGTH_SHORT).show()
        
        val cts = CancellationTokenSource()
        fusedLocationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
            .addOnSuccessListener { location: Location? ->
                if (location != null) {
                    verifyGeofencingAndSave(type, location.latitude, location.longitude)
                } else {
                    Toast.makeText(requireContext(), "Gagal mendapatkan lokasi. Coba lagi.", Toast.LENGTH_LONG).show()
                }
            }
            .addOnFailureListener { e: Exception ->
                Toast.makeText(requireContext(), "Error lokasi: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            }
    }

    private fun verifyGeofencingAndSave(type: String, lat: Double, lng: Double) {
        val config = companyConfig ?: CompanyConfig(officeLat = 3.5952, officeLng = 98.6722, radius = 100) // default fallback
        
        val results = FloatArray(1)
        Location.distanceBetween(lat, lng, config.officeLat, config.officeLng, results)
        val distance = results[0]

        if (distance > config.radius) {
            MaterialAlertDialogBuilder(requireContext())
                .setTitle("Di Luar Area")
                .setMessage("Anda berada di luar area absensi. Jarak Anda ke kantor adalah ${distance.toInt()} meter (Maksimal radius ${config.radius} meter).")
                .setPositiveButton("OK", null)
                .show()
            return
        }

        // Location verified! Proceed to Face Verification
        pendingAttendanceType = type
        pendingLat = lat
        pendingLng = lng
        val intent = Intent(requireContext(), FaceVerificationActivity::class.java)
        faceVerificationLauncher.launch(intent)
    }

    private fun saveAttendanceToDatabase(type: String, lat: Double, lng: Double, selfieUrl: String) {
        lifecycleScope.launch {
            try {
                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id ?: return@launch
                val user = viewModel.uiState.value.user ?: return@launch
                val todayStr = ShiftHelper.getAttendanceDate(user.role, user.shiftType)
                val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
                val nowStr = timeFormat.format(Date())

                when (type) {
                    "check_in" -> {
                        val (jamMasuk, _) = ShiftHelper.getShiftTimes(user.role, user.shiftType)
                        val partsMasuk = jamMasuk.split(":")
                        val masukMin = partsMasuk[0].toInt() * 60 + partsMasuk[1].toInt()
                        val calendar = Calendar.getInstance()
                        val currentMin = calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)

                        val status = if (currentMin <= masukMin + 30) "hadir" else "terlambat"

                        if (currentMin > masukMin + 120) {
                            Toast.makeText(requireContext(), "Batas waktu absen masuk berakhir", Toast.LENGTH_LONG).show()
                            return@launch
                        }

                        val newAtt = Attendance(
                            userId = userId,
                            date = todayStr,
                            checkInTime = nowStr,
                            locationLat = lat,
                            locationLng = lng,
                            status = status,
                            selfieUrl = selfieUrl
                        )

                        withContext(Dispatchers.IO) {
                            SupabaseClient.db.from("attendance").insert(newAtt)
                        }

                        if (status == "terlambat") {
                            val newLatenessCount = user.latenessCount + 1
                            withContext(Dispatchers.IO) {
                                SupabaseClient.db.from("users").update({
                                    set("lateness_count", newLatenessCount)
                                }) {
                                    filter { eq("id", userId) }
                                }
                            }
                            if (newLatenessCount >= 3) {
                                val adminNotif = Notification(
                                    userId = "superadmin",
                                    message = "Pegawai ${user.name} (${user.employeeCode}) telah terlambat 3 kali bulan ini."
                                )
                                withContext(Dispatchers.IO) {
                                    SupabaseClient.db.from("notifications").insert(adminNotif)
                                }
                            }
                        }

                        Toast.makeText(requireContext(), "Absen Masuk Berhasil ($status)!", Toast.LENGTH_LONG).show()
                    }
                    "break" -> {
                        withContext(Dispatchers.IO) {
                            SupabaseClient.db.from("attendance").update({
                                set("break_time", nowStr)
                                set("selfie_url", selfieUrl)
                            }) {
                                filter {
                                    eq("user_id", userId)
                                    eq("date", todayStr)
                                }
                            }
                        }
                        Toast.makeText(requireContext(), "Istirahat Berhasil Dimulai!", Toast.LENGTH_LONG).show()
                    }
                    "check_out" -> {
                        withContext(Dispatchers.IO) {
                            SupabaseClient.db.from("attendance").update({
                                set("check_out_time", nowStr)
                                set("selfie_url", selfieUrl)
                            }) {
                                filter {
                                    eq("user_id", userId)
                                    eq("date", todayStr)
                                }
                            }
                        }
                        Toast.makeText(requireContext(), "Absen Pulang Berhasil. Selamat Beristirahat!", Toast.LENGTH_LONG).show()
                    }
                }

                refreshDashboardData()
            } catch (e: Exception) {
                Toast.makeText(requireContext(), "Gagal absensi: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
