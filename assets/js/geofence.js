/*
=========================================
 FILE: geofence.js
 (Logika Pengecekan Radius Kampus)
=========================================
*/

//
// --- INI SAKLARNYA ---
// Set 'false' saat Anda coding di rumah
// Set 'true' saat aplikasi di-deploy/testing di kampus
//
const IS_CAMPUS_CHECK_ENABLED = false;

//
// --- KONFIGURASI AREA KAMPUS ---
//
// 1. Tentukan Titik Pusat Kampus (Ambil dari maps.js Anda)
const CAMPUS_CENTER = L.latLng(-7.5567, 110.7711);

// 2. Tentukan Radius (dalam METER)
// Anda HARUS menyesuaikan angka ini. Coba 800m dulu.
const CAMPUS_RADIUS_METERS = 800;

/**
 * Fungsi utama untuk mengecek apakah pengguna ada di dalam radius kampus.
 * @param {L.LatLng} userLatLng - Objek LatLng lokasi pengguna.
 * @returns {boolean} - True jika di dalam kampus, False jika di luar.
 */
function isUserOnCampus(userLatLng) {
  // Jika saklar dimatikan, kita anggap pengguna SELALU di dalam kampus.
  if (!IS_CAMPUS_CHECK_ENABLED) {
    console.log("Geofence: Check dinonaktifkan (Mode Development).");
    return true;
  }

  // Hitung jarak dari pengguna ke pusat kampus
  const distance = userLatLng.distanceTo(CAMPUS_CENTER);

  console.log(`Geofence: Jarak ke pusat kampus: ${distance} meter.`);

  // Kembalikan true HANYA jika jaraknya lebih kecil dari radius
  return distance <= CAMPUS_RADIUS_METERS;
}