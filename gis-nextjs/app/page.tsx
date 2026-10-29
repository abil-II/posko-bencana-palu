'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

// ── Types ────────────────────────────────────────────────────────────────────
interface PoskoInfo {
  id: string;
  nama: string;
  lon: number;
  lat: number;
  travel_time_minutes: number;
  radius_meter: number;
}

interface RouteResponse {
  posko_info: PoskoInfo;
  geojson: GeoJSON.FeatureCollection;
}

// ── Dynamic import komponen Peta (SSR = false) ───────────────────────────────
const MapView = dynamic(() => import('./components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-slate-100">
      <div className="text-slate-500 text-sm animate-pulse">Memuat peta …</div>
    </div>
  ),
});

// ── Halaman Utama ─────────────────────────────────────────────────────────────
export default function HomePage() {
  const [userLatLng, setUserLatLng] = useState<[number, number] | null>(null);
  const [routeData, setRouteData] = useState<RouteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allPosko, setAllPosko] = useState<GeoJSON.FeatureCollection | null>(null);

  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

  // Ambil semua posko saat halaman pertama dimuat
  useEffect(() => {
    fetch(`${BACKEND_URL}/posko`)
      .then((r) => r.json())
      .then((data) => setAllPosko(data))
      .catch(() => {}); // Diam-diam gagal, UI tetap berfungsi
  }, [BACKEND_URL]);

  // Handler klik peta → kirim ke backend
  const handleMapClick = useCallback(
    async (lat: number, lon: number) => {
      setUserLatLng([lat, lon]);
      setRouteData(null);
      setError(null);
      setLoading(true);

      try {
        const res = await fetch(`${BACKEND_URL}/find-route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat, lon }),
        });

        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.detail ?? `HTTP ${res.status}`);
        }

        const data: RouteResponse = await res.json();
        setRouteData(data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Terjadi kesalahan.');
      } finally {
        setLoading(false);
      }
    },
    [BACKEND_URL],
  );

  const handleReset = () => {
    setUserLatLng(null);
    setRouteData(null);
    setError(null);
  };

  return (
    <div className="flex flex-col h-screen font-sans">
      {/* ── Header ── */}
      <header className="bg-red-700 text-white px-4 py-3 shadow-md flex items-center gap-3 shrink-0">
        <span className="text-2xl">🆘</span>
        <div>
          <h1 className="text-lg font-bold leading-tight">
            Sistem Rute Tercepat Posko Bencana Alam
          </h1>
          <p className="text-xs text-red-200">Kota Palu, Sulawesi Tengah — Data OSM Real-time</p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ── */}
        <aside className="w-72 shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
          {/* Panduan */}
          <div className="p-4 bg-blue-50 border-b border-blue-100">
            <h2 className="font-semibold text-blue-800 mb-1 text-sm">📍 Cara Penggunaan</h2>
            <ol className="text-xs text-blue-700 space-y-1 list-decimal list-inside">
              <li>Klik pada titik mana saja di peta Kota Palu.</li>
              <li>Sistem mencari posko dalam radius 2 km (atau 5 km).</li>
              <li>Rute tercepat dihitung dengan algoritma A*.</li>
            </ol>
          </div>

          {/* Status */}
          <div className="p-4 border-b border-slate-100 flex-1">
            {!userLatLng && !loading && (
              <p className="text-slate-400 text-xs text-center mt-8">
                Klik peta untuk memilih lokasi Anda.
              </p>
            )}

            {loading && (
              <div className="flex flex-col items-center gap-2 mt-8">
                <div className="w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
                <p className="text-slate-500 text-xs">Menghitung rute …</p>
              </div>
            )}

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-700 text-xs font-medium">⚠️ {error}</p>
                <button
                  onClick={handleReset}
                  className="mt-2 text-xs text-red-600 underline"
                >
                  Coba lokasi lain
                </button>
              </div>
            )}

            {userLatLng && !loading && !error && (
              <div className="space-y-3">
                {/* Koordinat pengguna */}
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <p className="text-xs font-semibold text-slate-600 mb-1">📌 Lokasi Anda</p>
                  <p className="text-xs text-slate-500 font-mono">
                    {userLatLng[0].toFixed(6)}, {userLatLng[1].toFixed(6)}
                  </p>
                </div>

                {/* Info hasil rute */}
                {routeData && (
                  <>
                    <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                      <p className="text-xs font-semibold text-green-700 mb-1">
                        🏥 Posko Terdekat
                      </p>
                      <p className="text-sm font-bold text-green-900">
                        {routeData.posko_info.nama}
                      </p>
                      <p className="text-xs text-green-700 mt-1">
                        ID: {routeData.posko_info.id}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2 bg-orange-50 rounded-lg border border-orange-200 text-center">
                        <p className="text-xs text-orange-600 font-medium">⏱️ Waktu</p>
                        <p className="text-base font-bold text-orange-800">
                          {routeData.posko_info.travel_time_minutes} mnt
                        </p>
                      </div>
                      <div className="p-2 bg-purple-50 rounded-lg border border-purple-200 text-center">
                        <p className="text-xs text-purple-600 font-medium">📏 Radius</p>
                        <p className="text-base font-bold text-purple-800">
                          {(routeData.posko_info.radius_meter / 1000).toFixed(0)} km
                        </p>
                      </div>
                    </div>

                    {/* Legend */}
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <p className="text-xs font-semibold text-slate-600 mb-2">🗺️ Legenda</p>
                      <div className="space-y-1.5">
                        <LegendItem color="#3B82F6" opacity={0.2} label="Zona Buffer Pencarian" type="fill" />
                        <LegendItem color="#EF4444" label="Rute Tercepat (A*)" type="line" />
                        <LegendItem color="#22C55E" label="Posko dalam Radius" type="dot" />
                        <LegendItem color="#6366F1" label="Semua Posko" type="dot" />
                        <LegendItem color="#F97316" label="Lokasi Anda" type="dot" />
                      </div>
                    </div>
                  </>
                )}

                <button
                  onClick={handleReset}
                  className="w-full text-xs py-2 px-3 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  ↺ Reset Peta
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 bg-slate-50 border-t border-slate-200">
            <p className="text-xs text-slate-400 text-center">
              Data: OpenStreetMap © Contributors
            </p>
            <p className="text-xs text-slate-400 text-center">
              Kelompok 3 · AFL2 Compgraph · 2026
            </p>
          </div>
        </aside>

        {/* ── Area Peta ── */}
        <main className="flex-1 relative">
          <MapView
            onMapClick={handleMapClick}
            userLatLng={userLatLng}
            routeGeoJSON={routeData?.geojson ?? null}
            allPoskoGeoJSON={allPosko}
          />
        </main>
      </div>
    </div>
  );
}

// ── Komponen kecil Legenda ────────────────────────────────────────────────────
function LegendItem({
  color,
  opacity = 1,
  label,
  type,
}: {
  color: string;
  opacity?: number;
  label: string;
  type: 'fill' | 'line' | 'dot';
}) {
  const style: React.CSSProperties =
    type === 'fill'
      ? { backgroundColor: color, opacity, border: `2px solid ${color}`, borderRadius: 2 }
      : type === 'line'
        ? { backgroundColor: color, height: 3, borderRadius: 2 }
        : { backgroundColor: color, borderRadius: '50%', width: 10, height: 10 };

  return (
    <div className="flex items-center gap-2">
      <div
        style={
          type === 'dot'
            ? style
            : { ...style, width: 18, height: type === 'line' ? 3 : 12 }
        }
      />
      <span className="text-xs text-slate-600">{label}</span>
    </div>
  );
}
