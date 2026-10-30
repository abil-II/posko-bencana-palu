"""
Sistem Pencarian Rute Tercepat Menuju Posko Bencana Alam di Kota Palu
Backend FastAPI — Kelompok 3 AFL2 Compgraph

Alur:
1. Muat data OSM Kota Palu (graph jalan + batas wilayah) sekali saat startup.
2. Endpoint POST /find-route menerima koordinat WGS84 dari frontend.
3. Transformasi CRS → UTM Zona 50S (EPSG:32750).
4. Buffering adaptif (2 km → 5 km).
5. Spatial Join (intersects) untuk menyaring posko dalam radius.
6. Pathfinding A* via NetworkX untuk rute tercepat.
7. Kembalikan GeoJSON (dikembalikan ke EPSG:4326) ke frontend.
"""

import json
import math
import logging
from contextlib import asynccontextmanager
from typing import Any

import geopandas as gpd
import networkx as nx
import osmnx as ox
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from shapely.geometry import Point, mapping, shape

# ──────────────────────────────────────────────────────────
# Konfigurasi logging
# ──────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("gis-palu")

# ──────────────────────────────────────────────────────────
# Konstanta CRS
# ──────────────────────────────────────────────────────────
CRS_GEO = "EPSG:4326"   # WGS84 — input/output frontend
CRS_UTM = "EPSG:32750"  # UTM Zona 50S — perhitungan metrik

# ──────────────────────────────────────────────────────────
# Dataset Posko Bencana Alam Kota Palu
# Sumber: BNPB / laporan lapangan pascagempa 2018 & rencana kontijensi Kota Palu.
# Koordinat dalam WGS84 (lon, lat).
# ──────────────────────────────────────────────────────────
POSKO_DATA = [
    {"id": "P01", "nama": "Posko Mako Brimob Polda Sulteng",      "lon": 119.893064, "lat": -0.855826},
    {"id": "P02", "nama": "Posko Lapangan Vatulemo (Wali Kota)", "lon": 119.877881, "lat": -0.893121},
    {"id": "P03", "nama": "Posko Dinas Sosial Kota Palu",        "lon": 119.873215, "lat": -0.899120},
    {"id": "P04", "nama": "Posko Kantor BPBD Kota Palu",         "lon": 119.876100, "lat": -0.885400},
    {"id": "P05", "nama": "Posko Stadion Gawalise (Palu Barat)",  "lon": 119.838500, "lat": -0.891200},
    {"id": "P06", "nama": "Posko RSUD Undata Palu",              "lon": 119.886200, "lat": -0.852100},
    {"id": "P07", "nama": "Posko Universitas Tadulako (Untad)",  "lon": 119.896500, "lat": -0.838100},
    {"id": "P08", "nama": "Posko Kelurahan Balaroa",             "lon": 119.843200, "lat": -0.898500},
    {"id": "P09", "nama": "Posko Kelurahan Petobo",              "lon": 119.902100, "lat": -0.928400},
    {"id": "P10", "nama": "Posko Lapangan Anoa Tatura",          "lon": 119.881200, "lat": -0.911500},
]

# ──────────────────────────────────────────────────────────
# State global (dimuat sekali saat startup)
# ──────────────────────────────────────────────────────────
state: dict[str, Any] = {}


