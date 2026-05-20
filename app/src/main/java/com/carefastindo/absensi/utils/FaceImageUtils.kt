package com.carefastindo.absensi.utils

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import androidx.camera.core.ImageProxy
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

object FaceImageUtils {

    fun imageProxyToBitmap(image: ImageProxy): Bitmap? {
        if (image.format != ImageFormat.YUV_420_888) return null

        val nv21 = yuv420888ToNv21(image)
        val yuvImage = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
        val out = ByteArrayOutputStream()
        yuvImage.compressToJpeg(Rect(0, 0, image.width, image.height), 90, out)
        val imageBytes = out.toByteArray()
        return BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
    }

    fun rotateBitmap(bitmap: Bitmap, degrees: Float, mirrorHorizontal: Boolean = true): Bitmap {
        if (degrees == 0f && !mirrorHorizontal) return bitmap

        val matrix = Matrix()
        matrix.postRotate(degrees)
        if (mirrorHorizontal) {
            matrix.postScale(-1f, 1f, bitmap.width / 2f, bitmap.height / 2f)
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    fun cropFaceBitmap(bitmap: Bitmap, boundingBox: Rect, marginRatio: Float = 0.2f): Bitmap? {
        val marginX = (boundingBox.width() * marginRatio).toInt()
        val marginY = (boundingBox.height() * marginRatio).toInt()
        val cropRect = Rect(
            boundingBox.left - marginX,
            boundingBox.top - marginY,
            boundingBox.right + marginX,
            boundingBox.bottom + marginY
        )

        val hasFaceArea = cropRect.intersect(0, 0, bitmap.width, bitmap.height)
        if (!hasFaceArea || cropRect.width() <= 0 || cropRect.height() <= 0) return null

        return Bitmap.createBitmap(bitmap, cropRect.left, cropRect.top, cropRect.width(), cropRect.height())
    }

    private fun yuv420888ToNv21(image: ImageProxy): ByteArray {
        val width = image.width
        val height = image.height
        val ySize = width * height
        val uvSize = width * height / 4
        val nv21 = ByteArray(ySize + uvSize * 2)

        val yPlane = image.planes[0]
        val uPlane = image.planes[1]
        val vPlane = image.planes[2]

        copyPlane(
            buffer = yPlane.buffer,
            width = width,
            height = height,
            rowStride = yPlane.rowStride,
            pixelStride = yPlane.pixelStride,
            output = nv21,
            outputOffset = 0,
            outputStride = 1
        )
        copyPlane(
            buffer = vPlane.buffer,
            width = width / 2,
            height = height / 2,
            rowStride = vPlane.rowStride,
            pixelStride = vPlane.pixelStride,
            output = nv21,
            outputOffset = ySize,
            outputStride = 2
        )
        copyPlane(
            buffer = uPlane.buffer,
            width = width / 2,
            height = height / 2,
            rowStride = uPlane.rowStride,
            pixelStride = uPlane.pixelStride,
            output = nv21,
            outputOffset = ySize + 1,
            outputStride = 2
        )

        return nv21
    }

    private fun copyPlane(
        buffer: ByteBuffer,
        width: Int,
        height: Int,
        rowStride: Int,
        pixelStride: Int,
        output: ByteArray,
        outputOffset: Int,
        outputStride: Int
    ) {
        val inputBuffer = buffer.duplicate()
        var outputIndex = outputOffset

        for (row in 0 until height) {
            val rowStart = row * rowStride
            for (col in 0 until width) {
                val inputIndex = rowStart + col * pixelStride
                if (inputIndex < inputBuffer.limit() && outputIndex < output.size) {
                    output[outputIndex] = inputBuffer.get(inputIndex)
                }
                outputIndex += outputStride
            }
        }
    }
}
