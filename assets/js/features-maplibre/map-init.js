import { config } from './state.js';

export function initMap() {
    const map = new maplibregl.Map({
        container: 'map',
        style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_API_KEY}`,
        center: [config.lonmap, config.latmap], // [Lng, Lat]
        zoom: 16.5,
        pitch: 45,
        bearing: -17.6
    });

    // Fix render bug
    setTimeout(() => {
        map.resize();
    }, 500);

    return map;
}