// Main Entry Point untuk Peta MapLibre
// Mengimport modul-modul fitur dari folder features-maplibre

import { initMap } from './features-maplibre/map-init.js';
import { loadMapData } from './features-maplibre/data-loader.js';
import { setupGeolocation } from './features-maplibre/geolocation.js';
import { setupNavigation, setupTeleportDebug } from './features-maplibre/navigation.js';
import { setupUI } from './features-maplibre/ui-controls.js';
// Import modul AR
import { startARSession, endARSession } from './features-maplibre/ar-navigation.js';
import { elements } from './features-maplibre/state.js';

// 1. Inisialisasi Peta
const map = initMap();

// 2. Buat Kontrol Geolocate (diperlukan oleh modul geolocation & navigation)
const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showUserLocation: false,
    showUserHeading: true
});
map.addControl(geolocate); // Tambahkan tanpa UI default (karena kita punya tombol custom)

// 3. Jalankan Fitur-Fitur saat Peta siap
// ... imports ...

map.on('load', () => {
    console.log("Map Loaded. Initializing features...");

    loadMapData(map);
    setupTeleportDebug(map);
    setupUI(map);
    setupGeolocation(map, geolocate);
    setupNavigation(map, geolocate);

    // --- PERBAIKAN DI SINI ---
    
    // HAPUS listener ganda yang lama. Gunakan HANYA SATU listener ini:
    
    // 1. Listener Tombol Masuk AR
    elements.arButton.addEventListener('click', (e) => {
        e.preventDefault(); // Mencegah refresh halaman
        console.log("Tombol AR ditekan, memulai sesi...");
        startARSession();
    });

    // 2. Listener Tombol Keluar AR
    elements.closeArButton.addEventListener('click', (e) => {
        e.preventDefault();
        endARSession();
    });
});