def _load_palu_data() -> None:
    """Unduh & siapkan semua layer spasial Kota Palu dari OSM."""

    logger.info("Mengunduh graph jalan Kota Palu dari OSM …")
    G = ox.graph_from_place("Palu, Indonesia", network_type="drive", simplify=True)
    G = ox.add_edge_speeds(G)
    G = ox.add_edge_travel_times(G)

    # Simpan graph asli (WGS84) dan versi proyeksi (UTM)
    G_proj = ox.project_graph(G, to_crs=CRS_UTM)
    state["G"] = G
    state["G_proj"] = G_proj

    # ── Batas wilayah Kota Palu ──
    logger.info("Mengunduh batas wilayah administratif Kota Palu …")
    city_gdf = ox.geocode_to_gdf("Palu, Indonesia")
    city_gdf = city_gdf.set_crs(CRS_GEO)
    state["city_gdf"] = city_gdf
    state["city_gdf_utm"] = city_gdf.to_crs(CRS_UTM)

    # ── Layer Posko Bencana ──
    posko_gdf = gpd.GeoDataFrame(
        POSKO_DATA,
        geometry=[Point(p["lon"], p["lat"]) for p in POSKO_DATA],
        crs=CRS_GEO,
    )
    state["posko_gdf"] = posko_gdf
    state["posko_gdf_utm"] = posko_gdf.to_crs(CRS_UTM)

    logger.info(
        "Data Palu siap: %d node jalan, %d edge jalan, %d posko.",
        len(G.nodes),
        len(G.edges),
        len(posko_gdf),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load data OSM saat aplikasi pertama kali dijalankan."""
    _load_palu_data()
    yield
    state.clear()


# ──────────────────────────────────────────────────────────
# Aplikasi FastAPI
# ──────────────────────────────────────────────────────────
app = FastAPI(
    title="GIS Posko Bencana Kota Palu",
    description="Backend pencarian rute tercepat menuju posko bencana alam di Kota Palu.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # ubah ke domain frontend saat produksi
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────
# Schema Request / Response
# ──────────────────────────────────────────────────────────
class LocationRequest(BaseModel):
    lat: float = Field(..., description="Latitude titik pengguna (WGS84)", ge=-90, le=90)
    lon: float = Field(..., description="Longitude titik pengguna (WGS84)", ge=-180, le=180)


# ──────────────────────────────────────────────────────────
# Helper
# ──────────────────────────────────────────────────────────
"""Heuristik jarak Euclidean untuk A* (bekerja pada graph yang diproyeksikan)."""
def _heuristic_astar(u: int, v: int) -> float:
    """Heuristik jarak Euclidean untuk A*."""
    G: nx.MultiDiGraph = state["G"]
    xu, yu = G.nodes[u]["x"], G.nodes[u]["y"]
    xv, yv = G.nodes[v]["x"], G.nodes[v]["y"]
    return math.hypot(xu - xv, yu - yv)


def _route_to_geojson_coords(route: list[int], G: nx.MultiDiGraph) -> list[list[float]]:
    """
    Ubah daftar node ID A* menjadi koordinat GeoJSON [lon, lat].
    G harus dalam CRS WGS84 agar koordinat langsung bisa dipakai Leaflet.
    """
    coords: list[list[float]] = []
    for i in range(len(route) - 1):
        u, v = route[i], route[i + 1]
        # Ambil edge dengan bobot terkecil (multigraph)
        edge_data = min(G[u][v].values(), key=lambda d: d.get("travel_time", float("inf")))
        if "geometry" in edge_data:
            line_coords = list(edge_data["geometry"].coords)
            # Hindari duplikat titik sambungan antar edge
            if coords and coords[-1] == list(line_coords[0]):
                line_coords = line_coords[1:]
            coords.extend([list(c) for c in line_coords])
        else:
            node_u = G.nodes[u]
            node_v = G.nodes[v]
            pt_u = [node_u["x"], node_u["y"]]
            pt_v = [node_v["x"], node_v["y"]]
            if not coords or coords[-1] != pt_u:
                coords.append(pt_u)
            coords.append(pt_v)
    return coords


# ──────────────────────────────────────────────────────────
# Endpoint Utama
# ──────────────────────────────────────────────────────────
@app.post("/find-route")
def find_route(req: LocationRequest):
    """
    Terima koordinat pengguna → kembalikan GeoJSON berisi:
    - buffer polygon
    - marker posko-posko kandidat
    - polyline rute tercepat A*
    - info posko terpilih
    """
    if not state:
        raise HTTPException(status_code=503, detail="Data OSM belum selesai dimuat.")

    G: nx.MultiDiGraph = state["G"]
    G_proj: nx.MultiDiGraph = state["G_proj"]
    posko_gdf_utm: gpd.GeoDataFrame = state["posko_gdf_utm"]
    posko_gdf: gpd.GeoDataFrame = state["posko_gdf"]

    # ── 1. Titik pengguna dalam UTM ──
    user_point_geo = Point(req.lon, req.lat)
    user_gdf = gpd.GeoDataFrame(geometry=[user_point_geo], crs=CRS_GEO)
    user_gdf_utm = user_gdf.to_crs(CRS_UTM)
    user_point_utm = user_gdf_utm.geometry.iloc[0]

    # ── 2. Buffering Adaptif ──
    radius = 2000  # meter
    buffer_utm = user_point_utm.buffer(radius)
    buffer_gdf = gpd.GeoDataFrame(geometry=[buffer_utm], crs=CRS_UTM)

    # Spatial Join — intersects
    candidate_gdf = gpd.sjoin(
        posko_gdf_utm,
        buffer_gdf,
        how="inner",
        predicate="intersects",
    )

    # Perluasan otomatis ke 5 km jika kosong
    if candidate_gdf.empty:
        radius = 5000
        buffer_utm = user_point_utm.buffer(radius)
        buffer_gdf = gpd.GeoDataFrame(geometry=[buffer_utm], crs=CRS_UTM)
        candidate_gdf = gpd.sjoin(
            posko_gdf_utm,
            buffer_gdf,
            how="inner",
            predicate="intersects",
        )

    if candidate_gdf.empty:
        raise HTTPException(
            status_code=404,
            detail=(
                "Tidak ada posko dalam radius 5 km. "
                "Pastikan titik yang dipilih berada di dalam wilayah Kota Palu."
            ),
        )

    # ── 3. Proyeksi titik pengguna ke node OSM terdekat ──
    origin_node = ox.distance.nearest_nodes(G, req.lon, req.lat)

    # ── 4. Pathfinding A* ke setiap kandidat posko ──
    best_route: list[int] | None = None
    best_length: float = float("inf")
    best_posko_idx: int = -1

    for idx, row in candidate_gdf.iterrows():
        p_lon = posko_gdf.loc[idx, "geometry"].x
        p_lat = posko_gdf.loc[idx, "geometry"].y
        dest_node = ox.distance.nearest_nodes(G, p_lon, p_lat)

        try:
            route = nx.astar_path(
                G,
                origin_node,
                dest_node,
                heuristic=_heuristic_astar,
                weight="travel_time",
            )
            length = sum(
                G[route[i]][route[i + 1]][
                    min(G[route[i]][route[i + 1]], key=lambda k: G[route[i]][route[i + 1]][k].get("travel_time", float("inf")))
                ].get("travel_time", float("inf"))
                for i in range(len(route) - 1)
            )
            if length < best_length:
                best_length = length
                best_route = route
                best_posko_idx = idx  # type: ignore[assignment]
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            continue

    if best_route is None:
        raise HTTPException(
            status_code=404,
            detail="Tidak ditemukan rute jalan yang valid menuju posko manapun.",
        )

    # ── 5. Susun GeoJSON Response ──

    # Buffer polygon → kembali ke WGS84
    buffer_geo = gpd.GeoDataFrame(geometry=[buffer_utm], crs=CRS_UTM).to_crs(CRS_GEO)
    buffer_geojson = json.loads(buffer_geo.to_json())["features"][0]

    # Semua kandidat posko (WGS84)
    posko_features = []
    for idx, row in candidate_gdf.iterrows():
        orig = posko_gdf.loc[idx]
        is_best = idx == best_posko_idx
        posko_features.append({
            "type": "Feature",
            "geometry": mapping(orig["geometry"]),
            "properties": {
                "id": orig["id"],
                "nama": orig["nama"],
                "terpilih": is_best,
            },
        })

    # Rute terpilih → koordinat WGS84
    route_coords = _route_to_geojson_coords(best_route, G)
    route_feature = {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": route_coords},
        "properties": {
            "travel_time_seconds": round(best_length),
            "travel_time_minutes": round(best_length / 60, 1),
        },
    }

    # Info posko terpilih
    best_posko_info = posko_gdf.loc[best_posko_idx]
    posko_info = {
        "id": best_posko_info["id"],
        "nama": best_posko_info["nama"],
        "lon": best_posko_info["geometry"].x,
        "lat": best_posko_info["geometry"].y,
        "travel_time_minutes": round(best_length / 60, 1),
        "radius_meter": radius,
    }

    return {
        "posko_info": posko_info,
        "geojson": {
            "type": "FeatureCollection",
            "features": [
                {**buffer_geojson, "properties": {"type": "buffer", "radius_meter": radius}},
                *posko_features,
                {**route_feature, "properties": {**route_feature["properties"], "type": "route"}},
            ],
        },
    }


@app.get("/posko")
def get_all_posko():
    """Kembalikan semua titik posko bencana dalam GeoJSON untuk ditampilkan awal."""
    if not state:
        raise HTTPException(status_code=503, detail="Data OSM belum siap.")
    gdf = state["posko_gdf"]
    return json.loads(gdf.to_json())


@app.get("/health")
def health():
    return {"status": "ok", "data_loaded": bool(state)}
