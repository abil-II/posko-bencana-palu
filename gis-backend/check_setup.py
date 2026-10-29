#!/usr/bin/env python3
"""
Script setup & validasi backend GIS Palu.
Jalankan sekali untuk memastikan semua dependensi terpasang dan OSMnx berfungsi.
"""
import sys

def check_imports():
    missing = []
    packages = [
        "fastapi", "uvicorn", "osmnx", "geopandas",
        "networkx", "shapely", "pandas", "pyproj",
    ]
    for pkg in packages:
        try:
            __import__(pkg)
            print(f"  ✅ {pkg}")
        except ImportError:
            print(f"  ❌ {pkg} — BELUM TERPASANG")
            missing.append(pkg)
    return missing

def test_osmnx_small():
    """Test cepat OSMnx dengan query kecil."""
    import osmnx as ox
    print("\nMengetes koneksi OSMnx ke OpenStreetMap …")
    try:
        G = ox.graph_from_place("Palu, Indonesia", network_type="drive", simplify=True)
        print(f"  ✅ Berhasil! Graph: {len(G.nodes)} node, {len(G.edges)} edge")
        return True
    except Exception as e:
        print(f"  ❌ Gagal: {e}")
        return False

if __name__ == "__main__":
    print("=== Cek Dependensi Backend GIS Palu ===\n")
    missing = check_imports()
    if missing:
        print(f"\n⚠️  Pasang paket yang hilang:\n  pip install {' '.join(missing)}")
        sys.exit(1)

    print("\n=== Tes Koneksi OSMnx ===")
    ok = test_osmnx_small()
    if ok:
        print("\n🎉 Semua siap! Jalankan: uvicorn main:app --reload")
    else:
        print("\n⚠️  Periksa koneksi internet Anda.")
        sys.exit(1)
