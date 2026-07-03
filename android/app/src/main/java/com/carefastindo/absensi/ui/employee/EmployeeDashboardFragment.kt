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
import com.carefastindo.absensi.data.model.OvertimeAssignment
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
import android.os.CountDownTimer
import android.os.Vibrator
import android.os.VibrationEffect
import android.os.Build
import java.util.TimeZone

class EmployeeDashboardFragment : Fragment() {

    // Fix typical binding package issues manually
    private var _binding: View? = null
    private val binding get() = _binding!!
    
    private val viewModel: EmployeeViewModel by activityViewModels()
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var breakCountdownTimer: CountDownTimer? = null

    // Cache parameters to avoid duplicate queries
    private var todayAttendance: Attendance? = null
    private var isOffToday = false
    private var hasEmergencyAssignmentToday = false
    private var companyConfig: CompanyConfig? = null
    private var activeAdminNotification: Notification? = null
    private var todayEmergencyAssignment: EmergencyAssignment? = null
    private var activeOvertimeAssignment: OvertimeAssignment? = null

    // Temp variables for face verification
    private var pendingAttendanceType: String = ""
    private var pendingLat: Double = 0.0
    private var pendingLng: Double = 0.0

    private val faceVerificationLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val selfieUrl = result.data?.getStringExtra("selfie_url")
            saveAttendanceToDatabase(pendingAttendanceType, pendingLat, pendingLng, selfieUrl)
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
            startBreakFlow()
        }

        btnCheckOut?.setOnClickListener {
            startPresensiFlow("check_out")
        }

        val btnEndBreakEarly = view?.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnEndBreakEarly)
        btnEndBreakEarly?.setOnClickListener {
            endBreakEarly()
        }

        val btnOvertimeIn = view?.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnOvertimeIn)
        btnOvertimeIn?.setOnClickListener {
            handleOvertimeIn()
        }

        val btnOvertimeOut = view?.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnOvertimeOut)
        btnOvertimeOut?.setOnClickListener {
            handleOvertimeOut()
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

                // 6. Fetch emergency assignment for today (lembur or ganti_off)
                val todayEmergencyList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("emergency_assignments")
                        .select {
                            filter {
                                eq("assigned_user_id", userId)
                                eq("target_date", todayStr)
                            }
                        }.decodeList<EmergencyAssignment>()
                }
                todayEmergencyAssignment = todayEmergencyList.firstOrNull { it.status == "pending" || it.status == "active" }
                    ?: todayEmergencyList.firstOrNull()

                // 7. Fetch active overtime assignment for today (untuk tombol overtime_in / overtime_out)
                val overtimeList = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("overtime_assignments")
                        .select {
                            filter {
                                eq("user_id", userId)
                                eq("assignment_date", todayStr)
                            }
                        }.decodeList<OvertimeAssignment>()
                }
                activeOvertimeAssignment = overtimeList.firstOrNull { it.status == "pending" || it.status == "active" }
                    ?: overtimeList.firstOrNull()

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

        val cardBreakCountdown = view.findViewById<androidx.cardview.widget.CardView>(R.id.cardBreakCountdown)
        val cardActionsPanel = view.findViewById<androidx.cardview.widget.CardView>(R.id.cardActionsPanel)

        // 1. Update Status Cards
        val att = todayAttendance
        if (att == null) {
            txtTodayStatus.text = "Status hari ini: Belum absen masuk"
            txtCheckInTime.text = "--"
            txtBreakTime.text = "--"
            txtCheckOutTime.text = "--"
            
            cardBreakCountdown?.visibility = View.GONE
            cardActionsPanel?.visibility = View.VISIBLE
            breakCountdownTimer?.cancel()
            breakCountdownTimer = null
        } else {
            txtCheckInTime.text = att.checkInTime?.substring(0, 5) ?: "--"
            txtBreakTime.text = formatTimestampToTime(att.breakStart)
            txtCheckOutTime.text = att.checkOutTime?.substring(0, 5) ?: "--"

            val isOnBreak = att.breakStart != null && att.breakEnd == null

            when {
                att.checkOutTime != null -> txtTodayStatus.text = "Status hari ini: Sudah pulang (${att.checkOutTime.substring(0, 5)})"
                isOnBreak -> txtTodayStatus.text = "Status hari ini: Sedang istirahat (${formatTimestampToTime(att.breakStart)})"
                att.breakEnd != null -> txtTodayStatus.text = "Status hari ini: Kembali bekerja (${formatTimestampToTime(att.breakEnd)})"
                else -> txtTodayStatus.text = "Status hari ini: Sudah absen masuk (${att.checkInTime?.substring(0, 5)})"
            }

            if (isOnBreak) {
                cardBreakCountdown?.visibility = View.VISIBLE
                cardActionsPanel?.visibility = View.GONE
                
                val breakStartDate = parseIsoTimestamp(att.breakStart)
                val elapsedSeconds = (System.currentTimeMillis() - breakStartDate.time) / 1000
                val remainingSeconds = 3600 - elapsedSeconds
                
                if (remainingSeconds > 0) {
                    startLocalCountdown(remainingSeconds, breakStartDate)
                } else {
                    endBreakAutomatically(att.id ?: "")
                }
            } else {
                cardBreakCountdown?.visibility = View.GONE
                cardActionsPanel?.visibility = View.VISIBLE
                breakCountdownTimer?.cancel()
                breakCountdownTimer = null
            }
        }

        // 2. Button Enablement Logic based on shift and database records
        val user = viewModel.uiState.value.user
        if (user != null) {
            val role = user.role
            val shiftType = user.shiftType

            // Check In Button
            val hasCheckedIn = att?.checkInTime != null
            val isCheckInWindow = ShiftHelper.isCheckInWindowActive(role, shiftType)
            val allowedCheckIn = !hasCheckedIn && isCheckInWindow && (!isOffToday || hasEmergencyAssignmentToday)
            
            btnCheckIn.isEnabled = allowedCheckIn
            btnCheckIn.alpha = if (allowedCheckIn) 1.0f else 0.5f

            // Break Button (Conditional based on field situation/TL, so it can be clicked anytime after check in)
            val hasCheckedInButNotBreak = hasCheckedIn && att?.breakStart == null
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

        // 5. Emergency / Lembur info card
        val cardEmergencyInfo = view.findViewById<androidx.cardview.widget.CardView>(R.id.cardEmergencyInfo)
        val txtEmergencyInfoContent = view.findViewById<android.widget.TextView>(R.id.txtEmergencyInfoContent)
        val btnOvertimeIn = view.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnOvertimeIn)
        val btnOvertimeOut = view.findViewById<com.google.android.material.button.MaterialButton>(R.id.btnOvertimeOut)

        val emergency = todayEmergencyAssignment
        if (emergency != null) {
            cardEmergencyInfo?.visibility = View.VISIBLE

            when (emergency.reason) {
                "lembur" -> {
                    when (emergency.status) {
                        "pending" -> {
                            txtEmergencyInfoContent?.text = "⚡ Anda ditugaskan lembur hari ini. Tekan tombol di bawah untuk mulai."
                            btnOvertimeIn?.visibility = View.VISIBLE
                            btnOvertimeOut?.visibility = View.GONE
                        }
                        "active" -> {
                            val startTime = emergency.overtimeIn?.substring(11, 16) ?: "--"
                            txtEmergencyInfoContent?.text = "⚡ Sedang lembur sejak $startTime. Tekan selesai jika sudah."
                            btnOvertimeIn?.visibility = View.GONE
                            btnOvertimeOut?.visibility = View.VISIBLE
                        }
                        "selesai" -> {
                            val startTime = emergency.overtimeIn?.substring(11, 16) ?: "--"
                            val endTime = emergency.overtimeOut?.substring(11, 16) ?: "--"
                            txtEmergencyInfoContent?.text = "✅ Lembur selesai. ($startTime - $endTime)"
                            btnOvertimeIn?.visibility = View.GONE
                            btnOvertimeOut?.visibility = View.GONE
                        }
                        else -> {
                            txtEmergencyInfoContent?.text = "⚡ Anda ditugaskan lembur hari ini."
                            btnOvertimeIn?.visibility = View.GONE
                            btnOvertimeOut?.visibility = View.GONE
                        }
                    }
                }
                "ganti_off" -> {
                    txtEmergencyInfoContent?.text = "🔄 Anda menggantikan karyawan lain hari ini (Ganti Off). Absen seperti biasa."
                    btnOvertimeIn?.visibility = View.GONE
                    btnOvertimeOut?.visibility = View.GONE
                }
                else -> {
                    txtEmergencyInfoContent?.text = "ℹ️ Ada penugasan khusus hari ini."
                    btnOvertimeIn?.visibility = View.GONE
                    btnOvertimeOut?.visibility = View.GONE
                }
            }
        } else {
            cardEmergencyInfo?.visibility = View.GONE
            btnOvertimeIn?.visibility = View.GONE
            btnOvertimeOut?.visibility = View.GONE
        }
    }

    private fun observeViewModel() {
        lifecycleScope.launch {
            viewModel.uiState.collectLatest { state ->
                val view = view ?: return@collectLatest
                
                // Update header text views
                val txtEmployeeName = view.findViewById<android.widget.TextView>(R.id.txtEmployeeName)
                val txtEmployeeRole = view.findViewById<android.widget.TextView>(R.id.txtEmployeeRole)
                val txtEmployeeNip = view.findViewById<android.widget.TextView>(R.id.txtEmployeeNip)
                val txtEmployeeShiftTime = view.findViewById<android.widget.TextView>(R.id.txtEmployeeShiftTime)

                state.user?.let { u ->
                    txtEmployeeName?.text = u.name
                    if (u.role.equals("superadmin", ignoreCase = true)) {
                        txtEmployeeRole?.text = u.role
                        txtEmployeeNip?.text = "NIP: N/A"
                        txtEmployeeShiftTime?.text = "(N/A - N/A)"
                    } else {
                        txtEmployeeRole?.text = "${u.position ?: u.role} - ${u.shiftType ?: "-"}"
                        txtEmployeeNip?.text = "NIP: ${u.nip ?: "-"}"
                        
                        val (masuk, pulang) = ShiftHelper.getShiftTimes(u.role, u.shiftType)
                        txtEmployeeShiftTime?.text = "($masuk - $pulang)"
                    }
                }
            }
        }
    }

    private fun startPresensiFlow(type: String) {
        if (type != "check_in") {
            checkLocationAndExecute(type)
            return
        }

        // QR Code is only required for check-in.
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(com.google.mlkit.vision.barcode.common.Barcode.FORMAT_QR_CODE)
            .build()
        val scanner = GmsBarcodeScanning.getClient(requireContext(), options)

        scanner.startScan()
            .addOnSuccessListener { barcode: com.google.mlkit.vision.barcode.common.Barcode ->
                val scannedValue = barcode.rawValue ?: ""
                validateAndProceedQR(scannedValue, type)
            }
            .addOnFailureListener { e: Exception ->
                Toast.makeText(requireContext(), "Gagal scan QR: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            }
    }

    private fun validateAndProceedQR(scannedValue: String, type: String) {
        lifecycleScope.launch {
            try {
                // 1. Parse JSON
                val json = try {
                    org.json.JSONObject(scannedValue)
                } catch (e: Exception) {
                    showQRError("QR Code yang di scan tidak benar. Silahkan hubungi admin.")
                    return@launch
                }

                val qrShiftId = json.optString("shift_id", "")
                val expiresAt = json.optString("expires_at", "")

                if (qrShiftId.isEmpty() || expiresAt.isEmpty()) {
                    showQRError("QR Code yang di scan tidak benar. Silahkan hubungi admin.")
                    return@launch
                }

                // 2. Cek expired
                try {
                    val formats = listOf(
                        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                        "yyyy-MM-dd'T'HH:mm:ss'Z'",
                        "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"
                    )
                    var expDate: java.util.Date? = null
                    for (fmt in formats) {
                        try {
                            val sdf = java.text.SimpleDateFormat(fmt, java.util.Locale.getDefault())
                            sdf.timeZone = java.util.TimeZone.getTimeZone("UTC")
                            expDate = sdf.parse(expiresAt)
                            if (expDate != null) break
                        } catch (e: Exception) { /* try next */ }
                    }
                    if (expDate != null && expDate.before(java.util.Date())) {
                        showQRError("QR Code sudah kadaluarsa. Silahkan minta admin untuk generate QR baru.")
                        return@launch
                    }
                } catch (e: Exception) {
                    showQRError("QR Code yang di scan tidak benar. Silahkan hubungi admin.")
                    return@launch
                }

                // 3. Cek apakah shift_id di QR sesuai dengan shift karyawan ini
                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id
                if (userId == null) {
                    showQRError("Sesi tidak valid. Silahkan login ulang.")
                    return@launch
                }

                val todayStr = run {
                    val user = viewModel.uiState.value.user
                    ShiftHelper.getAttendanceDate(user?.role ?: "", user?.shiftType)
                }

                // Ambil shift_id karyawan dari user_shifts hari ini
                val userShiftData = withContext(kotlinx.coroutines.Dispatchers.IO) {
                    try {
                        SupabaseClient.db.from("user_shifts")
                            .select {
                                filter {
                                    eq("user_id", userId)
                                    eq("effective_date", todayStr)
                                }
                                order("created_at", io.github.jan.supabase.postgrest.query.Order.DESCENDING)
                            }
                            .decodeList<Map<String, kotlinx.serialization.json.JsonElement>>()
                    } catch (e: Exception) {
                        emptyList()
                    }
                }

                val userShiftId = userShiftData.firstOrNull()
                    ?.get("shift_id")
                    ?.let {
                        if (it is kotlinx.serialization.json.JsonPrimitive && !it.isString.not()) it.content
                        else it.toString().trim('"')
                    }
                    ?: ""

                if (userShiftId.isEmpty()) {
                    // Karyawan tidak punya shift hari ini — cek apakah punya emergency assignment (ganti off/lembur)
                    val hasEmergency = hasEmergencyAssignmentToday
                    if (!hasEmergency) {
                        showQRError("Anda tidak memiliki jadwal shift hari ini.")
                        return@launch
                    }
                    // Emergency assignment: scan QR manapun yang valid dan belum expired boleh
                    checkLocationAndExecute(type)
                    return@launch
                }

                if (userShiftId != qrShiftId) {
                    showQRError("QR Code yang di scan tidak benar. Silahkan hubungi admin.")
                    return@launch
                }

                // Semua valid — lanjut ke GPS
                checkLocationAndExecute(type)

            } catch (e: Exception) {
                showQRError("Terjadi kesalahan saat memvalidasi QR. Coba lagi.")
            }
        }
    }

    private fun showQRError(message: String) {
        MaterialAlertDialogBuilder(requireContext())
            .setTitle("QR Code Tidak Valid")
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show()
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

    private fun saveAttendanceToDatabase(type: String, lat: Double, lng: Double, selfieUrl: String?) {
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
                                if (selfieUrl != null) {
                                    set("selfie_url", selfieUrl)
                                }
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
                                if (selfieUrl != null) {
                                    set("selfie_url", selfieUrl)
                                }
                            }) {
                                filter {
                                    eq("user_id", userId)
                                    eq("date", todayStr)
                                }
                            }
                        }
                        Toast.makeText(requireContext(), "Absen Pulang Berhasil. Selamat Beristirahat!", Toast.LENGTH_LONG).show()
                    }
                    "overtime_in" -> {
                        val overtimeId = activeOvertimeAssignment?.id ?: return@launch
                        withContext(Dispatchers.IO) {
                            SupabaseClient.db.from("overtime_assignments").update({
                                set("status", "active")
                                set("actual_start_time", nowStr)
                            }) {
                                filter { eq("id", overtimeId) }
                            }
                        }
                        Toast.makeText(requireContext(), "Mulai Lembur Berhasil!", Toast.LENGTH_LONG).show()
                    }
                    "overtime_out" -> {
                        val overtimeId = activeOvertimeAssignment?.id ?: return@launch
                        withContext(Dispatchers.IO) {
                            SupabaseClient.db.from("overtime_assignments").update({
                                set("status", "completed")
                                set("actual_end_time", nowStr)
                            }) {
                                filter { eq("id", overtimeId) }
                            }
                        }
                        Toast.makeText(requireContext(), "Lembur Selesai. Terima kasih!", Toast.LENGTH_LONG).show()
                    }
                }

                refreshDashboardData()
            } catch (e: Exception) {
                Toast.makeText(requireContext(), "Gagal absensi: ${e.localizedMessage}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun startBreakFlow() {
        val attId = todayAttendance?.id ?: return
        val nowStr = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ", Locale.getDefault()).format(Date())
        
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("attendance").update({
                        set("break_start", nowStr)
                    }) {
                        filter {
                            eq("id", attId)
                        }
                    }
                }
                Toast.makeText(requireContext(), "Istirahat Berhasil Dimulai!", Toast.LENGTH_SHORT).show()
                refreshDashboardData()
            } catch (e: Exception) {
                e.printStackTrace()
                Toast.makeText(requireContext(), "Gagal memulai istirahat: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun endBreakEarly() {
        val attId = todayAttendance?.id ?: return
        val nowStr = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ", Locale.getDefault()).format(Date())
        
        breakCountdownTimer?.cancel()
        breakCountdownTimer = null

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("attendance").update({
                        set("break_end", nowStr)
                    }) {
                        filter {
                            eq("id", attId)
                        }
                    }
                }
                Toast.makeText(requireContext(), "Kembali bekerja!", Toast.LENGTH_SHORT).show()
                refreshDashboardData()
            } catch (e: Exception) {
                e.printStackTrace()
                Toast.makeText(requireContext(), "Gagal menyelesaikan istirahat: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun handleOvertimeIn() {
        val emergencyId = todayEmergencyAssignment?.id ?: return
        val nowStr = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault()).format(Date())

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("emergency_assignments").update({
                        set("status", "active")
                        set("overtime_in", nowStr)
                    }) {
                        filter { eq("id", emergencyId) }
                    }
                }
                Toast.makeText(requireContext(), "Lembur dimulai! Semangat 💪", Toast.LENGTH_SHORT).show()
                refreshDashboardData()
            } catch (e: Exception) {
                Toast.makeText(requireContext(), "Gagal: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun handleOvertimeOut() {
        val emergencyId = todayEmergencyAssignment?.id ?: return
        val nowStr = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault()).format(Date())

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("emergency_assignments").update({
                        set("status", "selesai")
                        set("overtime_out", nowStr)
                    }) {
                        filter { eq("id", emergencyId) }
                    }
                }
                Toast.makeText(requireContext(), "Lembur selesai! Terima kasih 🙏", Toast.LENGTH_LONG).show()
                refreshDashboardData()
            } catch (e: Exception) {
                Toast.makeText(requireContext(), "Gagal: ${e.localizedMessage}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun endBreakAutomatically(attendanceId: String) {
        val nowStr = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ", Locale.getDefault()).format(Date())
        
        breakCountdownTimer?.cancel()
        breakCountdownTimer = null

        // Trigger vibration
        try {
            val vibrator = requireContext().getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(1000, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(1000)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("attendance").update({
                        set("break_end", nowStr)
                    }) {
                        filter {
                            eq("id", attendanceId)
                        }
                    }
                }
                Toast.makeText(requireContext(), "Waktu istirahat Anda telah berakhir!", Toast.LENGTH_LONG).show()
                refreshDashboardData()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun startLocalCountdown(remainingSeconds: Long, breakStartDate: Date) {
        val view = view ?: return
        val txtBreakCountdown = view.findViewById<android.widget.TextView>(R.id.txtBreakCountdown)
        val progressBreak = view.findViewById<android.widget.ProgressBar>(R.id.progressBreak)
        val txtBreakStart = view.findViewById<android.widget.TextView>(R.id.txtBreakStart)
        val txtBreakEnd = view.findViewById<android.widget.TextView>(R.id.txtBreakEnd)

        val timeFormat = SimpleDateFormat("HH:mm", Locale.getDefault())
        txtBreakStart?.text = "Mulai: ${timeFormat.format(breakStartDate)}"
        txtBreakEnd?.text = "Selesai: ${timeFormat.format(Date(breakStartDate.time + 3600 * 1000))}"

        breakCountdownTimer?.cancel()
        
        progressBreak?.max = 3600
        progressBreak?.progress = remainingSeconds.toInt()

        breakCountdownTimer = object : CountDownTimer(remainingSeconds * 1000, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                val secsLeft = millisUntilFinished / 1000
                val minutes = secsLeft / 60
                val secs = secsLeft % 60
                txtBreakCountdown?.text = String.format("%02dm %02ds", minutes, secs)
                progressBreak?.progress = secsLeft.toInt()
            }

            override fun onFinish() {
                txtBreakCountdown?.text = "00m 00s"
                progressBreak?.progress = 0
                val attId = todayAttendance?.id
                if (attId != null) {
                    endBreakAutomatically(attId)
                }
            }
        }.start()
    }

    private fun formatTimestampToTime(ts: String?): String {
        if (ts.isNullOrEmpty()) return "--"
        try {
            val formats = listOf(
                "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                "yyyy-MM-dd'T'HH:mm:ss.SSS",
                "yyyy-MM-dd'T'HH:mm:ss",
                "yyyy-MM-dd HH:mm:ss"
            )
            for (fmt in formats) {
                try {
                    val parser = SimpleDateFormat(fmt, Locale.getDefault())
                    if (ts.endsWith("Z")) {
                        parser.timeZone = TimeZone.getTimeZone("UTC")
                    }
                    val date = parser.parse(ts)
                    if (date != null) {
                        return SimpleDateFormat("HH:mm", Locale.getDefault()).format(date)
                    }
                } catch (e: Exception) {
                    // Try next
                }
            }
            if (ts.contains("T")) {
                val timePart = ts.substringAfter("T")
                if (timePart.length >= 5) {
                    return timePart.substring(0, 5)
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return "--"
    }

    private fun parseIsoTimestamp(ts: String?): Date {
        if (ts.isNullOrEmpty()) return Date()
        val formats = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSS",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd HH:mm:ss"
        )
        for (fmt in formats) {
            try {
                val parser = SimpleDateFormat(fmt, Locale.getDefault())
                if (ts.endsWith("Z")) {
                    parser.timeZone = TimeZone.getTimeZone("UTC")
                }
                val date = parser.parse(ts)
                if (date != null) return date
            } catch (e: Exception) {
                // Try next
            }
        }
        return Date()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        breakCountdownTimer?.cancel()
        breakCountdownTimer = null
        _binding = null
    }
}
