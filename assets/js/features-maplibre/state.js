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
    isPreviewingRoute: false,
    snapBackTimer: null,
    currentRouteLine: null, // Untuk Snap-to-Road
    isSnapToRoadActive: false, // Default mati

    // Kompas & Marker
    lastCompassAlpha: 0,
    smoothedAlpha: null,
    correctedNeedleHeading: 0,
    correctedConeHeading: 0,
    userMarker: null, // Object Marker MapLibre

    // Augmented Reality (AR)
    isArActive: false,
    arMiniMap: null,
    arRouteLine: null, // Menyimpan rute yang diproses untuk AR
    arHeading: 0,      // Heading khusus AR
};

// Konstanta konfigurasi
export const config = {
    latmap: -7.5567,
    lonmap: 110.7711,
    smoothingFactor: 0.1
};

// Referensi Elemen DOM Global (yang sering dipakai)
export const elements = {
    routeInfoPanel: document.getElementById('route-info-panel'),
    routeDestName: document.getElementById('route-dest-name'),
    routeDestDistance: document.getElementById('route-dest-distance'),
    routeDestTime: document.getElementById('route-dest-time'),
    
    startNavBtn: document.getElementById('start-nav-btn'),
    cancelNavBtn: document.getElementById('cancel-nav-btn'),
    snapToRoadBtn: document.getElementById('snap-to-road-btn'),

    distanceIndicator: document.getElementById('distance-indicator'),
    distanceText: document.getElementById('distance-text'),

    compassIndicator: document.getElementById('compass-indicator'),
    compassNeedle: document.getElementById('compass-needle'),
    degreeIndicator: document.getElementById('degree-indicator'),

    bottomNavbar: document.getElementById('bottom-navbar'),
    arContainer: document.getElementById('ar-container'),
    arButton: document.getElementById('ar-btn'),
    closeArButton: document.getElementById('close-ar-btn'),
    locateButton: document.getElementById('locate-btn')
};