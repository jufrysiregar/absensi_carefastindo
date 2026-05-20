package com.carefastindo.absensi.utils

import android.content.Context
import android.graphics.Bitmap
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import kotlin.math.sqrt

class FaceVerificationHelper(context: Context) {
    private var interpreter: Interpreter? = null
    
    // Model input is typically 112x112, 3 channels (RGB) for MobileFaceNet
    private val inputSize = 112
    private val embeddingSize = 192 // MobileFaceNet outputs a 192-dimensional vector

    init {
        try {
            val assetFileDescriptor = context.assets.openFd("mobilefacenet.tflite")
            val fileInputStream = FileInputStream(assetFileDescriptor.fileDescriptor)
            val fileChannel = fileInputStream.channel
            val startOffset = assetFileDescriptor.startOffset
            val declaredLength = assetFileDescriptor.declaredLength
            val mappedByteBuffer = fileChannel.map(FileChannel.MapMode.READ_ONLY, startOffset, declaredLength)
            
            val options = Interpreter.Options()
            options.numThreads = 4
            interpreter = Interpreter(mappedByteBuffer, options)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun extractEmbedding(faceBitmap: Bitmap): FloatArray? {
        val interp = interpreter ?: return null

        val resizedBitmap = Bitmap.createScaledBitmap(faceBitmap, inputSize, inputSize, true)
        val inputBuffer = ByteBuffer.allocateDirect(1 * inputSize * inputSize * 3 * 4) // 1 batch * 112 * 112 * 3 channels * 4 bytes(float)
        inputBuffer.order(ByteOrder.nativeOrder())

        val intValues = IntArray(inputSize * inputSize)
        resizedBitmap.getPixels(intValues, 0, resizedBitmap.width, 0, 0, resizedBitmap.width, resizedBitmap.height)

        // Normalize depending on the model (Usually (val - 127.5)/128 or (val-128)/128)
        var pixel = 0
        for (i in 0 until inputSize) {
            for (j in 0 until inputSize) {
                val value = intValues[pixel++]
                inputBuffer.putFloat(((value shr 16 and 0xFF) - 127.5f) / 128f)
                inputBuffer.putFloat(((value shr 8 and 0xFF) - 127.5f) / 128f)
                inputBuffer.putFloat(((value and 0xFF) - 127.5f) / 128f)
            }
        }

        val outputBuffer = Array(1) { FloatArray(embeddingSize) }
        interp.run(inputBuffer, outputBuffer)

        return l2Normalize(outputBuffer[0])
    }

    private fun l2Normalize(embeddings: FloatArray): FloatArray {
        var sum = 0.0f
        for (f in embeddings) {
            sum += f * f
        }
        val norm = sqrt(sum.toDouble()).toFloat()
        for (i in embeddings.indices) {
            embeddings[i] /= norm
        }
        return embeddings
    }

    fun cosineSimilarity(vector1: FloatArray, vector2: FloatArray): Float {
        if (vector1.size != vector2.size) return 0f
        var dotProduct = 0f
        var normA = 0f
        var normB = 0f
        for (i in vector1.indices) {
            dotProduct += vector1[i] * vector2[i]
            normA += vector1[i] * vector1[i]
            normB += vector2[i] * vector2[i]
        }
        return if (normA == 0f || normB == 0f) 0f else (dotProduct / (sqrt(normA.toDouble()) * sqrt(normB.toDouble()))).toFloat()
    }
    
    fun close() {
        interpreter?.close()
        interpreter = null
    }
}
