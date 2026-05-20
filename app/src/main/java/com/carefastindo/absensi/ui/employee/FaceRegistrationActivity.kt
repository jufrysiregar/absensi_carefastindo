package com.carefastindo.absensi.ui.employee

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.carefastindo.absensi.R
import com.carefastindo.absensi.data.model.UserFace
import com.carefastindo.absensi.data.remote.SupabaseClient
import com.carefastindo.absensi.utils.FaceImageUtils
import com.carefastindo.absensi.utils.FaceVerificationHelper
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.storage.storage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class FaceRegistrationActivity : AppCompatActivity() {

    private lateinit var viewFinder: PreviewView
    private lateinit var txtInstruction: TextView
    private lateinit var progressBar: ProgressBar

    private lateinit var cameraExecutor: ExecutorService
    private lateinit var faceVerificationHelper: FaceVerificationHelper
    private lateinit var faceDetector: com.google.mlkit.vision.face.FaceDetector

    private var isProcessing = false
    private var isRegistered = false
    private var frameCounter = 0

    enum class RegistrationStep { FRONT, LEFT, RIGHT, DONE }
    private var currentStep = RegistrationStep.FRONT
    private val capturedEmbeddings = mutableMapOf<RegistrationStep, FloatArray>()
    private val tempStepEmbeddings = mutableListOf<FloatArray>()
    private var isDelaying = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_face_camera)

        viewFinder = findViewById(R.id.viewFinder)
        txtInstruction = findViewById(R.id.txtInstruction)
        progressBar = findViewById(R.id.progressBar)

        cameraExecutor = Executors.newSingleThreadExecutor()
        faceVerificationHelper = FaceVerificationHelper(this)
        if (!faceVerificationHelper.isReady()) {
            Toast.makeText(this, "Model face recognition gagal dimuat. Pastikan file model tersedia.", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        val detectorOptions = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
            .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
            .build()
        faceDetector = FaceDetection.getClient(detectorOptions)

        if (allPermissionsGranted()) {
            startCamera()
        } else {
            ActivityCompat.requestPermissions(
                this, REQUIRED_PERMISSIONS, REQUEST_CODE_PERMISSIONS
            )
        }
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)

        cameraProviderFuture.addListener({
            val cameraProvider: ProcessCameraProvider = cameraProviderFuture.get()

            val preview = Preview.Builder()
                .build()
                .also {
                    it.setSurfaceProvider(viewFinder.surfaceProvider)
                }

            val imageAnalyzer = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also {
                    it.setAnalyzer(cameraExecutor) { imageProxy ->
                        processImageProxy(imageProxy)
                    }
                }

            val cameraSelector = CameraSelector.DEFAULT_FRONT_CAMERA

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    this, cameraSelector, preview, imageAnalyzer
                )
            } catch (exc: Exception) {
                Log.e("FaceRegistration", "Use case binding failed", exc)
            }

        }, ContextCompat.getMainExecutor(this))
    }

    @OptIn(ExperimentalGetImage::class)
    private fun processImageProxy(imageProxy: ImageProxy) {
        if (isProcessing || isRegistered) {
            imageProxy.close()
            return
        }

        frameCounter++
        // Frame skipping: Cukup ambil 1 frame untuk diproses setiap 10 frame
        if (frameCounter % 10 != 0) {
            imageProxy.close()
            return
        }

        // 1. Optimasi Gambar (Resize ke maks 480x360 sebelum deteksi & encoding)
        val bitmap = FaceImageUtils.imageProxyToBitmap(imageProxy)
        if (bitmap != null) {
            // Resize terlebih dahulu sebelum rotasi untuk menghemat CPU & Memori
            val maxDim = bitmap.width.coerceAtLeast(bitmap.height)
            val resizedBitmap = if (maxDim > 480) {
                val scale = 480f / maxDim
                val scaled = Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true)
                bitmap.recycle()
                scaled
            } else {
                bitmap
            }

            val rotatedBitmap = FaceImageUtils.rotateBitmap(resizedBitmap, imageProxy.imageInfo.rotationDegrees.toFloat())
            if (rotatedBitmap != resizedBitmap) {
                resizedBitmap.recycle()
            }

            val image = InputImage.fromBitmap(rotatedBitmap, 0) // Gambar sudah terputar!

            faceDetector.process(image)
                .addOnSuccessListener { faces ->

                    if (faces.isNotEmpty() && !isProcessing && !isDelaying && currentStep != RegistrationStep.DONE) {
                        // Ambil wajah dengan ukuran paling besar (mengabaikan false positive di background)
                        val face = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() } ?: faces[0]
                        val boundingBox = face.boundingBox

                        // 2. Validasi Ukuran Wajah (Minimal 18% dari lebar/tinggi frame)
                        val frameMinDim = image.width.coerceAtMost(image.height)
                        val faceMinDim = boundingBox.width().coerceAtMost(boundingBox.height())
                        val minFaceSize = (frameMinDim * 0.18).toInt()

                        if (faceMinDim < minFaceSize) {
                            runOnUiThread {
                                txtInstruction.text = "Wajah terlalu jauh, mohon dekatkan ke kamera"
                            }
                            return@addOnSuccessListener
                        }

                        val stepProgressText = when (currentStep) {
                            RegistrationStep.FRONT -> "Langkah 1 dari 3: Ambil wajah tampak depan"
                            RegistrationStep.LEFT -> "Langkah 2 dari 3: Tolehkan wajah sedikit ke Kiri"
                            RegistrationStep.RIGHT -> "Langkah 3 dari 3: Tolehkan wajah sedikit ke Kanan"
                            else -> ""
                        }

                        // 3. Validasi Pose Wajah berdasarkan currentStep (headEulerAngleY)
                        val headEulerAngleY = face.headEulerAngleY
                        val isPoseValid = when (currentStep) {
                            RegistrationStep.FRONT -> {
                                if (headEulerAngleY < -12f || headEulerAngleY > 12f) {
                                    runOnUiThread { txtInstruction.text = "$stepProgressText\n(posisi wajah miring, tatap lurus ke depan)" }
                                    false
                                } else {
                                    true
                                }
                            }
                            RegistrationStep.LEFT -> {
                                if (headEulerAngleY >= -12f) {
                                    runOnUiThread { txtInstruction.text = stepProgressText }
                                    false
                                } else {
                                    true
                                }
                            }
                            RegistrationStep.RIGHT -> {
                                if (headEulerAngleY <= 12f) {
                                    runOnUiThread { txtInstruction.text = stepProgressText }
                                    false
                                } else {
                                    true
                                }
                            }
                            else -> false
                        }

                        if (!isPoseValid) {
                            return@addOnSuccessListener
                        }

                        isProcessing = true
                        
                        try {
                            val faceBitmap = FaceImageUtils.cropFaceBitmap(rotatedBitmap, boundingBox)
                            if (faceBitmap == null) {
                                runOnUiThread {
                                    txtInstruction.text = "Posisikan wajah lebih pas di dalam kotak"
                                }
                                isProcessing = false
                                return@addOnSuccessListener
                            }

                            val embedding = faceVerificationHelper.extractEmbedding(faceBitmap)

                            if (embedding != null) {
                                tempStepEmbeddings.add(embedding)
                                val stepName = when (currentStep) {
                                    RegistrationStep.FRONT -> "Depan"
                                    RegistrationStep.LEFT -> "Kiri"
                                    RegistrationStep.RIGHT -> "Kanan"
                                    else -> ""
                                }

                                if (tempStepEmbeddings.size < 3) {
                                    runOnUiThread {
                                        txtInstruction.text = "$stepProgressText\n(Mengambil data wajah $stepName: ${tempStepEmbeddings.size}/3)..."
                                    }
                                    faceBitmap.recycle()
                                    // Pacing: Beri jeda kecil agar frame selanjutnya bervariasi sedikit
                                    lifecycleScope.launch {
                                        kotlinx.coroutines.delay(100)
                                        isProcessing = false
                                    }
                                } else {
                                    val averaged = faceVerificationHelper.averageEmbeddings(tempStepEmbeddings)
                                    if (averaged != null) {
                                        capturedEmbeddings[currentStep] = averaged
                                        tempStepEmbeddings.clear()
                                        moveToNextStep(faceBitmap)
                                    } else {
                                        tempStepEmbeddings.clear()
                                        faceBitmap.recycle()
                                        isProcessing = false
                                    }
                                }
                            } else {
                                faceBitmap.recycle()
                                isProcessing = false
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                            isProcessing = false
                        }
                    } else if (!isProcessing && !isDelaying) {
                        // instruction
                        runOnUiThread {
                            val msg = when(currentStep) {
                                RegistrationStep.FRONT -> "Langkah 1 dari 3: Ambil wajah tampak depan"
                                RegistrationStep.LEFT -> "Langkah 2 dari 3: Tolehkan wajah sedikit ke Kiri"
                                RegistrationStep.RIGHT -> "Langkah 3 dari 3: Tolehkan wajah sedikit ke Kanan"
                                else -> ""
                            }
                            if (faces.isEmpty()) txtInstruction.text = "Tidak ada wajah terdeteksi\n$msg"
                            else txtInstruction.text = msg
                        }
                    }
                }
                .addOnFailureListener { e ->
                    Log.e("FaceRegistration", "Gagal deteksi wajah: ${e.message}", e)
                }
                .addOnCompleteListener {
                    if (!rotatedBitmap.isRecycled) {
                        rotatedBitmap.recycle()
                    }
                    imageProxy.close()
                }
        } else {
            imageProxy.close()
        }
    }
 
    private fun moveToNextStep(lastBitmap: Bitmap) {
        runOnUiThread {
            progressBar.visibility = View.VISIBLE
            txtInstruction.text = "Memproses wajah..."
        }
        lifecycleScope.launch {
            // Beri jeda loading singkat agar user melihat proses pengolahan wajah (animasi loading)
            kotlinx.coroutines.delay(1000)

            when (currentStep) {
                RegistrationStep.FRONT -> {
                    currentStep = RegistrationStep.LEFT
                    isDelaying = true
                    lastBitmap.recycle()
                    runOnUiThread {
                        progressBar.visibility = View.GONE
                        txtInstruction.text = "Wajah depan berhasil direkam!\nLangkah 2 dari 3: Tolehkan wajah sedikit ke Kiri"
                    }
                    kotlinx.coroutines.delay(2000)
                    isDelaying = false
                    isProcessing = false
                }
                RegistrationStep.LEFT -> {
                    currentStep = RegistrationStep.RIGHT
                    isDelaying = true
                    lastBitmap.recycle()
                    runOnUiThread {
                        progressBar.visibility = View.GONE
                        txtInstruction.text = "Wajah kiri berhasil direkam!\nLangkah 3 dari 3: Tolehkan wajah sedikit ke Kanan"
                    }
                    kotlinx.coroutines.delay(2000)
                    isDelaying = false
                    isProcessing = false
                }
                RegistrationStep.RIGHT -> {
                    currentStep = RegistrationStep.DONE
                    runOnUiThread {
                        txtInstruction.text = "Wajah kanan berhasil direkam!\nMenyimpan data wajah..."
                    }
                    registerFaces(lastBitmap)
                }
                RegistrationStep.DONE -> {}
            }
        }
    }

    private fun registerFaces(faceBitmap: Bitmap) {
        runOnUiThread {
            progressBar.visibility = View.VISIBLE
            txtInstruction.text = "Memproses pendaftaran wajah (3 sisi)..."
        }

        lifecycleScope.launch {
            try {
                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id
                    ?: throw IllegalStateException("Sesi login tidak ditemukan")

                val requiredSteps = listOf(RegistrationStep.FRONT, RegistrationStep.LEFT, RegistrationStep.RIGHT)
                val embeddings = requiredSteps.map { step ->
                    capturedEmbeddings[step]
                        ?: throw IllegalStateException("Data wajah belum lengkap. Silakan ulangi registrasi.")
                }

                val finalEmbedding = faceVerificationHelper.averageEmbeddings(embeddings)
                    ?: throw IllegalStateException("Data wajah tidak valid. Silakan ulangi registrasi.")
                val photoUrl = uploadReferencePhoto(userId, faceBitmap)

                withContext(Dispatchers.IO) {
                    val existingFaces = SupabaseClient.db.from("user_faces")
                        .select { filter { eq("user_id", userId) } }
                        .decodeList<UserFace>()
                    val faceRecord = UserFace(
                        userId = userId,
                        faceVector = embeddingToJson(finalEmbedding),
                        facePhotoUrl = photoUrl ?: existingFaces.firstOrNull()?.facePhotoUrl
                    )

                    if (existingFaces.isNotEmpty()) {
                        SupabaseClient.db.from("user_faces").update(faceRecord) {
                            filter { eq("user_id", userId) }
                        }
                    } else {
                        SupabaseClient.db.from("user_faces").insert(faceRecord)
                    }
                }

                withContext(Dispatchers.Main) {
                    isRegistered = true
                    Toast.makeText(this@FaceRegistrationActivity, "Wajah berhasil didaftarkan (3 Sisi)!", Toast.LENGTH_LONG).show()
                    finish()
                }

            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@FaceRegistrationActivity, "Gagal mendaftar wajah: ${e.message}", Toast.LENGTH_LONG).show()
                    isProcessing = false
                    currentStep = RegistrationStep.FRONT
                    capturedEmbeddings.clear()
                    tempStepEmbeddings.clear()
                    progressBar.visibility = View.GONE
                    txtInstruction.text = "Registrasi gagal. Posisikan wajah Anda di dalam kotak dan coba lagi."
                }
            } finally {
                if (!faceBitmap.isRecycled) {
                    faceBitmap.recycle()
                }
            }
        }
    }

    private fun embeddingToJson(embedding: FloatArray): String {
        val jsonArray = JSONArray()
        for (value in embedding) {
            jsonArray.put(value.toDouble())
        }
        return jsonArray.toString()
    }

    private suspend fun uploadReferencePhoto(userId: String, faceBitmap: Bitmap): String? {
        return try {
            val baos = ByteArrayOutputStream()
            faceBitmap.compress(Bitmap.CompressFormat.JPEG, 90, baos)
            val byteArray = baos.toByteArray()
            val photoPath = "$userId/${System.currentTimeMillis()}_face.jpg"

            withContext(Dispatchers.IO) {
                SupabaseClient.storage.from("face_photos").upload(photoPath, byteArray) {
                    upsert = true
                }
            }

            SupabaseClient.storage.from("face_photos").publicUrl(photoPath)
        } catch (e: Exception) {
            Log.w("FaceRegistration", "Foto referensi wajah tidak tersimpan, registrasi tetap dilanjutkan", e)
            null
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_CODE_PERMISSIONS && allPermissionsGranted()) {
            startCamera()
        } else if (requestCode == REQUEST_CODE_PERMISSIONS) {
            Toast.makeText(this, "Izin kamera diperlukan untuk registrasi wajah.", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun allPermissionsGranted() = REQUIRED_PERMISSIONS.all {
        ContextCompat.checkSelfPermission(baseContext, it) == PackageManager.PERMISSION_GRANTED
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::cameraExecutor.isInitialized) {
            cameraExecutor.shutdown()
        }
        if (::faceVerificationHelper.isInitialized) {
            faceVerificationHelper.close()
        }
        try {
            if (::faceDetector.isInitialized) {
                faceDetector.close()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    companion object {
        private const val REQUEST_CODE_PERMISSIONS = 10
        private val REQUIRED_PERMISSIONS = arrayOf(Manifest.permission.CAMERA)
    }
}
