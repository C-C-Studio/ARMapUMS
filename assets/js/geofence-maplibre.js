/*
=========================================
 FILE: geofence.js
 (Logika Pengecekan Radius Kampus)
 (DIUBAH UNTUK MAPLIBRE)
=========================================
*/

// --- INI SAKLARNYA ---
const IS_CAMPUS_CHECK_ENABLED = false;

// --- KONFIGURASI AREA KAMPUS ---

// 1. DIUBAH: Tentukan Titik Pusat Kampus (Gunakan format MapLibre)
// Format: new maplibregl.LngLat(LONGITUDE, LATITUDE)
const CAMPUS_CENTER = new maplibregl.LngLat(110.7711, -7.5567);

// 2. Tentukan Radius (dalam METER)
const CAMPUS_RADIUS_METERS = 800;

/**
 * Fungsi utama untuk mengecek apakah pengguna ada di dalam radius kampus.
 * @param {maplibregl.LngLat} userLngLat - Objek LngLat lokasi pengguna.
 * @returns {boolean} - True jika di dalam kampus, False jika di luar.
 */
function isUserOnCampus(userLngLat) {
  if (!IS_CAMPUS_CHECK_ENABLED) {
    console.log("Geofence: Check dinonaktifkan (Mode Development).");
    return true;
  }

  // 2. DIUBAH: Gunakan fungsi .distanceTo() milik MapLibre
  const distance = userLngLat.distanceTo(CAMPUS_CENTER);

  console.log(`Geofence: Jarak ke pusat kampus: ${distance} meter.`);

  return distance <= CAMPUS_RADIUS_METERS;
}