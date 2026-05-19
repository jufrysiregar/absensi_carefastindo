package com.carefastindo.absensi.ui.about

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.carefastindo.absensi.databinding.ActivityTentangAplikasiBinding

class TentangAplikasiActivity : AppCompatActivity() {

    private lateinit var binding: ActivityTentangAplikasiBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityTentangAplikasiBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupToolbar()
    }

    private fun setupToolbar() {
        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        supportActionBar?.setDisplayShowHomeEnabled(true)
        
        binding.toolbar.setNavigationOnClickListener {
            onBackPressedDispatcher.onBackPressed()
        }
    }
}
