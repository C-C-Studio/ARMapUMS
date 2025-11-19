// Main Entry Point untuk Peta MapLibre
// Mengimport modul-modul fitur dari folder features-maplibre

import { initMap } from './features-maplibre/map-init.js';
import { loadMapData } from './features-maplibre/data-loader.js';
import { setupGeolocation } from './features-maplibre/geolocation.js';
import { setupNavigation } from './features-maplibre/navigation.js';
import { setupUI } from './features-maplibre/ui-controls.js';

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
map.on('load', () => {
    console.log("Map Loaded. Initializing features...");

    // Load Data (Marker & Path)
    loadMapData(map);

    // Setup UI (Search, Navbar)
    setupUI(map);

    // Setup Geolocation (User Marker, Compass, Locate Button)
    setupGeolocation(map, geolocate);

    // Setup Navigation (Routing, Snap to Road, Start/Cancel Btns)
    setupNavigation(map, geolocate);

    // Trigger awal lokasi
    // geolocate.trigger();
});