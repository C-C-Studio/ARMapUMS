/*
=========================================
 FILE: geofence-google-2.js (VERSI MODULE)
 (PERBAIKAN)
=========================================
*/

// --- INI SAKLARNYA ---
const IS_CAMPUS_CHECK_ENABLED = false;
const CAMPUS_RADIUS_METERS = 800;

// Variabel untuk menampung library (akan diisi oleh initGeofence)
let spherical;
let LatLng;
let CAMPUS_CENTER;

/**
 * Fungsi inisialisasi yang HARUS dipanggil oleh skrip utama.
 * Ini akan mengimpor library yang dibutuhkan.
 */
export async function initGeofence() {
    // Tunggu google object ada (jika API script belum selesai)
    while (typeof google === 'undefined' || typeof google.maps === 'undefined') {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Impor library yang kita butuhkan
    const { spherical } = await google.maps.importLibrary("geometry");
    
    // DIUBAH: Ambil LatLng dari global namespace, BUKAN dari library 'maps'
    const { LatLng } = google.maps; 
    
    // Simpan di variabel module
    window.spherical = spherical; // Simpan secara global jika dibutuhkan
    window.LatLng = LatLng;     // Simpan secara global jika dibutuhkan
    
    CAMPUS_CENTER = new LatLng(-7.5567, 110.7711);
    console.log("Geofence module initialized.");
}

/**
 * Fungsi utama untuk mengecek apakah pengguna ada di dalam radius kampus.
 * @param {google.maps.LatLng} userLatLng - Objek LatLng lokasi pengguna.
 * @returns {boolean} - True jika di dalam kampus, False jika di luar.
 */
export function isUserOnCampus(userLatLng) {
  if (!IS_CAMPUS_CHECK_ENABLED) {
    console.log("Geofence: Check dinonaktifkan (Mode Development).");
    return true;
  }

  if (!CAMPUS_CENTER || !window.spherical) {
    console.warn("Geofence belum siap (initGeofence belum dipanggil).");
    return false; 
  }

  // Gunakan library yang sudah diimpor
  const distance = window.spherical.computeDistanceBetween(
    userLatLng,
    CAMPUS_CENTER
  );

  console.log(`Geofence: Jarak ke pusat kampus: ${distance} meter.`);

  return distance <= CAMPUS_RADIUS_METERS;
}