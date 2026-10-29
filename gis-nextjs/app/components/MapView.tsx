'use client';

import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  GeoJSON,
  useMapEvents,
  ZoomControl,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// ── Fix ikon Leaflet default di Next.js/Webpack ──────────────────────────────
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Ikon kustom ─────────────────────────────────────────────────────────────
const makeIcon = (color: string, size = 28) =>
  L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="${size}" height="${size * 1.3}">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}" stroke="white" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="5" fill="white"/>
    </svg>`,
    className: '',
    iconSize: [size, size * 1.3],
    iconAnchor: [size / 2, size * 1.3],
    popupAnchor: [0, -(size * 1.3)],
  });

const ICON_USER    = makeIcon('#F97316');   // oranye  — titik pengguna
const ICON_BEST    = makeIcon('#EF4444', 34); // merah besar — posko terpilih
const ICON_POSKO   = makeIcon('#6366F1');   // ungu   — semua posko
const ICON_CAND    = makeIcon('#22C55E');   // hijau  — kandidat dalam radius

// ── Kota Palu center & bounds ────────────────────────────────────────────────
const PALU_CENTER: [number, number] = [-0.896, 119.863];
const PALU_BOUNDS: L.LatLngBoundsExpression = [
  [-1.1, 119.65],
  [-0.65, 120.1],
];

// ── Types ────────────────────────────────────────────────────────────────────
interface MapViewProps {
  onMapClick: (lat: number, lon: number) => void;
  userLatLng: [number, number] | null;
  routeGeoJSON: GeoJSON.FeatureCollection | null;
  allPoskoGeoJSON: GeoJSON.FeatureCollection | null;
}

// ── Sub-komponen: klik peta ──────────────────────────────────────────────────
function ClickHandler({ onMapClick }: { onMapClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// ── Style layer GeoJSON ──────────────────────────────────────────────────────
function bufferStyle(): L.PathOptions {
  return {
    color: '#3B82F6',
    fillColor: '#3B82F6',
    fillOpacity: 0.12,
    weight: 2,
    dashArray: '6 4',
  };
}

function routeStyle(): L.PathOptions {
  return {
    color: '#EF4444',
    weight: 5,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round',
  };
}

// ── Komponen utama MapView ───────────────────────────────────────────────────
export default function MapView({
  onMapClick,
  userLatLng,
  routeGeoJSON,
  allPoskoGeoJSON,
}: MapViewProps) {
  const geoJsonBufferRef = useRef<L.GeoJSON | null>(null);
  const geoJsonRouteRef  = useRef<L.GeoJSON | null>(null);

  // Pisahkan feature berdasarkan tipe
  const bufferFeatures   = routeGeoJSON?.features.filter((f) => f.properties?.type === 'buffer')   ?? [];
  const routeFeatures    = routeGeoJSON?.features.filter((f) => f.properties?.type === 'route')    ?? [];
  const poskoFeatures    = routeGeoJSON?.features.filter((f) => f.properties?.nama !== undefined)  ?? [];

  // Key untuk force re-render layer GeoJSON saat data berubah
  const geoJsonKey = routeGeoJSON
    ? JSON.stringify(routeGeoJSON.features.map((f) => f.properties?.id ?? f.properties?.type))
    : 'empty';

  const allPoskoKey = allPoskoGeoJSON ? 'allPosko' : 'noPosko';

  return (
    <MapContainer
      center={PALU_CENTER}
      zoom={13}
      maxBounds={PALU_BOUNDS}
      maxBoundsViscosity={0.8}
      className="w-full h-full"
      zoomControl={false}
    >
      {/* ── Basemap OpenStreetMap ── */}
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />

      <ZoomControl position="bottomright" />
      <ClickHandler onMapClick={onMapClick} />

      {/* ── Semua posko (latar belakang, selalu tampil) ── */}
      {allPoskoGeoJSON && (
        <GeoJSON
          key={allPoskoKey}
          data={allPoskoGeoJSON}
          pointToLayer={(feature, latlng) =>
            L.marker(latlng, { icon: ICON_POSKO })
          }
          onEachFeature={(feature, layer) => {
            if (feature.properties?.nama) {
              layer.bindPopup(
                `<div class="text-sm">
                  <b class="text-indigo-700">${feature.properties.nama}</b><br/>
                  <span class="text-gray-500">ID: ${feature.properties.id}</span>
                </div>`,
              );
            }
          }}
        />
      )}

      {/* ── Layer hasil pencarian ── */}
      {routeGeoJSON && (
        <>
          {/* Buffer polygon */}
          {bufferFeatures.length > 0 && (
            <GeoJSON
              key={`buffer-${geoJsonKey}`}
              data={{ type: 'FeatureCollection', features: bufferFeatures } as GeoJSON.FeatureCollection}
              style={bufferStyle}
              onEachFeature={(feature, layer) => {
                layer.bindPopup(
                  `<span class="text-sm text-blue-700 font-medium">
                    Zona Pencarian: radius ${feature.properties?.radius_meter / 1000} km
                  </span>`,
                );
              }}
            />
          )}

          {/* Polyline rute A* */}
          {routeFeatures.length > 0 && (
            <GeoJSON
              key={`route-${geoJsonKey}`}
              data={{ type: 'FeatureCollection', features: routeFeatures } as GeoJSON.FeatureCollection}
              style={routeStyle}
              onEachFeature={(feature, layer) => {
                layer.bindPopup(
                  `<span class="text-sm text-red-700 font-medium">
                    ⏱️ Estimasi: ${feature.properties?.travel_time_minutes} menit
                  </span>`,
                );
              }}
            />
          )}

          {/* Marker posko kandidat */}
          {poskoFeatures.map((feature, i) => {
            const coords = (feature.geometry as GeoJSON.Point).coordinates;
            const isBest = feature.properties?.terpilih === true;
            return (
              <Marker
                key={`posko-${i}-${geoJsonKey}`}
                position={[coords[1], coords[0]]}
                icon={isBest ? ICON_BEST : ICON_CAND}
                zIndexOffset={isBest ? 1000 : 0}
              >
                <Popup>
                  <div className="text-sm">
                    {isBest && (
                      <p className="text-red-600 font-bold mb-1">🏅 Posko Terdekat</p>
                    )}
                    <b className="text-green-700">{feature.properties?.nama}</b>
                    <br />
                    <span className="text-gray-500">ID: {feature.properties?.id}</span>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </>
      )}

      {/* ── Marker titik pengguna ── */}
      {userLatLng && (
        <Marker position={userLatLng} icon={ICON_USER} zIndexOffset={2000}>
          <Popup>
            <div className="text-sm">
              <b className="text-orange-600">📍 Lokasi Anda</b>
              <br />
              <span className="font-mono text-gray-500 text-xs">
                {userLatLng[0].toFixed(6)}, {userLatLng[1].toFixed(6)}
              </span>
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
