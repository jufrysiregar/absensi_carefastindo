package com.carefastindo.absensi.ui.employee

import android.Manifest
import android.content.Intent
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

class FaceVerificationActivity : AppCompatActivity() {

    private lateinit var viewFinder: PreviewView
    private lateinit var txtInstruction: TextView
    private lateinit var progressBar: ProgressBar

    private lateinit var cameraExecutor: ExecutorService
    private lateinit var faceVerificationHelper: FaceVerificationHelper
    private lateinit var faceDetector: com.google.mlkit.vision.face.FaceDetector
    
    private var isProcessing = false
    private var baseFaceVectors: List<FloatArray> = emptyList()
    private var consecutiveMatchCount = 0
    private var frameCounter = 0

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
            setResult(RESULT_CANCELED)
            finish()
            return
        }

        val detectorOptions = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
            .build()
        faceDetector = FaceDetection.getClient(detectorOptions)

        loadBaseFaceVector()

        if (allPermissionsGranted()) {
            startCamera()
        } else {
            ActivityCompat.requestPermissions(
                this, REQUIRED_PERMISSIONS, REQUEST_CODE_PERMISSIONS
            )
        }
    }

    private fun loadBaseFaceVector() {
        lifecycleScope.launch {
            try {
                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id
                    ?: throw IllegalStateException("Sesi login tidak ditemukan")
                val userFaces = withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("user_faces")
                        .select { filter { eq("user_id", userId) } }
                        .decodeList<UserFace>()
                }

                if (userFaces.isNotEmpty()) {
                    val vectors = mutableListOf<FloatArray>()
                    for (face in userFaces) {
                        val vectorStr = face.faceVector
                        val jsonArray = JSONArray(vectorStr)
                        val floatArray = FloatArray(jsonArray.length())
                        for (i in 0 until jsonArray.length()) {
                            floatArray[i] = jsonArray.getDouble(i).toFloat()
                        }
                        vectors.add(floatArray)
                    }
                    baseFaceVectors = vectors
                } else {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@FaceVerificationActivity, "Wajah belum didaftarkan! Silakan daftar wajah di Profil terlebih dahulu.", Toast.LENGTH_LONG).show()
                        setResult(RESULT_CANCELED)
                        finish()
                    }
                }
            } catch (e: Exception) {
                Log.e("FaceVerification", "Gagal memuat data wajah", e)
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@FaceVerificationActivity, "Gagal memuat data wajah: ${e.message}", Toast.LENGTH_LONG).show()
                    setResult(RESULT_CANCELED)
                    finish()
                }
            }
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
                Log.e("FaceVerification", "Use case binding failed", exc)
            }

        }, ContextCompat.getMainExecutor(this))
    }

    @OptIn(ExperimentalGetImage::class)
    private fun processImageProxy(imageProxy: ImageProxy) {
        if (isProcessing || baseFaceVectors.isEmpty()) {
            imageProxy.close()
            return
        }

        frameCounter++
        // Frame skipping: Hanya proses 1 dari 3 frame agar tidak berat/ngelag
        if (frameCounter % 3 != 0) {
            imageProxy.close()
            return
        }

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
                    if (faces.isNotEmpty() && !isProcessing) {
                        // Ambil wajah dengan ukuran paling besar (mengabaikan false positive di background)
                        val face = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() } ?: faces[0]
                        val boundingBox = face.boundingBox

                        // 1. Validasi Ukuran Wajah (Minimal 18% dari lebar/tinggi frame)
                        val frameMinDim = image.width.coerceAtMost(image.height)
                        val faceMinDim = boundingBox.width().coerceAtMost(boundingBox.height())
                        val minFaceSize = (frameMinDim * 0.18).toInt()

                        if (faceMinDim < minFaceSize) {
                            consecutiveMatchCount = 0
                            runOnUiThread {
                                txtInstruction.text = "Wajah terlalu jauh, mohon dekatkan ke kamera"
                            }
                            return@addOnSuccessListener
                        }

                        isProcessing = true

                        try {
                            val faceBitmap = FaceImageUtils.cropFaceBitmap(rotatedBitmap, boundingBox)
                            if (faceBitmap == null) {
                                consecutiveMatchCount = 0
                                runOnUiThread {
                                    txtInstruction.text = "Posisikan wajah lebih pas di dalam kotak"
                                }
                                isProcessing = false
                                return@addOnSuccessListener
                            }

                            val embedding = faceVerificationHelper.extractEmbedding(faceBitmap)

                            if (embedding != null && baseFaceVectors.isNotEmpty()) {
                                var maxSimilarity = -1f
                                for (baseVector in baseFaceVectors) {
                                    val sim = faceVerificationHelper.cosineSimilarity(embedding, baseVector)
                                    if (sim > maxSimilarity) maxSimilarity = sim
                                }

                                Log.d("FaceVerification", "Max Similarity: $maxSimilarity")

                                val similarityPercent = "%.0f".format(maxSimilarity * 100)

                                if (maxSimilarity > 0.55f) {
                                    consecutiveMatchCount++
                                    if (consecutiveMatchCount >= 3) {
                                        // Wajah Cocok & Konsisten
                                        uploadSelfieAndFinish(faceBitmap)
                                    } else {
                                        runOnUiThread {
                                            txtInstruction.text = "Mencocokkan wajah... (${consecutiveMatchCount}/3) - $similarityPercent%"
                                        }
                                        faceBitmap.recycle()
                                        isProcessing = false
                                    }
                                } else {
                                    // Wajah Tidak Cocok
                                    consecutiveMatchCount = 0
                                    runOnUiThread {
                                        txtInstruction.text = "Wajah belum cocok ($similarityPercent%). Pastikan wajah Anda pas di dalam kotak & pencahayaan cukup."
                                    }
                                    faceBitmap.recycle()
                                    isProcessing = false
                                }
                            } else {
                                faceBitmap.recycle()
                                isProcessing = false
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                            isProcessing = false
                        }
                    } else if (!isProcessing) {
                        consecutiveMatchCount = 0
                        runOnUiThread {
                            if (faces.isEmpty()) txtInstruction.text = "Tidak ada wajah terdeteksi"
                        }
                    }
                }
                .addOnFailureListener { e ->
                    Log.e("FaceVerification", "Gagal deteksi wajah: ${e.message}", e)
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

    private fun uploadSelfieAndFinish(faceBitmap: Bitmap) {
        runOnUiThread {
            progressBar.visibility = View.VISIBLE
            txtInstruction.text = "Wajah terverifikasi! Menyimpan absensi..."
        }

        lifecycleScope.launch {
            try {
                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id
                    ?: throw IllegalStateException("Sesi login tidak ditemukan")
                val photoUrl = uploadAttendanceSelfie(userId, faceBitmap)
                
                withContext(Dispatchers.Main) {
                    val resultIntent = Intent()
                    if (photoUrl != null) {
                        resultIntent.putExtra("selfie_url", photoUrl)
                    }
                    setResult(RESULT_OK, resultIntent)
                    finish()
                }

            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@FaceVerificationActivity, "Gagal verifikasi wajah: ${e.message}", Toast.LENGTH_LONG).show()
                    isProcessing = false
                    progressBar.visibility = View.GONE
                }
            } finally {
                if (!faceBitmap.isRecycled) {
                    faceBitmap.recycle()
                }
            }
        }
    }

    private suspend fun uploadAttendanceSelfie(userId: String, faceBitmap: Bitmap): String? {
        return try {
            val baos = ByteArrayOutputStream()
            faceBitmap.compress(Bitmap.CompressFormat.JPEG, 90, baos)
            val byteArray = baos.toByteArray()
            val photoPath = "$userId/${System.currentTimeMillis()}_selfie.jpg"

            withContext(Dispatchers.IO) {
                SupabaseClient.storage.from("attendance-selfies").upload(photoPath, byteArray) {
                    upsert = true
                }
            }

            SupabaseClient.storage.from("attendance-selfies").publicUrl(photoPath)
        } catch (e: Exception) {
            Log.w("FaceVerification", "Selfie absensi tidak tersimpan, absensi tetap dilanjutkan", e)
            null
        }
    }

    private fun allPermissionsGranted() = REQUIRED_PERMISSIONS.all {
        ContextCompat.checkSelfPermission(baseContext, it) == PackageManager.PERMISSION_GRANTED
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
            Toast.makeText(this, "Izin kamera diperlukan untuk verifikasi wajah.", Toast.LENGTH_LONG).show()
            setResult(RESULT_CANCELED)
            finish()
        }
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
