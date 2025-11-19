// State Management
// Menyimpan variabel yang digunakan bersama antar modul

export const state = {
    userLocation: null,
    isUserOnCampusFlag: false,
    pendingRouteDestination: null,
    activePopup: null,
    isProgrammaticTrigger: false,
    
    // Navigasi
    isNavigating: false,
    wasNavigating: false,
    snapBackTimer: null,
    currentRouteLine: null, // Untuk Snap-to-Road
    isSnapToRoadActive: false, // Default mati

    // Kompas & Marker
    lastCompassAlpha: 0,
    smoothedAlpha: null,
    correctedNeedleHeading: 0,
    correctedConeHeading: 0,
    userMarker: null, // Object Marker MapLibre
};

// Konstanta konfigurasi
export const config = {
    latmap: -7.5567,
    lonmap: 110.7711,
    smoothingFactor: 0.1
};

// Referensi Elemen DOM Global (yang sering dipakai)
export const elements = {
    startNavBtn: document.getElementById('start-nav-btn'),
    cancelNavBtn: document.getElementById('cancel-nav-btn'),
    snapToRoadBtn: document.getElementById('snap-to-road-btn'),
    compassIndicator: document.getElementById('compass-indicator'),
    compassNeedle: document.getElementById('compass-needle'),
    degreeIndicator: document.getElementById('degree-indicator'),
    bottomNavbar: document.getElementById('bottom-navbar'),
    arContainer: document.getElementById('ar-container'),
    arButton: document.getElementById('ar-btn'),
    closeArButton: document.getElementById('close-ar-btn'),
    locateButton: document.getElementById('locate-btn')
};