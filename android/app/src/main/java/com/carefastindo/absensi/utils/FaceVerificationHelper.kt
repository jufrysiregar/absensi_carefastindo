package com.carefastindo.absensi.utils

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt

class FaceVerificationHelper(context: Context) {
    private var interpreter: Interpreter? = null
    private var modelBuffer: ByteBuffer? = null
    private var inputSize = 112
    private var embeddingSize = 192
    private var inputDataType = DataType.FLOAT32

    init {
        try {
            val modelBytes = context.assets.open("mobilefacenet.tflite").use { it.readBytes() }
            val modelBuffer = ByteBuffer.allocateDirect(modelBytes.size)
            modelBuffer.order(ByteOrder.nativeOrder())
            modelBuffer.put(modelBytes)
            modelBuffer.rewind()
            this.modelBuffer = modelBuffer
            
            val options = Interpreter.Options()
            options.numThreads = 4
            interpreter = Interpreter(modelBuffer, options)

            interpreter?.let { interp ->
                val inputTensor = interp.getInputTensor(0)
                val inputShape = inputTensor.shape()
                val spatialInputSize = inputShape
                    .filter { it > 1 && it != 3 }
                    .firstOrNull()
                if (spatialInputSize != null) {
                    inputSize = spatialInputSize
                }
                inputDataType = inputTensor.dataType()

                val outputShape = interp.getOutputTensor(0).shape()
                embeddingSize = outputShape.filter { it > 1 }.maxOrNull() ?: embeddingSize
            }
        } catch (e: Exception) {
            Log.e(TAG, "Gagal memuat model face recognition", e)
        }
    }

    fun isReady(): Boolean = interpreter != null

    fun extractEmbedding(faceBitmap: Bitmap): FloatArray? {
        val interp = interpreter ?: return null

        return try {
            val resizedBitmap = Bitmap.createScaledBitmap(faceBitmap, inputSize, inputSize, true)
            val inputBuffer = when (inputDataType) {
                DataType.UINT8 -> ByteBuffer.allocateDirect(1 * inputSize * inputSize * 3)
                else -> ByteBuffer.allocateDirect(1 * inputSize * inputSize * 3 * 4)
            }
            inputBuffer.order(ByteOrder.nativeOrder())

            val intValues = IntArray(inputSize * inputSize)
            resizedBitmap.getPixels(intValues, 0, resizedBitmap.width, 0, 0, resizedBitmap.width, resizedBitmap.height)

            var pixel = 0
            for (i in 0 until inputSize) {
                for (j in 0 until inputSize) {
                    val value = intValues[pixel++]
                    val r = value shr 16 and 0xFF
                    val g = value shr 8 and 0xFF
                    val b = value and 0xFF

                    if (inputDataType == DataType.UINT8) {
                        inputBuffer.put(r.toByte())
                        inputBuffer.put(g.toByte())
                        inputBuffer.put(b.toByte())
                    } else {
                        inputBuffer.putFloat((r - 127.5f) / 128f)
                        inputBuffer.putFloat((g - 127.5f) / 128f)
                        inputBuffer.putFloat((b - 127.5f) / 128f)
                    }
                }
            }
            inputBuffer.rewind()

            val outputBuffer = Array(1) { FloatArray(embeddingSize) }
            interp.run(inputBuffer, outputBuffer)

            if (resizedBitmap != faceBitmap) {
                resizedBitmap.recycle()
            }

            l2Normalize(outputBuffer[0])
        } catch (e: Exception) {
            Log.e(TAG, "Gagal mengekstrak embedding wajah", e)
            null
        }
    }

    private fun l2Normalize(embeddings: FloatArray): FloatArray {
        var sum = 0.0f
        for (f in embeddings) {
            sum += f * f
        }
        val norm = sqrt(sum.toDouble()).toFloat()
        if (norm == 0f) return embeddings
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

    fun averageEmbeddings(embeddingsList: List<FloatArray>): FloatArray? {
        if (embeddingsList.isEmpty()) return null
        val numFeatures = embeddingsList[0].size
        val average = FloatArray(numFeatures)
        for (embeddings in embeddingsList) {
            if (embeddings.size != numFeatures) return null
            for (i in 0 until numFeatures) {
                average[i] += embeddings[i]
            }
        }
        for (i in 0 until numFeatures) {
            average[i] /= embeddingsList.size
        }
        return l2Normalize(average)
    }

    fun close() {
        interpreter?.close()
        interpreter = null
        modelBuffer = null
    }

    companion object {
        private const val TAG = "FaceVerificationHelper"
    }
}
