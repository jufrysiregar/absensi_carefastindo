package com.carefastindo.absensi.ui.employee

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
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

    private var isProcessing = false
    private var isRegistered = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_face_camera)

        viewFinder = findViewById(R.id.viewFinder)
        txtInstruction = findViewById(R.id.txtInstruction)
        progressBar = findViewById(R.id.progressBar)

        faceVerificationHelper = FaceVerificationHelper(this)
        cameraExecutor = Executors.newSingleThreadExecutor()

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

        val mediaImage = imageProxy.image
        if (mediaImage != null) {
            val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
            val options = FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .build()
            val detector = FaceDetection.getClient(options)

            detector.process(image)
                .addOnSuccessListener { faces ->
                    if (faces.isNotEmpty() && !isProcessing) {
                        isProcessing = true
                        // Ambil wajah dengan ukuran paling besar (mengabaikan false positive di background)
                        val face = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() } ?: faces[0]
                        val boundingBox = face.boundingBox

                        // Extract face bitmap
                        val bitmap = imageProxyToBitmap(imageProxy)
                        if (bitmap != null) {
                            val rotatedBitmap = rotateBitmap(bitmap, imageProxy.imageInfo.rotationDegrees.toFloat())
                            // Adjust bounding box to rotated bitmap
                            // Note: mlkit bounding box is relative to unrotated image depending on configuration,
                            // but InputImage handles rotation. Let's crop center roughly or use boundingBox carefully.
                            
                            try {
                                // Clamp bounding box
                                val left = boundingBox.left.coerceAtLeast(0)
                                val top = boundingBox.top.coerceAtLeast(0)
                                val width = boundingBox.width().coerceAtMost(rotatedBitmap.width - left)
                                val height = boundingBox.height().coerceAtMost(rotatedBitmap.height - top)
                                
                                val faceBitmap = Bitmap.createBitmap(rotatedBitmap, left, top, width, height)
                                val embedding = faceVerificationHelper.extractEmbedding(faceBitmap)

                                if (embedding != null) {
                                    registerFace(embedding, faceBitmap)
                                } else {
                                    isProcessing = false
                                }
                            } catch (e: Exception) {
                                e.printStackTrace()
                                isProcessing = false
                            }
                        } else {
                            isProcessing = false
                        }
                    } else if (!isProcessing) {
                        // instruction
                        runOnUiThread {
                            if (faces.isEmpty()) txtInstruction.text = "Tidak ada wajah terdeteksi"
                        }
                    }
                }
                .addOnFailureListener {
                    // error
                }
                .addOnCompleteListener {
                    imageProxy.close()
                }
        } else {
            imageProxy.close()
        }
    }

    private fun registerFace(embedding: FloatArray, faceBitmap: Bitmap) {
        runOnUiThread {
            progressBar.visibility = View.VISIBLE
            txtInstruction.text = "Memproses pendaftaran wajah..."
        }

        lifecycleScope.launch {
            try {
                val userId = SupabaseClient.auth.currentSessionOrNull()?.user?.id ?: return@launch
                
                // Convert bitmap to byte array
                val baos = ByteArrayOutputStream()
                faceBitmap.compress(Bitmap.CompressFormat.JPEG, 90, baos)
                val byteArray = baos.toByteArray()
                
                // Upload photo
                val timestamp = System.currentTimeMillis()
                val photoPath = "$userId/${timestamp}_face.jpg"
                
                withContext(Dispatchers.IO) {
                    SupabaseClient.storage.from("face_photos").upload(photoPath, byteArray) {
                        upsert = true
                    }
                }
                
                val photoUrl = SupabaseClient.storage.from("face_photos").publicUrl(photoPath)
                
                // Convert embedding to JSON String
                val jsonArray = JSONArray()
                for (f in embedding) {
                    jsonArray.put(f.toDouble())
                }
                val embeddingStr = jsonArray.toString()
                
                val userFace = UserFace(userId = userId, faceVector = embeddingStr, facePhotoUrl = photoUrl)
                
                withContext(Dispatchers.IO) {
                    SupabaseClient.db.from("user_faces").insert(userFace)
                }

                withContext(Dispatchers.Main) {
                    isRegistered = true
                    Toast.makeText(this@FaceRegistrationActivity, "Wajah berhasil didaftarkan!", Toast.LENGTH_LONG).show()
                    finish()
                }

            } catch (e: Exception) {
                e.printStackTrace()
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@FaceRegistrationActivity, "Gagal mendaftar wajah: ${e.message}", Toast.LENGTH_LONG).show()
                    isProcessing = false
                    progressBar.visibility = View.GONE
                }
            }
        }
    }

    private fun imageProxyToBitmap(image: ImageProxy): Bitmap? {
        val yBuffer = image.planes[0].buffer
        val uBuffer = image.planes[1].buffer
        val vBuffer = image.planes[2].buffer

        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()

        val nv21 = ByteArray(ySize + uSize + vSize)

        yBuffer.get(nv21, 0, ySize)
        vBuffer.get(nv21, ySize, vSize)
        uBuffer.get(nv21, ySize + vSize, uSize)

        val yuvImage = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
        val out = ByteArrayOutputStream()
        yuvImage.compressToJpeg(Rect(0, 0, yuvImage.width, yuvImage.height), 100, out)
        val imageBytes = out.toByteArray()
        return BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
    }

    private fun rotateBitmap(bitmap: Bitmap, degrees: Float): Bitmap {
        val matrix = Matrix()
        matrix.postRotate(degrees)
        // Adjust for front camera mirror effect
        matrix.postScale(-1f, 1f, bitmap.width / 2f, bitmap.height / 2f)
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    private fun allPermissionsGranted() = REQUIRED_PERMISSIONS.all {
        ContextCompat.checkSelfPermission(baseContext, it) == PackageManager.PERMISSION_GRANTED
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
        faceVerificationHelper.close()
    }

    companion object {
        private const val REQUEST_CODE_PERMISSIONS = 10
        private val REQUIRED_PERMISSIONS = arrayOf(Manifest.permission.CAMERA)
    }
}
